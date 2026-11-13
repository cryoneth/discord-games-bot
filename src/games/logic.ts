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
