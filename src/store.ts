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
  | 'reaction';

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

export interface GameResult {
  userId: string;
  points: number;
  won: boolean;
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

  record(guildId: string | null, game: GameId, results: GameResult[]): void {
    if (!guildId || results.length === 0) return;
    const now = Date.now();
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
    this.transaction(() => {
      for (const r of results) {
        if (optedOut.get(r.userId)) continue;
        upsert.run(guildId, r.userId, game, Math.max(0, Math.round(r.points)), r.won ? 1 : 0, now);
      }
    });
  }

  leaderboard(guildId: string, game: GameId | null, limit = 10): { user_id: string; points: number; wins: number; games_played: number }[] {
    const sql = game
      ? `SELECT user_id, points, wins, games_played FROM scores WHERE guild_id = ? AND game = ? ORDER BY points DESC, wins DESC LIMIT ?`
      : `SELECT user_id, SUM(points) AS points, SUM(wins) AS wins, SUM(games_played) AS games_played
         FROM scores WHERE guild_id = ? GROUP BY user_id ORDER BY points DESC, wins DESC LIMIT ?`;
    const stmt = this.db.prepare(sql);
    const rows = game ? stmt.all(guildId, game, limit) : stmt.all(guildId, limit);
    return rows as unknown as { user_id: string; points: number; wins: number; games_played: number }[];
  }

  userData(userId: string): { rows: ScoreRow[]; quizzes: QuizRow[]; optedOut: boolean } {
    const rows = this.db.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY guild_id, game').all(userId) as unknown as ScoreRow[];
    const quizzes = this.db.prepare('SELECT * FROM quizzes WHERE owner_id = ? ORDER BY scope, created_at').all(userId) as unknown as QuizRow[];
    const optedOut = Boolean(this.db.prepare('SELECT 1 FROM opt_out WHERE user_id = ?').get(userId));
    return { rows, quizzes, optedOut };
  }

  /** Deletes the user's scores and the quizzes they wrote. */
  forgetUser(userId: string): number {
    let n = 0;
    this.transaction(() => {
      n += Number(this.db.prepare('DELETE FROM scores WHERE user_id = ?').run(userId).changes);
      n += Number(this.db.prepare('DELETE FROM quizzes WHERE owner_id = ?').run(userId).changes);
    });
    return n;
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
      n += Number(this.db.prepare('DELETE FROM quizzes WHERE scope = ?').run(guildId).changes);
    });
    return n;
  }

  /** Deletes scores not updated, and quizzes neither edited nor played, within `days`. */
  purgeOlderThan(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    let n = Number(this.db.prepare('DELETE FROM scores WHERE updated_at < ?').run(cutoff).changes);
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
