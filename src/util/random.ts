import { randomInt } from 'node:crypto';

/** Uniform random integer in [min, max] (inclusive). */
export function rand(min: number, max: number): number {
  return randomInt(min, max + 1);
}

export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() on empty array');
  return items[randomInt(items.length)]!;
}

/** Fisher–Yates shuffle, returns a new array. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Sleep that resolves early (without throwing) if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
