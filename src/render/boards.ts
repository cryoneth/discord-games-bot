import type { Cell, LetterScore, RpsChoice } from '../games/logic.js';
import { background, font, roundRect, THEME, type Ctx } from './canvas.js';

/** A scene draws itself for loop phase t ∈ [0, 1) (t is 0 for still images). */
export interface Scene {
  w: number;
  h: number;
  draw: (ctx: Ctx, t: number) => void;
}

const pulse = (t: number) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2);

function glow(ctx: Ctx, color: string, blur: number, fn: () => void): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

// ── Tic-tac-toe ──────────────────────────────────────────────────────────────

export function drawX(ctx: Ctx, cx: number, cy: number, r: number, width: number): void {
  glow(ctx, THEME.red, 18, () => {
    ctx.strokeStyle = THEME.red;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
  });
}

export function drawO(ctx: Ctx, cx: number, cy: number, r: number, width: number): void {
  glow(ctx, THEME.teal, 18, () => {
    ctx.strokeStyle = THEME.teal;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  });
}

export function ticTacToeScene(board: readonly Cell[], last: number, win: readonly number[]): Scene {
  const S = 480;
  const pad = 30;
  const gap = 14;
  const cell = (S - pad * 2 - gap * 2) / 3;
  return {
    w: S,
    h: S,
    draw(ctx, t) {
      background(ctx, S, S);
      for (let i = 0; i < 9; i++) {
        const x = pad + (i % 3) * (cell + gap);
        const y = pad + Math.floor(i / 3) * (cell + gap);
        const winning = win.includes(i);
        ctx.fillStyle = winning ? THEME.panelLight : THEME.panel;
        if (winning) {
          glow(ctx, board[i] === 1 ? THEME.red : THEME.teal, 10 + 20 * pulse(t), () => {
            roundRect(ctx, x, y, cell, cell, 22);
            ctx.fill();
          });
        } else {
          roundRect(ctx, x, y, cell, cell, 22);
          ctx.fill();
        }
        if (i === last && !win.length) {
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 3;
          roundRect(ctx, x + 1.5, y + 1.5, cell - 3, cell - 3, 21);
          ctx.stroke();
        }
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        const grow = winning ? 1 + 0.06 * pulse(t) : 1;
        if (board[i] === 1) drawX(ctx, cx, cy, cell * 0.26 * grow, 16);
        else if (board[i] === 2) drawO(ctx, cx, cy, cell * 0.3 * grow, 15);
      }
    },
  };
}

// ── Four in a row ────────────────────────────────────────────────────────────

export function fourInARowScene(board: readonly Cell[], width: number, height: number, last: number, win: readonly number[]): Scene {
  const cell = 72;
  const padX = 26;
  const top = 58;
  const W = padX * 2 + cell * width;
  const H = top + cell * height + 26;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      // Column numbers line up with the buttons.
      ctx.font = font(26, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = THEME.muted;
      for (let x = 0; x < width; x++) ctx.fillText(String(x + 1), padX + x * cell + cell / 2, top / 2 + 2);

      const g = ctx.createLinearGradient(0, top, 0, top + cell * height);
      g.addColorStop(0, THEME.blue);
      g.addColorStop(1, THEME.blueDark);
      ctx.fillStyle = g;
      roundRect(ctx, padX - 8, top - 8, cell * width + 16, cell * height + 16, 22);
      ctx.fill();

      for (let i = 0; i < width * height; i++) {
        const cx = padX + (i % width) * cell + cell / 2;
        const cy = top + Math.floor(i / width) * cell + cell / 2;
        const r = cell * 0.39;
        const c = board[i];
        if (!c) {
          ctx.fillStyle = THEME.bg;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const [light, dark] = c === 1 ? [THEME.red, THEME.redDark] : [THEME.yellow, THEME.yellowDark];
        const winning = win.includes(i);
        const rr = winning ? r * (1 + 0.07 * pulse(t)) : r;
        const disc = () => {
          const rg = ctx.createRadialGradient(cx - rr * 0.35, cy - rr * 0.35, rr * 0.1, cx, cy, rr);
          rg.addColorStop(0, light);
          rg.addColorStop(1, dark);
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.fill();
        };
        if (winning) glow(ctx, '#ffffff', 8 + 22 * pulse(t), disc);
        else disc();
        // Inner ring for a moulded-plastic look.
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        if (i === last && !win.length) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, rr + 1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    },
  };
}

// ── Word guess ───────────────────────────────────────────────────────────────

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const TILE_COLOR: Record<LetterScore, string> = { hit: THEME.green, near: THEME.amber, miss: THEME.slate };

export function wordGridScene(guesses: readonly { word: string; score: readonly LetterScore[] }[], maxGuesses: number, solvedRow: number): Scene {
  const tile = maxGuesses > 8 ? 46 : 58;
  const gap = 7;
  const pad = 28;
  const gridW = tile * 5 + gap * 4;
  const W = Math.max(gridW + pad * 2, 440);
  const keyW = 34;
  const keyH = 42;
  const keyGap = 5;
  const gridH = maxGuesses * tile + (maxGuesses - 1) * gap;
  const H = pad + gridH + 28 + KEY_ROWS.length * (keyH + keyGap) + pad - keyGap;

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
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < maxGuesses; r++) {
        const g = guesses[r];
        // The solving row does a little wave in the celebration GIF.
        for (let c = 0; c < 5; c++) {
          const wave = r === solvedRow ? Math.max(0, Math.sin((t - c * 0.1) * Math.PI * 2)) : 0;
          const grow = wave * 0.14 * tile; // pop each tile in turn without touching neighbours
          const x = gx + c * (tile + gap) - grow / 2;
          const y = pad + r * (tile + gap) - grow / 2 - wave * 3;
          const size = tile + grow;
          if (g) {
            ctx.fillStyle = TILE_COLOR[g.score[c]!];
            roundRect(ctx, x, y, size, size, 10);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = font(Math.round(size * 0.55), true);
            ctx.fillText(g.word[c]!.toUpperCase(), x + size / 2, y + size / 2 + 2);
          } else {
            ctx.strokeStyle = r === guesses.length ? THEME.muted : THEME.grid;
            ctx.lineWidth = 3;
            roundRect(ctx, x + 1.5, y + 1.5, tile - 3, tile - 3, 9);
            ctx.stroke();
          }
        }
      }

      const ky = pad + gridH + 28;
      ctx.font = font(19, true);
      KEY_ROWS.forEach((row, ri) => {
        const rowW = row.length * keyW + (row.length - 1) * keyGap;
        const kx = (W - rowW) / 2;
        [...row].forEach((ch, ci) => {
          const s = known.get(ch);
          const x = kx + ci * (keyW + keyGap);
          const y = ky + ri * (keyH + keyGap);
          ctx.fillStyle = s ? TILE_COLOR[s] : THEME.panelLight;
          ctx.globalAlpha = s === 'miss' ? 0.45 : 1;
          roundRect(ctx, x, y, keyW, keyH, 7);
          ctx.fill();
          ctx.fillStyle = s === 'miss' ? THEME.muted : THEME.text;
          ctx.fillText(ch.toUpperCase(), x + keyW / 2, y + keyH / 2 + 1);
          ctx.globalAlpha = 1;
        });
      });
    },
  };
}

// ── Rock paper scissors ──────────────────────────────────────────────────────

function drawRock(ctx: Ctx, cx: number, cy: number, s: number): void {
  const pts = [
    [-0.9, 0.2], [-0.7, -0.45], [-0.25, -0.8], [0.35, -0.7], [0.85, -0.3], [0.9, 0.3], [0.5, 0.75], [-0.3, 0.8], [-0.8, 0.6],
  ];
  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x! * s, cy + y! * s) : ctx.moveTo(cx + x! * s, cy + y! * s)));
    ctx.closePath();
  };
  const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
  g.addColorStop(0, '#b9bdd6');
  g.addColorStop(1, '#5d6283');
  ctx.fillStyle = g;
  path();
  ctx.fill();
  // Lighter facet for a chiselled look.
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(cx - 0.7 * s, cy - 0.45 * s);
  ctx.lineTo(cx - 0.25 * s, cy - 0.8 * s);
  ctx.lineTo(cx + 0.35 * s, cy - 0.7 * s);
  ctx.lineTo(cx + 0.05 * s, cy - 0.2 * s);
  ctx.lineTo(cx - 0.45 * s, cy - 0.05 * s);
  ctx.closePath();
  ctx.fill();
}

function drawPaper(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.fillStyle = '#f4f5ff';
  roundRect(ctx, -0.65 * s, -0.85 * s, 1.3 * s, 1.7 * s, 10);
  ctx.fill();
  ctx.fillStyle = '#d6d9f0';
  ctx.beginPath();
  ctx.moveTo(0.3 * s, -0.85 * s);
  ctx.lineTo(0.65 * s, -0.5 * s);
  ctx.lineTo(0.3 * s, -0.5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#9aa0d0';
  ctx.lineWidth = 5;
  for (let i = 0; i < 5; i++) {
    const y = -0.35 * s + i * 0.25 * s;
    ctx.beginPath();
    ctx.moveTo(-0.42 * s, y);
    ctx.lineTo((i === 4 ? 0.05 : 0.42) * s, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawScissors(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy + 0.1 * s);
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.rotate(dir * 0.42);
    // Blade
    const g = ctx.createLinearGradient(-0.1 * s, 0, 0.1 * s, 0);
    g.addColorStop(0, '#eef0fb');
    g.addColorStop(1, '#a9aed0');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-0.11 * s, 0.08 * s);
    ctx.quadraticCurveTo(-0.08 * s, -0.6 * s, 0, -1.0 * s);
    ctx.quadraticCurveTo(0.1 * s, -0.5 * s, 0.11 * s, 0.08 * s);
    ctx.closePath();
    ctx.fill();
    // Handle loop
    ctx.strokeStyle = dir < 0 ? THEME.red : THEME.blue;
    ctx.lineWidth = 0.12 * s;
    ctx.beginPath();
    ctx.ellipse(0, 0.5 * s, 0.17 * s, 0.24 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#5d6283';
  ctx.beginPath();
  ctx.arc(0, 0, 0.07 * s, 0, Math.PI * 2);
  ctx.fill();
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
  const panelW = 250;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      ([left, right] as const).forEach((choice, i) => {
        const x = i ? W - 30 - panelW : 30;
        const isWinner = winner === i + 1;
        const isLoser = winner !== 0 && !isWinner;
        const panel = () => {
          ctx.fillStyle = isWinner ? THEME.panelLight : THEME.panel;
          roundRect(ctx, x, 30, panelW, H - 60, 24);
          ctx.fill();
        };
        if (isWinner) glow(ctx, THEME.yellow, 12 + 20 * pulse(t), panel);
        else panel();
        ctx.globalAlpha = isLoser ? 0.45 : 1;
        const bob = isWinner ? Math.sin(t * Math.PI * 2) * 6 : 0;
        RPS_DRAW[choice](ctx, x + panelW / 2, H / 2 - 10 + bob, 78);
        ctx.globalAlpha = 1;
        ctx.font = font(22, true);
        ctx.textAlign = 'center';
        ctx.fillStyle = isWinner ? THEME.yellow : THEME.muted;
        ctx.fillText(choice.toUpperCase(), x + panelW / 2, H - 52);
      });
      ctx.font = font(40, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = THEME.text;
      ctx.fillText(winner === 0 ? '=' : 'VS', W / 2, H / 2);
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
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 64;
      ctx.font = font(size, true);
      while (size > 28 && ctx.measureText(title).width > W - 60) ctx.font = font((size -= 2), true);
      glow(ctx, accent, 14 + 18 * pulse(t), () => {
        ctx.fillStyle = accent;
        ctx.fillText(title, W / 2, H / 2 - 18);
      });
      ctx.font = font(24);
      ctx.fillStyle = THEME.muted;
      ctx.fillText(subtitle, W / 2, H / 2 + 44);
    },
  };
}
