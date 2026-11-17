import type { Cell, LetterScore, RpsChoice } from '../games/logic.js';
import { background, THEME, type Ctx } from './canvas.js';
import {
  celebrateAround,
  ellipsePts,
  handLoop,
  hatch,
  highlight,
  linePts,
  polyPts,
  shape,
  sketchCircle,
  sketchLine,
  sketchRect,
  sparkle,
  stroke,
  textWidth,
  write,
  type Pt,
} from './sketch.js';

/** A scene draws itself for loop phase t ∈ [0, 1) (t is 0 for still images). */
export interface Scene {
  w: number;
  h: number;
  draw: (ctx: Ctx, t: number) => void;
}

export const pulse = (t: number) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2);

/** Centres of the first and last cell of a winning line, stretched a bit past both ends. */
export function strikeThrough(ctx: Ctx, centres: readonly Pt[], extra: number): void {
  if (centres.length < 2) return;
  // The two cells furthest apart are the ends, whatever order the line came in.
  let best: [Pt, Pt] = [centres[0]!, centres[1]!];
  let bestD = -1;
  for (const a of centres)
    for (const b of centres) {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d > bestD) [best, bestD] = [[a, b], d];
    }
  const [[x1, y1], [x2, y2]] = best;
  const len = bestD || 1;
  const [dx, dy] = [((x2 - x1) / len) * extra, ((y2 - y1) / len) * extra];
  sketchLine(ctx, x1 - dx, y1 - dy, x2 + dx, y2 + dy, { color: THEME.ink, width: 9, amp: 2.5, overshoot: 0 });
}

// ── Tic-tac-toe ──────────────────────────────────────────────────────────────

export function drawX(ctx: Ctx, cx: number, cy: number, r: number, width: number): void {
  sketchLine(ctx, cx - r, cy - r, cx + r, cy + r * 1.05, { color: THEME.red, width, passes: 1, amp: 2, overshoot: 0 });
  sketchLine(ctx, cx + r * 1.05, cy - r * 1.05, cx - r * 0.95, cy + r, { color: THEME.red, width, passes: 1, amp: 2, overshoot: 0 });
}

export function drawO(ctx: Ctx, cx: number, cy: number, r: number, width: number): void {
  handLoop(ctx, cx, cy, r, { color: THEME.teal, width });
}

export function ticTacToeScene(board: readonly Cell[], last: number, win: readonly number[]): Scene {
  const S = 480;
  const pad = 42;
  const cell = (S - pad * 2) / 3;
  const centre = (i: number): Pt => [pad + (i % 3) * cell + cell / 2, pad + Math.floor(i / 3) * cell + cell / 2];
  return {
    w: S,
    h: S,
    draw(ctx, t) {
      background(ctx, S, S);
      if (last >= 0 && !win.length) {
        const [cx, cy] = centre(last);
        highlight(ctx, cx - cell / 2 + 14, cy - cell / 2 + 14, cell - 28, cell - 28);
      }
      for (const k of [1, 2]) {
        sketchLine(ctx, pad + k * cell, pad - 4, pad + k * cell, S - pad + 4, { width: 6, amp: 2.2 });
        sketchLine(ctx, pad - 4, pad + k * cell, S - pad + 4, pad + k * cell, { width: 6, amp: 2.2 });
      }
      for (let i = 0; i < 9; i++) {
        const [cx, cy] = centre(i);
        const grow = win.includes(i) ? 1 + 0.08 * pulse(t + i * 0.13) : 1;
        if (board[i] === 1) drawX(ctx, cx, cy, cell * 0.26 * grow, 15);
        else if (board[i] === 2) drawO(ctx, cx, cy, cell * 0.29 * grow, 14);
      }
      if (win.length) strikeThrough(ctx, win.map(centre), cell * 0.38);
    },
  };
}

// ── Four in a row ────────────────────────────────────────────────────────────

/** A marker-coloured counter with an ink outline and a little shine. */
export function counter(ctx: Ctx, cx: number, cy: number, r: number, color: string, seed: number): void {
  sketchCircle(ctx, cx, cy, r, { fill: color, width: 3, passes: 1, seed, offset: 2 });
  stroke(ctx, ellipsePts(cx, cy, r * 0.62, r * 0.62, Math.PI * 1.05, Math.PI * 0.5), false, { color: 'rgba(255,255,255,0.75)', width: Math.max(2.5, r * 0.14), passes: 1, amp: 0.6, seed });
}

export function fourInARowScene(board: readonly Cell[], width: number, height: number, last: number, win: readonly number[]): Scene {
  const cell = 72;
  const padX = 30;
  const top = 64;
  const W = padX * 2 + cell * width;
  const H = top + cell * height + 30;
  const centre = (i: number): Pt => [padX + (i % width) * cell + cell / 2, top + Math.floor(i / width) * cell + cell / 2];
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      // Column numbers line up with the buttons.
      for (let x = 0; x < width; x++) write(ctx, String(x + 1), padX + x * cell + cell / 2, top / 2, 30, THEME.ink, { tilt: ((x * 37) % 7 - 3) * 0.02 });

      sketchRect(ctx, padX - 10, top - 10, cell * width + 20, cell * height + 20, 22, {
        fill: THEME.blue,
        hatch: THEME.blueLight,
        hatchGap: 14,
        width: 4,
        seed: 3,
      });

      for (let i = 0; i < width * height; i++) {
        const [cx, cy] = centre(i);
        const r = cell * 0.37;
        const c = board[i];
        if (!c) {
          sketchCircle(ctx, cx, cy, r, { fill: THEME.paper, width: 2.5, passes: 1, seed: i, offset: 0.5 });
          continue;
        }
        const winning = win.includes(i);
        const rr = winning ? r * (1 + 0.08 * pulse(t + i * 0.05)) : r;
        counter(ctx, cx, cy, rr, c === 1 ? THEME.red : THEME.yellow, i);
        if (i === last && !win.length) handLoop(ctx, cx, cy, rr + 7, { color: THEME.white, width: 5, seed: i });
      }
      if (win.length) strikeThrough(ctx, win.map(centre), cell * 0.4);
    },
  };
}

// ── Word guess ───────────────────────────────────────────────────────────────

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const TILE_COLOR: Record<LetterScore, string> = { hit: THEME.green, near: THEME.amber, miss: THEME.slate };

export function wordGridScene(guesses: readonly { word: string; score: readonly LetterScore[] }[], maxGuesses: number, solvedRow: number): Scene {
  const tile = maxGuesses > 8 ? 46 : 58;
  const gap = 8;
  const pad = 30;
  const gridW = tile * 5 + gap * 4;
  const W = Math.max(gridW + pad * 2, 450);
  const keyW = 34;
  const keyH = 42;
  const keyGap = 6;
  const gridH = maxGuesses * tile + (maxGuesses - 1) * gap;
  const H = pad + gridH + 30 + KEY_ROWS.length * (keyH + keyGap) + pad - keyGap;

  // Best known state per letter: hit > near > miss.
  const rank: Record<LetterScore, number> = { miss: 1, near: 2, hit: 3 };
  const known = new Map<string, LetterScore>();
  for (const g of guesses) {
    [...g.word].forEach((ch, i) => {
      const s = g.score[i]!;
      const prev = known.get(ch);
      if (!prev || rank[s] > rank[prev]) known.set(ch, s);
    });
  }

  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      const gx = (W - gridW) / 2;
      for (let r = 0; r < maxGuesses; r++) {
        const g = guesses[r];
        for (let c = 0; c < 5; c++) {
          // The solving row does a little hop, one tile after the other.
          const wave = r === solvedRow ? Math.max(0, Math.sin((t - c * 0.1) * Math.PI * 2)) : 0;
          const x = gx + c * (tile + gap);
          const y = pad + r * (tile + gap) - wave * 7;
          const seed = r * 5 + c;
          if (g) {
            sketchRect(ctx, x, y, tile, tile, 8, { fill: TILE_COLOR[g.score[c]!], width: 2.5, passes: 1, seed, offset: 2.5 });
            write(ctx, g.word[c]!.toUpperCase(), x + tile / 2, y + tile / 2, Math.round(tile * 0.62), THEME.ink, { tilt: wave * 0.12 * (c % 2 ? 1 : -1) });
          } else {
            const current = r === guesses.length;
            sketchRect(ctx, x + 2, y + 2, tile - 4, tile - 4, 8, { stroke: current ? THEME.ink : THEME.pencil, width: current ? 2.2 : 1.8, passes: 1, seed, alpha: current ? 0.7 : 0.6 });
          }
        }
      }

      const ky = pad + gridH + 30;
      KEY_ROWS.forEach((row, ri) => {
        const rowW = row.length * keyW + (row.length - 1) * keyGap;
        const kx = (W - rowW) / 2;
        [...row].forEach((ch, ci) => {
          const s = known.get(ch);
          const x = kx + ci * (keyW + keyGap);
          const y = ky + ri * (keyH + keyGap);
          const faded = s === 'miss';
          sketchRect(ctx, x, y, keyW, keyH, 7, { fill: s ? TILE_COLOR[s] : THEME.white, width: 1.8, passes: 1, seed: 100 + ri * 10 + ci, offset: 1.5, alpha: faded ? 0.45 : 1 });
          ctx.globalAlpha = faded ? 0.4 : 1;
          write(ctx, ch.toUpperCase(), x + keyW / 2, y + keyH / 2, 22, THEME.ink);
          ctx.globalAlpha = 1;
        });
      });
    },
  };
}

// ── Rock paper scissors ──────────────────────────────────────────────────────

function drawRock(ctx: Ctx, cx: number, cy: number, s: number): void {
  const corners: Pt[] = [
    [-0.9, 0.25], [-0.75, -0.4], [-0.3, -0.78], [0.3, -0.72], [0.82, -0.32], [0.92, 0.28], [0.52, 0.74], [-0.25, 0.8], [-0.78, 0.6],
  ].map(([x, y]) => [cx + x! * s, cy + y! * s]);
  const pts = polyPts(corners, true, 5);
  shape(ctx, pts, { fill: '#b4b8c9', hatch: '#8d92a8', hatchGap: 11, width: 4, seed: 11 });
  // A couple of cracks and a highlight.
  stroke(ctx, polyPts([[cx - 0.2 * s, cy - 0.78 * s], [cx - 0.05 * s, cy - 0.35 * s], [cx + 0.2 * s, cy - 0.2 * s]], false, 5), false, { width: 3, passes: 1, seed: 12 });
  stroke(ctx, polyPts([[cx + 0.55 * s, cy + 0.2 * s], [cx + 0.3 * s, cy + 0.4 * s]], false, 5), false, { width: 3, passes: 1, seed: 13 });
  stroke(ctx, ellipsePts(cx - 0.35 * s, cy - 0.2 * s, 0.25 * s, 0.25 * s, Math.PI * 1.1, Math.PI * 0.45), false, { color: THEME.white, width: 5, passes: 1, seed: 14 });
}

function drawPaper(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  const sheet: Pt[] = [[-0.62 * s, -0.85 * s], [0.3 * s, -0.85 * s], [0.62 * s, -0.53 * s], [0.62 * s, 0.85 * s], [-0.62 * s, 0.85 * s]];
  shape(ctx, polyPts(sheet, true, 5), { fill: THEME.white, width: 4, seed: 21 });
  stroke(ctx, polyPts([[0.3 * s, -0.85 * s], [0.3 * s, -0.53 * s], [0.62 * s, -0.53 * s]], false, 5), false, { width: 3, passes: 1, seed: 22 });
  for (let i = 0; i < 5; i++) {
    const y = -0.3 * s + i * 0.24 * s;
    sketchLine(ctx, -0.48 * s, y, (i === 4 ? 0.05 : 0.48) * s, y, { color: THEME.blueLight, width: 3, passes: 1, overshoot: 0, seed: 23 + i });
  }
  sketchLine(ctx, -0.36 * s, -0.72 * s, -0.36 * s, 0.75 * s, { color: THEME.red, width: 2.5, passes: 1, overshoot: 0, seed: 29 });
  ctx.restore();
}

function drawScissors(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy + 0.1 * s);
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.rotate(dir * 0.42);
    const blade: Pt[] = [];
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      blade.push([-0.11 * s * (1 - u * u) + 0.01 * s * u, 0.08 * s - 1.08 * s * u]);
    }
    for (let k = 10; k >= 0; k--) {
      const u = k / 10;
      blade.push([0.11 * s * (1 - u * u * 0.6), 0.08 * s - 1.08 * s * u]);
    }
    shape(ctx, blade, { fill: '#e7e9f3', width: 3.5, passes: 1, seed: 31 + dir });
    const loop = ellipsePts(0, 0.5 * s, 0.17 * s, 0.24 * s);
    stroke(ctx, loop, true, { color: dir < 0 ? THEME.red : THEME.blue, width: 0.11 * s, passes: 1, seed: 33 + dir });
    stroke(ctx, ellipsePts(0, 0.5 * s, 0.24 * s, 0.31 * s), true, { width: 2.5, passes: 1, seed: 35 + dir });
    ctx.restore();
  }
  sketchCircle(ctx, 0, 0, 0.07 * s, { fill: THEME.ink, width: 2, passes: 1 });
  ctx.restore();
}

const RPS_DRAW: Record<RpsChoice, (ctx: Ctx, cx: number, cy: number, s: number) => void> = {
  rock: drawRock,
  paper: drawPaper,
  scissors: drawScissors,
};

/** Two picks side by side. `winner`: 0 tie, 1 left, 2 right. */
export function rpsScene(left: RpsChoice, right: RpsChoice, winner: 0 | 1 | 2): Scene {
  const W = 640;
  const H = 300;
  const panelW = 240;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      ([left, right] as const).forEach((choice, i) => {
        const x = i ? W - 34 - panelW : 34;
        const y = 30;
        const ph = H - 60;
        const isWinner = winner === i + 1;
        const isLoser = winner !== 0 && !isWinner;
        if (isWinner) highlight(ctx, x - 12, y - 10, panelW + 24, ph + 20, THEME.highlight, 5);
        ctx.save();
        ctx.translate(x + panelW / 2, y + ph / 2);
        ctx.rotate(i ? 0.025 : -0.025);
        sketchRect(ctx, -panelW / 2, -ph / 2, panelW, ph, 18, { fill: THEME.white, width: 3.5, seed: 40 + i, offset: 1 });
        ctx.restore();
        ctx.globalAlpha = isLoser ? 0.4 : 1;
        const bob = isWinner ? Math.sin(t * Math.PI * 2) * 6 : 0;
        RPS_DRAW[choice](ctx, x + panelW / 2, H / 2 - 16 + bob, 74);
        ctx.globalAlpha = 1;
        const label = choice[0]!.toUpperCase() + choice.slice(1);
        write(ctx, label, x + panelW / 2, H - 58, 30, isLoser ? THEME.pencil : THEME.ink);
        if (isWinner) celebrateAround(ctx, x, y, panelW, ph, t, i + 1);
      });
      write(ctx, winner === 0 ? '=' : 'vs', W / 2, H / 2, 54, THEME.red, { outline: THEME.ink, tilt: -0.08 });
    },
  };
}

// ── Banners ──────────────────────────────────────────────────────────────────

/** A wide title banner, e.g. for a battle royale winner or trivia results. */
export function bannerScene(title: string, subtitle: string, accent: string): Scene {
  const W = 640;
  const H = 220;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      let size = 70;
      while (size > 28 && textWidth(ctx, title, size) > W - 120) size -= 2;
      const tw = textWidth(ctx, title, size);
      const ty = H / 2 - 20;
      // Squiggly underline in the accent colour.
      const uy = ty + size * 0.55;
      const under: Pt[] = linePts(W / 2 - tw / 2 - 6, uy, W / 2 + tw / 2 + 6, uy, 4).map(([x, y], k) => [x, y + Math.sin(k * 0.9) * 3]);
      stroke(ctx, under, false, { color: accent, width: 7, passes: 1, amp: 1, seed: 51 });
      ctx.save();
      ctx.translate(W / 2, ty);
      const grow = 1 + 0.035 * pulse(t);
      ctx.scale(grow, grow);
      write(ctx, title, 0, 0, size, accent, { outline: THEME.ink, tilt: -0.03 + 0.015 * Math.sin(t * Math.PI * 2) });
      ctx.restore();
      write(ctx, subtitle, W / 2, H / 2 + 52, 28, THEME.ink);
      // Doodles in the corners.
      const spin = t * Math.PI * 2;
      sparkle(ctx, 46, 50, 16 + 3 * pulse(t), accent);
      sparkle(ctx, W - 46, H - 50, 16 + 3 * pulse(t + 0.5), accent);
      hatchCorner(ctx, W, H);
      ctx.save();
      ctx.translate(W - 52, 52);
      ctx.rotate(spin * 0.25);
      ctx.translate(-(W - 52), -52);
      shapeStar(ctx, W - 52, 52, 18, THEME.yellow);
      ctx.restore();
      shapeStar(ctx, 52, H - 52, 14 + 2 * pulse(t + 0.3), THEME.teal);
    },
  };
}

function shapeStar(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  const corners: Pt[] = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  shape(ctx, polyPts(corners, true, 4), { fill: color, width: 2.5, passes: 1, amp: 0.8, seed: 61 });
}

/** Faint pencil shading in two corners, like a quick sketchbook margin. */
function hatchCorner(ctx: Ctx, W: number, H: number): void {
  ctx.save();
  ctx.globalAlpha = 0.35;
  hatch(ctx, polyPts([[0, H], [0, H - 70], [70, H]], true, 8), THEME.pencil, { gap: 10, width: 2, seed: 71 });
  hatch(ctx, polyPts([[W, 0], [W - 70, 0], [W, 70]], true, 8), THEME.pencil, { gap: 10, width: 2, seed: 72 });
  ctx.restore();
}
