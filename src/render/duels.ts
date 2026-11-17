/**
 * Board images for the smaller duels: dots and boxes, matchsticks, five in a row,
 * mancala, higher or lower, hangman and the number duel. Like the other scenes they
 * contain no usernames: seats are told apart by colour (red = first, teal = second).
 */
import { MANCALA_STORE, rankLabel, sideLine, type Cell, type Dots, type PlayingCard, type Side, type Suit } from '../games/logic.js';
import { counter, drawO, drawX, pulse, strikeThrough, type Scene } from './boards.js';
import { background, THEME, type Ctx } from './canvas.js';
import {
  celebrateAround,
  handLoop,
  hatch,
  highlight,
  highlightCircle,
  linePts,
  rectPts,
  sketchCircle,
  sketchLine,
  sketchRect,
  stroke,
  write,
  type Pt,
} from './sketch.js';

export const SEAT_COLOR = [THEME.red, THEME.teal] as const;
/** Darker seat colours for text and thin lines, which need more contrast on paper. */
const SEAT_INK = [THEME.redInk, THEME.tealInk] as const;

/** A tick, or a cross when `cross`, as two quick marker strokes. */
function mark(ctx: Ctx, cross: boolean, cx: number, cy: number, r: number, color: string): void {
  const o = { color, width: 9, passes: 1 as const, overshoot: 0 };
  if (cross) {
    sketchLine(ctx, cx - r, cy - r, cx + r, cy + r, o);
    sketchLine(ctx, cx + r, cy - r, cx - r, cy + r, o);
  } else {
    stroke(ctx, [[cx - r, cy], [cx - r * 0.3, cy + r * 0.7], [cx + r, cy - r * 0.8]], false, { ...o, amp: 0.5 });
  }
}

/** A hand-drawn arrow, slightly bowed. */
function arrow(ctx: Ctx, cx: number, cy: number, dir: 1 | -1, color: string): void {
  const pts: Pt[] = linePts(cx - 26 * dir, cy, cx + 26 * dir, cy, 4).map(([x, y], k, a) => [x, y - Math.sin((k / (a.length - 1)) * Math.PI) * 4 * dir]);
  stroke(ctx, pts, false, { color, width: 3.5, passes: 1, amp: 0.6 });
  const tip = pts.at(-1)!;
  stroke(ctx, [[tip[0] - 9 * dir, tip[1] - 7], tip, [tip[0] - 9 * dir, tip[1] + 6]], false, { color, width: 3.5, passes: 1, amp: 0.4 });
}

// ── Dots and boxes ───────────────────────────────────────────────────────────

export function dotsScene(d: Dots, last: { box: number; side: Side } | null, selected: number, celebrate = false): Scene {
  const cell = 120;
  const pad = 48;
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

      // Boxes: hatched in the owner's colour with their mark, or the keypad number when still open.
      for (let b = 0; b < d.w * d.h; b++) {
        const x = px(b % d.w);
        const y = py(Math.floor(b / d.w));
        const owner = d.boxes[b];
        if (b === selected) highlight(ctx, x + 10, y + 10, cell - 20, cell - 20, THEME.highlight, b + 1);
        if (owner) {
          hatch(ctx, rectPts(x + 8, y + 8, cell - 16, cell - 16, 6), SEAT_COLOR[owner - 1]!, { gap: 11, width: 2.5, seed: b, alpha: 0.45 });
          const grow = celebrate ? 1 + 0.1 * pulse(t + b * 0.07) : 1;
          if (owner === 1) drawX(ctx, x + cell / 2, y + cell / 2, cell * 0.2 * grow, 12);
          else drawO(ctx, x + cell / 2, y + cell / 2, cell * 0.24 * grow, 11);
        } else {
          write(ctx, String(b + 1), x + cell / 2, y + cell / 2, 40, b === selected ? THEME.ink : THEME.pencil);
        }
      }

      // Lines: faint pencil dashes for open ones, the drawer's marker colour for taken ones.
      const line = (x1: number, y1: number, x2: number, y2: number, who: Cell, isLast: boolean) => {
        if (!who) {
          ctx.save();
          ctx.strokeStyle = THEME.pencil;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 3;
          ctx.setLineDash([3, 12]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.restore();
          return;
        }
        if (isLast) stroke(ctx, linePts(x1, y1, x2, y2), false, { color: THEME.highlight, width: 26, passes: 1, amp: 1 });
        sketchLine(ctx, x1, y1, x2, y2, { color: SEAT_COLOR[who - 1]!, width: 10, passes: 1, amp: 1.8, overshoot: 0 });
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
        for (let x = 0; x <= d.w; x++) sketchCircle(ctx, px(x), py(y), 8, { fill: THEME.ink, width: 2, passes: 1, offset: 0.5 });
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
  const top = 132;
  const H = top + rows * (stickH + 30) + 20;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      const bob = celebrate ? Math.sin(t * Math.PI * 2) * 4 : 0;
      write(ctx, String(left), W / 2, 56 + bob, 72, left <= 1 ? THEME.red : THEME.yellow, { outline: THEME.ink, tilt: -0.04 });
      write(ctx, left === 1 ? 'stick left' : 'sticks left', W / 2, 106, 24, THEME.ink);
      if (celebrate) celebrateAround(ctx, W / 2 - 70, 14, 140, 84, t, 3);
      for (let k = 0; k < total; k++) {
        const r = Math.floor(k / perRow);
        const inRow = Math.min(perRow, total - r * perRow);
        const c = k % perRow;
        const x = W / 2 - ((inRow - 1) * gap) / 2 + c * gap;
        const y = top + r * (stickH + 30);
        const onTable = k < left;
        const justTaken = !onTable && k < left + lastTaken;
        ctx.globalAlpha = onTable ? 1 : justTaken ? 0.6 : 0.15;
        const lift = justTaken ? -10 : 0;
        const tilt = ((k * 53) % 9 - 4) * 0.012;
        ctx.save();
        ctx.translate(x, y + lift + stickH / 2);
        ctx.rotate(tilt);
        sketchRect(ctx, -5, -stickH / 2 + 18, 10, stickH - 18, 4, { fill: THEME.wood, width: 2.2, passes: 1, seed: k, offset: 1 });
        const head = justTaken ? SEAT_COLOR[lastSeat]! : THEME.red;
        sketchCircle(ctx, 0, -stickH / 2 + 14, 10, { fill: head, width: 2.2, passes: 1, seed: k + 50, offset: 1 });
        ctx.restore();
        if (justTaken) {
          ctx.globalAlpha = 1;
          sketchRect(ctx, x - 15, y - 4 + lift, 30, stickH + 12, 12, { stroke: SEAT_INK[lastSeat]!, width: 3, passes: 1, seed: k + 100 });
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
  const left = 60;
  const top = 60;
  const W = left + cell * size + 32;
  const H = top + cell * size + 32;
  const cx = (x: number) => left + x * cell + cell / 2;
  const cy = (y: number) => top + y * cell + cell / 2;
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      if (selectedRow >= 0) highlight(ctx, left - 6, top + selectedRow * cell + 6, cell * size + 12, cell - 12, THEME.highlight, selectedRow + 1);
      for (let i = 0; i < size; i++) {
        write(ctx, String(i + 1), cx(i), top / 2 + 2, 26, THEME.ink);
        write(ctx, ROW_LETTERS[i]!, left / 2 + 2, cy(i), 26, i === selectedRow ? THEME.redInk : THEME.ink);
      }
      for (let i = 0; i < size; i++) {
        sketchLine(ctx, cx(0), cy(i), cx(size - 1), cy(i), { color: THEME.pencil, width: 2.2, passes: 1, amp: 1.2, overshoot: 4 });
        sketchLine(ctx, cx(i), cy(0), cx(i), cy(size - 1), { color: THEME.pencil, width: 2.2, passes: 1, amp: 1.2, overshoot: 4 });
      }
      // Star points help find your way around.
      const mid = Math.floor(size / 2);
      for (const [x, y] of [[2, 2], [size - 3, 2], [2, size - 3], [size - 3, size - 3], [mid, mid]]) {
        sketchCircle(ctx, cx(x!), cy(y!), 4.5, { fill: THEME.pencil, stroke: null });
      }
      for (let i = 0; i < size * size; i++) {
        const c = board[i];
        if (!c) continue;
        const x = cx(i % size);
        const y = cy(Math.floor(i / size));
        const winning = win.includes(i);
        const r = cell * 0.39 * (winning ? 1 + 0.08 * pulse(t + i * 0.03) : 1);
        counter(ctx, x, y, r, SEAT_COLOR[c - 1]!, i);
        if (i === last && !win.length) sketchCircle(ctx, x, y, 6, { fill: THEME.ink, stroke: null });
      }
      if (win.length) strikeThrough(ctx, win.map((i) => [cx(i % size), cy(Math.floor(i / size))] as Pt), cell * 0.45);
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
  const H = 340;
  const rowY = [H - 112, 112];
  const pitX = (seat: number, p: number) => (seat === 0 ? 40 + storeW + 20 + gap * p + gap / 2 : 40 + storeW + 20 + gap * (5 - p) + gap / 2);
  const hits = new Set(path);
  return {
    w: W,
    h: H,
    draw(ctx, t) {
      background(ctx, W, H);
      sketchRect(ctx, 22, 28, W - 44, H - 56, 60, { fill: THEME.wood, hatch: 'rgba(207,149,71,0.55)', hatchGap: 26, width: 4, seed: 9 });

      // Colourful pebbles; the count is always written too.
      const seeds = (x: number, y: number, n: number, spread: number, seed: number) => {
        const shown = Math.min(n, 12);
        for (let k = 0; k < shown; k++) {
          const a = k * 2.399 + n; // golden angle spiral
          const rr = spread * Math.sqrt((k + 0.5) / 12);
          sketchCircle(ctx, x + Math.cos(a) * rr, y + Math.sin(a) * rr, 6, {
            fill: THEME.confetti[(k + seed) % THEME.confetti.length]!,
            width: 1.5,
            passes: 1,
            offset: 0.8,
            seed: seed * 20 + k,
          });
        }
      };

      for (const seat of [0, 1] as const) {
        for (let p = 0; p < 6; p++) {
          const i = seat * 7 + p;
          const x = pitX(seat, p);
          const y = rowY[seat]!;
          sketchCircle(ctx, x, y, pitR, { fill: THEME.paper, width: 3, seed: i, offset: 1 });
          // Pits the last move sowed into get a white ring (highlighter turns muddy on wood).
          if (hits.has(i)) handLoop(ctx, x, y, pitR + 7, { color: THEME.white, width: 5, seed: i });
          seeds(x, y - 6, pits[i]!, pitR - 15, i);
          write(ctx, String(pits[i]), x, y + pitR - 13, 22, THEME.ink);
          write(ctx, String(p + 1), x, seat === 0 ? y + pitR + 22 : y - pitR - 22, 24, SEAT_INK[seat]!, { outline: THEME.paper });
        }
        // Stores: seat 0 right, seat 1 left.
        const s = MANCALA_STORE[seat]!;
        const sx = seat === 0 ? W - 42 - storeW : 42;
        const won = celebrate && winner === seat;
        sketchRect(ctx, sx, 60, storeW, H - 120, 40, { fill: THEME.paper, width: 3, seed: 30 + seat, offset: 1 });
        sketchRect(ctx, sx + 5, 65, storeW - 10, H - 130, 35, { stroke: SEAT_COLOR[seat]!, width: hits.has(s) ? 6 : 4, passes: 1, seed: 32 + seat });
        seeds(sx + storeW / 2, H / 2 - 28, pits[s]!, 24, s);
        const grow = won ? 1 + 0.12 * pulse(t) : 1;
        write(ctx, String(pits[s]), sx + storeW / 2, H / 2 + 48, Math.round(40 * grow), SEAT_COLOR[seat]!, { outline: THEME.ink });
        if (won) celebrateAround(ctx, sx, 60, storeW, H - 120, t, 4);
      }
      // Sowing direction arrows.
      arrow(ctx, W / 2, H / 2 + 12, 1, SEAT_INK[0]);
      arrow(ctx, W / 2, H / 2 - 12, -1, SEAT_INK[1]);
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
}

/** A suit in marker colour, printed a touch off its ink outline. */
function suit(ctx: Ctx, kind: Suit, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  suitPath(ctx, kind, cx + s * 0.06, cy + s * 0.05, s);
  ctx.fill();
  ctx.strokeStyle = THEME.ink;
  ctx.lineWidth = Math.max(1.5, s * 0.08);
  ctx.lineJoin = 'round';
  suitPath(ctx, kind, cx, cy, s);
  ctx.stroke();
  ctx.restore();
}

export function drawCard(ctx: Ctx, c: PlayingCard | null, x: number, y: number, w: number, accent?: string): void {
  const h = w * 1.4;
  const seed = Math.round(x + y);
  if (accent) highlight(ctx, x - 12, y - 12, w + 24, h + 24, accent === THEME.red ? 'rgba(255,90,110,0.45)' : 'rgba(92,207,111,0.5)', seed);
  sketchRect(ctx, x, y, w, h, w * 0.1, { fill: c ? THEME.white : THEME.blue, width: w > 100 ? 3.5 : 2.5, seed, offset: 1.5 });
  if (!c) {
    // Card back: crosshatching and a big question mark.
    const inner = rectPts(x + w * 0.1, y + w * 0.1, w * 0.8, h - w * 0.2, w * 0.06);
    hatch(ctx, inner, THEME.blueLight, { gap: 12, angle: -0.8, width: 2.5, seed });
    hatch(ctx, inner, THEME.blueLight, { gap: 12, angle: 0.8, width: 2.5, seed: seed + 1 });
    write(ctx, '?', x + w / 2, y + h / 2, w * 0.5, THEME.white, { outline: THEME.ink });
    return;
  }
  const red = RED_SUITS.has(c.suit);
  const color = red ? THEME.red : THEME.ink;
  write(ctx, rankLabel(c.rank), x + w * 0.19, y + w * 0.2, w * 0.24, red ? THEME.redInk : THEME.ink);
  suit(ctx, c.suit, x + w * 0.19, y + w * 0.44, w * 0.08, color);
  suit(ctx, c.suit, x + w / 2, y + h / 2 + w * 0.06, w * 0.24, color);
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
      prev.forEach((c, k) => {
        ctx.save();
        const x = 26 + k * 34;
        const y = 120 + (prev.length - 1 - k) * 4;
        ctx.translate(x + 35, y + 49);
        ctx.rotate((k - prev.length / 2) * 0.05);
        drawCard(ctx, c, -35, -49, 70);
        ctx.restore();
      });
      const cx = W / 2 - bigW / 2 - 30;
      const bob = celebrate ? Math.sin(t * Math.PI * 2) * 5 : 0;
      const accent = verdict === 'bust' ? THEME.red : verdict === 'ok' ? THEME.green : undefined;
      if (hidden) {
        drawCard(ctx, current, cx, 60, bigW);
        drawCard(ctx, null, W - 40 - bigW, 60, bigW);
        write(ctx, `${left} left`, W - 40 - bigW / 2, 60 + bigW * 1.4 + 24, 24, THEME.ink);
      } else {
        const before = run.at(-2);
        if (before) drawCard(ctx, before, cx, 60, bigW);
        drawCard(ctx, current, W - 40 - bigW, 60 + bob, bigW, accent);
        mark(ctx, verdict === 'bust', W - 40 - bigW - 56, 60 + bigW * 0.7, 18, verdict === 'bust' ? THEME.redInk : verdict === 'ok' ? '#2fa64a' : THEME.pencil);
        if (celebrate && verdict === 'ok') celebrateAround(ctx, W - 40 - bigW, 60, bigW, bigW * 1.4, t, 5);
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

function gallows(ctx: Ctx, x: number, y: number, misses: number, color: string, seed: number): void {
  const o = { width: 6, amp: 1.4, seed };
  sketchLine(ctx, x - 4, y + 150, x + 96, y + 150, o);
  sketchLine(ctx, x + 22, y + 150, x + 22, y, { ...o, seed: seed + 1 });
  sketchLine(ctx, x + 16, y, x + 84, y, { ...o, seed: seed + 2 });
  sketchLine(ctx, x + 22, y + 30, x + 48, y + 2, { ...o, width: 4, seed: seed + 3 });
  sketchLine(ctx, x + 80, y, x + 80, y + 18, { ...o, width: 3.5, seed: seed + 4 });
  const p = { color, width: 5, passes: 1 as const, overshoot: 0, seed };
  const parts: (() => void)[] = [
    () => handLoop(ctx, x + 80, y + 34, 15, { color, width: 5, seed }),
    () => sketchLine(ctx, x + 80, y + 50, x + 80, y + 96, p),
    () => sketchLine(ctx, x + 80, y + 62, x + 60, y + 82, p),
    () => sketchLine(ctx, x + 80, y + 62, x + 100, y + 82, p),
    () => sketchLine(ctx, x + 80, y + 96, x + 64, y + 126, p),
    () => sketchLine(ctx, x + 80, y + 96, x + 96, y + 126, p),
  ];
  for (let k = 0; k < Math.min(misses, parts.length); k++) parts[k]!();
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
      if (/[a-z_]/.test(ch)) sketchLine(ctx, x + 1, y + slot * 0.62, x + slot - 1, y + slot * 0.62, { width: 3, passes: 1, overshoot: 0, seed: i });
      const letter = ch === '_' ? real : ch;
      if (letter) write(ctx, letter.toUpperCase(), x + slot / 2, y, Math.round(slot * 1.05), ch === '_' ? THEME.redInk : color);
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
        const ink = SEAT_INK[seat]!;
        if (seat === turn) highlight(ctx, x - 6, 14, panelW + 12, H - 28, THEME.highlight, seat + 1);
        sketchRect(ctx, x, 20, panelW, H - 40, 20, { fill: THEME.white, stroke: color, width: seat === turn ? 5 : 3, seed: 80 + seat, offset: 1 });

        sketchCircle(ctx, x + 30, 48, 9, { fill: color, width: 2, passes: 1 });
        write(ctx, `${b.lives} ${b.lives === 1 ? 'life' : 'lives'} left`, x + 48, 48, 22, THEME.ink, { align: 'left' });

        gallows(ctx, x + 26, 78, b.maxLives - b.lives, ink, seat * 10);

        letterSlots(ctx, b.masked, b.answer, x + panelW / 2, H - 70, panelW - 40, b.solved ? '#2fa64a' : THEME.ink);

        // Wrong letters to the right of the gallows, each crossed out.
        const wrong = b.wrong.map((w) => w.toUpperCase());
        if (!wrong.length) write(ctx, 'no misses yet', x + 170, 100, 22, THEME.pencil, { align: 'left' });
        wrong.forEach((w, k) => {
          const lx = x + 178 + (k % 4) * 38;
          const ly = 102 + Math.floor(k / 4) * 36;
          if (lx > x + panelW - 20) return;
          write(ctx, w, lx, ly, 28, THEME.redInk, { tilt: ((k * 31) % 5 - 2) * 0.05 });
          sketchLine(ctx, lx - 11, ly + 9, lx + 11, ly - 9, { width: 2.5, passes: 1, overshoot: 0, seed: k });
        });
        if (celebrate && winner === seat) celebrateAround(ctx, x, 20, panelW, H - 40, t, seat + 6);
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
      const left = 72;
      const right = W - 40;
      const sx = (n: number) => left + ((n - 1) / (max - 1)) * (right - left);
      tracks.forEach((tr, seat) => {
        const y = 94 + seat * 118;
        const color = SEAT_COLOR[seat]!;
        const won = celebrate && winner === seat;
        const r = (seat === turn ? 14 : 11) * (won ? 1 + 0.15 * pulse(t) : 1);
        if (seat === turn) highlightCircle(ctx, 34, y, 22);
        sketchCircle(ctx, 34, y, r, { fill: color, width: 2.5, passes: 1, seed: seat });
        // Full track, then the window still in play.
        sketchRect(ctx, left, y - 14, right - left, 28, 14, { fill: THEME.white, width: 2.5, seed: 90 + seat, offset: 1 });
        const x1 = sx(tr.lo) - 6;
        const x2 = sx(tr.hi) + 6;
        const win = rectPts(x1, y - 14, Math.max(12, x2 - x1), 28, 14);
        if (tr.solved) sketchRect(ctx, x1, y - 14, Math.max(12, x2 - x1), 28, 14, { fill: THEME.green, width: 2.5, passes: 1, seed: 95 + seat });
        else {
          hatch(ctx, win, color, { gap: 7, width: 3, seed: 97 + seat });
          stroke(ctx, win, true, { color: SEAT_INK[seat]!, width: 3, passes: 1, seed: 99 + seat });
        }
        for (const g of tr.guesses) sketchLine(ctx, sx(g), y - 20, sx(g), y + 20, { width: 3, passes: 1, overshoot: 0, seed: g });
        const label = tr.solved ? `found ${tr.guesses.at(-1)}` : tr.lo === tr.hi ? `it's ${tr.lo}` : `${tr.lo} – ${tr.hi}`;
        write(ctx, label, (sx(tr.lo) + sx(tr.hi)) / 2, y - 40, 28, tr.solved ? '#2fa64a' : THEME.ink);
        write(ctx, `${tr.guesses.length} guess${tr.guesses.length === 1 ? '' : 'es'}`, right, y + 36, 20, THEME.pencil, { align: 'right' });
        if (tr.secret !== undefined && !tr.solved) write(ctx, `was ${tr.secret}`, left, y + 36, 20, THEME.redInk, { align: 'left' });
        if (won) celebrateAround(ctx, 14, y - 20, 40, 40, t, seat + 8);
      });
      write(ctx, '1', left, H - 22, 20, THEME.pencil);
      write(ctx, String(max), right, H - 22, 20, THEME.pencil);
    },
  };
}
