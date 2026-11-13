/**
 * Pure rules for the small games, kept separate from Discord so they can be
 * unit-tested. Boards are flat arrays in row-major order, row 0 at the top.
 */

/** 0 = empty, 1 = first player, 2 = second player. */
export type Cell = 0 | 1 | 2;

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

/** Returns the player with `need` in a row anywhere on the board, or 0. */
export function lineWinner(board: readonly Cell[], width: number, height: number, need: number): Cell {
  const line = winningLine(board, width, height, need);
  return line.length ? board[line[0]!]! : 0;
}

/** Board indices of the first winning line found (empty if none). */
export function winningLine(board: readonly Cell[], width: number, height: number, need: number): number[] {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = board[y * width + x];
      if (!c) continue;
      for (const [dx, dy] of DIRECTIONS) {
        let k = 1;
        while (k < need) {
          const nx = x + dx * k;
          const ny = y + dy * k;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || board[ny * width + nx] !== c) break;
          k++;
        }
        if (k === need) return Array.from({ length: need }, (_, j) => (y + dy * j) * width + (x + dx * j));
      }
    }
  }
  return [];
}

export function isFull(board: readonly Cell[]): boolean {
  return board.every((c) => c !== 0);
}

/** Drops a piece into `col` (gravity). Returns the board index it landed on, or -1 if the column is full. */
export function dropPiece(board: Cell[], width: number, height: number, col: number, who: 1 | 2): number {
  if (col < 0 || col >= width) return -1;
  for (let y = height - 1; y >= 0; y--) {
    const i = y * width + col;
    if (board[i] === 0) {
      board[i] = who;
      return i;
    }
  }
  return -1;
}

export type LetterScore = 'hit' | 'near' | 'miss';

/** Scores a word guess: hit = right letter, right spot; near = in the word elsewhere. Handles repeated letters. */
export function scoreGuess(guess: string, answer: string): LetterScore[] {
  const g = guess.toLowerCase();
  const a = answer.toLowerCase();
  const out: LetterScore[] = Array.from({ length: g.length }, () => 'miss');
  const remaining = new Map<string, number>();
  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) out[i] = 'hit';
    else remaining.set(a[i]!, (remaining.get(a[i]!) ?? 0) + 1);
  }
  for (let i = 0; i < g.length; i++) {
    if (out[i] === 'hit') continue;
    const left = remaining.get(g[i]!) ?? 0;
    if (left > 0) {
      out[i] = 'near';
      remaining.set(g[i]!, left - 1);
    }
  }
  return out;
}

export const RPS = ['rock', 'paper', 'scissors'] as const;
export type RpsChoice = (typeof RPS)[number];

/** 0 = tie, 1 = `a` wins, 2 = `b` wins. */
export function rpsWinner(a: RpsChoice, b: RpsChoice): 0 | 1 | 2 {
  if (a === b) return 0;
  return (RPS.indexOf(a) - RPS.indexOf(b) + 3) % 3 === 1 ? 1 : 2;
}

// ── Dots and boxes ───────────────────────────────────────────────────────────

export type Side = 'top' | 'bottom' | 'left' | 'right';
export const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];

/**
 * A grid of `w`×`h` boxes. Horizontal lines are indexed row by row ((h+1) rows of w),
 * vertical lines too (h rows of w+1). Each line and box stores who drew or won it.
 */
export interface Dots {
  w: number;
  h: number;
  hLines: Cell[];
  vLines: Cell[];
  boxes: Cell[];
}

export function newDots(w: number, h: number): Dots {
  return { w, h, hLines: Array((h + 1) * w).fill(0), vLines: Array(h * (w + 1)).fill(0), boxes: Array(w * h).fill(0) };
}

/** The line array and index for one side of a box. */
export function sideLine(d: Dots, box: number, side: Side): { lines: Cell[]; i: number; horizontal: boolean } {
  const x = box % d.w;
  const y = Math.floor(box / d.w);
  switch (side) {
    case 'top':
      return { lines: d.hLines, i: y * d.w + x, horizontal: true };
    case 'bottom':
      return { lines: d.hLines, i: (y + 1) * d.w + x, horizontal: true };
    case 'left':
      return { lines: d.vLines, i: y * (d.w + 1) + x, horizontal: false };
    case 'right':
      return { lines: d.vLines, i: y * (d.w + 1) + x + 1, horizontal: false };
  }
}

export function boxSides(d: Dots, box: number): number {
  return SIDES.filter((s) => {
    const { lines, i } = sideLine(d, box, s);
    return lines[i] !== 0;
  }).length;
}

/** Draws one side of a box. Returns how many boxes it closed (0–2), or -1 if that line is taken. */
export function drawSide(d: Dots, box: number, side: Side, who: 1 | 2): number {
  if (!Number.isInteger(box) || box < 0 || box >= d.w * d.h) return -1;
  const { lines, i } = sideLine(d, box, side);
  if (lines[i] !== 0) return -1;
  lines[i] = who;
  // The line borders this box and maybe the neighbour on the other side.
  const x = box % d.w;
  const y = Math.floor(box / d.w);
  const touched = [box];
  if (side === 'top' && y > 0) touched.push(box - d.w);
  if (side === 'bottom' && y < d.h - 1) touched.push(box + d.w);
  if (side === 'left' && x > 0) touched.push(box - 1);
  if (side === 'right' && x < d.w - 1) touched.push(box + 1);
  let closed = 0;
  for (const b of touched) {
    if (d.boxes[b] === 0 && boxSides(d, b) === 4) {
      d.boxes[b] = who;
      closed++;
    }
  }
  return closed;
}

// ── Mancala (Kalah rules) ────────────────────────────────────────────────────

/** Pits 0–5 and store 6 belong to seat 0; pits 7–12 and store 13 to seat 1. Sowing runs upwards. */
export const MANCALA_STORE = [6, 13] as const;

export function newMancala(seeds = 4): number[] {
  return Array.from({ length: 14 }, (_, i) => (i === 6 || i === 13 ? 0 : seeds));
}

export interface Sown {
  /** Indices that received a seed, in order. */
  path: number[];
  /** Last seed landed in the mover's store: they go again. */
  extra: boolean;
  /** Seeds captured from the opposite pit (plus the capturing seed), 0 if none. */
  captured: number;
  /** One side ran empty, so the remaining seeds were swept into their owners' stores. */
  over: boolean;
}

/** Plays pit `pit` (0–5, counted from the mover's left). Returns null if that pit is empty or out of range. */
export function sow(pits: number[], seat: 0 | 1, pit: number): Sown | null {
  if (!Number.isInteger(pit) || pit < 0 || pit > 5) return null;
  let i = seat * 7 + pit;
  let seeds = pits[i]!;
  if (seeds === 0) return null;
  pits[i] = 0;
  const skip = MANCALA_STORE[1 - seat]!;
  const path: number[] = [];
  while (seeds > 0) {
    i = (i + 1) % 14;
    if (i === skip) continue;
    pits[i]!++;
    path.push(i);
    seeds--;
  }
  const store = MANCALA_STORE[seat]!;
  const ownPit = i >= seat * 7 && i < seat * 7 + 6;
  let captured = 0;
  if (ownPit && pits[i] === 1 && pits[12 - i]! > 0) {
    captured = pits[12 - i]! + 1;
    pits[store]! += captured;
    pits[i] = 0;
    pits[12 - i] = 0;
  }
  const sideEmpty = (s: number) => pits.slice(s * 7, s * 7 + 6).every((n) => n === 0);
  const over = sideEmpty(0) || sideEmpty(1);
  if (over) {
    for (const s of [0, 1]) {
      for (let p = s * 7; p < s * 7 + 6; p++) {
        pits[MANCALA_STORE[s]!]! += pits[p]!;
        pits[p] = 0;
      }
    }
  }
  return { path, extra: i === store && !over, captured, over };
}

// ── Playing cards ────────────────────────────────────────────────────────────

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];
/** Rank 2–14 (11 J, 12 Q, 13 K, 14 A). */
export interface PlayingCard {
  rank: number;
  suit: Suit;
}

export function fullDeck(): PlayingCard[] {
  return SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, k) => ({ rank: k + 2, suit })));
}

export function rankLabel(rank: number): string {
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[rank] ?? String(rank);
}

/** Whether a higher/lower call holds. An equal rank counts as correct either way. */
export function callHolds(call: 'higher' | 'lower', from: PlayingCard, to: PlayingCard): boolean {
  if (to.rank === from.rank) return true;
  return call === 'higher' ? to.rank > from.rank : to.rank < from.rank;
}

// ── Number duel and hangman ──────────────────────────────────────────────────

/** Letters of `word` revealed by `guessed`, with `_` for the rest. Non-letters are always shown. */
export function maskWord(word: string, guessed: ReadonlySet<string>): string {
  return [...word].map((ch) => (/[a-z]/.test(ch) && !guessed.has(ch) ? '_' : ch)).join('');
}

export function isSolved(word: string, guessed: ReadonlySet<string>): boolean {
  return !maskWord(word, guessed).includes('_');
}
