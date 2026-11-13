/**
 * Server-side image rendering. Everything is drawn in memory and sent straight
 * to Discord; nothing is written to disk. Images contain no usernames, so no
 * personal data ends up in them (and no missing-glyph boxes for non-Latin names).
 */
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

const fontDir = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
for (const [file, family] of [
  ['nunito-700.ttf', 'Nunito'],
  ['nunito-900.ttf', 'Nunito Black'],
] as const) {
  // Fail loudly: a missing font would silently render boxes instead of letters.
  if (!GlobalFonts.registerFromPath(`${fontDir}${file}`, family)) throw new Error(`Could not load font ${fontDir}${file}`);
}

export type Ctx = SKRSContext2D;

export const THEME = {
  bg: '#16182b',
  panel: '#22253f',
  panelLight: '#2e3254',
  grid: '#3a3f6b',
  text: '#f2f3ff',
  muted: '#8b90c0',
  red: '#ff5470',
  redDark: '#c22f4b',
  yellow: '#ffd23f',
  yellowDark: '#d69a00',
  teal: '#2ee6c5',
  blue: '#4c6fff',
  blueDark: '#2f4bd1',
  green: '#3ecf6e',
  amber: '#f5b53a',
  slate: '#4a4f73',
  confetti: ['#ff5470', '#ffd23f', '#2ee6c5', '#4c6fff', '#b46cff', '#3ecf6e'],
} as const;

export function font(size: number, black = false): string {
  return `${size}px "${black ? 'Nunito Black' : 'Nunito'}"`;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Rounded background panel filling the whole canvas, with a subtle vertical gradient. */
export function background(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1d2040');
  g.addColorStop(1, THEME.bg);
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, w, h, 28);
  ctx.fill();
}

export function newCanvas(w: number, h: number) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return { canvas, ctx };
}

export function png(draw: (ctx: Ctx) => void, w: number, h: number): Buffer {
  const { canvas, ctx } = newCanvas(w, h);
  draw(ctx);
  return canvas.toBuffer('image/png');
}
