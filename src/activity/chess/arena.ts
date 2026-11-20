import { arenaPoints } from '../../shared/chess.js';

export interface Waiting {
  id: string;
  score: number;
  /** Opponent in their last game, to avoid instant rematches. */
  lastOpp: string | null;
  /** Games as white minus games as black. */
  colorBalance: number;
}

/**
 * Arena pairing: players waiting for a game are sorted by score and paired
 * with the closest-ranked player who wasn't their last opponent. A rematch
 * only happens when those two are the only ones waiting. Returns [white, black] pairs.
 */
export function pairUp(waiting: readonly Waiting[], rnd: () => number = Math.random): [string, string][] {
  const pool = waiting
    .map((w) => ({ w, r: rnd() }))
    .sort((a, b) => b.w.score - a.w.score || a.r - b.r)
    .map((x) => x.w);
  const pairs: [string, string][] = [];
  while (pool.length >= 2) {
    const a = pool.shift()!;
    let j = pool.findIndex((b) => b.id !== a.lastOpp && b.lastOpp !== a.id);
    if (j < 0) {
      if (pool.length !== 1) continue; // a sits this round out; someone new will free up soon
      j = 0;
    }
    const b = pool.splice(j, 1)[0]!;
    const aWhite = a.colorBalance < b.colorBalance || (a.colorBalance === b.colorBalance && rnd() < 0.5);
    pairs.push(aWhite ? [a.id, b.id] : [b.id, a.id]);
  }
  return pairs;
}

export interface EntryStats {
  score: number;
  wins: number;
  draws: number;
  losses: number;
  games: number;
  streak: number;
  sheet: number[];
}

/** Applies one finished game to a player's tournament stats. Returns the points scored. */
export function applyResult(e: EntryStats, outcome: 'win' | 'draw' | 'loss', opts: { berserk: boolean; plies: number }): number {
  const { points, streak } = arenaPoints(outcome, e.streak, opts);
  e.score += points;
  e.streak = streak;
  e.games++;
  if (outcome === 'win') e.wins++;
  else if (outcome === 'draw') e.draws++;
  else e.losses++;
  e.sheet.push(points);
  if (e.sheet.length > 60) e.sheet.splice(0, e.sheet.length - 60);
  return points;
}

/** Final order: score, then wins, then fewer games (a better rate), then who joined first. */
export function rankEntries<T extends EntryStats & { joinedAt: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => b.score - a.score || b.wins - a.wins || a.games - b.games || a.joinedAt - b.joinedAt);
}
