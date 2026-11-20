import { randomUUID } from 'node:crypto';
import {
  ABANDON_MS,
  checkTourneySettings,
  cleanName,
  TOURNEY_LIMITS,
  type BoardSummary,
  type Color,
  type ModVerdict,
  type TimeControl,
  type TourneySettings,
  type TourneyView,
} from '../../shared/chess.js';
import type { ChessRepo, EntryRow, GameResult, TourneyRow } from '../../store.js';
import { log } from '../../util/log.js';
import { takePairSlot } from '../../util/pairlimit.js';
import { applyResult, pairUp, rankEntries, type EntryStats } from './arena.js';
import { ChessGame, type ChessPlayer } from './game.js';

/** A chess screen in one Activity instance. The service tells it what changed. */
export interface ChessListener {
  readonly scope: string;
  /** Whether this user is connected here. */
  has(userId: string): boolean;
  gameChanged(game: ChessGame): void;
  lobbyChanged(): void;
  notify(userId: string, text: string): void;
}

export type TourneyEvent =
  | { kind: 'created' | 'started' | 'cancelled'; row: TourneyRow; players: number }
  | { kind: 'finished'; row: TourneyRow; ranking: { id: string; score: number; wins: number; games: number }[] };

export interface ChessDeps {
  repo: ChessRepo;
  /** Records a result for the leaderboard. Returns whether it counted. */
  record(guildId: string, results: GameResult[]): boolean;
  /** Post to the tournament's channel in Discord. */
  announce?(ev: TourneyEvent): void;
  /** Looks up a display name (never stored). */
  resolveName?(userId: string): Promise<string | null>;
  now?: () => number;
  /** Tests turn timers off and call `tick()` themselves. */
  timers?: boolean;
  rnd?: () => number;
}

interface Entry extends EntryStats {
  id: string;
  colorBalance: number;
  banned: boolean;
  joinedAt: number;
  paused: boolean;
  lastOpp: string | null;
  gameId: string | null;
  /** Not paired again before this (a short break to see the result). */
  readyAt: number;
}

interface Arena {
  row: TourneyRow;
  entries: Map<string, Entry>;
  games: Map<string, ChessGame>;
  /** Time is up: no new pairings, waiting for the last games. */
  ending: boolean;
  removed: boolean;
}

const CASUAL_WIN = 50;
const CASUAL_DRAW = 15;
const RESULT_BREAK_MS = 4000;
/** No new pairings this close to the end. */
const LAST_PAIRING_MS = 20_000;

export const endsAt = (row: TourneyRow) => row.starts_at + row.duration_min * 60_000;

/**
 * Runs every chess game and arena tournament of the bot. Tournaments belong
 * to a server and are stored; games and who is online live in memory. Each
 * Activity instance showing chess registers itself as a listener.
 */
export class ChessService {
  private readonly arenas = new Map<string, Arena>();
  private readonly casual = new Map<string, { game: ChessGame; owner: ChessListener; scope: string }>();
  /** `scope:user` → the live game they're in. */
  private readonly playing = new Map<string, ChessGame>();
  private readonly listeners = new Set<ChessListener>();
  private readonly names = new Map<string, string>();
  private readonly resolving = new Set<string>();
  private readonly abandonTimers = new Map<string, NodeJS.Timeout>();
  private readonly loadedScopes = new Set<string>();
  private readonly ticker: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: ChessDeps) {
    this.now = deps.now ?? Date.now;
    for (const row of deps.repo.openTourneys()) this.load(row);
    if (deps.timers !== false) {
      this.ticker = setInterval(() => {
        try {
          this.tick();
        } catch (err) {
          log.error('Chess tick failed', err);
        }
      }, 1000);
      this.ticker.unref();
    }
  }

  // ── Listeners and presence ───────────────────────────────────────────────

  attach(l: ChessListener): void {
    this.listeners.add(l);
  }

  detach(l: ChessListener): void {
    this.listeners.delete(l);
  }

  rememberName(id: string, name: string): void {
    this.names.set(id, name);
  }

  nameOf(id: string): string {
    const known = this.names.get(id);
    if (known) return known;
    if (this.deps.resolveName && !this.resolving.has(id)) {
      this.resolving.add(id);
      this.deps
        .resolveName(id)
        .then((name) => {
          if (!name) return;
          this.names.set(id, name);
          this.lobbiesChanged();
        })
        .catch(() => {});
    }
    return 'Player';
  }

  online(scope: string, userId: string): boolean {
    for (const l of this.listeners) if (l.scope === scope && l.has(userId)) return true;
    return false;
  }

  /** A player connected to or left a chess screen. Starts or stops the abandonment clock of their game. */
  presence(scope: string, userId: string): void {
    const game = this.liveGameOf(scope, userId);
    if (game) {
      const c = game.colorOf(userId)!;
      const on = this.online(scope, userId);
      game.online[c] = on;
      const key = `${game.id}:${c}`;
      const t = this.abandonTimers.get(key);
      if (on && t) {
        clearTimeout(t);
        this.abandonTimers.delete(key);
      } else if (!on && !t && this.deps.timers !== false) {
        const timer = setTimeout(() => {
          this.abandonTimers.delete(key);
          if (!game.over && !this.online(scope, userId)) game.abandon(c);
        }, ABANDON_MS);
        timer.unref();
        this.abandonTimers.set(key, timer);
      }
      this.gameChanged(scope, game);
    }
    this.lobbiesChanged(scope);
  }

  // ── Games ────────────────────────────────────────────────────────────────

  liveGameOf(scope: string, userId: string): ChessGame | null {
    return this.playing.get(`${scope}:${userId}`) ?? null;
  }

  /** A live game anywhere on this server, for watching. */
  findGame(scope: string, id: string): ChessGame | null {
    const c = this.casual.get(id);
    if (c && c.scope === scope) return c.game;
    for (const a of this.arenas.values()) if (a.row.scope === scope && a.games.has(id)) return a.games.get(id)!;
    return null;
  }

  /** Casual boards started in one Activity instance. */
  casualBoards(owner: ChessListener): BoardSummary[] {
    return [...this.casual.values()].filter((c) => c.owner === owner).map((c) => c.game.summary());
  }

  /** Every live game on a server, for `/mod games`. */
  liveGames(scope: string): ChessGame[] {
    const out = [...this.casual.values()].filter((c) => c.scope === scope).map((c) => c.game);
    for (const a of this.arenas.values()) if (a.row.scope === scope) out.push(...a.games.values());
    return out;
  }

  startCasual(scope: string, owner: ChessListener, white: ChessPlayer, black: ChessPlayer, tc: TimeControl): ChessGame | string {
    if (white.id === black.id) return "You can't play yourself.";
    if (this.liveGameOf(scope, white.id) || this.liveGameOf(scope, black.id)) return 'One of you is already playing a game.';
    const game = this.newGame(scope, white, black, tc, null, (g) => this.casualEnded(scope, g));
    this.casual.set(game.id, { game, owner, scope });
    this.lobbiesChanged(scope);
    return game;
  }

  /** Moderator: abort or decide any live game on the server. */
  decide(scope: string, gameId: string, verdict: ModVerdict): boolean {
    const g = this.findGame(scope, gameId);
    if (!g || g.over) return false;
    g.decide(verdict);
    return true;
  }

  /** Moderator stop: abort these players' games and pause them in tournaments. */
  stopUsers(scope: string, userIds: readonly string[]): number {
    let n = 0;
    for (const id of userIds) {
      const g = this.liveGameOf(scope, id);
      if (g && !g.over) {
        g.decide('abort');
        n++;
      }
      for (const a of this.arenas.values()) {
        const e = a.row.scope === scope ? a.entries.get(id) : undefined;
        if (e && a.row.status === 'running') e.paused = true;
      }
    }
    this.lobbiesChanged(scope);
    return n;
  }

  private newGame(scope: string, white: ChessPlayer, black: ChessPlayer, tc: TimeControl, tourneyId: string | null, ended: (g: ChessGame) => void): ChessGame {
    const game = new ChessGame({
      id: randomUUID().slice(0, 12),
      white,
      black,
      tc,
      tourneyId,
      now: this.now,
      timers: this.deps.timers,
      onChange: (g) => this.gameChanged(scope, g),
      onEnd: (g) => {
        for (const c of ['w', 'b'] as const) {
          const id = g.playerOf(c).id;
          if (this.playing.get(`${scope}:${id}`) === g) this.playing.delete(`${scope}:${id}`);
          const key = `${g.id}:${c}`;
          clearTimeout(this.abandonTimers.get(key));
          this.abandonTimers.delete(key);
        }
        ended(g);
      },
    });
    this.playing.set(`${scope}:${white.id}`, game);
    this.playing.set(`${scope}:${black.id}`, game);
    game.online = { w: this.online(scope, white.id), b: this.online(scope, black.id) };
    // Someone already gone when the game starts gets the usual grace period.
    for (const p of [white, black]) if (!this.online(scope, p.id)) this.presence(scope, p.id);
    return game;
  }

  private casualEnded(scope: string, g: ChessGame): void {
    const entry = this.casual.get(g.id);
    this.casual.delete(g.id);
    entry?.owner.lobbyChanged();
    if (g.result === '*' || scope === 'local') return;
    const players: [string, string] = [g.white.id, g.black.id];
    if (!takePairSlot(scope, 'chess', players, this.now())) return;
    try {
      this.deps.record(scope, [
        { userId: g.white.id, points: g.result === '1-0' ? CASUAL_WIN : g.result === '0-1' ? 0 : CASUAL_DRAW, won: g.result === '1-0' },
        { userId: g.black.id, points: g.result === '0-1' ? CASUAL_WIN : g.result === '1-0' ? 0 : CASUAL_DRAW, won: g.result === '0-1' },
      ]);
    } catch (err) {
      log.warn('Could not record a chess result', err);
    }
  }

  private gameChanged(scope: string, g: ChessGame): void {
    for (const l of this.listeners) if (l.scope === scope) l.gameChanged(g);
  }

  private lobbiesChanged(scope?: string): void {
    for (const l of this.listeners) if (!scope || l.scope === scope) l.lobbyChanged();
  }

  // ── Tournaments: organisers ──────────────────────────────────────────────

  /** Tournaments of a server: scheduled, running and recently finished, by start time. */
  list(scope: string): TourneyRow[] {
    this.loadFinished(scope);
    return [...this.arenas.values()].filter((a) => a.row.scope === scope).map((a) => a.row).sort((a, b) => a.starts_at - b.starts_at);
  }

  get(scope: string, id: string): TourneyRow | null {
    this.loadFinished(scope);
    const a = this.arenas.get(id);
    return a && a.row.scope === scope ? a.row : null;
  }

  create(scope: string, channelId: string | null, by: string, s: TourneySettings): { row: TourneyRow } | { error: string } {
    const now = this.now();
    const err = checkTourneySettings(s, now);
    if (err) return { error: err };
    const open = [...this.arenas.values()].filter((a) => a.row.scope === scope && a.row.status !== 'finished').length;
    if (open >= TOURNEY_LIMITS.perScope) return { error: `This server already has ${TOURNEY_LIMITS.perScope} upcoming tournaments. Remove one first.` };
    let id = randomUUID().slice(0, 6);
    while (this.arenas.has(id) || this.deps.repo.getTourney(id)) id = randomUUID().slice(0, 6);
    const row: TourneyRow = {
      id,
      scope,
      channel_id: channelId ?? '',
      created_by: by,
      name: cleanName(s.name),
      tc: s.tc,
      starts_at: Math.max(now, Math.round(s.startsAt)),
      duration_min: s.durationMin,
      max_players: s.maxPlayers,
      status: 'scheduled',
      created_at: now,
      updated_at: now,
    };
    this.deps.repo.createTourney(row);
    this.load(row);
    this.announce({ kind: 'created', row, players: 0 });
    this.lobbiesChanged(scope);
    return { row };
  }

  edit(scope: string, id: string, patch: Partial<TourneySettings>): string | null {
    const a = this.arena(scope, id);
    if (!a) return 'That tournament no longer exists.';
    if (a.row.status === 'finished') return 'That tournament is over.';
    const running = a.row.status === 'running';
    const err = checkTourneySettings(patch, this.now(), { running, entries: this.activeEntries(a).length });
    if (err) return err;
    const next: Partial<TourneyRow> = {};
    if (patch.name !== undefined) next.name = cleanName(patch.name);
    if (patch.tc !== undefined) next.tc = patch.tc;
    if (patch.startsAt !== undefined) next.starts_at = Math.max(this.now(), Math.round(patch.startsAt));
    if (patch.maxPlayers !== undefined) next.max_players = patch.maxPlayers;
    if (patch.durationMin !== undefined) {
      if (running && a.row.starts_at + patch.durationMin * 60_000 <= this.now() + 60_000) return 'That would end the tournament in the past. Pick a longer duration.';
      next.duration_min = patch.durationMin;
    }
    next.updated_at = this.now();
    Object.assign(a.row, next);
    if (running && a.ending && endsAt(a.row) > this.now()) a.ending = false;
    this.deps.repo.updateTourney(id, next);
    this.lobbiesChanged(scope);
    return null;
  }

  /** Deletes a tournament (any status). Live games in it are aborted without points. Returns its name. */
  remove(scope: string, id: string): string | null {
    const a = this.arena(scope, id);
    if (!a) return null;
    a.removed = true;
    for (const g of [...a.games.values()]) g.decide('abort');
    this.arenas.delete(id);
    this.deps.repo.deleteTourney(id);
    if (a.row.status !== 'finished') this.announce({ kind: 'cancelled', row: a.row, players: this.activeEntries(a).length });
    this.lobbiesChanged(scope);
    return a.row.name;
  }

  startNow(scope: string, id: string): string | null {
    const a = this.arena(scope, id);
    if (!a) return 'That tournament no longer exists.';
    if (a.row.status !== 'scheduled') return 'That tournament has already started.';
    a.row.starts_at = this.now();
    this.deps.repo.updateTourney(id, { starts_at: a.row.starts_at, updated_at: this.now() });
    this.tick();
    return null;
  }

  /** Moderator: remove a player. They can't rejoin; a game they're playing is lost. */
  kick(scope: string, id: string, userId: string): string | null {
    const a = this.arena(scope, id);
    const e = a?.entries.get(userId);
    if (!a || !e || e.banned) return "That player isn't in this tournament.";
    if (e.gameId) {
      const g = a.games.get(e.gameId);
      if (g && !g.over) g.decide(g.colorOf(userId) === 'w' ? '0-1' : '1-0');
    }
    e.banned = true;
    e.paused = true;
    this.save(a, e);
    this.lobbiesChanged(scope);
    return null;
  }

  // ── Tournaments: players ─────────────────────────────────────────────────

  join(scope: string, id: string, userId: string): string | null {
    const a = this.arena(scope, id);
    if (!a) return 'That tournament no longer exists.';
    if (a.row.status === 'finished' || a.ending) return 'That tournament is over.';
    const e = a.entries.get(userId);
    if (e?.banned) return 'A moderator removed you from this tournament.';
    if (e) {
      if (!e.paused) return "You've already joined.";
      e.paused = false;
      this.lobbiesChanged(scope);
      return null;
    }
    if (this.activeEntries(a).length >= a.row.max_players) return `It's full (${a.row.max_players} players).`;
    const entry: Entry = {
      id: userId,
      score: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      games: 0,
      streak: 0,
      sheet: [],
      colorBalance: 0,
      banned: false,
      joinedAt: this.now(),
      paused: false,
      lastOpp: null,
      gameId: null,
      readyAt: 0,
    };
    a.entries.set(userId, entry);
    this.save(a, entry);
    this.lobbiesChanged(scope);
    return null;
  }

  /** Before the start: drop out. While running: withdraw (points are kept, rejoin any time). */
  leave(scope: string, id: string, userId: string): string | null {
    const a = this.arena(scope, id);
    const e = a?.entries.get(userId);
    if (!a || !e || e.banned) return "You're not in that tournament.";
    if (a.row.status === 'scheduled') {
      a.entries.delete(userId);
      this.deps.repo.deleteEntry(id, userId);
    } else e.paused = true;
    this.lobbiesChanged(scope);
    return null;
  }

  pause(scope: string, id: string, userId: string, paused: boolean): void {
    const e = this.arena(scope, id)?.entries.get(userId);
    if (!e || e.banned) return;
    e.paused = paused;
    this.lobbiesChanged(scope);
  }

  views(scope: string, userId: string): TourneyView[] {
    this.loadFinished(scope);
    return [...this.arenas.values()]
      .filter((a) => a.row.scope === scope)
      .sort((x, y) => order(x.row) - order(y.row) || x.row.starts_at - y.row.starts_at)
      .map((a) => {
        const me = a.entries.get(userId);
        const ranked = rankEntries(this.activeEntries(a));
        const rank = new Map(ranked.map((e, i) => [e.id, i]));
        const boards = [...a.games.values()]
          .filter((g) => !g.over)
          .sort((x, y) => (rank.get(x.white.id) ?? 99) + (rank.get(x.black.id) ?? 99) - ((rank.get(y.white.id) ?? 99) + (rank.get(y.black.id) ?? 99)))
          .slice(0, 6)
          .map((g) => g.summary());
        return {
          id: a.row.id,
          name: a.row.name,
          status: a.row.status,
          startsAt: a.row.starts_at,
          endsAt: endsAt(a.row),
          durationMin: a.row.duration_min,
          tc: a.row.tc,
          maxPlayers: a.row.max_players,
          createdBy: a.row.created_by,
          standings: ranked.map((e) => ({
            id: e.id,
            name: this.nameOf(e.id),
            score: e.score,
            fire: e.streak >= 2,
            sheet: e.sheet.slice(-20),
            games: e.games,
            wins: e.wins,
            online: this.online(scope, e.id),
            playing: Boolean(e.gameId),
            paused: e.paused,
          })),
          joined: Boolean(me && !me.banned),
          paused: me?.paused ?? false,
          boards,
        };
      });
  }

  // ── Clock ────────────────────────────────────────────────────────────────

  tick(): void {
    const now = this.now();
    for (const a of [...this.arenas.values()]) {
      const { row } = a;
      if (row.status === 'scheduled' && now >= row.starts_at) {
        row.status = 'running';
        row.updated_at = now;
        this.deps.repo.updateTourney(row.id, { status: 'running', updated_at: now });
        this.announce({ kind: 'started', row, players: this.activeEntries(a).length });
        this.lobbiesChanged(row.scope);
      }
      if (row.status === 'running') {
        if (!a.ending && now >= endsAt(row)) {
          a.ending = true;
          this.lobbiesChanged(row.scope);
        }
        if (a.ending) {
          if (a.games.size === 0) this.finish(a);
        } else if (now < endsAt(row) - LAST_PAIRING_MS) this.pair(a, now);
      }
      if (row.status === 'finished' && now - endsAt(row) > TOURNEY_LIMITS.showFinishedMs) this.arenas.delete(row.id);
    }
  }

  dispose(): void {
    if (this.ticker) clearInterval(this.ticker);
    for (const t of this.abandonTimers.values()) clearTimeout(t);
    for (const g of new Set(this.playing.values())) g.dispose();
    this.listeners.clear();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private pair(a: Arena, now: number): void {
    const scope = a.row.scope;
    const waiting = [...a.entries.values()].filter(
      (e) => !e.banned && !e.paused && !e.gameId && e.readyAt <= now && this.online(scope, e.id) && !this.liveGameOf(scope, e.id),
    );
    if (waiting.length < 2) return;
    for (const [w, b] of pairUp(waiting, this.deps.rnd)) {
      const ew = a.entries.get(w)!;
      const eb = a.entries.get(b)!;
      const game = this.newGame(scope, { id: w, name: this.nameOf(w) }, { id: b, name: this.nameOf(b) }, a.row.tc, a.row.id, (g) => this.tourneyGameEnded(a, g));
      a.games.set(game.id, game);
      ew.gameId = eb.gameId = game.id;
      ew.lastOpp = b;
      eb.lastOpp = w;
      ew.colorBalance++;
      eb.colorBalance--;
      this.gameChanged(scope, game);
    }
    this.lobbiesChanged(scope);
  }

  private tourneyGameEnded(a: Arena, g: ChessGame): void {
    a.games.delete(g.id);
    if (a.removed) return;
    const now = this.now();
    const points = { w: 0, b: 0 };
    for (const c of ['w', 'b'] as Color[]) {
      const e = a.entries.get(g.playerOf(c).id);
      if (!e) continue;
      e.gameId = null;
      e.readyAt = now + RESULT_BREAK_MS;
      const outcome = g.outcomeFor(c);
      if (!outcome || e.banned) {
        // Aborted by a moderator: undo the colour count, no points.
        if (!outcome) e.colorBalance += c === 'w' ? -1 : 1;
        this.save(a, e);
        continue;
      }
      points[c] = applyResult(e, outcome, { berserk: g.berserkOf(c), plies: g.plies });
      if (outcome === 'loss' && (g.reason === 'nostart' || g.reason === 'abandon')) {
        // Lichess pauses players who don't play their game.
        e.paused = true;
        this.notifyUser(a.row.scope, e.id, "You didn't play your game, so you're paused. Tap Resume to get paired again.");
      }
      this.save(a, e);
    }
    if (g.result !== '*') g.points = points;
    this.lobbiesChanged(a.row.scope);
    if (a.ending && a.games.size === 0) this.finish(a);
  }

  private finish(a: Arena): void {
    if (a.row.status === 'finished') return;
    const now = this.now();
    a.row.status = 'finished';
    a.row.updated_at = now;
    a.ending = false;
    this.deps.repo.updateTourney(a.row.id, { status: 'finished', updated_at: now });
    const ranking = rankEntries(this.activeEntries(a)).filter((e) => e.games > 0);
    if (a.row.scope !== 'local' && ranking.length >= 2) {
      try {
        this.deps.record(
          a.row.scope,
          ranking.map((e, i) => ({ userId: e.id, points: e.score * 10, won: i === 0 && e.score > 0 })),
        );
      } catch (err) {
        log.warn('Could not record tournament results', err);
      }
    }
    this.announce({ kind: 'finished', row: a.row, ranking: ranking.map((e) => ({ id: e.id, score: e.score, wins: e.wins, games: e.games })) });
    this.lobbiesChanged(a.row.scope);
  }

  private notifyUser(scope: string, userId: string, text: string): void {
    for (const l of this.listeners) if (l.scope === scope && l.has(userId)) l.notify(userId, text);
  }

  private announce(ev: TourneyEvent): void {
    try {
      this.deps.announce?.(ev);
    } catch (err) {
      log.warn('Tournament announcement failed', err);
    }
  }

  private arena(scope: string, id: string): Arena | null {
    const a = this.arenas.get(id);
    return a && a.row.scope === scope ? a : null;
  }

  private activeEntries(a: Arena): Entry[] {
    return [...a.entries.values()].filter((e) => !e.banned);
  }

  private save(a: Arena, e: Entry): void {
    const row: EntryRow = {
      tourney_id: a.row.id,
      user_id: e.id,
      score: e.score,
      wins: e.wins,
      draws: e.draws,
      losses: e.losses,
      games: e.games,
      streak: e.streak,
      sheet: JSON.stringify(e.sheet),
      color_balance: e.colorBalance,
      banned: e.banned ? 1 : 0,
      joined_at: e.joinedAt,
    };
    this.deps.repo.saveEntry(row);
  }

  private load(row: TourneyRow): Arena {
    const entries = new Map<string, Entry>();
    for (const r of this.deps.repo.entries(row.id)) {
      let sheet: number[] = [];
      try {
        sheet = (JSON.parse(r.sheet) as unknown[]).filter((n): n is number => typeof n === 'number');
      } catch {
        /* keep empty */
      }
      entries.set(r.user_id, {
        id: r.user_id,
        score: r.score,
        wins: r.wins,
        draws: r.draws,
        losses: r.losses,
        games: r.games,
        streak: r.streak,
        sheet,
        colorBalance: r.color_balance,
        banned: r.banned === 1,
        joinedAt: r.joined_at,
        paused: false,
        lastOpp: null,
        gameId: null,
        readyAt: 0,
      });
    }
    const a: Arena = { row, entries, games: new Map(), ending: false, removed: false };
    this.arenas.set(row.id, a);
    return a;
  }

  /** Recently finished tournaments are read from the database once per server. */
  private loadFinished(scope: string): void {
    if (this.loadedScopes.has(scope)) return;
    this.loadedScopes.add(scope);
    const since = this.now() - TOURNEY_LIMITS.showFinishedMs;
    for (const row of this.deps.repo.listTourneys(scope)) {
      if (row.status === 'finished' && endsAt(row) >= since && !this.arenas.has(row.id)) this.load(row);
    }
  }
}

const order = (r: TourneyRow) => (r.status === 'running' ? 0 : r.status === 'scheduled' ? 1 : 2);
