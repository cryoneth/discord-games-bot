import { randomUUID } from 'node:crypto';
import {
  isTimeControl,
  type ChallengeView,
  type ChessLobby,
  type ChessServerMessage,
  type Color,
  type ModVerdict,
  type TimeControl,
  type TourneySettings,
} from '../../shared/chess.js';
import { MAX_CHAT_LENGTH, type ChatMessage } from '../../shared/protocol.js';
import type { Conn, GameRoom, RoomContext } from '../base.js';
import type { ChessGame } from '../chess/game.js';
import type { ChessListener, ChessService } from '../chess/service.js';
import { cleanText } from '../room.js';

interface ChessSeat {
  id: string;
  name: string;
  conns: Set<Conn>;
  /** The board on screen: your game, one you watch, or null for the lobby. */
  board: ChessGame | null;
}

interface Challenge {
  id: string;
  by: string;
  tc: TimeControl;
  color: 'random' | Color;
}

const MAX_CHALLENGES = 20;
const VERDICTS: readonly ModVerdict[] = ['abort', '1-0', '0-1', 'draw'];
type Msg = { t: string } & Record<string, unknown>;

/**
 * Chess inside one Activity instance: open challenges and casual boards for
 * the people in this call, and the server's arena tournaments. Games run in
 * the shared ChessService, so tournament players in different voice channels
 * still meet each other.
 */
export class ChessRoom implements GameRoom, ChessListener {
  readonly scope: string;
  lastActivity = Date.now();
  private readonly seats = new Map<string, ChessSeat>();
  private order: string[] = [];
  private readonly challenges = new Map<string, Challenge>();
  private lobbyTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(
    private readonly ctx: RoomContext,
    private readonly service: ChessService,
  ) {
    this.scope = ctx.guildId ?? 'local';
    service.attach(this);
  }

  /** Nobody here is in a live game, so the host may switch to another game. */
  get idle(): boolean {
    for (const s of this.seats.values()) if (this.service.liveGameOf(this.scope, s.id)) return false;
    return true;
  }

  has(userId: string): boolean {
    return (this.seats.get(userId)?.conns.size ?? 0) > 0;
  }

  join(user: { id: string; name: string }, conn: Conn): boolean {
    let seat = this.seats.get(user.id);
    if (!seat) {
      seat = { id: user.id, name: user.name, conns: new Set(), board: null };
      this.seats.set(user.id, seat);
      this.order.push(user.id);
    }
    seat.name = user.name;
    seat.conns.add(conn);
    this.lastActivity = Date.now();
    this.service.rememberName(user.id, user.name);
    const live = this.service.liveGameOf(this.scope, user.id);
    if (live) seat.board = live;
    conn.send(this.lobbyFor(seat.id));
    conn.send(this.boardMsg(seat));
    this.service.presence(this.scope, user.id);
    return true;
  }

  leave(userId: string, conn: Conn): void {
    const seat = this.seats.get(userId);
    if (!seat) return;
    seat.conns.delete(conn);
    if (seat.conns.size > 0) return;
    for (const [id, c] of this.challenges) if (c.by === userId) this.challenges.delete(id);
    if (!this.service.liveGameOf(this.scope, userId)) {
      this.seats.delete(userId);
      this.order = this.order.filter((id) => id !== userId);
    }
    this.service.presence(this.scope, userId);
    this.lobbyChanged();
  }

  handle(userId: string, msg: Msg): void {
    const seat = this.seats.get(userId);
    if (!seat || this.disposed) return;
    this.lastActivity = Date.now();
    const s = this.scope;
    const svc = this.service;
    const mine = svc.liveGameOf(s, userId);
    const done = (err: string | null): void => {
      if (err) this.direct(userId, err);
    };
    switch (msg.t) {
      case 'chat': {
        const text = cleanText(msg.text, MAX_CHAT_LENGTH);
        if (text) this.broadcast({ t: 'chat', kind: 'guess', name: seat.name, text } satisfies ChatMessage);
        return;
      }
      case 'challenge': {
        if (mine) return this.direct(userId, 'Finish your game first.');
        if (!isTimeControl(msg.tc)) return;
        const color = msg.color === 'w' || msg.color === 'b' ? msg.color : 'random';
        for (const [id, c] of this.challenges) if (c.by === userId) this.challenges.delete(id);
        if (this.challenges.size >= MAX_CHALLENGES) return this.direct(userId, 'There are too many open challenges. Accept one instead!');
        const id = randomUUID().slice(0, 8);
        this.challenges.set(id, { id, by: userId, tc: msg.tc, color });
        return this.lobbyChanged();
      }
      case 'cancelChallenge':
        for (const [id, c] of this.challenges) if (c.by === userId) this.challenges.delete(id);
        return this.lobbyChanged();
      case 'accept': {
        const c = typeof msg.id === 'string' ? this.challenges.get(msg.id) : undefined;
        if (!c) return this.direct(userId, 'That challenge is gone.');
        if (c.by === userId) return;
        if (mine) return this.direct(userId, 'Finish your game first.');
        const by = this.seats.get(c.by);
        if (!by || by.conns.size === 0) {
          this.challenges.delete(c.id);
          this.lobbyChanged();
          return this.direct(userId, 'That player has left.');
        }
        const byWhite = c.color === 'w' || (c.color === 'random' && Math.random() < 0.5);
        const a = { id: by.id, name: by.name };
        const b = { id: seat.id, name: seat.name };
        const game = svc.startCasual(s, this, byWhite ? a : b, byWhite ? b : a, c.tc);
        if (typeof game === 'string') return this.direct(userId, game);
        for (const [id, ch] of this.challenges) if (ch.by === by.id || ch.by === userId) this.challenges.delete(id);
        this.gameChanged(game);
        return;
      }
      case 'move':
        if (!mine) return;
        done(mine.move(userId, String(msg.uci ?? '')));
        if (seat.board !== mine) this.show(seat, mine);
        return;
      case 'resign':
        return mine?.resign(userId);
      case 'draw':
        if (mine) done(mine.draw(userId, typeof msg.accept === 'boolean' ? msg.accept : undefined));
        return;
      case 'berserk':
        return mine?.berserk(userId);
      case 'watch': {
        if (msg.id === null) {
          if (mine) return this.show(seat, mine);
          return this.show(seat, null);
        }
        if (mine) return this.direct(userId, 'Finish your game first.');
        const g = typeof msg.id === 'string' ? svc.findGame(s, msg.id) : null;
        if (!g) return this.direct(userId, 'That game has finished.');
        return this.show(seat, g);
      }
      case 'tjoin':
        return done(svc.join(s, String(msg.id), userId));
      case 'tleave':
        return done(svc.leave(s, String(msg.id), userId));
      case 'tpause':
        return svc.pause(s, String(msg.id), userId, msg.paused === true);
    }

    // ── Moderators only ──
    if (!this.isMod(userId)) return this.direct(userId, 'Only moderators can do that.');
    switch (msg.t) {
      case 'tcreate': {
        const res = svc.create(s, this.ctx.channelId, userId, msg.settings as TourneySettings);
        if ('error' in res) return this.direct(userId, res.error);
        return this.direct(userId, `Tournament "${res.row.name}" created.`);
      }
      case 'tedit':
        if (!msg.settings || typeof msg.settings !== 'object') return;
        return done(svc.edit(s, String(msg.id), msg.settings as Partial<TourneySettings>));
      case 'tdelete': {
        const name = svc.remove(s, String(msg.id));
        if (name) this.system(`${seat.name} (moderator) removed the tournament "${name}".`);
        return;
      }
      case 'tstart':
        return done(svc.startNow(s, String(msg.id)));
      case 'tkick':
        return done(svc.kick(s, String(msg.id), String(msg.user)));
      case 'decide': {
        if (!VERDICTS.includes(msg.verdict as ModVerdict)) return;
        const g = svc.findGame(s, String(msg.game));
        if (!g) return this.direct(userId, 'That game has finished.');
        svc.decide(s, g.id, msg.verdict as ModVerdict);
        return this.system(`${seat.name} (moderator) ${msg.verdict === 'abort' ? 'aborted' : 'decided'} ${g.white.name} vs ${g.black.name}.`);
      }
    }
  }

  refresh(): void {
    this.lobbyChanged();
  }

  /** A moderator stopped the Activity: abort games here and pause these players in tournaments. */
  stopByModerator(): void {
    this.service.stopUsers(this.scope, [...this.seats.keys()]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.service.detach(this);
    const ids = [...this.seats.keys()];
    this.seats.clear();
    this.challenges.clear();
    // They're no longer on a chess screen here.
    for (const id of ids) this.service.presence(this.scope, id);
  }

  // ── ChessListener ────────────────────────────────────────────────────────

  gameChanged(game: ChessGame): void {
    if (this.disposed) return;
    for (const seat of this.seats.values()) {
      const plays = game.colorOf(seat.id) !== null;
      // A new game of yours (accepted challenge or tournament pairing) takes over the screen.
      if (plays && !game.over && seat.board !== game) seat.board = game;
      if (seat.board === game) this.sendSeat(seat, this.boardMsg(seat));
    }
  }

  lobbyChanged(): void {
    if (this.disposed || this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      for (const seat of this.seats.values()) if (seat.conns.size) this.sendSeat(seat, this.lobbyFor(seat.id));
    }, 150);
    this.lobbyTimer.unref?.();
  }

  notify(userId: string, text: string): void {
    this.direct(userId, text);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private isMod(userId: string): boolean {
    return this.ctx.isMod?.(userId) ?? false;
  }

  private show(seat: ChessSeat, board: ChessGame | null): void {
    seat.board = board;
    this.sendSeat(seat, this.boardMsg(seat));
  }

  private boardMsg(seat: ChessSeat): ChessServerMessage {
    return { t: 'board', board: seat.board ? seat.board.viewFor(seat.id) : null };
  }

  private lobbyFor(userId: string): ChessLobby {
    const host = this.ctx.hostId?.() ?? this.order.find((id) => this.has(id)) ?? null;
    const challenges: ChallengeView[] = [...this.challenges.values()].map((c) => ({
      id: c.id,
      byId: c.by,
      byName: this.seats.get(c.by)?.name ?? 'Player',
      tc: c.tc,
      color: c.color,
    }));
    return {
      t: 'lobby',
      now: Date.now(),
      mod: this.isMod(userId),
      challenges,
      boards: this.service.casualBoards(this),
      tourneys: this.service.views(this.scope, userId),
      players: this.order
        .map((id) => this.seats.get(id))
        .filter((s): s is ChessSeat => Boolean(s))
        .map((s) => ({ id: s.id, name: s.name, connected: s.conns.size > 0, host: s.id === host, playing: Boolean(this.service.liveGameOf(this.scope, s.id)) })),
    };
  }

  private sendSeat(seat: ChessSeat, msg: unknown): void {
    for (const c of seat.conns) c.send(msg);
  }

  private broadcast(msg: unknown): void {
    for (const s of this.seats.values()) this.sendSeat(s, msg);
  }

  private system(text: string): void {
    this.broadcast({ t: 'chat', kind: 'system', text } satisfies ChatMessage);
  }

  private direct(userId: string, text: string): void {
    const seat = this.seats.get(userId);
    if (seat) this.sendSeat(seat, { t: 'chat', kind: 'private', text } satisfies ChatMessage);
  }
}
