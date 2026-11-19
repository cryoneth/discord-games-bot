import {
  DEFAULT_MARKET_SETTINGS,
  equityOf,
  MARKET,
  validMarketSettings,
  type Account,
  type BoardEntry,
  type MarketPhase,
  type MarketResult,
  type MarketServerMessage,
  type MarketSettings,
  type MarketStateMessage,
  type Scenario,
  type TickMessage,
  type Vault,
} from '../../shared/market.js';
import { BaseRoom, type Conn, type RoomContext, type Seat } from '../base.js';
import {
  accrueVaults,
  checkTriggers,
  closePosition,
  deposit,
  exploitFarm,
  fundingRate,
  makePlan,
  newAccount,
  openPosition,
  PriceModel,
  REAL_SCENARIOS,
  settleFunding,
  trackDrawdown,
  withdraw,
  type MarketPlan,
  type Rng,
} from './market-engine.js';

interface MarketSeat extends Seat {
  account: Account;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;

/**
 * Everyone trades the same fictional market in real time with play money.
 * The price follows a scripted regime with news, funding settles every 8
 * simulated hours, and the end screen explains what went right or wrong.
 */
export class MarketRoom extends BaseRoom<MarketSeat> {
  protected readonly minPlayers = 1;
  protected readonly maxPlayers = 16;
  private phase: MarketPhase = 'lobby';
  private settings: MarketSettings = { ...DEFAULT_MARKET_SETTINGS };
  private plan: MarketPlan | null = null;
  private model: PriceModel | null = null;
  private prices: number[] = [];
  private totalTicks = 0;
  private rate = 0;
  /** Extra funding pressure from recent headlines, fading back to the plan's bias. */
  private newsBias = 0;
  private farmExploited = false;
  private endsAt: number | null = null;
  private results: MarketResult[] | null = null;
  private ticker: NodeJS.Timeout | null = null;

  constructor(
    ctx: RoomContext,
    private readonly tickMs: number = MARKET.tickMs,
    private readonly rng: Rng = Math.random,
  ) {
    super(ctx);
  }

  get idle(): boolean {
    return this.phase === 'lobby' || this.phase === 'finished';
  }

  get currentPhase(): MarketPhase {
    return this.phase;
  }

  get price(): number {
    return this.model?.price ?? MARKET.startPrice;
  }

  accountOf(id: string): Account | undefined {
    return this.players.get(id)?.account;
  }

  protected createSeat(user: { id: string; name: string }): MarketSeat {
    return { ...user, score: MARKET.startCash, account: newAccount(), conns: new Set() };
  }

  protected override applySettings(raw: unknown): boolean {
    if (!validMarketSettings(raw)) return false;
    this.settings = { minutes: raw.minutes, scenario: raw.scenario, maxLeverage: raw.maxLeverage };
    return true;
  }

  protected begin(): void {
    const scenario: Exclude<Scenario, 'mystery'> =
      this.settings.scenario === 'mystery' ? REAL_SCENARIOS[Math.floor(this.rng() * REAL_SCENARIOS.length)]! : this.settings.scenario;
    this.totalTicks = Math.round((this.settings.minutes * 60_000) / MARKET.tickMs);
    this.plan = makePlan(scenario, this.totalTicks, this.rng);
    this.model = new PriceModel(this.plan, this.totalTicks, this.rng);
    this.prices = [this.model.price];
    this.farmExploited = false;
    this.results = null;
    this.rate = this.plan.crowdBias;
    this.newsBias = 0;
    for (const s of this.players.values()) {
      s.account = newAccount();
      s.score = MARKET.startCash;
    }
    this.phase = 'running';
    this.endsAt = Date.now() + this.totalTicks * this.tickMs;
    this.system(`📈 Market open! Everyone starts with ${money(MARKET.startCash)} of play money. Highest balance at the close wins.`);
    this.system('⚠️ Just a simulation: a made-up token, play money and invented news. Real markets with real money are different and far riskier. Not financial advice.');
    this.broadcast({ t: 'history', prices: this.prices } satisfies MarketServerMessage);
    this.stopTicker();
    this.ticker = setInterval(() => this.step(), this.tickMs);
  }

  protected abort(): void {
    this.stopTicker();
    this.phase = 'lobby';
    this.endsAt = null;
  }

  protected onDeparture(): void {
    // Positions keep running while you're away, just like a real market.
  }

  override dispose(): void {
    this.stopTicker();
    super.dispose();
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  protected override onConnect(seat: MarketSeat, conn: Conn): void {
    if (this.phase !== 'running') return;
    conn.send({ t: 'history', prices: this.prices } satisfies MarketServerMessage);
    conn.send(this.tickFor(seat, this.board()));
  }

  protected onMessage(seat: MarketSeat, msg: { t: string } & Record<string, unknown>): void {
    if (this.phase !== 'running') return;
    const a = seat.account;
    const price = this.price;
    switch (msg.t) {
      case 'open': {
        const err = openPosition(
          a,
          price,
          { side: msg.side as 'long' | 'short', size: msg.size as number, leverage: msg.leverage as number, stop: msg.stop as number, take: msg.take as number },
          this.settings.maxLeverage,
        );
        if (err) return this.direct(seat.id, err);
        const p = a.position!;
        this.direct(seat.id, `Opened ${p.leverage}x ${p.side} at ${p.entry.toFixed(2)}. Liquidation at ${p.liq.toFixed(2)}.`);
        break;
      }
      case 'close': {
        if (!a.position) return;
        const net = closePosition(a, price);
        this.direct(seat.id, `Closed at ${price.toFixed(2)}: ${signed(net)} after fees and funding.`);
        break;
      }
      case 'deposit': {
        const err = deposit(a, msg.vault as Vault, msg.size as number, this.farmExploited);
        if (err) return this.direct(seat.id, err);
        break;
      }
      case 'withdraw':
        withdraw(a, msg.vault as Vault);
        break;
      default:
        return;
    }
    this.sendTo(seat.id, this.tickFor(seat, this.board()));
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  private step(): void {
    if (this.phase !== 'running' || !this.model || !this.plan) return;
    const { price, news } = this.model.step();
    const tick = this.model.tick;
    this.prices.push(price);
    for (const n of news) {
      this.newsBias += n.funding;
      this.broadcast({ t: 'news', i: tick, text: n.text, tone: n.tone } satisfies MarketServerMessage);
    }
    this.newsBias *= 0.97;

    if (tick === this.plan.exploitAt) {
      this.farmExploited = true;
      this.broadcast({ t: 'news', i: tick, text: `🚨 ZetaFarm exploited! ${Math.round(MARKET.exploitLoss * 100)}% of the vault was drained.`, tone: 'bad' } satisfies MarketServerMessage);
      for (const s of this.players.values()) {
        const lost = exploitFarm(s.account);
        if (lost > 0) this.direct(s.id, `You lost ${money(lost)} in the farm exploit.`);
      }
    }

    const settle = tick % MARKET.fundingEveryTicks === 0;
    for (const s of this.players.values()) {
      const a = s.account;
      const trig = checkTriggers(a, price);
      if (trig?.kind === 'liquidated') this.direct(s.id, `💀 Liquidated at ${price.toFixed(2)}. Your ${money(trig.loss)} margin is gone.`);
      else if (trig?.kind === 'stop') this.direct(s.id, `🛑 Stop-loss hit at ${price.toFixed(2)}: ${signed(trig.net)}.`);
      else if (trig?.kind === 'take') this.direct(s.id, `🎯 Take-profit hit at ${price.toFixed(2)}: ${signed(trig.net)}.`);
      if (settle) settleFunding(a, price, this.rate);
      accrueVaults(a);
      s.score = Math.round(trackDrawdown(a, price));
    }
    this.rate = fundingRate(
      [...this.players.values()].map((s) => s.account),
      price,
      this.plan.crowdBias + this.newsBias,
    );

    const board = this.board();
    for (const s of this.players.values()) {
      if (s.conns.size === 0) continue;
      const msg = this.tickFor(s, board);
      for (const c of s.conns) c.send(msg);
    }
    if (tick >= this.totalTicks) this.finish();
  }

  private board(): BoardEntry[] {
    const price = this.price;
    return [...this.players.values()]
      .map((s) => ({
        id: s.id,
        name: s.name,
        equity: Math.round(equityOf(s.account, price)),
        side: s.account.position?.side ?? null,
        leverage: s.account.position?.leverage ?? null,
        connected: s.conns.size > 0,
      }))
      .sort((a, b) => b.equity - a.equity);
  }

  private tickFor(seat: MarketSeat, board: BoardEntry[]): TickMessage {
    return {
      t: 'tick',
      i: this.model?.tick ?? 0,
      price: this.price,
      fundingRate: this.rate,
      account: seat.account,
      equity: equityOf(seat.account, this.price),
      board,
      farmExploited: this.farmExploited,
    };
  }

  private finish(): void {
    this.stopTicker();
    const price = this.price;
    for (const s of this.players.values()) {
      closePosition(s.account, price);
      withdraw(s.account, 'lend');
      withdraw(s.account, 'farm');
      s.score = Math.round(trackDrawdown(s.account, price));
    }
    const ranking = [...this.players.values()].sort((a, b) => b.account.cash - a.account.cash);
    this.results = ranking.map((s) => ({ id: s.id, name: s.name, equity: s.account.cash, stats: s.account.stats }));
    this.phase = 'finished';
    this.endsAt = null;
    const top = ranking[0];
    this.system(
      top && top.account.cash > MARKET.startCash
        ? `🔔 Market closed. ${top.name} finishes on top with ${money(top.account.cash)}!`
        : '🔔 Market closed. Nobody beat the starting balance this time!',
    );
    this.broadcastState();
    const best = top?.account.cash ?? 0;
    this.reportResults(
      ranking,
      (s) => s.account.cash === best && best > MARKET.startCash,
      (s) => (s.account.cash - MARKET.startCash) / 10,
    );
  }

  protected stateFor(): MarketStateMessage {
    return {
      t: 'state',
      now: Date.now(),
      phase: this.phase,
      players: this.seatViews(),
      settings: this.settings,
      endsAt: this.endsAt,
      totalTicks: this.totalTicks,
      scenario: this.phase === 'finished' ? (this.plan?.scenario ?? null) : this.settings.scenario === 'mystery' ? null : this.settings.scenario,
      results: this.phase === 'finished' ? this.results : null,
    };
  }
}
