/**
 * Perp Arena simulation: a synthetic price path with scripted market regimes
 * and news, and isolated-margin perpetual accounts. Pure and deterministic
 * given an RNG, so it is unit-tested without timers.
 */
import {
  equityOf,
  liquidationPrice,
  MARKET,
  positionPnl,
  type Account,
  type Position,
  type Scenario,
  type Side,
  type Vault,
} from '../../shared/market.js';
import { filler, KEY_EVENTS, NOISE, STORIES, type Headline } from './market-news.js';

export type Rng = () => number;

function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Small fast seeded PRNG (mulberry32). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

import type { Tone } from './market-news.js';
export type { Tone };

export interface NewsEvent {
  at: number;
  text: string;
  tone: Tone;
  /** Total log-return spread over `over` ticks. */
  move: number;
  over: number;
  /** Extra volatility afterwards, decaying. */
  vol: number;
  /** Shift in funding pressure (positive: longs crowded), fading over time. */
  funding: number;
}

interface Segment {
  /** Fraction of the game this regime lasts until. */
  until: number;
  mu: number;
  sigma: number;
}

export interface MarketPlan {
  scenario: Exclude<Scenario, 'mystery'>;
  segments: Segment[];
  events: NewsEvent[];
  meanRevert: boolean;
  /** Funding pressure from "the rest of the market", per 8h settlement. */
  crowdBias: number;
  /** Tick at which the farm vault gets exploited, if it does. */
  exploitAt: number | null;
}

export const REAL_SCENARIOS = ['bull', 'bear', 'chop', 'squeeze', 'crash'] as const;

/** Build the script for one game: regimes, scheduled news and whether the farm gets exploited. */
export function makePlan(scenario: Exclude<Scenario, 'mystery'>, totalTicks: number, rng: Rng): MarketPlan {
  const at = (frac: number) => Math.max(1, Math.min(totalTicks - 2, Math.round(frac * totalTicks)));
  const between = ([lo, hi]: [number, number]) => lo + rng() * (hi - lo);
  const events: NewsEvent[] = [];
  const add = (frac: number, h: Headline, flip = false, fill = filler(rng)) =>
    events.push({ at: at(frac), text: fill(h.text), tone: h.tone, move: between(h.move) * (flip ? -1 : 1), over: h.over ?? 3, vol: h.vol ?? 0.002, funding: h.funding ?? 0 });
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  let segments: Segment[];
  let meanRevert = false;
  let crowdBias = 0.00005;
  switch (scenario) {
    case 'bull':
      segments = [
        { until: 0.3, mu: 0.0008, sigma: 0.006 },
        { until: 0.45, mu: -0.0006, sigma: 0.008 },
        { until: 1, mu: 0.001, sigma: 0.007 },
      ];
      crowdBias = 0.0002;
      break;
    case 'bear':
      segments = [
        { until: 0.25, mu: -0.0004, sigma: 0.006 },
        { until: 0.55, mu: -0.001, sigma: 0.008 },
        { until: 0.7, mu: 0.0008, sigma: 0.007 },
        { until: 1, mu: -0.0008, sigma: 0.007 },
      ];
      crowdBias = -0.00008;
      break;
    case 'chop':
      segments = [{ until: 1, mu: 0, sigma: 0.005 }];
      meanRevert = true;
      crowdBias = 0.0001;
      break;
    case 'squeeze':
      segments = [
        { until: 0.6, mu: -0.0006, sigma: 0.005 },
        { until: 0.75, mu: 0.0012, sigma: 0.01 },
        { until: 1, mu: -0.0003, sigma: 0.008 },
      ];
      crowdBias = -0.0003;
      break;
    case 'crash':
      segments = [
        { until: 0.62, mu: 0.0005, sigma: 0.004 },
        { until: 0.8, mu: -0.0008, sigma: 0.012 },
        { until: 1, mu: 0.0004, sigma: 0.009 },
      ];
      crowdBias = 0.0003;
      break;
  }
  // The scenario's big moments, each told one of several ways.
  for (const k of KEY_EVENTS[scenario]) add(k.at + (rng() - 0.5) * 0.08, pick(k.variants));

  // Everyday headlines and two-part stories, spread through the game. Longer games get more.
  const slots = Math.max(3, Math.round(totalTicks / 110));
  const noise = shuffled(NOISE, rng);
  const stories = shuffled(STORIES, rng);
  const keyAts = events.map((e) => e.at / totalTicks);
  for (let i = 0; i < slots; i++) {
    let frac = 0.06 + ((i + 0.2 + rng() * 0.6) / slots) * 0.86;
    // Keep clear of the big moments so headlines don't trample each other.
    if (keyAts.some((k) => Math.abs(k - frac) < 0.035)) frac += 0.05;
    const story = rng() < 0.35 ? stories.pop() : undefined;
    if (story) {
      // Both parts of a story talk about the same exchange, fund or bridge.
      const fill = filler(rng);
      add(frac, story.first, false, fill);
      const r = rng();
      let acc = 0;
      const next = story.then?.find((o) => (acc += o.p) >= r) ?? story.then?.at(-1);
      if (next) add(frac + 0.04 + rng() * 0.05, next.h, false, fill);
    } else {
      const h = noise.pop();
      // Not every headline moves the price the way it sounds.
      if (h) add(frac, h, rng() < (h.fakeout ?? 0.2));
    }
  }
  events.sort((a, b) => a.at - b.at);
  const exploitAt = rng() < 0.4 ? at(0.3 + rng() * 0.55) : null;
  return { scenario, segments, events, meanRevert, crowdBias, exploitAt };
}

/** Steps the price forward one tick at a time. */
export class PriceModel {
  price: number;
  tick = 0;
  private impulses: { per: number; left: number }[] = [];
  private volBoost = 0;
  /** Scale drift and volatility so short and long games feel similar overall. */
  private readonly k: number;

  constructor(
    private readonly plan: MarketPlan,
    private readonly totalTicks: number,
    private readonly rng: Rng,
    readonly start: number = MARKET.startPrice,
  ) {
    this.price = start;
    this.k = 600 / totalTicks;
  }

  step(): { price: number; news: NewsEvent[] } {
    this.tick++;
    const frac = this.tick / this.totalTicks;
    const seg = this.plan.segments.find((s) => frac < s.until) ?? this.plan.segments[this.plan.segments.length - 1]!;
    let r = seg.mu * this.k + (seg.sigma + this.volBoost) * Math.sqrt(this.k) * gauss(this.rng);
    if (this.plan.meanRevert) r -= 0.03 * Math.log(this.price / this.start);
    const news = this.plan.events.filter((e) => e.at === this.tick);
    for (const e of news) {
      this.impulses.push({ per: e.move / e.over, left: e.over });
      this.volBoost = Math.max(this.volBoost, e.vol);
    }
    for (const imp of this.impulses) {
      r += imp.per;
      imp.left--;
    }
    this.impulses = this.impulses.filter((i) => i.left > 0);
    this.volBoost *= 0.96;
    this.price = Math.max(0.5, this.price * Math.exp(r));
    return { price: this.price, news };
  }
}

// ── Accounts ───────────────────────────────────────────────────────────────

export function newAccount(): Account {
  return {
    cash: MARKET.startCash,
    position: null,
    lend: 0,
    farm: 0,
    stats: { trades: 0, wins: 0, liquidations: 0, fees: 0, funding: 0, farmLost: 0, vaultEarned: 0, peak: MARKET.startCash, maxDrawdown: 0, maxLeverage: 0, stopsHit: 0 },
  };
}

export interface OpenRequest {
  side: Side;
  /** Percent of free cash to use as margin (fee included). */
  size: number;
  leverage: number;
  /** Stop-loss distance in percent of entry (0 = none). */
  stop: number;
  take: number;
}

/** Returns an error message, or null when the position was opened. */
export function openPosition(a: Account, price: number, req: OpenRequest, maxLeverage: number): string | null {
  if (a.position) return 'Close your current position first.';
  if (req.side !== 'long' && req.side !== 'short') return 'Pick long or short.';
  if (!(MARKET.leverages as readonly number[]).includes(req.leverage) || req.leverage > maxLeverage) return `Leverage is capped at ${maxLeverage}x.`;
  if (!(MARKET.sizes as readonly number[]).includes(req.size)) return 'Pick a size.';
  if (!(MARKET.stops as readonly number[]).includes(req.stop) || !(MARKET.takes as readonly number[]).includes(req.take)) return 'Pick a stop and target.';
  const budget = (a.cash * req.size) / 100;
  // Margin plus the opening fee use up the budget exactly.
  const margin = budget / (1 + req.leverage * MARKET.takerFee);
  if (margin < MARKET.minMargin) return 'Not enough free cash.';
  const notional = margin * req.leverage;
  const fee = notional * MARKET.takerFee;
  const dir = req.side === 'long' ? 1 : -1;
  const base = { side: req.side, leverage: req.leverage, margin, entry: price, qty: notional / price, funding: 0 };
  const position: Position = {
    ...base,
    liq: liquidationPrice(base),
    stop: req.stop ? price * (1 - (dir * req.stop) / 100) : null,
    take: req.take ? price * (1 + (dir * req.take) / 100) : null,
  };
  a.cash -= margin + fee;
  a.position = position;
  a.stats.fees += fee;
  a.stats.maxLeverage = Math.max(a.stats.maxLeverage, req.leverage);
  return null;
}

/** Closes at `price`; returns the realized result after all fees and funding. */
export function closePosition(a: Account, price: number): number {
  const p = a.position;
  if (!p) return 0;
  const pnl = positionPnl(p, price);
  const fee = p.qty * price * MARKET.takerFee;
  const openFee = p.qty * p.entry * MARKET.takerFee;
  a.cash += Math.max(0, p.margin + pnl - p.funding - fee);
  a.stats.fees += fee;
  a.stats.trades++;
  const net = pnl - p.funding - fee - openFee;
  if (net > 0) a.stats.wins++;
  a.position = null;
  return net;
}

export type Trigger = { kind: 'liquidated'; loss: number } | { kind: 'stop' | 'take'; net: number };

/** Liquidation first (isolated margin: you lose the margin, nothing more), then stop/take-profit. */
export function checkTriggers(a: Account, price: number): Trigger | null {
  const p = a.position;
  if (!p) return null;
  const long = p.side === 'long';
  if (long ? price <= p.liq : price >= p.liq) {
    const loss = p.margin + p.qty * p.entry * MARKET.takerFee;
    a.stats.liquidations++;
    a.stats.trades++;
    a.position = null;
    return { kind: 'liquidated', loss };
  }
  if (p.stop !== null && (long ? price <= p.stop : price >= p.stop)) {
    a.stats.stopsHit++;
    return { kind: 'stop', net: closePosition(a, price) };
  }
  if (p.take !== null && (long ? price >= p.take : price <= p.take)) {
    return { kind: 'take', net: closePosition(a, price) };
  }
  return null;
}

/** Funding rate for the next settlement: crowd bias plus how lopsided the players are. */
export function fundingRate(accounts: Account[], price: number, crowdBias: number): number {
  let longs = 0;
  let shorts = 0;
  for (const a of accounts) {
    if (!a.position) continue;
    const n = a.position.qty * price;
    if (a.position.side === 'long') longs += n;
    else shorts += n;
  }
  // Players trade alongside a simulated market, so one trader alone can't swing funding much,
  // but a whole room piling onto one side will.
  const skew = (longs - shorts) / (longs + shorts + MARKET.startCash * 10);
  return Math.max(-MARKET.maxFundingRate, Math.min(MARKET.maxFundingRate, crowdBias + 0.0008 * skew));
}

/** Positive rate: longs pay shorts. Updates the liquidation price, since funding eats margin. */
export function settleFunding(a: Account, price: number, rate: number): number {
  const p = a.position;
  if (!p) return 0;
  const paid = p.qty * price * rate * (p.side === 'long' ? 1 : -1);
  p.funding += paid;
  a.stats.funding += paid;
  p.liq = liquidationPrice(p);
  return paid;
}

export function accrueVaults(a: Account): void {
  const perTick = MARKET.hoursPerTick / 8760;
  const lend = a.lend * MARKET.lendApr * perTick;
  const farm = a.farm * MARKET.farmApr * perTick;
  a.lend += lend;
  a.farm += farm;
  a.stats.vaultEarned += lend + farm;
}

export function exploitFarm(a: Account): number {
  const lost = a.farm * MARKET.exploitLoss;
  a.farm -= lost;
  a.stats.farmLost += lost;
  return lost;
}

export function deposit(a: Account, vault: Vault, size: number, farmExploited: boolean): string | null {
  if (vault !== 'lend' && vault !== 'farm') return 'Unknown vault.';
  if (vault === 'farm' && farmExploited) return 'The farm was exploited. Deposits are closed.';
  if (!(MARKET.sizes as readonly number[]).includes(size)) return 'Pick an amount.';
  const amount = (a.cash * size) / 100;
  if (amount < 1) return 'Not enough free cash.';
  a.cash -= amount;
  a[vault] += amount;
  return null;
}

export function withdraw(a: Account, vault: Vault): number {
  if (vault !== 'lend' && vault !== 'farm') return 0;
  const amount = a[vault];
  a.cash += amount;
  a[vault] = 0;
  return amount;
}

export function trackDrawdown(a: Account, price: number): number {
  const eq = equityOf(a, price);
  a.stats.peak = Math.max(a.stats.peak, eq);
  a.stats.maxDrawdown = Math.max(a.stats.maxDrawdown, (a.stats.peak - eq) / a.stats.peak);
  return eq;
}
