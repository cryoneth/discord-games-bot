import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type GameId = 'trivia' | 'royale' | 'drawing';

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
 * Discord user ID. No usernames, no message content, no drawings.
 * Rows expire after the retention period.
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

  userData(userId: string): { rows: ScoreRow[]; optedOut: boolean } {
    const rows = this.db.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY guild_id, game').all(userId) as unknown as ScoreRow[];
    const optedOut = Boolean(this.db.prepare('SELECT 1 FROM opt_out WHERE user_id = ?').get(userId));
    return { rows, optedOut };
  }

  forgetUser(userId: string): number {
    return Number(this.db.prepare('DELETE FROM scores WHERE user_id = ?').run(userId).changes);
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

  wipeGuild(guildId: string): number {
    return Number(this.db.prepare('DELETE FROM scores WHERE guild_id = ?').run(guildId).changes);
  }

  purgeOlderThan(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    return Number(this.db.prepare('DELETE FROM scores WHERE updated_at < ?').run(cutoff).changes);
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
