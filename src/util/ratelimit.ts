/** Token bucket: `capacity` burst, refilled at `perSecond` tokens/second. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity;
  }

  take(cost = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Per-key cooldown with automatic cleanup of stale keys. */
export class Cooldown {
  private readonly until = new Map<string, number>();

  constructor(private readonly ms: number) {
    setInterval(() => {
      const now = Date.now();
      for (const [k, t] of this.until) if (t <= now) this.until.delete(k);
    }, 60_000).unref();
  }

  /** Returns remaining ms if on cooldown, otherwise 0 and starts a new cooldown. */
  hit(key: string): number {
    const now = Date.now();
    const t = this.until.get(key) ?? 0;
    if (t > now) return t - now;
    this.until.set(key, now + this.ms);
    return 0;
  }
}
