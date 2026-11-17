/**
 * Renders the bot's profile art in the same hand-drawn style as the game boards.
 * Usage: npx tsx scripts/branding.ts [outDir]   (default: branding/)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { background, png, THEME, type Ctx } from '../src/render/canvas.js';
import {
  ellipsePts,
  fill,
  highlight,
  polyPts,
  rectPts,
  shape,
  sketchCircle,
  sketchLine,
  sketchRect,
  sparkle,
  star,
  stroke,
  textWidth,
  write,
  type Pt,
} from '../src/render/sketch.js';

const NAME = 'Doodle Den';
const out = process.argv[2] ?? 'branding';
mkdirSync(out, { recursive: true });

/** Runs `draw` with the origin moved to (x, y), rotated and scaled. */
function at(ctx: Ctx, x: number, y: number, rot: number, scale: number, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  draw();
  ctx.restore();
}

// ── Doodles, drawn around (0, 0) at a nominal size ───────────────────────────

/** A die about 200 px wide showing `face`. */
function die(ctx: Ctx, face: number, color: string = THEME.white, seed = 1): void {
  sketchRect(ctx, -100, -100, 200, 200, 38, { fill: color, width: 9, seed, offset: 6 });
  const p = 52;
  const spots: Record<number, Pt[]> = {
    1: [[0, 0]],
    2: [[-p, -p], [p, p]],
    3: [[-p, -p], [0, 0], [p, p]],
    4: [[-p, -p], [p, -p], [-p, p], [p, p]],
    5: [[-p, -p], [p, -p], [0, 0], [-p, p], [p, p]],
    6: [[-p, -p], [p, -p], [-p, 0], [p, 0], [-p, p], [p, p]],
  };
  spots[face]!.forEach(([x, y], i) => sketchCircle(ctx, x, y, 19, { fill: THEME.ink, width: 4, passes: 1, seed: seed * 10 + i }));
}

/** A pencil about 360 px long lying along the x axis, tip at +x. */
function pencil(ctx: Ctx, seed = 3): void {
  const h = 34;
  shape(ctx, polyPts([[-180, -h], [110, -h], [110, h], [-180, h]], true, 6), { fill: THEME.yellow, width: 8, seed });
  sketchLine(ctx, -170, 0, 104, 0, { width: 4, passes: 1, color: THEME.woodDark, seed });
  shape(ctx, polyPts([[110, -h], [180, 0], [110, h]], true, 5), { fill: THEME.wood, width: 8, seed: seed + 1 });
  shape(ctx, polyPts([[154, -12], [180, 0], [154, 12]], true, 3), { fill: THEME.ink, stroke: null, seed: seed + 2, offset: 0 });
  shape(ctx, polyPts([[-215, -h], [-180, -h], [-180, h], [-215, h]], true, 5), { fill: THEME.slate, width: 7, seed: seed + 3 });
  shape(ctx, rectPts(-262, -h, 52, h * 2, 16), { fill: THEME.red, width: 8, seed: seed + 4 });
}

/** A little tic-tac-toe grid about 240 px square with a few marks. */
function ticTacToe(ctx: Ctx, seed = 5): void {
  const s = 80;
  const o = { width: 8, seed };
  sketchLine(ctx, -s / 2, -s * 1.5, -s / 2, s * 1.5, o);
  sketchLine(ctx, s / 2, -s * 1.5, s / 2, s * 1.5, { ...o, seed: seed + 1 });
  sketchLine(ctx, -s * 1.5, -s / 2, s * 1.5, -s / 2, { ...o, seed: seed + 2 });
  sketchLine(ctx, -s * 1.5, s / 2, s * 1.5, s / 2, { ...o, seed: seed + 3 });
  const x = (cx: number, cy: number, k: number) => {
    sketchLine(ctx, cx - 24, cy - 24, cx + 24, cy + 24, { width: 9, color: THEME.redInk, seed: seed + k });
    sketchLine(ctx, cx + 24, cy - 24, cx - 24, cy + 24, { width: 9, color: THEME.redInk, seed: seed + k + 1 });
  };
  const ring = (cx: number, cy: number) => stroke(ctx, ellipsePts(cx, cy, 26, 26), true, { width: 9, color: THEME.tealInk, seed: seed + cx + cy });
  x(-s, -s, 10);
  ring(0, -s);
  x(0, 0, 20);
  ring(s, -s);
  x(s, s, 30);
}

/** A playing card about 160 × 220 px. */
function card(ctx: Ctx, seed = 7): void {
  sketchRect(ctx, -80, -110, 160, 220, 22, { fill: THEME.white, width: 8, seed });
  write(ctx, 'A', -48, -70, 48, THEME.redInk);
  heart(ctx, 0, 14, 46, seed);
}

function heart(ctx: Ctx, cx: number, cy: number, r: number, seed = 9): void {
  const pts: Pt[] = Array.from({ length: 60 }, (_, i) => {
    const t = (i / 60) * Math.PI * 2;
    return [cx + r * 0.06 * 16 * Math.sin(t) ** 3, cy - r * 0.06 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  });
  shape(ctx, pts, { fill: THEME.red, width: 6, seed, passes: 1 });
}

/** A speech bubble with a question mark, about 200 px wide. */
function bubble(ctx: Ctx, seed = 11): void {
  shape(ctx, [...ellipsePts(0, 0, 100, 74)], { fill: THEME.white, width: 8, seed });
  shape(ctx, polyPts([[-46, 56], [-80, 104], [-6, 70]], true, 4), { fill: THEME.white, width: 8, seed: seed + 1 });
  // Patch over the seam where the tail meets the bubble.
  fill(ctx, ellipsePts(-34, 54, 30, 14), THEME.white, { seed: seed + 2, offset: 0, amp: 0.5 });
  write(ctx, '?', 0, 4, 110, THEME.blue, { outline: THEME.ink });
}

// ── Avatar ───────────────────────────────────────────────────────────────────

/**
 * Discord crops the avatar to a circle and shows it as small as 32 px, so the
 * mark is one big die and one pencil on a bold colour, nothing finer.
 */
function avatar(ctx: Ctx, S: number): void {
  const k = S / 1024;
  ctx.save();
  ctx.scale(k, k);
  ctx.fillStyle = THEME.blue;
  ctx.fillRect(0, 0, 1024, 1024);
  // Soft paper dots so the colour reads as a page, not a flat fill.
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (let y = 40; y < 1024; y += 64) for (let x = 40; x < 1024; x += 64) {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  at(ctx, 480, 450, -0.2, 1.85, () => die(ctx, 5, THEME.white, 2));
  at(ctx, 590, 705, -0.62, 1.2, () => pencil(ctx, 4));
  star(ctx, 790, 260, 62, THEME.yellow, 0.2);
  star(ctx, 225, 700, 40, THEME.teal, 0.9);
  ctx.restore();
}

// ── Banner (profile header) ──────────────────────────────────────────────────

/**
 * Discord puts the avatar over the bottom-left of the profile banner, so the
 * left third stays mostly empty paper.
 */
function banner(ctx: Ctx): void {
  const W = 1360;
  const H = 480;
  ctx.fillStyle = THEME.paper;
  ctx.fillRect(0, 0, W, H);
  background(ctx, W, H);
  ctx.fillStyle = THEME.paper;
  // Re-square the corners: Discord rounds the banner itself.
  ctx.fillRect(0, 0, 30, 30); ctx.fillRect(W - 30, 0, 30, 30); ctx.fillRect(0, H - 30, 30, 30); ctx.fillRect(W - 30, H - 30, 30, 30);

  const tx = 790;
  const tw = textWidth(ctx, NAME, 132);
  highlight(ctx, tx - tw / 2 - 16, 150, tw + 32, 74, THEME.highlight, 3);
  write(ctx, NAME, tx, 160, 132, THEME.ink, { tilt: -0.03 });
  write(ctx, 'party games, drawn by hand', tx, 272, 50, THEME.blue, { tilt: -0.02 });
  sketchLine(ctx, tx - 250, 312, tx + 250, 306, { width: 5, color: THEME.red, passes: 1 });

  at(ctx, 1220, 130, 0.25, 0.75, () => die(ctx, 3, THEME.white, 5));
  at(ctx, 1225, 370, -0.15, 0.62, () => ticTacToe(ctx, 9));
  at(ctx, 330, 120, -0.3, 0.6, () => card(ctx, 6));
  at(ctx, 470, 380, 0.08, 0.6, () => bubble(ctx, 14));
  at(ctx, 800, 410, -0.06, 0.55, () => pencil(ctx, 12));
  star(ctx, 120, 70, 26, THEME.yellow, 0.3);
  star(ctx, 1080, 60, 22, THEME.teal, 0.8);
  sparkle(ctx, 1110, 420, 26, THEME.red);
  sparkle(ctx, 560, 70, 22, THEME.blue);
}

// ── Activity cover (16:9) ────────────────────────────────────────────────────

function cover(ctx: Ctx): void {
  const W = 1920;
  const H = 1080;
  ctx.fillStyle = THEME.paper;
  ctx.fillRect(0, 0, W, H);
  background(ctx, W, H);
  ctx.fillStyle = THEME.paper;
  ctx.fillRect(0, 0, 30, 30); ctx.fillRect(W - 30, 0, 30, 30); ctx.fillRect(0, H - 30, 30, 30); ctx.fillRect(W - 30, H - 30, 30, 30);

  const cx = W / 2;
  const tw = textWidth(ctx, NAME, 230);
  highlight(ctx, cx - tw / 2 - 30, 380, tw + 60, 130, THEME.highlight, 8);
  write(ctx, NAME, cx, 400, 230, THEME.ink, { tilt: -0.03 });
  write(ctx, 'draw · guess · bluff · quiz · trade', cx, 600, 74, THEME.blue, { tilt: -0.015 });
  sketchLine(ctx, cx - 520, 660, cx + 520, 650, { width: 7, color: THEME.red, passes: 1 });

  at(ctx, 250, 200, -0.25, 0.95, () => die(ctx, 6, THEME.white, 21));
  at(ctx, 1690, 190, 0.2, 0.9, () => bubble(ctx, 22));
  at(ctx, 290, 820, 0.18, 0.95, () => ticTacToe(ctx, 23));
  at(ctx, 1660, 810, -0.2, 1.05, () => card(ctx, 24));
  at(ctx, 960, 870, -0.05, 1.0, () => pencil(ctx, 25));
  star(ctx, 660, 170, 40, THEME.yellow, 0.3);
  star(ctx, 1290, 950, 34, THEME.teal, 0.7);
  sparkle(ctx, 1300, 170, 40, THEME.red);
  sparkle(ctx, 600, 960, 36, THEME.blue);
}

const save = (name: string, draw: (ctx: Ctx) => void, w: number, h: number) => {
  const buf = png(draw, w, h);
  writeFileSync(join(out, name), buf);
  console.log(name, `${w}×${h}`, `${(buf.length / 1024).toFixed(0)} KB`);
};

save('avatar.png', (ctx) => avatar(ctx, 1024), 1024, 1024);
save('avatar-preview-64.png', (ctx) => avatar(ctx, 64), 64, 64);
save('banner.png', banner, 1360, 480);
save('activity-cover.png', cover, 1920, 1080);
