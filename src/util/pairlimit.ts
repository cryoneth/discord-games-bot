/** The same two players score at most this many games of one duel per UTC day (stops win-trading). */
export const PAIR_DAILY_LIMIT = 5;
const pairGames = new Map<string, number>();
let pairDay = '';

/** Counts a finished duel for the pair; false once they've hit today's limit. */
export function takePairSlot(guildId: string, gameId: string, players: readonly [string, string], now = Date.now()): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  if (day !== pairDay) {
    pairDay = day;
    pairGames.clear();
  }
  const key = `${guildId}:${gameId}:${[...players].sort().join(':')}`;
  const n = pairGames.get(key) ?? 0;
  if (n >= PAIR_DAILY_LIMIT) return false;
  pairGames.set(key, n + 1);
  return true;
}
