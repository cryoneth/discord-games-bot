import gifenc from 'gifenc';
import { randomInt } from 'node:crypto';
import { newCanvas, THEME, type Ctx } from './canvas.js';

const { GIFEncoder, quantize, applyPalette } = gifenc;

interface Particle {
  x: number;
  y: number;
  laps: number;
  sway: number;
  swayPhase: number;
  spin: number;
  angle: number;
  w: number;
  h: number;
  color: string;
}

function makeConfetti(w: number, h: number, count: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: randomInt(w),
    y: randomInt(h + 40),
    laps: 1 + randomInt(2), // whole laps per loop keeps the animation seamless
    sway: 6 + randomInt(14),
    swayPhase: Math.random() * Math.PI * 2,
    spin: 1 + randomInt(2),
    angle: Math.random() * Math.PI * 2,
    w: 7 + randomInt(6),
    h: 4 + randomInt(4),
    color: THEME.confetti[randomInt(THEME.confetti.length)]!,
  }));
}

function drawConfetti(ctx: Ctx, parts: Particle[], t: number, w: number, h: number): void {
  const span = h + 40;
  for (const p of parts) {
    const y = ((p.y + p.laps * span * t) % span) - 20;
    const x = p.x + Math.sin(p.swayPhase + t * Math.PI * 2) * p.sway;
    const a = p.angle + t * Math.PI * 2 * p.spin;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(1, Math.abs(Math.cos(a * 1.5)) * 0.8 + 0.2); // flutter
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

/**
 * Renders a looping celebration GIF: `scene(ctx, t)` draws the base image for
 * loop phase t ∈ [0, 1), and confetti falls over it.
 */
export function celebrationGif(scene: (ctx: Ctx, t: number) => void, w: number, h: number, frames = 24, delayMs = 60): Buffer {
  const { ctx } = newCanvas(w, h);
  const confetti = makeConfetti(w, h, Math.round((w * h) / 4500));
  const rendered: Uint8ClampedArray[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    ctx.clearRect(0, 0, w, h);
    scene(ctx, t);
    drawConfetti(ctx, confetti, t, w, h);
    rendered.push(ctx.getImageData(0, 0, w, h).data);
  }

  // One shared palette for all frames avoids colour flicker between frames.
  const sample = new Uint8ClampedArray(w * h * 4 * 3);
  [0, Math.floor(frames / 3), Math.floor((2 * frames) / 3)].forEach((f, i) => sample.set(rendered[f]!, i * w * h * 4));
  const palette = quantize(sample, 256, { format: 'rgba4444', oneBitAlpha: true });
  const transparentIndex = palette.findIndex((c) => c[3] === 0);

  const gif = GIFEncoder();
  for (const data of rendered) {
    const index = applyPalette(data, palette, 'rgba4444');
    gif.writeFrame(index, w, h, {
      palette,
      delay: delayMs,
      repeat: 0,
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}
