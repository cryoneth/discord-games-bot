import { MAX_CHAT_LENGTH, type ChatKind, type ChatMessage } from '../shared/protocol.js';
import { cleanText, type RoomResult } from './room.js';
import { log } from '../util/log.js';

export type { RoomResult } from './room.js';

/** One open WebSocket (already wrapped in the hub's envelope). */
export interface Conn {
  send(msg: unknown): void;
}

/** What the hub needs from any game. */
export interface GameRoom {
  /** Between games (lobby or results), so the host may switch to another game. */
  readonly idle: boolean;
  readonly lastActivity: number;
  /** Returns false if the game is full. */
  join(user: { id: string; name: string }, conn: Conn): boolean;
  leave(userId: string, conn: Conn): void;
  handle(userId: string, msg: { t: string } & Record<string, unknown>): void;
  dispose(): void;
}

export interface RoomContext {
  instanceId: string;
  guildId: string | null;
  channelId: string | null;
  onGameEnd(results: RoomResult[]): void;
  /** Who the host is, when the room runs inside a hub. */
  hostId?(): string | null;
}

export interface Seat {
  id: string;
  name: string;
  score: number;
  conns: Set<Conn>;
}

export interface SeatView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  host: boolean;
}

type Msg = { t: string } & Record<string, unknown>;

/**
 * Shared plumbing for activity games: seats, host, reconnects, chat, timers,
 * per-player state broadcasts. Everything lives in memory only.
 */
export abstract class BaseRoom<S extends Seat = Seat> implements GameRoom {
  protected readonly players = new Map<string, S>();
  /** Join order; decides the host. */
  protected order: string[] = [];
  lastActivity = Date.now();
  private timers = new Set<NodeJS.Timeout>();

  protected abstract readonly minPlayers: number;
  protected abstract readonly maxPlayers: number;

  constructor(protected readonly ctx: RoomContext) {}

  abstract get idle(): boolean;
  protected abstract createSeat(user: { id: string; name: string }): S;
  /** Full state for one player (may include private data such as their secret word). */
  protected abstract stateFor(userId: string): unknown;
  /** Start a new game. Scores are already reset and offline players removed. */
  protected abstract begin(): void;
  /** Abort the current game (not enough players left). */
  protected abstract abort(): void;
  /** A player's last connection closed mid-game. */
  protected abstract onDeparture(seat: S): void;
  protected abstract onMessage(seat: S, msg: Msg): void;
  /** Host changed a setting between games. Return true if it was accepted. */
  protected applySettings(_raw: unknown): boolean {
    return false;
  }
  /** Extra messages for a freshly connected socket (after state). */
  protected onConnect(_seat: S, _conn: Conn): void {}
  /** Free text from a player. Games can treat it as a guess instead. */
  protected onChat(seat: S, text: string): void {
    this.broadcast({ t: 'chat', kind: 'guess', name: seat.name, text } satisfies ChatMessage);
  }

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.conns.size > 0) n++;
    return n;
  }

  join(user: { id: string; name: string }, conn: Conn): boolean {
    let seat = this.players.get(user.id);
    if (!seat) {
      if (this.players.size >= this.maxPlayers) return false;
      seat = this.createSeat(user);
      this.players.set(user.id, seat);
      this.order.push(user.id);
    }
    seat.name = user.name;
    const wasConnected = seat.conns.size > 0;
    seat.conns.add(conn);
    this.lastActivity = Date.now();
    conn.send(this.stateFor(seat.id));
    this.onConnect(seat, conn);
    if (!wasConnected) this.system(`${seat.name} joined.`);
    this.broadcastState();
    return true;
  }

  leave(userId: string, conn: Conn): void {
    const seat = this.players.get(userId);
    if (!seat) return;
    seat.conns.delete(conn);
    if (seat.conns.size > 0) return;
    this.system(`${seat.name} left.`);
    if (this.idle) {
      this.players.delete(userId);
      this.order = this.order.filter((id) => id !== userId);
    } else if (this.connectedCount < this.minPlayers) {
      this.system('Not enough players left. Back to the lobby.');
      this.clearTimers();
      this.abort();
    } else {
      this.onDeparture(seat);
    }
    this.broadcastState();
  }

  handle(userId: string, msg: Msg): void {
    const seat = this.players.get(userId);
    if (!seat) return;
    this.lastActivity = Date.now();
    switch (msg.t) {
      case 'start':
        return this.start(userId);
      case 'end':
        // Host stops the game early; nothing is scored.
        if (this.idle || !this.isHost(userId)) return;
        this.clearTimers();
        this.abort();
        this.system(`${seat.name} ended the game.`);
        this.broadcastState();
        return;
      case 'settings':
        if (!this.idle) return;
        if (!this.isHost(userId)) return this.direct(userId, 'Only the host can change the settings.');
        if (this.applySettings(msg.settings)) this.broadcastState();
        return;
      case 'chat': {
        const text = cleanText(msg.text, MAX_CHAT_LENGTH);
        if (text) this.onChat(seat, text);
        return;
      }
      default:
        return this.onMessage(seat, msg);
    }
  }

  dispose(): void {
    this.clearTimers();
    this.players.clear();
  }

  protected start(userId: string): void {
    if (!this.idle) return;
    if (!this.isHost(userId)) return this.direct(userId, 'Only the host can start the game.');
    if (this.connectedCount < this.minPlayers) return this.direct(userId, `You need at least ${this.minPlayers} players to start.`);
    if (!this.canStart(userId)) return;
    for (const id of [...this.players.keys()]) {
      const seat = this.players.get(id)!;
      if (seat.conns.size === 0) {
        this.players.delete(id);
        this.order = this.order.filter((o) => o !== id);
      } else seat.score = 0;
    }
    this.clearTimers();
    this.begin();
    this.broadcastState();
  }

  /** Extra start checks (e.g. teams are balanced). Send the reason to `userId` and return false to refuse. */
  protected canStart(_userId: string): boolean {
    return true;
  }

  /** Report results to the hub (scores, channel post). */
  protected reportResults(ranking: S[], won: (s: S) => boolean, points: (s: S) => number = (s) => s.score): void {
    try {
      this.ctx.onGameEnd(ranking.map((s) => ({ userId: s.id, points: Math.max(0, Math.round(points(s))), won: won(s) })));
    } catch {
      /* hooks must never break the room */
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  protected hostId(): string | null {
    if (this.ctx.hostId) return this.ctx.hostId();
    return this.order.find((id) => (this.players.get(id)?.conns.size ?? 0) > 0) ?? null;
  }

  protected isHost(userId: string): boolean {
    return this.hostId() === userId;
  }

  /** Connected seats in join order. */
  protected connected(): S[] {
    return this.order.map((id) => this.players.get(id)!).filter((s) => s && s.conns.size > 0);
  }

  protected seatViews(): SeatView[] {
    const host = this.hostId();
    return this.order
      .map((id) => this.players.get(id))
      .filter((s): s is S => Boolean(s))
      .map((s) => ({ id: s.id, name: s.name, score: s.score, connected: s.conns.size > 0, host: s.id === host }));
  }

  protected broadcastState(): void {
    for (const p of this.players.values()) {
      if (p.conns.size === 0) continue;
      const state = this.stateFor(p.id);
      for (const c of p.conns) c.send(state);
    }
  }

  protected broadcast(msg: unknown, except?: string): void {
    for (const p of this.players.values()) {
      if (p.id === except) continue;
      for (const c of p.conns) c.send(msg);
    }
  }

  protected sendTo(userId: string, msg: unknown): void {
    const p = this.players.get(userId);
    if (p) for (const c of p.conns) c.send(msg);
  }

  protected system(text: string, kind: ChatKind = 'system'): void {
    this.broadcast({ t: 'chat', kind, text } satisfies ChatMessage);
  }

  protected direct(userId: string, text: string): void {
    this.sendTo(userId, { t: 'chat', kind: 'private', text } satisfies ChatMessage);
  }

  protected later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      // A bug in one room's timer must not crash the process (and every other game with it).
      try {
        fn();
      } catch (err) {
        log.error(`${this.constructor.name} timer failed`, err);
      }
    }, ms);
    this.timers.add(t);
  }

  protected clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
