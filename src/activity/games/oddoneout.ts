import {
  DEFAULT_ODD_SETTINGS,
  MAX_CLUE_LENGTH,
  ODD_POINTS,
  ODD_TIMING,
  validOddSettings,
  type OddClue,
  type OddPhase,
  type OddReveal,
  type OddSettings,
  type OddStateMessage,
} from '../../shared/oddoneout.js';
import { pick, shuffle } from '../../util/random.js';
import { BaseRoom, type RoomContext, type Seat } from '../base.js';
import { CRYPTO_PAIRS, GENERAL_PAIRS } from '../data/oddoneout.js';
import { cleanText, levenshtein, normalizeGuess } from '../room.js';

interface OddSeat extends Seat {
  timesOdd: number;
}

export interface OddTiming {
  /** Length of one clue "second". */
  secondMs: number;
  voteMs: number;
  guessMs: number;
  revealMs: number;
}

const DEFAULT_TIMING: OddTiming = {
  secondMs: 1000,
  voteMs: ODD_TIMING.voteSeconds * 1000,
  guessMs: ODD_TIMING.guessSeconds * 1000,
  revealMs: ODD_TIMING.revealSeconds * 1000,
};

/** Whether a clue gives the word away (contains it, or is nearly the same word). */
export function revealsWord(clue: string, word: string): boolean {
  const c = normalizeGuess(clue).replace(/ /g, '');
  const w = normalizeGuess(word).replace(/ /g, '');
  if (!c || !w) return false;
  return c.includes(w) || (w.length >= 4 && levenshtein(c, w) <= 1);
}

export function sameWord(guess: string, word: string): boolean {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  return g === w || (w.length >= 4 && levenshtein(g, w) <= 1);
}

/**
 * Everyone shares a secret word except one player, who got a related one and
 * doesn't know it. Players give one clue each in turn, then vote. A caught odd
 * player can still steal points by guessing the majority's word.
 */
export class OddOneOutRoom extends BaseRoom<OddSeat> {
  protected readonly minPlayers = 3;
  protected readonly maxPlayers = 12;
  private phase: OddPhase = 'lobby';
  private settings: OddSettings = { ...DEFAULT_ODD_SETTINGS };
  private round = 0;
  private pass = 1;
  private roundPlayers: string[] = [];
  private turnIndex = 0;
  private oddId: string | null = null;
  private majority = '';
  private oddWord = '';
  private clues: OddClue[] = [];
  private votes = new Map<string, string>();
  private guesserId: string | null = null;
  private endsAt: number | null = null;
  private reveal: OddReveal | null = null;
  private recentPairs: string[] = [];

  constructor(
    ctx: RoomContext,
    private readonly timing: OddTiming = DEFAULT_TIMING,
  ) {
    super(ctx);
  }

  get idle(): boolean {
    return this.phase === 'lobby' || this.phase === 'finished';
  }

  get currentPhase(): OddPhase {
    return this.phase;
  }

  /** For tests: who the odd one is this round. */
  get currentOdd(): string | null {
    return this.oddId;
  }

  protected createSeat(user: { id: string; name: string }): OddSeat {
    return { ...user, score: 0, timesOdd: 0, conns: new Set() };
  }

  protected override applySettings(raw: unknown): boolean {
    if (!validOddSettings(raw)) return false;
    this.settings = { rounds: raw.rounds, clueRounds: raw.clueRounds, clueSeconds: raw.clueSeconds, deck: raw.deck };
    return true;
  }

  protected begin(): void {
    this.round = 0;
    for (const s of this.players.values()) s.timesOdd = 0;
    this.system(`🕵️ ${this.settings.rounds} rounds. One of you has a different word, and they don't know it!`);
    this.nextRound();
  }

  protected abort(): void {
    this.phase = 'lobby';
    this.resetRound();
  }

  private resetRound(): void {
    this.roundPlayers = [];
    this.oddId = null;
    this.clues = [];
    this.votes.clear();
    this.guesserId = null;
    this.endsAt = null;
    this.reveal = null;
  }

  private turnId(): string | null {
    return this.phase === 'clues' ? (this.roundPlayers[this.turnIndex] ?? null) : null;
  }

  private isOnline(id: string): boolean {
    return (this.players.get(id)?.conns.size ?? 0) > 0;
  }

  protected onDeparture(seat: OddSeat): void {
    if (!this.roundPlayers.includes(seat.id)) return;
    if (seat.id === this.oddId && (this.phase === 'clues' || this.phase === 'vote')) {
      this.system(`The odd one out left! The words were "${this.majority}" and "${this.oddWord}". Next round.`);
      this.clearTimers();
      this.nextRound();
      return;
    }
    if (this.phase === 'clues' && this.turnId() === seat.id) {
      this.clearTimers();
      this.turnIndex++;
      this.startTurn();
    } else if (this.phase === 'vote') {
      this.maybeTally();
    } else if (this.phase === 'guess' && seat.id === this.guesserId) {
      this.clearTimers();
      this.finishRound(null);
    }
  }

  protected onMessage(seat: OddSeat, msg: { t: string } & Record<string, unknown>): void {
    switch (msg.t) {
      case 'clue': {
        if (this.phase !== 'clues' || this.turnId() !== seat.id) return;
        const text = cleanText(msg.text, MAX_CLUE_LENGTH);
        if (!text) return;
        const word = seat.id === this.oddId ? this.oddWord : this.majority;
        if (revealsWord(text, word)) return this.direct(seat.id, "That gives your word away! Try another clue.");
        this.clues.push({ id: seat.id, pass: this.pass, text });
        this.clearTimers();
        this.turnIndex++;
        this.startTurn();
        return;
      }
      case 'vote': {
        if (this.phase !== 'vote' || !this.roundPlayers.includes(seat.id)) return;
        const target = msg.target;
        if (typeof target !== 'string' || target === seat.id || !this.roundPlayers.includes(target)) return;
        this.votes.set(seat.id, target);
        if (!this.maybeTally()) this.broadcastState();
        return;
      }
      case 'guess': {
        if (this.phase !== 'guess' || seat.id !== this.guesserId) return;
        const text = cleanText(msg.text, 40);
        if (!text) return;
        this.clearTimers();
        this.finishRound(text);
        return;
      }
    }
  }

  // ── Flow ─────────────────────────────────────────────────────────────────

  private pickPair(): [string, string] {
    const deck = this.settings.deck === 'general' ? GENERAL_PAIRS : this.settings.deck === 'crypto' ? CRYPTO_PAIRS : [...GENERAL_PAIRS, ...CRYPTO_PAIRS];
    const fresh = deck.filter(([a]) => !this.recentPairs.includes(a));
    const pair = pick(fresh.length ? fresh : deck);
    this.recentPairs = [...this.recentPairs, pair[0]].slice(-40);
    return Math.random() < 0.5 ? [pair[0], pair[1]] : [pair[1], pair[0]];
  }

  private nextRound(): void {
    this.clearTimers();
    this.resetRound();
    this.round++;
    if (this.round > this.settings.rounds) return this.finish();
    const online = this.connected();
    if (online.length < this.minPlayers) {
      this.phase = 'lobby';
      return this.broadcastState();
    }
    this.roundPlayers = shuffle(online.map((s) => s.id));
    // Spread the odd role around: pick among those who've had it the fewest times.
    const fewest = Math.min(...online.map((s) => s.timesOdd));
    const odd = pick(online.filter((s) => s.timesOdd === fewest));
    odd.timesOdd++;
    this.oddId = odd.id;
    [this.majority, this.oddWord] = this.pickPair();
    this.pass = 1;
    this.turnIndex = 0;
    this.phase = 'clues';
    this.system(`Round ${this.round}/${this.settings.rounds}. Check your word and give a one-word clue when it's your turn.`);
    this.startTurn();
  }

  private startTurn(): void {
    while (this.turnIndex < this.roundPlayers.length && !this.isOnline(this.roundPlayers[this.turnIndex]!)) this.turnIndex++;
    if (this.turnIndex >= this.roundPlayers.length) {
      this.pass++;
      this.turnIndex = 0;
      if (this.pass > this.settings.clueRounds) return this.startVote();
      return this.startTurn();
    }
    const ms = this.settings.clueSeconds * this.timing.secondMs;
    this.endsAt = Date.now() + ms;
    this.broadcastState();
    const id = this.roundPlayers[this.turnIndex]!;
    this.later(ms, () => {
      if (this.phase !== 'clues' || this.turnId() !== id) return;
      this.clues.push({ id, pass: this.pass, text: '…' });
      this.turnIndex++;
      this.startTurn();
    });
  }

  private startVote(): void {
    this.phase = 'vote';
    this.pass = this.settings.clueRounds;
    this.endsAt = Date.now() + this.timing.voteMs;
    this.system('🗳️ Discuss and vote: who has the different word?');
    this.broadcastState();
    this.later(this.timing.voteMs, () => this.tally());
  }

  private maybeTally(): boolean {
    const voters = this.roundPlayers.filter((id) => this.isOnline(id));
    if (voters.length > 0 && voters.every((id) => this.votes.has(id))) {
      this.tally();
      return true;
    }
    return false;
  }

  private tally(): void {
    if (this.phase !== 'vote') return;
    this.clearTimers();
    const counts = new Map<string, number>();
    for (const target of this.votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
    const max = Math.max(0, ...counts.values());
    const top = [...counts].filter(([, n]) => n === max).map(([id]) => id);
    // A tie means the group couldn't agree, so the odd one slips away.
    const caught = max > 0 && top.length === 1 && top[0] === this.oddId;
    if (caught && this.isOnline(this.oddId!)) {
      this.phase = 'guess';
      this.guesserId = this.oddId;
      this.endsAt = Date.now() + this.timing.guessMs;
      const name = this.players.get(this.oddId!)?.name ?? 'The odd one';
      this.system(`Caught! ${name} had a different word. They get one guess at yours to steal points.`);
      this.broadcastState();
      this.later(this.timing.guessMs, () => this.finishRound(null));
      return;
    }
    this.finishRound(null, caught);
  }

  private finishRound(guess: string | null, caughtOverride?: boolean): void {
    if (this.phase !== 'guess' && this.phase !== 'vote') return;
    this.clearTimers();
    const oddId = this.oddId!;
    const caught = caughtOverride ?? this.phase === 'guess';
    const stole = caught && guess !== null && sameWord(guess, this.majority);
    const gains: Record<string, number> = {};
    const add = (id: string, n: number) => {
      const seat = this.players.get(id);
      if (!seat) return;
      seat.score += n;
      gains[id] = (gains[id] ?? 0) + n;
    };
    if (!caught) {
      add(oddId, ODD_POINTS.escaped);
    } else {
      for (const id of this.roundPlayers) if (id !== oddId) add(id, ODD_POINTS.caught);
      for (const [voter, target] of this.votes) if (target === oddId && voter !== oddId) add(voter, ODD_POINTS.spotted);
      if (stole) add(oddId, ODD_POINTS.stoleWord);
    }
    const name = this.players.get(oddId)?.name ?? 'The odd one';
    if (!caught) this.system(`🎭 ${name} got away with it! The words were "${this.majority}" and "${this.oddWord}".`);
    else if (stole) this.system(`😈 ${name} guessed "${this.majority}" and steals ${ODD_POINTS.stoleWord} points!`);
    else if (guess) this.system(`${name} guessed "${guess}". The word was "${this.majority}".`);
    this.reveal = {
      oddId,
      majorityWord: this.majority,
      oddWord: this.oddWord,
      votes: Object.fromEntries(this.votes),
      caught,
      guess,
      stole,
      gains,
    };
    this.phase = 'reveal';
    this.guesserId = null;
    this.endsAt = Date.now() + this.timing.revealMs;
    this.broadcastState();
    this.later(this.timing.revealMs, () => this.nextRound());
  }

  private finish(): void {
    this.phase = 'finished';
    this.resetRound();
    const ranking = [...this.players.values()].sort((a, b) => b.score - a.score);
    const top = ranking[0]?.score ?? 0;
    this.system(ranking[0] && top > 0 ? `🏆 ${ranking[0].name} wins with ${top} points!` : 'Game over!');
    this.broadcastState();
    this.reportResults(ranking, (s) => s.score === top && top > 0);
  }

  protected stateFor(userId: string): OddStateMessage {
    const playing = this.roundPlayers.includes(userId);
    const live = this.phase === 'clues' || this.phase === 'vote' || this.phase === 'guess';
    return {
      t: 'state',
      now: Date.now(),
      phase: this.phase,
      players: this.seatViews().map((v) => ({ ...v, inRound: this.roundPlayers.includes(v.id), voted: this.votes.has(v.id) })),
      settings: this.settings,
      round: this.round,
      pass: this.pass,
      word: playing && live ? (userId === this.oddId ? this.oddWord : this.majority) : null,
      turnId: this.turnId(),
      clues: this.clues,
      endsAt: this.endsAt,
      myVote: this.votes.get(userId) ?? null,
      guesserId: this.phase === 'guess' ? this.guesserId : null,
      reveal: this.phase === 'reveal' ? this.reveal : null,
    };
  }
}
