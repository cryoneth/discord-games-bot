import {
  answerPoints,
  QUIZ_TIMING,
  sanitizeQuiz,
  streakBonus,
  type Quiz,
  type QuizPhase,
  type QuizQuestion,
  type QuizServerMessage,
  type QuizSettings,
  type QuizStateMessage,
  type QuizSummary,
} from '../../shared/quiz.js';
import type { QuizRepo } from '../../store.js';
import { shuffle } from '../../util/random.js';
import { BaseRoom, type RoomContext, type Seat } from '../base.js';
import { BUILTIN_QUIZZES } from '../data/quizzes.js';

interface QuizSeat extends Seat {
  streak: number;
}

export interface QuizTiming {
  introMs: number;
  revealMs: number;
  /** Length of one question "second". Tests shrink it. */
  secondMs: number;
}

const DEFAULT_TIMING: QuizTiming = { introMs: QUIZ_TIMING.introSeconds * 1000, revealMs: QUIZ_TIMING.revealSeconds * 1000, secondMs: 1000 };
const ID_RE = /^(builtin:[a-z0-9-]{1,40}|[0-9a-f-]{36})$/;

/** Live multiple-choice quiz with speed scoring and streaks. */
export class QuizRoom extends BaseRoom<QuizSeat> {
  protected readonly minPlayers = 1;
  protected readonly maxPlayers = 16;
  private phase: QuizPhase = 'lobby';
  private settings: QuizSettings = { quizId: BUILTIN_QUIZZES[0]!.id, shuffle: false };
  private quiz: Quiz | null = null;
  private questions: QuizQuestion[] = [];
  private index = 0;
  private endsAt: number | null = null;
  private askedAt = 0;
  private answers = new Map<string, { index: number; at: number }>();
  private reveal: QuizStateMessage['reveal'] = null;

  constructor(
    ctx: RoomContext,
    private readonly repo: QuizRepo,
    private readonly timing: QuizTiming = DEFAULT_TIMING,
  ) {
    super(ctx);
  }

  get idle(): boolean {
    return this.phase === 'lobby' || this.phase === 'finished';
  }

  get currentPhase(): QuizPhase {
    return this.phase;
  }

  protected createSeat(user: { id: string; name: string }): QuizSeat {
    return { ...user, score: 0, streak: 0, conns: new Set() };
  }

  private findQuiz(id: string | null): Quiz | null {
    if (!id || !ID_RE.test(id)) return null;
    return BUILTIN_QUIZZES.find((q) => q.id === id) ?? this.repo.get(id)?.quiz ?? null;
  }

  private summaries(userId: string): QuizSummary[] {
    return [
      ...BUILTIN_QUIZZES.map((q) => ({ id: q.id, title: q.title, count: q.questions.length, mine: false, builtin: true })),
      ...this.repo.list(userId),
    ];
  }

  protected override applySettings(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const { quizId, shuffle: shuf } = raw as Record<string, unknown>;
    if (typeof shuf !== 'boolean' || typeof quizId !== 'string' || !this.findQuiz(quizId)) return false;
    this.settings = { quizId, shuffle: shuf };
    return true;
  }

  protected override canStart(userId: string): boolean {
    if (this.findQuiz(this.settings.quizId)) return true;
    this.direct(userId, 'Pick a quiz first.');
    return false;
  }

  protected begin(): void {
    this.quiz = this.findQuiz(this.settings.quizId)!;
    if (!this.quiz.id.startsWith('builtin:')) this.repo.markUsed(this.quiz.id);
    this.questions = this.settings.shuffle ? shuffle(this.quiz.questions) : [...this.quiz.questions];
    this.index = 0;
    for (const s of this.players.values()) s.streak = 0;
    this.system(`⚡ ${this.quiz.title}: ${this.questions.length} question${this.questions.length === 1 ? '' : 's'}. Faster answers score more!`);
    this.intro();
  }

  protected abort(): void {
    this.phase = 'lobby';
    this.endsAt = null;
    this.reveal = null;
    this.answers.clear();
  }

  protected onDeparture(): void {
    if (this.phase === 'question') this.maybeRevealEarly();
  }

  protected onMessage(seat: QuizSeat, msg: { t: string } & Record<string, unknown>): void {
    switch (msg.t) {
      case 'answer': {
        if (this.phase !== 'question' || this.answers.has(seat.id)) return;
        const q = this.questions[this.index];
        const index = msg.index;
        if (!q || !Number.isInteger(index) || (index as number) < 0 || (index as number) >= q.answers.length) return;
        this.answers.set(seat.id, { index: index as number, at: Date.now() });
        if (!this.maybeRevealEarly()) this.broadcastState();
        return;
      }
      case 'next':
        if (this.phase === 'reveal' && this.isHost(seat.id)) this.advance();
        return;
      case 'list':
        return this.sendTo(seat.id, { t: 'quizzes', items: this.summaries(seat.id) } satisfies QuizServerMessage);
      case 'load': {
        if (typeof msg.id !== 'string' || !ID_RE.test(msg.id)) return;
        const builtin = BUILTIN_QUIZZES.find((q) => q.id === msg.id);
        const saved = builtin ? null : this.repo.get(msg.id);
        const quiz = builtin ?? saved?.quiz;
        if (!quiz) return this.direct(seat.id, 'That quiz no longer exists.');
        return this.sendTo(seat.id, { t: 'quiz', quiz, mine: saved?.ownerId === seat.id } satisfies QuizServerMessage);
      }
      case 'save': {
        const draft = sanitizeQuiz(msg.quiz);
        if (typeof draft === 'string') return this.direct(seat.id, draft);
        const id = typeof msg.id === 'string' && ID_RE.test(msg.id) && !msg.id.startsWith('builtin:') ? msg.id : undefined;
        const res = this.repo.save(seat.id, draft, id);
        if ('error' in res) return this.direct(seat.id, res.error);
        this.sendTo(seat.id, { t: 'saved', id: res.id } satisfies QuizServerMessage);
        this.direct(seat.id, `Saved "${draft.title}".`);
        // Everyone's picker shows the new or renamed quiz.
        for (const p of this.players.values()) this.sendTo(p.id, { t: 'quizzes', items: this.summaries(p.id) } satisfies QuizServerMessage);
        return;
      }
      case 'remove': {
        if (typeof msg.id !== 'string' || !ID_RE.test(msg.id)) return;
        if (!this.repo.remove(seat.id, msg.id)) return this.direct(seat.id, 'Only the author can delete this quiz.');
        if (this.settings.quizId === msg.id) this.settings = { ...this.settings, quizId: BUILTIN_QUIZZES[0]!.id };
        for (const p of this.players.values()) this.sendTo(p.id, { t: 'quizzes', items: this.summaries(p.id) } satisfies QuizServerMessage);
        this.broadcastState();
        return;
      }
    }
  }

  // ── Flow ─────────────────────────────────────────────────────────────────

  private intro(): void {
    this.phase = 'intro';
    this.reveal = null;
    this.answers.clear();
    this.endsAt = Date.now() + this.timing.introMs;
    this.broadcastState();
    this.later(this.timing.introMs, () => this.ask());
  }

  private ask(): void {
    const q = this.questions[this.index]!;
    this.phase = 'question';
    this.askedAt = Date.now();
    const ms = q.seconds * this.timing.secondMs;
    this.endsAt = this.askedAt + ms;
    this.broadcastState();
    this.later(ms, () => this.showAnswer());
  }

  /** Ends the question once every connected player has answered. */
  private maybeRevealEarly(): boolean {
    const everyone = this.connected();
    if (everyone.length > 0 && everyone.every((s) => this.answers.has(s.id))) {
      this.showAnswer();
      return true;
    }
    return false;
  }

  private showAnswer(): void {
    if (this.phase !== 'question') return;
    this.clearTimers();
    const q = this.questions[this.index]!;
    const limit = q.seconds * this.timing.secondMs;
    const counts = q.answers.map(() => 0);
    const gains: Record<string, number> = {};
    for (const seat of this.players.values()) {
      const a = this.answers.get(seat.id);
      if (a) counts[a.index]!++;
      if (a && a.index === q.correct) {
        seat.streak++;
        const gain = answerPoints(a.at - this.askedAt, limit) + streakBonus(seat.streak);
        seat.score += gain;
        gains[seat.id] = gain;
      } else {
        seat.streak = 0;
      }
    }
    this.phase = 'reveal';
    this.reveal = { correct: q.correct, counts, gains };
    this.endsAt = Date.now() + this.timing.revealMs;
    this.broadcastState();
    this.later(this.timing.revealMs, () => this.advance());
  }

  private advance(): void {
    if (this.phase !== 'reveal') return;
    this.clearTimers();
    this.index++;
    if (this.index >= this.questions.length) return this.finish();
    this.intro();
  }

  private finish(): void {
    this.phase = 'finished';
    this.endsAt = null;
    this.reveal = null;
    const ranking = [...this.players.values()].sort((a, b) => b.score - a.score);
    const top = ranking[0]?.score ?? 0;
    this.system(ranking[0] && top > 0 ? `🏆 ${ranking[0].name} wins with ${top} points!` : 'Quiz over!');
    this.broadcastState();
    // Quiz points run into the thousands, so scale them to sit alongside other games.
    this.reportResults(ranking, (s) => s.score === top && top > 0, (s) => s.score / 10);
  }

  protected stateFor(userId: string): QuizStateMessage {
    const q = this.questions[this.index];
    const showQuestion = this.phase === 'intro' || this.phase === 'question' || this.phase === 'reveal';
    return {
      t: 'state',
      now: Date.now(),
      phase: this.phase,
      players: this.seatViews().map((v) => ({ ...v, streak: this.players.get(v.id)?.streak ?? 0, answered: this.answers.has(v.id) })),
      settings: this.settings,
      quiz: (() => {
        const quiz = this.idle ? this.findQuiz(this.settings.quizId) : this.quiz;
        return quiz ? { id: quiz.id, title: quiz.title, count: quiz.questions.length } : null;
      })(),
      index: this.index,
      total: this.questions.length,
      // During the intro only the question is shown; answers appear when the clock starts.
      question: showQuestion && q ? { q: q.q, answers: this.phase === 'intro' ? [] : q.answers, seconds: q.seconds } : null,
      endsAt: this.endsAt,
      myAnswer: this.answers.get(userId)?.index ?? null,
      reveal: this.phase === 'reveal' ? this.reveal : null,
    };
  }
}
