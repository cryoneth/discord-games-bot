import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  | 'massreaction';

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

  userData(userId: string): { rows: ScoreRow[]; days: DayRow[]; quizzes: QuizRow[]; optedOut: boolean } {
    const rows = this.db.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY guild_id, game').all(userId) as unknown as ScoreRow[];
    const days = this.db.prepare('SELECT * FROM score_days WHERE user_id = ? ORDER BY guild_id, day, game').all(userId) as unknown as DayRow[];
    const quizzes = this.db.prepare('SELECT * FROM quizzes WHERE owner_id = ? ORDER BY scope, created_at').all(userId) as unknown as QuizRow[];
    const optedOut = Boolean(this.db.prepare('SELECT 1 FROM opt_out WHERE user_id = ?').get(userId));
    return { rows, days, quizzes, optedOut };
  }

  /** Deletes the user's scores and the quizzes they wrote. */
  forgetUser(userId: string): number {
    let n = 0;
    this.transaction(() => {
      n += Number(this.db.prepare('DELETE FROM scores WHERE user_id = ?').run(userId).changes);
      this.db.prepare('DELETE FROM score_days WHERE user_id = ?').run(userId);
      n += Number(this.db.prepare('DELETE FROM quizzes WHERE owner_id = ?').run(userId).changes);
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
    });
    return n;
  }

  /** Deletes scores not updated, and quizzes neither edited nor played, within `days`. */
  purgeOlderThan(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    let n = Number(this.db.prepare('DELETE FROM scores WHERE updated_at < ?').run(cutoff).changes);
    n += Number(this.db.prepare('DELETE FROM score_days WHERE day < ?').run(dayKey(cutoff)).changes);
    n += Number(this.db.prepare('DELETE FROM quizzes WHERE updated_at < ? AND used_at < ?').run(cutoff, cutoff).changes);
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
