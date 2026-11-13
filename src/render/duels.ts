/**
 * Board images for the smaller duels: dots and boxes, matchsticks, five in a row,
 * mancala, higher or lower, hangman and the number duel. Like the other scenes they
 * contain no usernames: seats are told apart by colour (red = first, teal = second).
 */
import { MANCALA_STORE, rankLabel, sideLine, type Cell, type Dots, type PlayingCard, type Side, type Suit } from '../games/logic.js';
import { drawO, drawX, type Scene } from './boards.js';
import { background, font, roundRect, THEME, type Ctx } from './canvas.js';

const pulse = (t: number) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
export const SEAT_COLOR = [THEME.red, THEME.teal] as const;

function glow(ctx: Ctx, color: string, blur: number, fn: () => void): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, opts: { black?: boolean; align?: CanvasTextAlign } = {}): void {
  ctx.font = font(size, opts.black ?? true);
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function disc(ctx: Ctx, cx: number, cy: number, r: number, light: string, dark: string): void {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A tick, or a cross when `cross`, drawn with lines (the bundled font has no such glyphs). */
function mark(ctx: Ctx, cross: boolean, cx: number, cy: number, r: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (cross) {
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
  } else {
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - r * 0.3, cy + r * 0.7);
    ctx.lineTo(cx + r, cy - r * 0.8);
  }
  ctx.stroke();
}

function arrow(ctx: Ctx, cx: number, cy: number, dir: 1 | -1, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 22 * dir, cy);
  ctx.lineTo(cx + 22 * dir, cy);
  ctx.moveTo(cx + 15 * dir, cy - 5);
  ctx.lineTo(cx + 22 * dir, cy);
  ctx.lineTo(cx + 15 * dir, cy + 5);
  ctx.stroke();
}

const STONE = [
  [THEME.red, THEME.redDark],
  [THEME.teal, '#14a58b'],
] as const;

// ── Dots and boxes ───────────────────────────────────────────────────────────

export function dotsScene(d: Dots, last: { box: number; side: Side } | null, selected: number, celebrate = false): Scene {
  const cell = 120;
  const pad = 46;
  const W = pad * 2 + cell * d.w;
  const H = pad * 2 + cell * d.h;
  const lastLine = last ? sideLine(d, last.box, last.side) : null;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      const px = (x: number) => pad + x * cell;
      const py = (y: number) => pad + y * cell;

      // Boxes: owner tint and mark, or the keypad number when still open.
      for (let b = 0; b < d.w * d.h; b++) {
        const x = px(b % d.w);
        const y = py(Math.floor(b / d.w));
        const owner = d.boxes[b];
        if (owner) {
          ctx.fillStyle = owner === 1 ? 'rgba(255,84,112,0.16)' : 'rgba(46,230,197,0.16)';
          ctx.fillRect(x + 6, y + 6, cell - 12, cell - 12);
          const grow = celebrate ? 1 + 0.08 * pulse(t + b * 0.07) : 1;
          if (owner === 1) drawX(ctx, x + cell / 2, y + cell / 2, cell * 0.2 * grow, 11);
          else drawO(ctx, x + cell / 2, y + cell / 2, cell * 0.24 * grow, 10);
        } else {
          text(ctx, String(b + 1), x + cell / 2, y + cell / 2 + 2, 34, b === selected ? THEME.yellow : THEME.grid);
        }
        if (b === selected) {
          glow(ctx, THEME.yellow, 14, () => {
            ctx.strokeStyle = THEME.yellow;
            ctx.lineWidth = 3;
            ctx.setLineDash([10, 8]);
            roundRect(ctx, x + 10, y + 10, cell - 20, cell - 20, 12);
            ctx.stroke();
            ctx.setLineDash([]);
          });
        }
      }

      // Lines: faint guides for open ones, the drawer's colour for taken ones.
      const line = (x1: number, y1: number, x2: number, y2: number, who: Cell, isLast: boolean) => {
        ctx.lineCap = 'round';
        if (!who) {
          ctx.strokeStyle = 'rgba(139,144,192,0.18)';
          ctx.lineWidth = 4;
          ctx.setLineDash([2, 12]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          return;
        }
        const color = SEAT_COLOR[who - 1]!;
        const draw = () => {
          ctx.strokeStyle = color;
          ctx.lineWidth = isLast ? 11 : 9;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        };
        if (isLast) glow(ctx, '#ffffff', 16, draw);
        else draw();
      };
      for (let y = 0; y <= d.h; y++)
        for (let x = 0; x < d.w; x++) {
          const i = y * d.w + x;
          line(px(x), py(y), px(x + 1), py(y), d.hLines[i]!, lastLine?.horizontal === true && lastLine.i === i);
        }
      for (let y = 0; y < d.h; y++)
        for (let x = 0; x <= d.w; x++) {
          const i = y * (d.w + 1) + x;
          line(px(x), py(y), px(x), py(y + 1), d.vLines[i]!, lastLine?.horizontal === false && lastLine.i === i);
        }

      for (let y = 0; y <= d.h; y++)
        for (let x = 0; x <= d.w; x++) {
          ctx.fillStyle = THEME.text;
          ctx.beginPath();
          ctx.arc(px(x), py(y), 8, 0, Math.PI * 2);
          ctx.fill();
        }
    },
  };
}

// ── Matchsticks ──────────────────────────────────────────────────────────────

/** `total` sticks, the first `left` still on the table, the next `lastTaken` just removed. */
export function nimScene(total: number, left: number, lastTaken: number, lastSeat: number, celebrate = false): Scene {
  const perRow = 12;
  const rows = Math.ceil(total / perRow);
  const gap = 44;
  const stickH = 110;
  const W = 640;
  const top = 128;
  const H = top + rows * (stickH + 30) + 20;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      const bob = celebrate ? Math.sin(t * Math.PI * 2) * 4 : 0;
      text(ctx, String(left), W / 2, 58 + bob, 64, left <= 1 ? THEME.red : THEME.yellow);
      text(ctx, left === 1 ? 'stick left' : 'sticks left', W / 2, 104, 20, THEME.muted, { black: false });
      for (let k = 0; k < total; k++) {
        const r = Math.floor(k / perRow);
        const inRow = Math.min(perRow, total - r * perRow);
        const c = k % perRow;
        const x = W / 2 - ((inRow - 1) * gap) / 2 + c * gap;
        const y = top + r * (stickH + 30);
        const onTable = k < left;
        const justTaken = !onTable && k < left + lastTaken;
        ctx.globalAlpha = onTable ? 1 : justTaken ? 0.55 : 0.12;
        const lift = justTaken ? -10 : 0;
        // Wooden stick with a coloured head.
        const g = ctx.createLinearGradient(x - 5, 0, x + 5, 0);
        g.addColorStop(0, '#e9c58a');
        g.addColorStop(1, '#b98a4a');
        ctx.fillStyle = g;
        roundRect(ctx, x - 5, y + 18 + lift, 10, stickH - 18, 4);
        ctx.fill();
        const head = justTaken ? SEAT_COLOR[lastSeat]! : THEME.red;
        disc(ctx, x, y + 16 + lift, 10, head === THEME.red ? '#ff8095' : '#7ff5df', head === THEME.red ? THEME.redDark : '#14a58b');
        if (justTaken) {
          ctx.strokeStyle = SEAT_COLOR[lastSeat]!;
          ctx.lineWidth = 2;
          roundRect(ctx, x - 14, y - 2 + lift, 28, stickH + 8, 10);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    },
  };
}

// ── Five in a row ────────────────────────────────────────────────────────────

export const ROW_LETTERS = 'ABCDEFGHIJKLMNO';

export function gomokuScene(board: readonly Cell[], size: number, last: number, win: readonly number[], selectedRow: number): Scene {
  const cell = 52;
  const left = 58;
  const top = 58;
  const W = left + cell * size + 30;
  const H = top + cell * size + 30;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      const cx = (x: number) => left + x * cell + cell / 2;
      const cy = (y: number) => top + y * cell + cell / 2;

      if (selectedRow >= 0) {
        ctx.fillStyle = 'rgba(255,210,63,0.13)';
        roundRect(ctx, left - 4, top + selectedRow * cell + 3, cell * size + 8, cell - 6, 12);
        ctx.fill();
      }
      for (let i = 0; i < size; i++) {
        text(ctx, String(i + 1), cx(i), top / 2 + 4, 22, THEME.muted);
        text(ctx, ROW_LETTERS[i]!, left / 2 + 4, cy(i) + 1, 22, i === selectedRow ? THEME.yellow : THEME.muted);
      }
      ctx.strokeStyle = THEME.grid;
      ctx.lineWidth = 2;
      for (let i = 0; i < size; i++) {
        ctx.beginPath();
        ctx.moveTo(cx(0), cy(i));
        ctx.lineTo(cx(size - 1), cy(i));
        ctx.moveTo(cx(i), cy(0));
        ctx.lineTo(cx(i), cy(size - 1));
        ctx.stroke();
      }
      // Star points help find your way around.
      const mid = Math.floor(size / 2);
      for (const [x, y] of [[2, 2], [size - 3, 2], [2, size - 3], [size - 3, size - 3], [mid, mid]]) {
        ctx.fillStyle = THEME.grid;
        ctx.beginPath();
        ctx.arc(cx(x!), cy(y!), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < size * size; i++) {
        const c = board[i];
        if (!c) continue;
        const x = cx(i % size);
        const y = cy(Math.floor(i / size));
        const winning = win.includes(i);
        const r = cell * 0.4 * (winning ? 1 + 0.08 * pulse(t) : 1);
        const [light, dark] = STONE[c - 1]!;
        if (winning) glow(ctx, '#ffffff', 8 + 18 * pulse(t), () => disc(ctx, x, y, r, light, dark));
        else disc(ctx, x, y, r, light, dark);
        if (i === last && !win.length) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };
}

// ── Mancala ──────────────────────────────────────────────────────────────────

/**
 * Seat 0 (red) plays the bottom row left to right into the right store; seat 1 (teal)
 * plays the top row right to left into the left store. Pits are numbered 1–6 in sowing order.
 */
export function mancalaScene(pits: readonly number[], path: readonly number[], winner: number, celebrate = false): Scene {
  const pitR = 40;
  const gap = 96;
  const storeW = 82;
  const W = (40 + storeW + 20) * 2 + gap * 6;
  const H = 330;
  const rowY = [H - 108, 108];
  const pitX = (seat: number, p: number) => (seat === 0 ? 40 + storeW + 20 + gap * p + gap / 2 : 40 + storeW + 20 + gap * (5 - p) + gap / 2);
  const hits = new Set(path);
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      ctx.fillStyle = '#2a2342';
      roundRect(ctx, 20, 26, W - 40, H - 52, 60);
      ctx.fill();

      const seeds = (x: number, y: number, n: number, spread: number) => {
        // A few seeds as dots; the count is always printed too.
        const shown = Math.min(n, 12);
        for (let k = 0; k < shown; k++) {
          const a = k * 2.399 + n; // golden angle spiral
          const rr = spread * Math.sqrt((k + 0.5) / 12);
          disc(ctx, x + Math.cos(a) * rr, y + Math.sin(a) * rr, 6, '#ffe9a8', '#c99a2e');
        }
      };

      for (const seat of [0, 1] as const) {
        const color = SEAT_COLOR[seat]!;
        for (let p = 0; p < 6; p++) {
          const i = seat * 7 + p;
          const x = pitX(seat, p);
          const y = rowY[seat]!;
          ctx.fillStyle = THEME.bg;
          ctx.beginPath();
          ctx.arc(x, y, pitR, 0, Math.PI * 2);
          ctx.fill();
          if (hits.has(i)) {
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 3;
            ctx.stroke();
          }
          seeds(x, y - 4, pits[i]!, pitR - 14);
          text(ctx, String(pits[i]), x, y + pitR - 12, 18, THEME.text);
          text(ctx, String(p + 1), x, seat === 0 ? y + pitR + 24 : y - pitR - 24, 18, color);
        }
        // Stores: seat 0 right, seat 1 left.
        const s = MANCALA_STORE[seat]!;
        const sx = seat === 0 ? W - 40 - storeW : 40;
        const box = () => {
          ctx.fillStyle = THEME.bg;
          roundRect(ctx, sx, 56, storeW, H - 112, 40);
          ctx.fill();
        };
        if (celebrate && winner === seat) glow(ctx, color, 10 + 22 * pulse(t), box);
        else box();
        ctx.strokeStyle = color;
        ctx.lineWidth = hits.has(s) ? 5 : 3;
        roundRect(ctx, sx, 56, storeW, H - 112, 40);
        ctx.stroke();
        seeds(sx + storeW / 2, H / 2 - 28, pits[s]!, 26);
        text(ctx, String(pits[s]), sx + storeW / 2, H / 2 + 46, 34, color);
      }
      // Sowing direction arrows.
      arrow(ctx, W / 2, H / 2 + 8, 1, 'rgba(255,84,112,0.7)');
      arrow(ctx, W / 2, H / 2 - 8, -1, 'rgba(46,230,197,0.7)');
    },
  };
}

// ── Playing cards ────────────────────────────────────────────────────────────

const RED_SUITS = new Set<Suit>(['hearts', 'diamonds']);

function suitPath(ctx: Ctx, suit: Suit, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  if (suit === 'diamonds') {
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s * 0.72, cy);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s * 0.72, cy);
    ctx.closePath();
  } else if (suit === 'hearts') {
    ctx.moveTo(cx, cy + s * 0.9);
    ctx.bezierCurveTo(cx - s * 1.3, cy - s * 0.1, cx - s * 0.6, cy - s * 1.2, cx, cy - s * 0.45);
    ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.2, cx + s * 1.3, cy - s * 0.1, cx, cy + s * 0.9);
  } else if (suit === 'spades') {
    ctx.moveTo(cx, cy - s);
    ctx.bezierCurveTo(cx + s * 1.3, cy - s * 0.05, cx + s * 0.6, cy + s * 0.95, cx, cy + s * 0.35);
    ctx.bezierCurveTo(cx - s * 0.6, cy + s * 0.95, cx - s * 1.3, cy - s * 0.05, cx, cy - s);
    ctx.moveTo(cx, cy + s * 0.2);
    ctx.lineTo(cx + s * 0.32, cy + s);
    ctx.lineTo(cx - s * 0.32, cy + s);
    ctx.closePath();
  } else {
    const r = s * 0.42;
    ctx.arc(cx, cy - s * 0.48, r, 0, Math.PI * 2);
    ctx.moveTo(cx - s * 0.42 + r, cy + s * 0.08);
    ctx.arc(cx - s * 0.42, cy + s * 0.08, r, 0, Math.PI * 2);
    ctx.moveTo(cx + s * 0.42 + r, cy + s * 0.08);
    ctx.arc(cx + s * 0.42, cy + s * 0.08, r, 0, Math.PI * 2);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + s * 0.3, cy + s);
    ctx.lineTo(cx - s * 0.3, cy + s);
    ctx.closePath();
  }
  ctx.fill();
}

export function drawCard(ctx: Ctx, c: PlayingCard | null, x: number, y: number, w: number, accent?: string): void {
  const h = w * 1.4;
  const body = () => {
    ctx.fillStyle = c ? '#f7f7fc' : THEME.blue;
    roundRect(ctx, x, y, w, h, w * 0.1);
    ctx.fill();
  };
  if (accent) glow(ctx, accent, 22, body);
  else body();
  if (!c) {
    // Card back: inset border and a diamond pattern.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    roundRect(ctx, x + w * 0.08, y + w * 0.08, w * 0.84, h - w * 0.16, w * 0.06);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    suitPath(ctx, 'diamonds', x + w / 2, y + h / 2, w * 0.22);
    text(ctx, '?', x + w / 2, y + h / 2 + 2, w * 0.28, '#ffffff');
    return;
  }
  if (accent) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, w * 0.1);
    ctx.stroke();
  }
  const color = RED_SUITS.has(c.suit) ? '#e0284d' : '#1f2240';
  const corner = () => {
    text(ctx, rankLabel(c.rank), x + w * 0.17, y + w * 0.18, w * 0.2, color);
    ctx.fillStyle = color;
    suitPath(ctx, c.suit, x + w * 0.17, y + w * 0.4, w * 0.08);
  };
  corner();
  ctx.fillStyle = color;
  suitPath(ctx, c.suit, x + w / 2, y + h / 2, w * 0.24);
}

/** The run of revealed cards (oldest first). `hidden`: the next card is still face down. */
export function higherLowerScene(run: readonly PlayingCard[], hidden: boolean, left: number, verdict: 'ok' | 'bust' | null, celebrate = false): Scene {
  const W = 680;
  const H = 330;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      const bigW = 150;
      const current = run.at(-1)!;
      const prev = run.slice(0, -1).slice(-5);
      // History, small and fanned out on the left.
      prev.forEach((c, k) => drawCard(ctx, c, 26 + k * 34, 120 + (prev.length - 1 - k) * 4, 70));
      const cx = W / 2 - bigW / 2 - 30;
      const bob = celebrate ? Math.sin(t * Math.PI * 2) * 5 : 0;
      const accent = verdict === 'bust' ? THEME.red : verdict === 'ok' ? THEME.green : undefined;
      if (hidden) {
        drawCard(ctx, current, cx, 60, bigW);
        drawCard(ctx, null, W - 40 - bigW, 60, bigW);
        text(ctx, `${left} left`, W - 40 - bigW / 2, 60 + bigW * 1.4 + 22, 18, THEME.muted, { black: false });
      } else {
        const before = run.at(-2);
        if (before) drawCard(ctx, before, cx, 60, bigW);
        drawCard(ctx, current, W - 40 - bigW, 60 + bob, bigW, accent);
        mark(ctx, verdict === 'bust', W - 40 - bigW - 56, 60 + bigW * 0.7, 18, accent ?? THEME.muted);
      }
    },
  };
}

// ── Hangman duel ─────────────────────────────────────────────────────────────

export interface HangmanBoard {
  /** The puzzle as the guesser sees it, `_` for hidden letters. */
  masked: string;
  wrong: readonly string[];
  lives: number;
  maxLives: number;
  solved: boolean;
  /** Shown at the end. */
  answer?: string;
}

function gallows(ctx: Ctx, x: number, y: number, misses: number, color: string): void {
  ctx.strokeStyle = THEME.muted;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + 150);
  ctx.lineTo(x + 90, y + 150);
  ctx.moveTo(x + 22, y + 150);
  ctx.lineTo(x + 22, y);
  ctx.lineTo(x + 80, y);
  ctx.lineTo(x + 80, y + 18);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  const parts: (() => void)[] = [
    () => ctx.arc(x + 80, y + 34, 16, 0, Math.PI * 2),
    () => (ctx.moveTo(x + 80, y + 50), ctx.lineTo(x + 80, y + 96)),
    () => (ctx.moveTo(x + 80, y + 62), ctx.lineTo(x + 60, y + 82)),
    () => (ctx.moveTo(x + 80, y + 62), ctx.lineTo(x + 100, y + 82)),
    () => (ctx.moveTo(x + 80, y + 96), ctx.lineTo(x + 64, y + 126)),
    () => (ctx.moveTo(x + 80, y + 96), ctx.lineTo(x + 96, y + 126)),
  ];
  for (let k = 0; k < Math.min(misses, parts.length); k++) {
    ctx.beginPath();
    parts[k]!();
    ctx.stroke();
  }
}

/**
 * The puzzle as a row of letter slots. Hidden letters are empty slots, or shown in red
 * when `answer` reveals them at the end. Spaces leave a gap; other symbols are shown as-is.
 */
function letterSlots(ctx: Ctx, masked: string, answer: string | undefined, cx: number, y: number, maxW: number, color: string): void {
  const n = masked.length;
  const slot = Math.min(34, (maxW + 6) / n - 6);
  const gap = Math.max(3, slot * 0.18);
  const total = n * slot + (n - 1) * gap;
  let x = cx - total / 2;
  for (let i = 0; i < n; i++) {
    const ch = masked[i]!;
    const real = answer?.[i];
    if (ch !== ' ') {
      if (/[a-z_]/.test(ch)) {
        ctx.fillStyle = THEME.muted;
        roundRect(ctx, x, y + slot * 0.55, slot, 4, 2);
        ctx.fill();
      }
      const letter = ch === '_' ? real : ch;
      if (letter) text(ctx, letter.toUpperCase(), x + slot / 2, y + 2, Math.round(slot * 0.95), ch === '_' ? THEME.red : color);
    }
    x += slot + gap;
  }
}

/** Two panels: the puzzle each seat is solving. `turn` gets a highlight. */
export function hangmanScene(boards: readonly [HangmanBoard, HangmanBoard], turn: number, winner: number, celebrate = false): Scene {
  const W = 760;
  const H = 330;
  const panelW = (W - 60) / 2;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      boards.forEach((b, seat) => {
        const x = 20 + seat * (panelW + 20);
        const color = SEAT_COLOR[seat]!;
        const panel = () => {
          ctx.fillStyle = seat === turn ? THEME.panelLight : THEME.panel;
          roundRect(ctx, x, 20, panelW, H - 40, 22);
          ctx.fill();
        };
        if (celebrate && winner === seat) glow(ctx, THEME.yellow, 10 + 20 * pulse(t), panel);
        else panel();
        ctx.strokeStyle = color;
        ctx.lineWidth = seat === turn ? 4 : 2;
        roundRect(ctx, x, 20, panelW, H - 40, 22);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + 28, 48, 9, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, `${b.lives} ${b.lives === 1 ? 'life' : 'lives'} left`, x + 44, 49, 18, THEME.muted, { black: false, align: 'left' });

        gallows(ctx, x + 24, 78, b.maxLives - b.lives, color);

        letterSlots(ctx, b.masked, b.answer, x + panelW / 2, H - 66, panelW - 40, b.solved ? THEME.green : THEME.text);

        // Wrong letters to the right of the gallows.
        ctx.font = font(22, true);
        ctx.textAlign = 'left';
        ctx.fillStyle = THEME.red;
        const wrong = b.wrong.map((w) => w.toUpperCase());
        for (let k = 0; k < wrong.length; k += 3) ctx.fillText(wrong.slice(k, k + 3).join('  '), x + 168, 100 + (k / 3) * 30, panelW - 186);
        if (!wrong.length) text(ctx, 'no misses yet', x + 168, 100, 18, THEME.muted, { black: false, align: 'left' });
      });
    },
  };
}

// ── Number duel ──────────────────────────────────────────────────────────────

export interface NumberTrack {
  lo: number;
  hi: number;
  guesses: readonly number[];
  solved: boolean;
  /** Revealed at the end. */
  secret?: number;
}

/** Each seat's search: the range still possible for the number they're hunting. */
export function numberScene(tracks: readonly [NumberTrack, NumberTrack], max: number, turn: number, winner: number, celebrate = false): Scene {
  const W = 700;
  const H = 300;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      const left = 70;
      const right = W - 40;
      const sx = (n: number) => left + ((n - 1) / (max - 1)) * (right - left);
      tracks.forEach((tr, seat) => {
        const y = 92 + seat * 118;
        const color = SEAT_COLOR[seat]!;
        const dot = () => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(34, y, seat === turn ? 13 : 10, 0, Math.PI * 2);
          ctx.fill();
        };
        if (celebrate && winner === seat) glow(ctx, color, 10 + 20 * pulse(t), dot);
        else dot();
        // Full track, then the window still in play.
        ctx.fillStyle = THEME.panel;
        roundRect(ctx, left, y - 14, right - left, 28, 14);
        ctx.fill();
        ctx.fillStyle = tr.solved ? THEME.green : color;
        ctx.globalAlpha = tr.solved ? 0.9 : 0.55;
        const x1 = sx(tr.lo) - 6;
        const x2 = sx(tr.hi) + 6;
        roundRect(ctx, x1, y - 14, Math.max(12, x2 - x1), 28, 14);
        ctx.fill();
        ctx.globalAlpha = 1;
        for (const g of tr.guesses) {
          ctx.fillStyle = THEME.text;
          ctx.fillRect(sx(g) - 1.5, y - 20, 3, 40);
        }
        const label = tr.solved ? `found ${tr.guesses.at(-1)}` : tr.lo === tr.hi ? `it's ${tr.lo}` : `${tr.lo} – ${tr.hi}`;
        text(ctx, label, (sx(tr.lo) + sx(tr.hi)) / 2, y - 38, 22, tr.solved ? THEME.green : THEME.text);
        text(ctx, `${tr.guesses.length} guess${tr.guesses.length === 1 ? '' : 'es'}`, right, y + 34, 16, THEME.muted, { black: false, align: 'right' });
        if (tr.secret !== undefined && !tr.solved) text(ctx, `was ${tr.secret}`, left, y + 34, 16, THEME.red, { black: false, align: 'left' });
      });
      text(ctx, '1', left, H - 22, 16, THEME.muted, { black: false });
      text(ctx, String(max), right, H - 22, 16, THEME.muted, { black: false });
    },
  };
}
