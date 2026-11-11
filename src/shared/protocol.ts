/**
 * Wire protocol between the drawing Activity (browser, inside Discord) and the
 * game server. Shared by both sides; must stay free of Node/DOM imports.
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
  maxMessageBytes: 16 * 1024,
} as const;

export const TIMING = {
  chooseSeconds: 12,
  drawSeconds: 80,
  revealSeconds: 6,
  rounds: 3,
} as const;

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
  | { t: 'hello'; accessToken: string; instanceId: string }
  | { t: 'start' }
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
  round: number;
  totalRounds: number;
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
