import { gameInfo, HUB_LIMITS, isGameId, type ClientMessage, type GameId, type HubPlayer, type ServerMessage } from '../shared/protocol.js';
import type { Conn, GameRoom } from './base.js';

/** A raw socket for the hub; game messages get wrapped before reaching it. */
export interface HubConn {
  send(msg: ServerMessage): void;
}

interface Member {
  id: string;
  name: string;
  /** Server moderator: may stop the game or take over as host at any time. */
  mod: boolean;
  conns: Set<HubConn>;
}

export type GameFactory = (game: GameId, hub: Hub) => GameRoom;

/**
 * Everything happening in one Discord Activity instance: who is here, which
 * game the host picked, and the running game itself. Games never see raw
 * sockets; they get a wrapper that puts their messages in the `g` envelope.
 */
export class Hub {
  private readonly members = new Map<string, Member>();
  private order: string[] = [];
  private readonly wrapped = new Map<HubConn, Conn>();
  private game: GameId | null = null;
  private room: GameRoom | null = null;
  private touched = Date.now();

  constructor(
    readonly instanceId: string,
    readonly guildId: string | null,
    readonly channelId: string | null,
    private readonly factory: GameFactory,
  ) {}

  get connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.conns.size > 0) n++;
    return n;
  }

  get lastActivity(): number {
    return Math.max(this.touched, this.room?.lastActivity ?? 0);
  }

  get currentGame(): GameId | null {
    return this.game;
  }

  /** Returns false if the activity is full. */
  join(user: { id: string; name: string; mod?: boolean }, raw: HubConn): boolean {
    let member = this.members.get(user.id);
    if (!member) {
      // Moderators can always get in, so they can deal with a full activity.
      if (this.members.size >= HUB_LIMITS.maxPlayers && !user.mod) return false;
      member = { id: user.id, name: user.name, mod: false, conns: new Set() };
      this.members.set(user.id, member);
      this.order.push(user.id);
    }
    member.name = user.name;
    member.mod = user.mod ?? false;
    member.conns.add(raw);
    this.touched = Date.now();
    raw.send({ t: 'welcome', you: user.id, mod: member.mod });
    this.broadcastHub();
    if (this.room && !this.room.join({ id: user.id, name: user.name }, this.wrap(raw))) {
      raw.send({ t: 'g', m: { t: 'chat', kind: 'private', text: 'This game is full. You can watch the next one.' } });
    }
    return true;
  }

  leave(userId: string, raw: HubConn): void {
    const member = this.members.get(userId);
    const conn = this.wrapped.get(raw);
    this.wrapped.delete(raw);
    if (!member) return;
    member.conns.delete(raw);
    if (conn) this.room?.leave(userId, conn);
    if (member.conns.size > 0) return;
    if (!this.room || this.room.idle) {
      this.members.delete(userId);
      this.order = this.order.filter((id) => id !== userId);
    }
    this.broadcastHub();
  }

  handle(userId: string, msg: ClientMessage): void {
    const member = this.members.get(userId);
    if (!member) return;
    this.touched = Date.now();
    switch (msg.t) {
      case 'choose':
        if (!isGameId(msg.game) || !this.canSwitch(userId)) return;
        return this.switchTo(msg.game);
      case 'menu':
        if (!this.room) return;
        // Moderators may also stop a game that is in progress.
        if (this.canSwitch(userId)) return this.toMenu(null);
        if (member.mod) return this.toMenu(`${member.name} (moderator) stopped the game.`);
        return;
      case 'takeover':
        if (!member.mod || this.hostId() === userId) return;
        this.order = [userId, ...this.order.filter((id) => id !== userId)];
        this.broadcastHub();
        this.room?.refresh?.();
        this.notice(`${member.name} (moderator) is now the host.`);
        return;
      case 'g':
        if (!msg.m || typeof msg.m !== 'object' || typeof msg.m.t !== 'string') return;
        this.room?.handle(userId, msg.m);
        return;
    }
  }

  /** Moderator stop from Discord (`/mod stop`): back to the game picker, nothing scored. */
  forceStop(text: string): void {
    this.toMenu(text);
  }

  /** Who is here, for `/mod games`. */
  summary(): { game: GameId | null; host: string | null; online: number } {
    const host = this.hostId();
    return { game: this.game, host, online: this.connectedCount };
  }

  dispose(): void {
    this.room?.dispose();
    this.room = null;
    this.members.clear();
    this.wrapped.clear();
  }

  private canSwitch(userId: string): boolean {
    const allowed = this.hostId() === userId || (this.members.get(userId)?.mod ?? false);
    return allowed && (!this.room || this.room.idle);
  }

  private toMenu(notice: string | null): void {
    this.room?.dispose();
    this.room = null;
    this.game = null;
    this.wrapped.clear();
    // Members who left mid-game were kept for reconnects; between games they go.
    for (const [id, m] of this.members) if (m.conns.size === 0) this.members.delete(id);
    this.order = this.order.filter((id) => this.members.has(id));
    this.broadcastHub();
    if (notice) this.notice(notice);
  }

  private notice(text: string): void {
    const msg: ServerMessage = { t: 'notice', text };
    for (const m of this.members.values()) for (const c of m.conns) c.send(msg);
  }

  private switchTo(game: GameId): void {
    this.room?.dispose();
    this.wrapped.clear();
    this.game = game;
    this.room = this.factory(game, this);
    // Clients mount the new game's screen on this message, before its first state arrives.
    this.broadcastHub();
    const max = gameInfo(game).maxPlayers;
    let seated = 0;
    for (const id of this.order) {
      const m = this.members.get(id)!;
      if (m.conns.size === 0) continue;
      const fits = seated < max;
      if (fits) seated++;
      for (const raw of m.conns) {
        if (!fits || !this.room.join({ id: m.id, name: m.name }, this.wrap(raw))) {
          raw.send({ t: 'g', m: { t: 'chat', kind: 'private', text: 'This game is full. You can watch the next one.' } });
        }
      }
    }
  }

  private wrap(raw: HubConn): Conn {
    let conn = this.wrapped.get(raw);
    if (!conn) {
      conn = { send: (m: unknown) => raw.send({ t: 'g', m: m as { t: string } & Record<string, unknown> }) };
      this.wrapped.set(raw, conn);
    }
    return conn;
  }

  /** The host for the whole activity; games use this too, so everyone agrees. */
  hostId(): string | null {
    return this.order.find((id) => (this.members.get(id)?.conns.size ?? 0) > 0) ?? null;
  }

  private broadcastHub(): void {
    const host = this.hostId();
    const players: HubPlayer[] = this.order
      .map((id) => this.members.get(id)!)
      .map((m) => ({ id: m.id, name: m.name, connected: m.conns.size > 0, host: m.id === host }));
    const msg: ServerMessage = { t: 'hub', game: this.game, players, now: Date.now() };
    for (const m of this.members.values()) for (const c of m.conns) c.send(msg);
  }
}
