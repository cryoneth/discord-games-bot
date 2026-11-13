/**
 * Sketch Party messages (carried inside the hub's `g` envelope).
 * Shared by browser and server; must stay free of Node/DOM imports.
 */

export const CANVAS_W = 1000;
export const CANVAS_H = 750;

/** Only these colors are accepted. White doubles as the eraser. */
export const COLORS = [
  '#000000', '#ffffff', '#7f8c8d', '#e74c3c', '#e67e22', '#f1c40f',
  '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63', '#8b4513',
] as const;
export const WIDTHS = [4, 10, 20, 40] as const;

export const LIMITS = {
  maxPlayers: 16,
  maxPointsPerChunk: 200,
  maxStrokeChunks: 4000,
  maxGuessLength: 60,
} as const;

export const TIMING = {
  chooseSeconds: 12,
  revealSeconds: 6,
} as const;

// ── Game length settings (chosen by the host in the lobby) ─────────────────

/** How a game ends: after N rounds, after a time limit, or when someone reaches a score. */
export type GoalMode = 'rounds' | 'time' | 'points';

export interface GameSettings {
  mode: GoalMode;
  /** Rounds, minutes or points, depending on `mode`. */
  value: number;
  drawSeconds: number;
}

export const SETTING_OPTIONS = {
  rounds: [1, 2, 3],
  time: [5, 10, 15, 20],
  points: [300, 500, 800, 1200],
  drawSeconds: [45, 60, 80],
} as const;

export const DEFAULT_SETTINGS: GameSettings = { mode: 'time', value: 10, drawSeconds: 60 };

/** Points mode never runs longer than this, even if nobody reaches the target. */
export const POINTS_MODE_MAX_MINUTES = 30;

export function validSettings(x: unknown): x is GameSettings {
  if (!x || typeof x !== 'object') return false;
  const { mode, value, drawSeconds } = x as Record<string, unknown>;
  if (mode !== 'rounds' && mode !== 'time' && mode !== 'points') return false;
  return (SETTING_OPTIONS[mode] as readonly number[]).includes(value as number) && (SETTING_OPTIONS.drawSeconds as readonly number[]).includes(drawSeconds as number);
}

/** Rough seconds per turn: picking a word, drawing (usually ends early once everyone guesses), reveal. */
export function turnSeconds(drawSeconds: number): number {
  return 6 + drawSeconds * 0.7 + TIMING.revealSeconds;
}

/**
 * Approximate game length in minutes, for the lobby. Points mode assumes a
 * typical player guesses ~80% of words for ~105 points each and earns ~20 per
 * guesser when drawing, with the leader ~30% ahead of average.
 */
export function estimateMinutes(settings: GameSettings, players: number): number {
  const n = Math.max(2, players);
  const turn = turnSeconds(settings.drawSeconds);
  switch (settings.mode) {
    case 'rounds':
      return (settings.value * n * turn) / 60;
    case 'time':
      return settings.value + turn / 2 / 60; // the last turn finishes after time is up
    case 'points': {
      const leaderPerRotation = 1.3 * 104 * (n - 1);
      const turns = Math.ceil((settings.value / leaderPerRotation) * n);
      return Math.min(POINTS_MODE_MAX_MINUTES, (turns * turn) / 60);
    }
  }
}

export function describeGoal(s: GameSettings): string {
  if (s.mode === 'rounds') return `${s.value} round${s.value === 1 ? '' : 's'}`;
  if (s.mode === 'time') return `${s.value} minutes`;
  return `First to ${s.value} points`;
}

/**
 * A chunk of a stroke. `id` groups chunks into one stroke (for undo).
 * `p` is a flat list of points [x0, y0, x1, y1, …] in canvas units.
 */
export interface StrokeChunk {
  id: number;
  c: number; // index into COLORS
  w: number; // index into WIDTHS
  p: number[];
}

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'reveal' | 'finished';

export type ClientMessage =
  | { t: 'start' }
  /** Host: stop the game early. */
  | { t: 'end' }
  | { t: 'settings'; settings: GameSettings }
  | { t: 'pick'; index: number }
  | { t: 'stroke'; s: StrokeChunk }
  | { t: 'undo' }
  | { t: 'clear' }
  | { t: 'guess'; text: string };

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  guessed: boolean;
  connected: boolean;
  host: boolean;
}

export interface StateMessage {
  t: 'state';
  now: number;
  phase: Phase;
  players: PlayerView[];
  drawerId: string | null;
  /** Round number (rounds mode) or turn number (time and points modes). */
  round: number;
  totalRounds: number;
  /** Turns played so far in this game, including the current one. */
  turn: number;
  settings: GameSettings;
  /** Time mode only: when no new turns start any more. */
  gameEndsAt: number | null;
  /** Underscores with revealed letters, e.g. "c _ _ f e e". Full word for the drawer and during reveal. */
  hint: string;
  /** The plain word: only sent to the drawer while drawing, and to everyone during reveal. */
  word?: string;
  endsAt: number | null;
}

export type ChatKind = 'guess' | 'system' | 'correct' | 'close' | 'private';

export type ServerMessage =
  | { t: 'welcome'; you: string }
  | StateMessage
  | { t: 'choices'; words: string[]; endsAt: number }
  | { t: 'stroke'; s: StrokeChunk }
  | { t: 'canvas'; strokes: StrokeChunk[] }
  | { t: 'chat'; kind: ChatKind; name?: string; text: string }
  | { t: 'error'; text: string; fatal?: boolean };
