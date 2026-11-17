import {
  DEFAULT_MASS_SETTINGS,
  MIN_REACTION_MS,
  validMassSettings,
  type MassPhase,
  type MassRoundResult,
  type MassServerMessage,
  type MassSettings,
  type MassStateMessage,
  type TapStatus,
} from '../../shared/massreaction.js';
import { rand } from '../../util/random.js';
import { BaseRoom, type RoomContext, type Seat } from '../base.js';

interface MassSeat extends Seat {
  alive: boolean;
  outRound: number | null;
  best: number | null;
}

export interface MassTiming {
  readyMs: number;
  waitMinMs: number;
  waitMaxMs: number;
  /** How long the green screen stays tappable. */
  windowMs: number;
  resultMs: number;
}

const DEFAULT_TIMING: MassTiming = { readyMs: 3000, waitMinMs: 1500, waitMaxMs: 5000, windowMs: 2500, resultMs: 4500 };
const MAX_ROUNDS = 50;
/** Most network round-trip a player's own timing may subtract from what the server saw. */
export const MAX_LAG_CREDIT_MS = 300;
const POINTS = { survive: 10, fastest: 5, win: 100 } as const;

export interface Tap {
  ms: number | null;
  early: boolean;
}

/**
 * Decides one round. False starts and no-shows are out, then the slowest
 * `cutPct`% of the valid taps (at least one, but never everyone). If nobody
 * tapped validly, nobody is out and the round is replayed.
 */
export function cutRound(alive: readonly string[], taps: ReadonlyMap<string, Tap>, cutPct: number, round = 0): MassRoundResult & { survivors: string[] } {
  const msOf = (id: string) => {
    const t = taps.get(id);
    return t && !t.early ? t.ms : null;
  };
  const valid = alive.filter((id) => msOf(id) !== null).sort((a, b) => msOf(a)! - msOf(b)!);
  const status = new Map<string, TapStatus>();
  for (const id of alive) {
    const t = taps.get(id);
    status.set(id, !t ? 'missed' : t.early ? 'early' : 'safe');
  }
  const replay = valid.length === 0;
  let survivors: string[];
  if (replay) {
    survivors = [...alive];
  } else {
    const cut = Math.min(valid.length - 1, Math.max(1, Math.round((valid.length * cutPct) / 100)));
    survivors = valid.slice(0, valid.length - cut);
    for (const id of valid.slice(valid.length - cut)) status.set(id, 'slow');
  }
  const entries = alive
    .map((id) => ({ id, ms: msOf(id), status: status.get(id)! }))
    .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
  return { round, entries, fastestId: valid[0] ?? null, replay, survivors };
}

/**
 * Everyone in the call stares at a red screen. When it turns green, tap.
 * Tapping early or not at all knocks you out, and so does being among the
 * slowest each round, until one player is left. Built for big groups: taps
 * never trigger a broadcast, and green is announced with a tiny message.
 */
export class MassReactionRoom extends BaseRoom<MassSeat> {
  protected readonly minPlayers = 2;
  protected readonly maxPlayers = 100;
  private phase: MassPhase = 'lobby';
  private settings: MassSettings = { ...DEFAULT_MASS_SETTINGS };
  private round = 0;
  private endsAt: number | null = null;
  private goAt = 0;
  private taps = new Map<string, Tap>();
  private last: MassRoundResult | null = null;

  constructor(
    ctx: RoomContext,
    private readonly timing: MassTiming = DEFAULT_TIMING,
  ) {
    super(ctx);
  }

  get idle(): boolean {
    return this.phase === 'lobby' || this.phase === 'finished';
  }

  get currentPhase(): MassPhase {
    return this.phase;
  }

  protected createSeat(user: { id: string; name: string }): MassSeat {
    return { ...user, score: 0, alive: false, outRound: null, best: null, conns: new Set() };
  }

  protected override applySettings(raw: unknown): boolean {
    if (!validMassSettings(raw)) return false;
    this.settings = { cut: raw.cut };
    return true;
  }

  private aliveSeats(): MassSeat[] {
    return [...this.players.values()].filter((s) => s.alive);
  }

  protected begin(): void {
    this.round = 0;
    this.last = null;
    for (const s of this.players.values()) {
      s.alive = s.conns.size > 0;
      s.outRound = null;
      s.best = null;
    }
    this.system(`⚡ ${this.aliveSeats().length} players. Tap when it turns green. Too early, too late or too slow and you're out!`);
    this.nextRound();
  }

  protected abort(): void {
    this.phase = 'lobby';
    this.endsAt = null;
    this.taps.clear();
    this.last = null;
    for (const s of this.players.values()) s.alive = false;
  }

  protected onDeparture(seat: MassSeat): void {
    if (!seat.alive) return;
    seat.alive = false;
    seat.outRound = this.round;
    if (this.aliveSeats().length <= 1) {
      this.clearTimers();
      this.finish();
    } else if (this.phase === 'go') {
      this.maybeResolve();
    }
  }

  protected onMessage(seat: MassSeat, msg: { t: string } & Record<string, unknown>): void {
    if (msg.t !== 'tap' || !seat.alive || this.taps.has(seat.id)) return;
    if (this.phase === 'wait') {
      this.taps.set(seat.id, { ms: null, early: true });
      return;
    }
    if (this.phase !== 'go') return;
    const elapsed = Date.now() - this.goAt;
    // Measured on the player's screen so network lag doesn't count. It can't exceed the server's clock,
    // and it can claim at most MAX_LAG_CREDIT_MS of lag, so a tampered client can't fake a huge lead.
    const reported = typeof msg.ms === 'number' && Number.isFinite(msg.ms) && msg.ms >= 0 ? Math.round(msg.ms) : elapsed;
    const ms = Math.max(Math.min(reported, elapsed), elapsed - MAX_LAG_CREDIT_MS);
    const early = msg.early === true || ms < MIN_REACTION_MS;
    this.taps.set(seat.id, { ms: early ? null : ms, early });
    this.maybeResolve();
  }

  // ── Flow ─────────────────────────────────────────────────────────────────

  private nextRound(): void {
    if (this.aliveSeats().length <= 1 || this.round >= MAX_ROUNDS) return this.finish();
    this.round++;
    this.taps.clear();
    this.phase = 'ready';
    this.endsAt = Date.now() + this.timing.readyMs;
    this.broadcastState();
    this.later(this.timing.readyMs, () => {
      this.phase = 'wait';
      this.endsAt = null;
      this.broadcastState();
      this.later(rand(this.timing.waitMinMs, this.timing.waitMaxMs), () => this.go());
    });
  }

  private go(): void {
    if (this.phase !== 'wait') return;
    this.phase = 'go';
    this.goAt = Date.now();
    this.broadcast({ t: 'go', round: this.round } satisfies MassServerMessage);
    this.later(this.timing.windowMs, () => this.resolve());
    this.maybeResolve();
  }

  private maybeResolve(): void {
    if (this.phase === 'go' && this.aliveSeats().every((s) => this.taps.has(s.id))) this.resolve();
  }

  private resolve(): void {
    if (this.phase !== 'go') return;
    this.clearTimers();
    const alive = this.aliveSeats().map((s) => s.id);
    const res = cutRound(alive, this.taps, this.settings.cut, this.round);
    const survivors = new Set(res.survivors);
    for (const e of res.entries) {
      const seat = this.players.get(e.id)!;
      if (e.ms !== null && (seat.best === null || e.ms < seat.best)) seat.best = e.ms;
      if (survivors.has(e.id)) {
        if (!res.replay) seat.score += POINTS.survive;
      } else {
        seat.alive = false;
        seat.outRound = this.round;
      }
    }
    if (res.fastestId) this.players.get(res.fastestId)!.score += POINTS.fastest;
    const out = res.entries.length - survivors.size;
    this.system(res.replay ? '🔁 Nobody made a clean tap. Replay!' : `Round ${this.round}: ${out} out, ${survivors.size} left.`);
    this.last = { round: res.round, entries: res.entries, fastestId: res.fastestId, replay: res.replay };
    this.phase = 'result';
    this.endsAt = Date.now() + this.timing.resultMs;
    this.broadcastState();
    this.later(this.timing.resultMs, () => this.nextRound());
  }

  private finish(): void {
    this.clearTimers();
    this.phase = 'finished';
    this.endsAt = null;
    const alive = this.aliveSeats();
    if (alive.length === 1) alive[0]!.score += POINTS.win;
    const played = [...this.players.values()].filter((s) => s.alive || s.outRound !== null);
    const ranking = played.sort(
      (a, b) => Number(b.alive) - Number(a.alive) || (b.outRound ?? 0) - (a.outRound ?? 0) || (a.best ?? Infinity) - (b.best ?? Infinity),
    );
    this.system(alive.length === 1 ? `🏆 ${alive[0]!.name} has the fastest fingers!` : 'Game over!');
    this.broadcastState();
    this.reportResults(ranking, (s) => s.alive);
  }

  protected stateFor(userId: string): MassStateMessage {
    const tap = this.taps.get(userId);
    const live = this.phase === 'wait' || this.phase === 'go';
    return {
      t: 'state',
      now: Date.now(),
      phase: this.phase,
      players: this.seatViews().map((v) => {
        const s = this.players.get(v.id)!;
        return { ...v, alive: s.alive, outRound: s.outRound, best: s.best };
      }),
      settings: this.settings,
      round: this.round,
      endsAt: this.endsAt,
      last: this.phase === 'result' || this.phase === 'finished' ? this.last : null,
      me: { tapped: live && !!tap, early: live && !!tap?.early, ms: live ? (tap?.ms ?? null) : null },
    };
  }
}
