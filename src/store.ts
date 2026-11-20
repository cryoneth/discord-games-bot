import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TimeControl, TourneyStatus } from './shared/chess.js';
import { QUIZ_LIMITS, type Quiz, type QuizDraft, type QuizSummary } from './shared/quiz.js';

export type GameId =
  | 'trivia'
  | 'royale'
  | 'drawing'
  | 'tictactoe'
  | 'fourinarow'
  | 'rps'
  | 'wordguess'
  | 'oddoneout'
  | 'forbidden'
  | 'quiz'
  | 'market'
  | 'dotsandboxes'
  | 'matchsticks'
  | 'fiveinarow'
  | 'mancala'
  | 'higherlower'
  | 'hangman'
  | 'numberduel'
  | 'reaction'
  | 'laststanding'
  | 'minority'
  | 'massreaction'
  | 'chess';

export interface QuizRow {
  id: string;
  scope: string;
  owner_id: string;
  title: string;
  data: string;
  created_at: number;
  updated_at: number;
  used_at: number;
}

/** Custom quizzes of one server, as seen by the quiz game. */
export interface QuizRepo {
  list(userId: string): QuizSummary[];
  get(id: string): { quiz: Quiz; ownerId: string } | null;
  save(ownerId: string, draft: QuizDraft, id?: string): { id: string } | { error: string };
  remove(ownerId: string, id: string): boolean;
  markUsed(id: string): void;
}

/** A chess arena tournament. Names of players are never stored, only user IDs. */
export interface TourneyRow {
  id: string;
  /** Server ID (or `local` outside servers). */
  scope: string;
  /** Where announcements and results are posted (may be empty). */
  channel_id: string;
  created_by: string;
  name: string;
  tc: TimeControl;
  starts_at: number;
  duration_min: number;
  max_players: number;
  status: TourneyStatus;
  created_at: number;
  updated_at: number;
}

export interface EntryRow {
  tourney_id: string;
  user_id: string;
  score: number;
  wins: number;
  draws: number;
  losses: number;
  games: number;
  /** Wins in a row (two or more: on fire). */
  streak: number;
  /** JSON array of points per game. */
  sheet: string;
  /** Games played as white minus games as black, for fair colours. */
  color_balance: number;
  /** Removed by a moderator: can't rejoin. */
  banned: number;
  joined_at: number;
}

/** Tournament storage, as seen by the chess service. */
export interface ChessRepo {
  createTourney(row: TourneyRow): void;
  updateTourney(id: string, patch: Partial<Omit<TourneyRow, 'id' | 'scope'>>): void;
  deleteTourney(id: string): void;
  getTourney(id: string): TourneyRow | null;
  listTourneys(scope: string): TourneyRow[];
  /** Scheduled or running tournaments on every server (loaded at startup). */
  openTourneys(): TourneyRow[];
  entries(tourneyId: string): EntryRow[];
  saveEntry(row: EntryRow): void;
  deleteEntry(tourneyId: string, userId: string): void;
}

export type Period = 'day' | 'week' | 'month' | 'all';

/** UTC day key, e.g. 2026-11-17. */
export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * First day of the current period (UTC) and when the next one starts.
 * Weeks start on Monday.
 */
export function periodRange(period: Exclude<Period, 'all'>, now = Date.now()): { from: string; resetsAt: number } {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (period === 'day') return { from: dayKey(Date.UTC(y, m, day)), resetsAt: Date.UTC(y, m, day + 1) };
  if (period === 'month') return { from: dayKey(Date.UTC(y, m, 1)), resetsAt: Date.UTC(y, m + 1, 1) };
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return { from: dayKey(Date.UTC(y, m, day - sinceMonday)), resetsAt: Date.UTC(y, m, day - sinceMonday + 7) };
}

/** A game only counts towards leaderboards with at least this many players (stops solo farming). */
export const MIN_SCORED_PLAYERS = 2;

export interface LeaderboardRow {
  user_id: string;
  points: number;
  wins: number;
  games_played: number;
}

export interface GameResult {
  userId: string;
  points: number;
  won: boolean;
}

export interface DayRow {
  guild_id: string;
  user_id: string;
  game: string;
  day: string;
  points: number;
  wins: number;
  games_played: number;
}

export interface ScoreRow {
  guild_id: string;
  user_id: string;
  game: string;
  points: number;
  wins: number;
  games_played: number;
  updated_at: number;
}

/**
 * The only persistent data the bot keeps: per-server score totals keyed by
 * Discord user ID, and quizzes that users wrote for their server.
 * No usernames, no message content, no drawings. Rows expire after the
 * retention period.
 */
export class ScoreStore {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'games.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS scores (
        guild_id     TEXT    NOT NULL,
        user_id      TEXT    NOT NULL,
        game         TEXT    NOT NULL,
        points       INTEGER NOT NULL DEFAULT 0,
        wins         INTEGER NOT NULL DEFAULT 0,
        games_played INTEGER NOT NULL DEFAULT 0,
        updated_at   INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, game)
      );
      CREATE INDEX IF NOT EXISTS scores_user ON scores (user_id);
      CREATE INDEX IF NOT EXISTS scores_updated ON scores (updated_at);
      -- Same totals split by UTC day, for the daily, weekly and monthly boards.
      CREATE TABLE IF NOT EXISTS score_days (
        guild_id     TEXT    NOT NULL,
        user_id      TEXT    NOT NULL,
        game         TEXT    NOT NULL,
        day          TEXT    NOT NULL,
        points       INTEGER NOT NULL DEFAULT 0,
        wins         INTEGER NOT NULL DEFAULT 0,
        games_played INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id, game, day)
      );
      CREATE INDEX IF NOT EXISTS score_days_board ON score_days (guild_id, day);
      CREATE INDEX IF NOT EXISTS score_days_user ON score_days (user_id);
      CREATE TABLE IF NOT EXISTS opt_out (user_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS quizzes (
        id         TEXT    PRIMARY KEY,
        scope      TEXT    NOT NULL,
        owner_id   TEXT    NOT NULL,
        title      TEXT    NOT NULL,
        data       TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        used_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS quizzes_scope ON quizzes (scope);
      CREATE INDEX IF NOT EXISTS quizzes_owner ON quizzes (owner_id);
      CREATE TABLE IF NOT EXISTS chess_tourneys (
        id           TEXT    PRIMARY KEY,
        scope        TEXT    NOT NULL,
        channel_id   TEXT    NOT NULL DEFAULT '',
        created_by   TEXT    NOT NULL,
        name         TEXT    NOT NULL,
        tc           TEXT    NOT NULL,
        starts_at    INTEGER NOT NULL,
        duration_min INTEGER NOT NULL,
        max_players  INTEGER NOT NULL,
        status       TEXT    NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chess_tourneys_scope ON chess_tourneys (scope);
      CREATE INDEX IF NOT EXISTS chess_tourneys_status ON chess_tourneys (status);
      CREATE TABLE IF NOT EXISTS chess_entries (
        tourney_id    TEXT    NOT NULL,
        user_id       TEXT    NOT NULL,
        score         INTEGER NOT NULL DEFAULT 0,
        wins          INTEGER NOT NULL DEFAULT 0,
        draws         INTEGER NOT NULL DEFAULT 0,
        losses        INTEGER NOT NULL DEFAULT 0,
        games         INTEGER NOT NULL DEFAULT 0,
        streak        INTEGER NOT NULL DEFAULT 0,
        sheet         TEXT    NOT NULL DEFAULT '[]',
        color_balance INTEGER NOT NULL DEFAULT 0,
        banned        INTEGER NOT NULL DEFAULT 0,
        joined_at     INTEGER NOT NULL,
        PRIMARY KEY (tourney_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS chess_entries_user ON chess_entries (user_id);
    `);
  }

  /**
   * Adds one finished game to the totals. Games with fewer than
   * MIN_SCORED_PLAYERS distinct players are not counted. Returns whether it counted.
   */
  record(guildId: string | null, game: GameId, results: GameResult[], now = Date.now()): boolean {
    if (!guildId) return false;
    const seen = new Set<string>();
    results = results.filter((r) => !seen.has(r.userId) && seen.add(r.userId));
    if (results.length < MIN_SCORED_PLAYERS) return false;
    const day = dayKey(now);
    const optedOut = this.db.prepare('SELECT 1 FROM opt_out WHERE user_id = ?');
    const upsert = this.db.prepare(`
      INSERT INTO scores (guild_id, user_id, game, points, wins, games_played, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT (guild_id, user_id, game) DO UPDATE SET
        points = points + excluded.points,
        wins = wins + excluded.wins,
        games_played = games_played + 1,
        updated_at = excluded.updated_at
    `);
    const upsertDay = this.db.prepare(`
      INSERT INTO score_days (guild_id, user_id, game, day, points, wins, games_played)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT (guild_id, user_id, game, day) DO UPDATE SET
        points = points + excluded.points,
        wins = wins + excluded.wins,
        games_played = games_played + 1
    `);
    this.transaction(() => {
      for (const r of results) {
        if (optedOut.get(r.userId)) continue;
        const points = Math.max(0, Math.round(r.points));
        upsert.run(guildId, r.userId, game, points, r.won ? 1 : 0, now);
        upsertDay.run(guildId, r.userId, game, day, points, r.won ? 1 : 0);
      }
    });
    return true;
  }

  /** Top players for a game (or all games) over a period. Ties go to more wins. */
  leaderboard(guildId: string, game: GameId | null, limit = 10, period: Period = 'all', now = Date.now()): LeaderboardRow[] {
    const { sql, args } = this.boardQuery(guildId, game, period, now);
    return this.db.prepare(`${sql} ORDER BY points DESC, wins DESC, user_id LIMIT ?`).all(...args, limit) as unknown as LeaderboardRow[];
  }

  /** One player's place on a board (1-based), or null if they have no points there. */
  rankOf(guildId: string, userId: string, game: GameId | null, period: Period = 'all', now = Date.now()): { rank: number; row: LeaderboardRow } | null {
    const { sql, args } = this.boardQuery(guildId, game, period, now);
    const row = this.db.prepare(`SELECT * FROM (${sql}) WHERE user_id = ?`).get(...args, userId) as unknown as LeaderboardRow | undefined;
    if (!row) return null;
    const ahead = this.db
      .prepare(`SELECT COUNT(*) AS n FROM (${sql}) WHERE points > ? OR (points = ? AND wins > ?)`)
      .get(...args, row.points, row.points, row.wins) as { n: number };
    return { rank: ahead.n + 1, row };
  }

  private boardQuery(guildId: string, game: GameId | null, period: Period, now: number): { sql: string; args: string[] } {
    const table = period === 'all' ? 'scores' : 'score_days';
    const where = ['guild_id = ?'];
    const args = [guildId];
    if (game) {
      where.push('game = ?');
      args.push(game);
    }
    if (period !== 'all') {
      where.push('day >= ?');
      args.push(periodRange(period, now).from);
    }
    return {
      sql: `SELECT user_id, SUM(points) AS points, SUM(wins) AS wins, SUM(games_played) AS games_played
            FROM ${table} WHERE ${where.join(' AND ')} GROUP BY user_id`,
      args,
    };
  }

  userData(userId: string): { rows: ScoreRow[]; days: DayRow[]; quizzes: QuizRow[]; tournamentEntries: EntryRow[]; tournamentsCreated: TourneyRow[]; optedOut: boolean } {
    const rows = this.db.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY guild_id, game').all(userId) as unknown as ScoreRow[];
    const days = this.db.prepare('SELECT * FROM score_days WHERE user_id = ? ORDER BY guild_id, day, game').all(userId) as unknown as DayRow[];
    const quizzes = this.db.prepare('SELECT * FROM quizzes WHERE owner_id = ? ORDER BY scope, created_at').all(userId) as unknown as QuizRow[];
    const tournamentEntries = this.db.prepare('SELECT * FROM chess_entries WHERE user_id = ? ORDER BY joined_at').all(userId) as unknown as EntryRow[];
    const tournamentsCreated = this.db.prepare('SELECT * FROM chess_tourneys WHERE created_by = ? ORDER BY created_at').all(userId) as unknown as TourneyRow[];
    const optedOut = Boolean(this.db.prepare('SELECT 1 FROM opt_out WHERE user_id = ?').get(userId));
    return { rows, days, quizzes, tournamentEntries, tournamentsCreated, optedOut };
  }

  /** Deletes the user's scores and the quizzes they wrote. */
  forgetUser(userId: string): number {
    let n = 0;
    this.transaction(() => {
      n += Number(this.db.prepare('DELETE FROM scores WHERE user_id = ?').run(userId).changes);
      this.db.prepare('DELETE FROM score_days WHERE user_id = ?').run(userId);
      n += Number(this.db.prepare('DELETE FROM quizzes WHERE owner_id = ?').run(userId).changes);
      n += Number(this.db.prepare('DELETE FROM chess_entries WHERE user_id = ?').run(userId).changes);
      // Tournaments they organised stay for everyone else, without their ID.
      n += Number(this.db.prepare("UPDATE chess_tourneys SET created_by = '' WHERE created_by = ?").run(userId).changes);
    });
    return n;
  }

  /** Moderation: every custom quiz of a server, newest first. */
  listServerQuizzes(scope: string): { id: string; title: string; owner_id: string; updated_at: number }[] {
    return this.db.prepare('SELECT id, title, owner_id, updated_at FROM quizzes WHERE scope = ? ORDER BY updated_at DESC').all(scope) as unknown as {
      id: string;
      title: string;
      owner_id: string;
      updated_at: number;
    }[];
  }

  /** Moderation: deletes any quiz of a server, whoever wrote it. Returns its title, or null if it didn't exist. */
  removeServerQuiz(scope: string, id: string): string | null {
    const row = this.db.prepare('SELECT title FROM quizzes WHERE scope = ? AND id = ?').get(scope, id) as { title: string } | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM quizzes WHERE scope = ? AND id = ?').run(scope, id);
    return row.title;
  }

  quizzes(scope: string): QuizRepo {
    const db = this.db;
    const parse = (row: QuizRow): Quiz => ({ id: row.id, ...(JSON.parse(row.data) as QuizDraft) });
    return {
      list: (userId) =>
        (db.prepare('SELECT id, owner_id, title, data FROM quizzes WHERE scope = ? ORDER BY updated_at DESC').all(scope) as unknown as QuizRow[]).map((r) => ({
          id: r.id,
          title: r.title,
          count: (JSON.parse(r.data) as QuizDraft).questions.length,
          mine: r.owner_id === userId,
          builtin: false,
        })),
      get: (id) => {
        const row = db.prepare('SELECT * FROM quizzes WHERE scope = ? AND id = ?').get(scope, id) as unknown as QuizRow | undefined;
        return row ? { quiz: parse(row), ownerId: row.owner_id } : null;
      },
      save: (ownerId, draft, id) => {
        const now = Date.now();
        const data = JSON.stringify({ title: draft.title, questions: draft.questions });
        if (id) {
          const res = db.prepare('UPDATE quizzes SET title = ?, data = ?, updated_at = ? WHERE scope = ? AND id = ? AND owner_id = ?').run(draft.title, data, now, scope, id, ownerId);
          return Number(res.changes) ? { id } : { error: 'Only the author can edit this quiz.' };
        }
        const total = (db.prepare('SELECT COUNT(*) AS n FROM quizzes WHERE scope = ?').get(scope) as { n: number }).n;
        if (total >= QUIZ_LIMITS.perScope) return { error: `This server already has ${QUIZ_LIMITS.perScope} quizzes. Delete some first.` };
        const mine = (db.prepare('SELECT COUNT(*) AS n FROM quizzes WHERE scope = ? AND owner_id = ?').get(scope, ownerId) as { n: number }).n;
        if (mine >= QUIZ_LIMITS.perOwner) return { error: `You can keep up to ${QUIZ_LIMITS.perOwner} quizzes here. Delete one first.` };
        const newId = randomUUID();
        db.prepare('INSERT INTO quizzes (id, scope, owner_id, title, data, created_at, updated_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(newId, scope, ownerId, draft.title, data, now, now, now);
        return { id: newId };
      },
      remove: (ownerId, id) => Number(db.prepare('DELETE FROM quizzes WHERE scope = ? AND id = ? AND owner_id = ?').run(scope, id, ownerId).changes) > 0,
      markUsed: (id) => void db.prepare('UPDATE quizzes SET used_at = ? WHERE scope = ? AND id = ?').run(Date.now(), scope, id),
    };
  }

  chess(): ChessRepo {
    const db = this.db;
    const COLS = ['channel_id', 'created_by', 'name', 'tc', 'starts_at', 'duration_min', 'max_players', 'status', 'updated_at'] as const;
    return {
      createTourney: (r) =>
        void db
          .prepare(
            'INSERT INTO chess_tourneys (id, scope, channel_id, created_by, name, tc, starts_at, duration_min, max_players, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(r.id, r.scope, r.channel_id, r.created_by, r.name, r.tc, r.starts_at, r.duration_min, r.max_players, r.status, r.created_at, r.updated_at),
      updateTourney: (id, patch) => {
        const keys = COLS.filter((k) => patch[k] !== undefined);
        if (!keys.length) return;
        db.prepare(`UPDATE chess_tourneys SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k] as string | number), id);
      },
      deleteTourney: (id) =>
        this.transaction(() => {
          db.prepare('DELETE FROM chess_entries WHERE tourney_id = ?').run(id);
          db.prepare('DELETE FROM chess_tourneys WHERE id = ?').run(id);
        }),
      getTourney: (id) => (db.prepare('SELECT * FROM chess_tourneys WHERE id = ?').get(id) as unknown as TourneyRow | undefined) ?? null,
      listTourneys: (scope) => db.prepare('SELECT * FROM chess_tourneys WHERE scope = ? ORDER BY starts_at').all(scope) as unknown as TourneyRow[],
      openTourneys: () => db.prepare("SELECT * FROM chess_tourneys WHERE status IN ('scheduled', 'running') ORDER BY starts_at").all() as unknown as TourneyRow[],
      entries: (tid) => db.prepare('SELECT * FROM chess_entries WHERE tourney_id = ? ORDER BY joined_at').all(tid) as unknown as EntryRow[],
      saveEntry: (e) =>
        void db
          .prepare(
            `INSERT INTO chess_entries (tourney_id, user_id, score, wins, draws, losses, games, streak, sheet, color_balance, banned, joined_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (tourney_id, user_id) DO UPDATE SET score = excluded.score, wins = excluded.wins, draws = excluded.draws,
               losses = excluded.losses, games = excluded.games, streak = excluded.streak, sheet = excluded.sheet,
               color_balance = excluded.color_balance, banned = excluded.banned`,
          )
          .run(e.tourney_id, e.user_id, e.score, e.wins, e.draws, e.losses, e.games, e.streak, e.sheet, e.color_balance, e.banned, e.joined_at),
      deleteEntry: (tid, uid) => void db.prepare('DELETE FROM chess_entries WHERE tourney_id = ? AND user_id = ?').run(tid, uid),
    };
  }

  setOptOut(userId: string, optOut: boolean): void {
    if (optOut) {
      this.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO opt_out (user_id) VALUES (?)').run(userId);
        this.db.prepare('DELETE FROM scores WHERE user_id = ?').run(userId);
        this.db.prepare('DELETE FROM score_days WHERE user_id = ?').run(userId);
      });
    } else {
      this.db.prepare('DELETE FROM opt_out WHERE user_id = ?').run(userId);
    }
  }

  /** Deletes the server's scores and quizzes. */
  wipeGuild(guildId: string): number {
    let n = 0;
    this.transaction(() => {
      n += Number(this.db.prepare('DELETE FROM scores WHERE guild_id = ?').run(guildId).changes);
      this.db.prepare('DELETE FROM score_days WHERE guild_id = ?').run(guildId);
      n += Number(this.db.prepare('DELETE FROM quizzes WHERE scope = ?').run(guildId).changes);
      this.db.prepare('DELETE FROM chess_entries WHERE tourney_id IN (SELECT id FROM chess_tourneys WHERE scope = ?)').run(guildId);
      n += Number(this.db.prepare('DELETE FROM chess_tourneys WHERE scope = ?').run(guildId).changes);
    });
    return n;
  }

  /** Deletes scores not updated, and quizzes neither edited nor played, within `days`. */
  purgeOlderThan(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    let n = Number(this.db.prepare('DELETE FROM scores WHERE updated_at < ?').run(cutoff).changes);
    n += Number(this.db.prepare('DELETE FROM score_days WHERE day < ?').run(dayKey(cutoff)).changes);
    n += Number(this.db.prepare('DELETE FROM quizzes WHERE updated_at < ? AND used_at < ?').run(cutoff, cutoff).changes);
    this.transaction(() => {
      this.db.prepare("DELETE FROM chess_entries WHERE tourney_id IN (SELECT id FROM chess_tourneys WHERE status = 'finished' AND updated_at < ?)").run(cutoff);
      n += Number(this.db.prepare("DELETE FROM chess_tourneys WHERE status = 'finished' AND updated_at < ?").run(cutoff).changes);
    });
    return n;
  }

  close(): void {
    this.db.close();
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
