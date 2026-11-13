/**
 * Perp Arena messages and constants. Play money only: a fictional asset with
 * a synthetic price, so nothing here is market data or advice.
 * Shared by browser and server.
 */

export type Scenario = 'mystery' | 'bull' | 'bear' | 'chop' | 'squeeze' | 'crash';
export type Side = 'long' | 'short';
export type Vault = 'lend' | 'farm';

export const SCENARIO_LABELS: Record<Scenario, string> = {
  mystery: '🎲 Mystery',
  bull: '🐂 Bull run',
  bear: '🐻 Bear market',
  chop: '🦀 Sideways chop',
  squeeze: '🧨 Short squeeze',
  crash: '💥 Flash crash',
};

export interface MarketSettings {
  minutes: number;
  scenario: Scenario;
  maxLeverage: number;
}

export const MARKET_OPTIONS = {
  minutes: [3, 5, 10],
  scenario: ['mystery', 'bull', 'bear', 'chop', 'squeeze', 'crash'],
  maxLeverage: [10, 25, 50],
} as const;

export const DEFAULT_MARKET_SETTINGS: MarketSettings = { minutes: 5, scenario: 'mystery', maxLeverage: 25 };

export const MARKET = {
  asset: 'ZETA',
  startPrice: 100,
  startCash: 10_000,
  tickMs: 500,
  /** Simulated hours per tick: a 5 minute game covers 25 days. */
  hoursPerTick: 1,
  takerFee: 0.0005,
  /** Maintenance margin as a share of position size. */
  maintenance: 0.005,
  /** Funding settles every 8 simulated hours. */
  fundingEveryTicks: 8,
  /** Funding is exaggerated so it matters inside a short game. */
  maxFundingRate: 0.001,
  lendApr: 0.12,
  farmApr: 3,
  /** Share of a farm deposit lost if the farm gets exploited. */
  exploitLoss: 0.7,
  minMargin: 10,
  leverages: [1, 2, 3, 5, 10, 25, 50],
  sizes: [10, 25, 50, 100],
  stops: [0, 2, 5, 10],
  takes: [0, 5, 10, 25],
} as const;

export function validMarketSettings(x: unknown): x is MarketSettings {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return (
    (MARKET_OPTIONS.minutes as readonly unknown[]).includes(s.minutes) &&
    (MARKET_OPTIONS.scenario as readonly unknown[]).includes(s.scenario) &&
    (MARKET_OPTIONS.maxLeverage as readonly unknown[]).includes(s.maxLeverage)
  );
}

export interface Position {
  side: Side;
  leverage: number;
  margin: number;
  entry: number;
  /** Units of the asset. */
  qty: number;
  liq: number;
  stop: number | null;
  take: number | null;
  /** Net funding paid on this position (negative = received). */
  funding: number;
}

export interface Stats {
  trades: number;
  wins: number;
  liquidations: number;
  fees: number;
  /** Net funding paid (negative = received). */
  funding: number;
  farmLost: number;
  vaultEarned: number;
  peak: number;
  maxDrawdown: number;
  maxLeverage: number;
  stopsHit: number;
}

export interface Account {
  cash: number;
  position: Position | null;
  lend: number;
  farm: number;
  stats: Stats;
}

export interface BoardEntry {
  id: string;
  name: string;
  equity: number;
  side: Side | null;
  leverage: number | null;
  connected: boolean;
}

export type MarketPhase = 'lobby' | 'running' | 'finished';

export interface MarketResult {
  id: string;
  name: string;
  equity: number;
  stats: Stats;
}

export type MarketClientMessage =
  | { t: 'start' }
  | { t: 'settings'; settings: MarketSettings }
  | { t: 'open'; side: Side; size: number; leverage: number; stop: number; take: number }
  | { t: 'close' }
  | { t: 'deposit'; vault: Vault; size: number }
  | { t: 'withdraw'; vault: Vault }
  | { t: 'chat'; text: string };

export interface MarketStateMessage {
  t: 'state';
  now: number;
  phase: MarketPhase;
  players: { id: string; name: string; score: number; connected: boolean; host: boolean }[];
  settings: MarketSettings;
  endsAt: number | null;
  totalTicks: number;
  /** Revealed at the end when the scenario was a mystery. */
  scenario: Scenario | null;
  results: MarketResult[] | null;
}

export interface TickMessage {
  t: 'tick';
  i: number;
  price: number;
  /** Funding rate for the next settlement (positive: longs pay shorts). */
  fundingRate: number;
  account: Account;
  equity: number;
  board: BoardEntry[];
  farmExploited: boolean;
}

export type MarketServerMessage =
  | MarketStateMessage
  | TickMessage
  | { t: 'history'; prices: number[] }
  | { t: 'news'; i: number; text: string; tone: 'good' | 'bad' | 'neutral' }
  | { t: 'chat'; kind: 'guess' | 'system' | 'correct' | 'close' | 'private'; name?: string; text: string };

export function positionPnl(p: Position, price: number): number {
  return p.qty * (price - p.entry) * (p.side === 'long' ? 1 : -1);
}

export function positionEquity(p: Position, price: number): number {
  return p.margin + positionPnl(p, price) - p.funding;
}

export function equityOf(a: Account, price: number): number {
  return a.cash + a.lend + a.farm + (a.position ? Math.max(0, positionEquity(a.position, price)) : 0);
}

/** Price at which the position's equity falls to the maintenance margin. */
export function liquidationPrice(p: Pick<Position, 'side' | 'entry' | 'qty' | 'margin' | 'funding'>): number {
  const dir = p.side === 'long' ? 1 : -1;
  const mm = MARKET.maintenance * p.qty * p.entry;
  return Math.max(0, p.entry - (dir * (p.margin - p.funding - mm)) / p.qty);
}

/** Simulated clock label for a tick, e.g. "Day 3 · 14:00". */
export function simClock(tick: number): string {
  const hours = tick * MARKET.hoursPerTick;
  return `Day ${Math.floor(hours / 24) + 1} · ${String(hours % 24).padStart(2, '0')}:00`;
}
