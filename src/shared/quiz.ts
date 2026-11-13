/** Quiz Arena messages and quiz format. Shared by browser and server. */

export const QUIZ_LIMITS = {
  minQuestions: 1,
  maxQuestions: 50,
  titleLength: 80,
  questionLength: 200,
  answerLength: 80,
  minAnswers: 2,
  maxAnswers: 4,
  /** Saved quizzes per server. */
  perScope: 100,
  /** Saved quizzes per author per server. */
  perOwner: 25,
} as const;

export const QUESTION_SECONDS = [10, 20, 30, 60] as const;
export const QUIZ_TIMING = { introSeconds: 3, revealSeconds: 6 } as const;

export interface QuizQuestion {
  q: string;
  answers: string[];
  /** Index into `answers`. */
  correct: number;
  seconds: number;
}

export interface QuizDraft {
  title: string;
  questions: QuizQuestion[];
}

export interface Quiz extends QuizDraft {
  id: string;
}

export interface QuizSummary {
  id: string;
  title: string;
  count: number;
  mine: boolean;
  builtin: boolean;
}

function clean(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Validate and normalize a quiz from the editor or a JSON import.
 * Returns the clean quiz, or an error message for the author.
 */
export function sanitizeQuiz(x: unknown): QuizDraft | string {
  if (!x || typeof x !== 'object') return 'That is not a quiz.';
  const raw = x as Record<string, unknown>;
  const title = clean(raw.title, QUIZ_LIMITS.titleLength);
  if (!title) return 'Give the quiz a title.';
  if (!Array.isArray(raw.questions)) return 'The quiz has no questions.';
  if (raw.questions.length < QUIZ_LIMITS.minQuestions) return 'Add at least one question.';
  if (raw.questions.length > QUIZ_LIMITS.maxQuestions) return `A quiz can have at most ${QUIZ_LIMITS.maxQuestions} questions.`;
  const questions: QuizQuestion[] = [];
  for (const [i, item] of raw.questions.entries()) {
    const n = i + 1;
    if (!item || typeof item !== 'object') return `Question ${n} is empty.`;
    const r = item as Record<string, unknown>;
    const q = clean(r.q, QUIZ_LIMITS.questionLength);
    if (!q) return `Question ${n} needs a question.`;
    if (!Array.isArray(r.answers)) return `Question ${n} needs answers.`;
    const answers = r.answers.map((a) => clean(a, QUIZ_LIMITS.answerLength));
    if (answers.length < QUIZ_LIMITS.minAnswers || answers.length > QUIZ_LIMITS.maxAnswers) return `Question ${n} needs 2 to 4 answers.`;
    if (answers.some((a) => !a)) return `Question ${n} has an empty answer.`;
    if (new Set(answers.map((a) => a.toLowerCase())).size !== answers.length) return `Question ${n} has the same answer twice.`;
    const correct = r.correct;
    if (!Number.isInteger(correct) || (correct as number) < 0 || (correct as number) >= answers.length) return `Mark the correct answer for question ${n}.`;
    const seconds = (QUESTION_SECONDS as readonly number[]).includes(r.seconds as number) ? (r.seconds as number) : 20;
    questions.push({ q, answers, correct: correct as number, seconds });
  }
  return { title, questions };
}

/** Points for a correct answer: 500–1000, faster is more. */
export function answerPoints(elapsedMs: number, limitMs: number): number {
  const frac = Math.min(1, Math.max(0, elapsedMs / limitMs));
  return Math.round(1000 - 500 * frac);
}

/** Bonus for answering several in a row correctly. */
export function streakBonus(streak: number): number {
  return Math.min(Math.max(0, streak - 1), 5) * 100;
}

export type QuizPhase = 'lobby' | 'intro' | 'question' | 'reveal' | 'finished';

export interface QuizSettings {
  quizId: string | null;
  shuffle: boolean;
}

export type QuizClientMessage =
  | { t: 'start' }
  | { t: 'settings'; settings: QuizSettings }
  | { t: 'answer'; index: number }
  /** Host: skip the rest of the reveal. */
  | { t: 'next' }
  | { t: 'list' }
  | { t: 'load'; id: string }
  | { t: 'save'; id?: string; quiz: QuizDraft }
  | { t: 'remove'; id: string };

export interface QuizPlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  host: boolean;
  streak: number;
  answered: boolean;
}

export interface QuizStateMessage {
  t: 'state';
  now: number;
  phase: QuizPhase;
  players: QuizPlayerView[];
  settings: QuizSettings;
  quiz: { id: string; title: string; count: number } | null;
  /** 0-based question index. */
  index: number;
  total: number;
  question: { q: string; answers: string[]; seconds: number } | null;
  endsAt: number | null;
  myAnswer: number | null;
  reveal: { correct: number; counts: number[]; gains: Record<string, number> } | null;
}

export type QuizServerMessage =
  | QuizStateMessage
  | { t: 'quizzes'; items: QuizSummary[] }
  | { t: 'quiz'; quiz: Quiz; mine: boolean }
  | { t: 'saved'; id: string }
  | { t: 'chat'; kind: 'guess' | 'system' | 'correct' | 'close' | 'private'; name?: string; text: string };
