/**
 * Hand-drawn drawing kit: wobbly ink lines, marker fills that sit slightly off
 * their outline, hatching, highlighter and handwritten text.
 *
 * Every wobble comes from a seeded generator (by default seeded from the shape's
 * position), so a board looks identical on every render and lines don't jitter
 * between the frames of an animation.
 */
import { font, THEME, type Ctx } from './canvas.js';

export type Pt = [number, number];
const TAU = Math.PI * 2;

/** Small deterministic PRNG (FNV-1a seed + mulberry32). */
export function rng(...seed: number[]): () => number {
  let h = 2166136261;
  for (const n of seed) {
    h ^= Math.round(n * 7) | 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Shapes as point lists ────────────────────────────────────────────────────

export function linePts(x1: number, y1: number, x2: number, y2: number, step = 6): Pt[] {
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
  return Array.from({ length: n + 1 }, (_, i) => [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n] as Pt);
}

/** Points along an ellipse arc. A full turn leaves out the duplicate end point. */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, from = 0, sweep = TAU, step = 5): Pt[] {
  const full = Math.abs(sweep) >= TAU - 1e-9;
  const n = Math.max(12, Math.ceil((Math.abs(sweep) * Math.max(rx, ry)) / step));
  return Array.from({ length: full ? n : n + 1 }, (_, i) => {
    const a = from + (sweep * i) / n;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Pt;
  });
}

export function rectPts(x: number, y: number, w: number, h: number, r: number, step = 6): Pt[] {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const pts: Pt[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number) => pts.push(...linePts(x1, y1, x2, y2, step).slice(0, -1));
  const arc = (cx: number, cy: number, a0: number) => r > 0 && pts.push(...ellipsePts(cx, cy, r, r, a0, Math.PI / 2, step).slice(0, -1));
  seg(x + r, y, x + w - r, y);
  arc(x + w - r, y + r, -Math.PI / 2);
  seg(x + w, y + r, x + w, y + h - r);
  arc(x + w - r, y + h - r, 0);
  seg(x + w - r, y + h, x + r, y + h);
  arc(x + r, y + h - r, Math.PI / 2);
  seg(x, y + h - r, x, y + r);
  arc(x + r, y + r, Math.PI);
  return pts;
}

/** Densifies a polygon given by its corners. */
export function polyPts(corners: readonly Pt[], closed = true, step = 6): Pt[] {
  const pts: Pt[] = [];
  const n = corners.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [x1, y1] = corners[i]!;
    const [x2, y2] = corners[(i + 1) % n]!;
    pts.push(...linePts(x1, y1, x2, y2, step).slice(0, -1));
  }
  if (!closed) pts.push(corners[n - 1]!);
  return pts;
}

// ── Wobble ───────────────────────────────────────────────────────────────────

const seedOf = (pts: readonly Pt[]) => {
  const a = pts[0]!;
  const b = pts[pts.length >> 1]!;
  return [a[0], a[1], b[0], b[1], pts.length];
};

/** Pushes each point along its normal by two random sine waves: a slow sway and a faster tremble. */
function wobble(pts: readonly Pt[], closed: boolean, amp: number, rand: () => number): Pt[] {
  const n = pts.length;
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = (s[n - 1]! + (closed ? Math.hypot(pts[0]![0] - pts[n - 1]![0], pts[0]![1] - pts[n - 1]![1]) : 0)) || 1;
  // Closed shapes need whole cycles so the outline meets itself without a step.
  const cycles = (len: number, min: number) => (closed ? Math.max(min, Math.round(total / len)) : total / len);
  const k1 = cycles(90 + rand() * 70, 1);
  const k2 = cycles(26 + rand() * 18, 2);
  const p1 = rand() * TAU;
  const p2 = rand() * TAU;
  return pts.map((p, i) => {
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
    let nx = -(next[1] - prev[1]);
    let ny = next[0] - prev[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const u = s[i]! / total;
    const d = amp * (0.7 * Math.sin(TAU * k1 * u + p1) + 0.3 * Math.sin(TAU * k2 * u + p2));
    return [p[0] + nx * d, p[1] + ny * d] as Pt;
  });
}

function trace(ctx: Ctx, pts: readonly Pt[], closed: boolean): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (closed) ctx.closePath();
}

// ── Strokes and fills ────────────────────────────────────────────────────────

export interface Ink {
  color?: string;
  width?: number;
  /** 2 (default) draws a second, thinner line over the first, like a pen going over it again. */
  passes?: 1 | 2;
  amp?: number;
  seed?: number;
  alpha?: number;
}

export function stroke(ctx: Ctx, pts: readonly Pt[], closed: boolean, o: Ink = {}): void {
  const rand = rng(...(o.seed !== undefined ? [o.seed, pts.length] : seedOf(pts)));
  const w = o.width ?? 3.5;
  ctx.save();
  ctx.strokeStyle = o.color ?? THEME.ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha *= o.alpha ?? 1;
  const passes = o.passes ?? 2;
  for (let k = 0; k < passes; k++) {
    ctx.lineWidth = k ? Math.max(1, w * 0.5) : w;
    trace(ctx, wobble(pts, closed, o.amp ?? 1.6, rand), closed);
    ctx.stroke();
  }
  ctx.restore();
}

/** A flat marker fill, nudged a little off its outline. */
export function fill(ctx: Ctx, pts: readonly Pt[], color: string, o: { seed?: number; amp?: number; offset?: number; alpha?: number } = {}): void {
  const rand = rng(...(o.seed !== undefined ? [o.seed, 7] : [...seedOf(pts), 7]));
  const off = o.offset ?? 2.5;
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.translate((rand() - 0.5) * 2 * off, (rand() - 0.2) * 1.6 * off);
  ctx.fillStyle = color;
  trace(ctx, wobble(pts, true, o.amp ?? 1.6, rand), true);
  ctx.fill();
  ctx.restore();
}

/** Parallel pen strokes clipped to a closed shape. */
export function hatch(ctx: Ctx, pts: readonly Pt[], color: string, o: { gap?: number; angle?: number; width?: number; seed?: number; alpha?: number } = {}): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const R = Math.hypot(maxX - minX, maxY - minY) / 2 + 4;
  const a = o.angle ?? -0.9;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  const [vx, vy] = [-uy, ux];
  const gap = o.gap ?? 9;
  ctx.save();
  trace(ctx, pts, true);
  ctx.clip();
  let k = 0;
  for (let t = -R; t <= R; t += gap, k++) {
    const x1 = cx + vx * t - ux * R;
    const y1 = cy + vy * t - uy * R;
    const x2 = cx + vx * t + ux * R;
    const y2 = cy + vy * t + uy * R;
    stroke(ctx, linePts(x1, y1, x2, y2, 10), false, { color, width: o.width ?? 2.5, passes: 1, amp: 1.2, seed: (o.seed ?? cx + cy) + k, alpha: o.alpha });
  }
  ctx.restore();
}

// ── Ready-made shapes ────────────────────────────────────────────────────────

export interface Shape {
  fill?: string;
  /** Outline colour; `null` for no outline. Defaults to ink. */
  stroke?: string | null;
  width?: number;
  hatch?: string;
  hatchGap?: number;
  seed?: number;
  offset?: number;
  amp?: number;
  passes?: 1 | 2;
  alpha?: number;
}

export function shape(ctx: Ctx, pts: readonly Pt[], s: Shape): void {
  if (s.fill) fill(ctx, pts, s.fill, { seed: s.seed, offset: s.offset, amp: s.amp, alpha: s.alpha });
  if (s.hatch) hatch(ctx, pts, s.hatch, { seed: s.seed, gap: s.hatchGap, alpha: s.alpha });
  if (s.stroke !== null) stroke(ctx, pts, true, { color: s.stroke ?? THEME.ink, width: s.width, seed: s.seed, amp: s.amp, passes: s.passes, alpha: s.alpha });
}

export function sketchRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, s: Shape = {}): void {
  shape(ctx, rectPts(x, y, w, h, r), s);
}

export function sketchCircle(ctx: Ctx, cx: number, cy: number, r: number, s: Shape = {}): void {
  shape(ctx, ellipsePts(cx, cy, r, r, 0, TAU, Math.max(3, r / 6)), s);
}

/** A straight pen line that overshoots its ends a little, as a quick hand stroke does. */
export function sketchLine(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, o: Ink & { overshoot?: number } = {}): void {
  const rand = rng(x1, y1, x2, y2, o.seed ?? 0);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const [dx, dy] = [(x2 - x1) / len, (y2 - y1) / len];
  const over = o.overshoot ?? Math.min(6, len * 0.03);
  const a = over * (0.3 + rand());
  const b = over * (0.3 + rand());
  stroke(ctx, linePts(x1 - dx * a, y1 - dy * a, x2 + dx * b, y2 + dy * b), false, { ...o, seed: o.seed ?? Math.round(x1 * 3 + y2 * 5 + x2 * 7 + y1 * 11) });
}

/** A hand-drawn loop: one marker stroke that goes round once and overlaps where it started. */
export function handLoop(ctx: Ctx, cx: number, cy: number, r: number, o: Ink = {}): void {
  const rand = rng(cx, cy, r, o.seed ?? 0);
  const start = -Math.PI / 2 - 0.4 + rand() * 0.5;
  const sweep = TAU + 0.35 + rand() * 0.25;
  const n = Math.ceil((sweep * r) / 4);
  const pts: Pt[] = Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const a = start + sweep * u;
    const rr = r * (1.04 - 0.1 * u); // a slight spiral, so the overlap doesn't sit on the start
    return [cx + Math.cos(a) * rr * 1.03, cy + Math.sin(a) * rr * 0.97] as Pt;
  });
  stroke(ctx, pts, false, { passes: 1, amp: 1.4, ...o });
}

/** Translucent highlighter swipe over a rectangle. */
export function highlight(ctx: Ctx, x: number, y: number, w: number, h: number, color: string = THEME.highlight, seed = 0): void {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  fill(ctx, rectPts(x, y, w, h, Math.min(w, h) * 0.2), color, { seed: seed || x + y * 3 + w, amp: 2.5, offset: 3 });
  ctx.restore();
}

/** Translucent highlighter blob behind a circle. */
export function highlightCircle(ctx: Ctx, cx: number, cy: number, r: number, color: string = THEME.highlight): void {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  fill(ctx, ellipsePts(cx, cy, r, r * 0.94), color, { amp: 3, offset: 3 });
  ctx.restore();
}

// ── Doodles ──────────────────────────────────────────────────────────────────

export function star(ctx: Ctx, cx: number, cy: number, r: number, color: string, rot = 0): void {
  const corners: Pt[] = Array.from({ length: 10 }, (_, i) => {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  shape(ctx, polyPts(corners, true, 4), { fill: color, width: Math.max(2, r / 7), passes: 1, amp: 0.8, seed: Math.round(cx + cy) });
}

/** Four little strokes radiating out, the classic "shiny!" doodle. */
export function sparkle(ctx: Ctx, cx: number, cy: number, r: number, color: string = THEME.ink): void {
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + 0.3;
    sketchLine(ctx, cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, cx + Math.cos(a) * r, cy + Math.sin(a) * r, { color, width: 3, passes: 1, overshoot: 0 });
  }
}

/** Stars and sparkles scattered around a box; they turn and twinkle with the loop phase. */
export function celebrateAround(ctx: Ctx, x: number, y: number, w: number, h: number, t: number, seed = 1): void {
  const rand = rng(x, y, w, h, seed);
  const spots = 6;
  for (let k = 0; k < spots; k++) {
    const side = k % 4;
    const u = 0.15 + rand() * 0.7;
    const px = side === 0 ? x + u * w : side === 1 ? x + w + 4 : side === 2 ? x + u * w : x - 4;
    const py = side === 0 ? y - 4 : side === 1 ? y + u * h : side === 2 ? y + h + 4 : y + u * h;
    const phase = Math.sin((t + k / spots) * TAU);
    const color = THEME.confetti[k % THEME.confetti.length]!;
    if (k % 2) sparkle(ctx, px, py, 12 + 3 * phase, color);
    else star(ctx, px, py, 11 + 3 * phase, color, t * TAU * 0.25 + k);
  }
}

// ── Text ─────────────────────────────────────────────────────────────────────

export interface Write {
  align?: CanvasTextAlign;
  /** Ink outline around coloured letters. */
  outline?: string;
  tilt?: number;
  maxWidth?: number;
}

/** Handwritten text centred vertically on `y`. */
export function write(ctx: Ctx, s: string, x: number, y: number, size: number, color: string = THEME.ink, o: Write = {}): void {
  ctx.save();
  ctx.translate(x, y);
  if (o.tilt) ctx.rotate(o.tilt);
  ctx.font = font(size);
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'alphabetic';
  // Kalam's line box is tall; this puts the middle of capitals and digits on `y`.
  const dy = size * 0.34;
  if (o.outline) {
    ctx.strokeStyle = o.outline;
    ctx.lineWidth = Math.max(3, size * 0.12);
    ctx.lineJoin = 'round';
    ctx.strokeText(s, 0, dy, o.maxWidth);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, 0, dy, o.maxWidth);
  ctx.restore();
}

export function textWidth(ctx: Ctx, s: string, size: number): number {
  ctx.font = font(size);
  return ctx.measureText(s).width;
}
