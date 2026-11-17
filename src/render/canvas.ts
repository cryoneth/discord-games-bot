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
  ['kalam-700.ttf', 'Kalam'],
] as const) {
  // Fail loudly: a missing font would silently render boxes instead of letters.
  if (!GlobalFonts.registerFromPath(`${fontDir}${file}`, family)) throw new Error(`Could not load font ${fontDir}${file}`);
}

export type Ctx = SKRSContext2D;

/** Sketchbook palette: marker colours and ink on cream paper. */
export const THEME = {
  paper: '#fdf8ec',
  paperDot: '#e2dccb',
  ink: '#2b2d42',
  pencil: '#9097ab',
  white: '#ffffff',
  red: '#ff5a6e',
  redInk: '#e03a52',
  teal: '#22c4b2',
  tealInk: '#0f9d8e',
  yellow: '#ffcf3f',
  highlight: 'rgba(255, 214, 10, 0.5)',
  blue: '#5a82ff',
  blueLight: '#8ea8ff',
  green: '#5ccf6f',
  amber: '#ffb238',
  slate: '#cfd2dc',
  wood: '#eebd7a',
  woodDark: '#cf9547',
  confetti: ['#ff5a6e', '#ffcf3f', '#22c4b2', '#5a82ff', '#a56bff', '#5ccf6f', '#ff8a3d'],
} as const;

/** Handwritten font for everything drawn on the boards. */
export function font(size: number): string {
  return `${size}px "Kalam"`;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A sheet of dotted sketchbook paper filling the whole canvas, with rounded corners. */
export function background(ctx: Ctx, w: number, h: number): void {
  ctx.save();
  roundRect(ctx, 0, 0, w, h, 26);
  ctx.fillStyle = THEME.paper;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = THEME.paperDot;
  const step = 24;
  for (let y = step; y < h; y += step)
    for (let x = step; x < w; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.restore();
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
