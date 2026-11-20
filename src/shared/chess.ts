/**
 * Chess messages, time controls and arena tournament rules.
 * Shared by browser and server; must stay free of Node/DOM imports.
 */

// ── Time controls ──────────────────────────────────────────────────────────

/** "minutes+increment seconds", like Lichess. */
export const TIME_CONTROLS = ['1+0', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '10+5', '15+10'] as const;
export type TimeControl = (typeof TIME_CONTROLS)[number];
export const DEFAULT_TC: TimeControl = '3+2';

export const isTimeControl = (x: unknown): x is TimeControl => (TIME_CONTROLS as readonly unknown[]).includes(x);

export function parseTc(tc: TimeControl): { baseMs: number; incMs: number } {
  const [m, s] = tc.split('+').map(Number) as [number, number];
  return { baseMs: m * 60_000, incMs: s * 1000 };
}

export function tcName(tc: TimeControl): string {
  const { baseMs, incMs } = parseTc(tc);
  const est = baseMs / 1000 + (40 * incMs) / 1000;
  const kind = est < 180 ? 'Bullet' : est < 480 ? 'Blitz' : 'Rapid';
  return `${tc} ${kind}`;
}

/** Each side has this long to make their first move, or the game is aborted (casual) or lost (tournament). */
export const FIRST_MOVE_MS = 30_000;
/** A player gone from the Activity this long while it's their game loses by abandonment. */
export const ABANDON_MS = 60_000;
export const MAX_DRAW_OFFERS = 3;

// ── Tournaments ────────────────────────────────────────────────────────────

export const TOURNEY_LIMITS = {
  minPlayers: 2,
  maxPlayers: 50,
  nameLength: 40,
  durations: [20, 30, 45, 60, 90, 120] as readonly number[],
  /** How far ahead a tournament can be scheduled. */
  maxAheadDays: 60,
  /** Scheduled or running tournaments per server at once. */
  perScope: 10,
  /** Finished tournaments stay visible in the Activity for this long. */
  showFinishedMs: 3 * 86_400_000,
};

export type TourneyStatus = 'scheduled' | 'running' | 'finished';

export interface TourneySettings {
  name: string;
  startsAt: number;
  durationMin: number;
  tc: TimeControl;
  maxPlayers: number;
}

export function cleanName(x: unknown): string {
  if (typeof x !== 'string') return '';
  return x.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, TOURNEY_LIMITS.nameLength);
}

/**
 * Checks new tournament settings (or an edit of some of them). Returns an
 * error for the organiser, or null if they're fine. `running` limits what can change.
 */
export function checkTourneySettings(s: Partial<TourneySettings>, now: number, opts: { running?: boolean; entries?: number } = {}): string | null {
  if (s.name !== undefined && !cleanName(s.name)) return 'Give the tournament a name.';
  if (s.tc !== undefined && !isTimeControl(s.tc)) return 'Pick one of the time controls.';
  if (s.durationMin !== undefined && !TOURNEY_LIMITS.durations.includes(s.durationMin)) return `Duration must be one of ${TOURNEY_LIMITS.durations.join(', ')} minutes.`;
  if (s.maxPlayers !== undefined) {
    if (!Number.isInteger(s.maxPlayers) || s.maxPlayers < TOURNEY_LIMITS.minPlayers || s.maxPlayers > TOURNEY_LIMITS.maxPlayers)
      return `Max players must be between ${TOURNEY_LIMITS.minPlayers} and ${TOURNEY_LIMITS.maxPlayers}.`;
    if (opts.entries !== undefined && s.maxPlayers < opts.entries) return `${opts.entries} players have already joined, so the limit can't go below that.`;
  }
  if (s.startsAt !== undefined) {
    if (opts.running) return "The tournament has already started, so its start time can't change.";
    if (!Number.isFinite(s.startsAt)) return 'That start time is not valid.';
    if (s.startsAt < now - 60_000) return 'The start time is in the past.';
    if (s.startsAt > now + TOURNEY_LIMITS.maxAheadDays * 86_400_000) return `Tournaments can be scheduled up to ${TOURNEY_LIMITS.maxAheadDays} days ahead.`;
  }
  if (opts.running && s.tc !== undefined) return "The tournament has already started, so its time control can't change.";
  return null;
}

/**
 * Arena scoring (Lichess rules): win 2, draw 1, loss 0. After two wins in a
 * row you're on fire and score double until you fail to win. A berserk win
 * (half your clock) adds 1 if the game lasted at least 7 moves each. Draws
 * in the first 10 moves score nothing, to stop draw-farming.
 */
export function arenaPoints(outcome: 'win' | 'draw' | 'loss', streak: number, opts: { berserk?: boolean; plies: number }): { points: number; streak: number } {
  const fire = streak >= 2;
  if (outcome === 'loss') return { points: 0, streak: 0 };
  if (outcome === 'draw') return { points: opts.plies < 20 ? 0 : fire ? 2 : 1, streak: 0 };
  const berserk = opts.berserk && opts.plies >= 14 ? 1 : 0;
  return { points: (fire ? 4 : 2) + berserk, streak: streak + 1 };
}

// ── Game views ─────────────────────────────────────────────────────────────

export type Color = 'w' | 'b';
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type EndReason =
  | 'checkmate'
  | 'resign'
  | 'timeout'
  | 'stalemate'
  | 'repetition'
  | 'insufficient'
  | 'fifty'
  | 'agreement'
  | 'abandon'
  | 'nostart'
  | 'aborted'
  | 'moderator';

export const REASON_TEXT: Record<EndReason, string> = {
  checkmate: 'Checkmate',
  resign: 'Resignation',
  timeout: 'Time out',
  stalemate: 'Stalemate',
  repetition: 'Threefold repetition',
  insufficient: 'Insufficient material',
  fifty: 'Fifty-move rule',
  agreement: 'Draw agreed',
  abandon: 'Left the game',
  nostart: 'No first move',
  aborted: 'Game aborted',
  moderator: 'Decided by a moderator',
};

export interface SideView {
  id: string;
  name: string;
  /** Remaining clock in ms at `BoardView.now`. */
  clock: number;
  berserk: boolean;
  online: boolean;
}

export interface BoardView {
  id: string;
  /** Server time this view was made at; the side to move's clock runs from here. */
  now: number;
  white: SideView;
  black: SideView;
  fen: string;
  turn: Color;
  /** Moves so far in SAN. */
  moves: string[];
  /** Last move as [from, to] squares, for highlighting. */
  last: [string, string] | null;
  check: boolean;
  /** Clocks only run once both sides have moved. */
  running: boolean;
  /** Deadline for the side to move's first move. */
  firstMoveBy: number | null;
  drawOffer: Color | null;
  result: GameResult;
  reason: EndReason | null;
  tc: TimeControl;
  tourneyId: string | null;
  /** Arena points each side scored, once a tournament game is over. */
  points?: { w: number; b: number };
}

/** A board seen from a player in it. */
export interface MyBoardView extends BoardView {
  color: Color;
  /** Your legal moves in UCI (e2e4, e7e8q), only when it's your turn. */
  legal: string[];
  canBerserk: boolean;
}

export interface BoardSummary {
  id: string;
  white: string;
  black: string;
  tc: TimeControl;
  tourneyId: string | null;
  moves: number;
}

export interface ChallengeView {
  id: string;
  byId: string;
  byName: string;
  tc: TimeControl;
  color: 'random' | Color;
}

export interface StandingView {
  id: string;
  name: string;
  score: number;
  /** On fire: the next win scores double. */
  fire: boolean;
  /** Points per game, oldest first (the last 20). */
  sheet: number[];
  games: number;
  wins: number;
  online: boolean;
  playing: boolean;
  paused: boolean;
}

export interface TourneyView {
  id: string;
  name: string;
  status: TourneyStatus;
  startsAt: number;
  endsAt: number;
  durationMin: number;
  tc: TimeControl;
  maxPlayers: number;
  createdBy: string;
  /** Sorted by score. */
  standings: StandingView[];
  joined: boolean;
  paused: boolean;
  /** Top boards being played right now. */
  boards: BoardSummary[];
}

export interface ChessLobby {
  t: 'lobby';
  now: number;
  /** Server moderator: may manage tournaments and decide any game. */
  mod: boolean;
  challenges: ChallengeView[];
  boards: BoardSummary[];
  tourneys: TourneyView[];
  players: { id: string; name: string; connected: boolean; host: boolean; playing: boolean }[];
}

export type ChessServerMessage =
  | ChessLobby
  /** The board you play or watch. `null` when you go back to the lobby. */
  | { t: 'board'; board: MyBoardView | BoardView | null }
  | { t: 'chat'; kind: string; text: string; name?: string };

export type ModVerdict = 'abort' | '1-0' | '0-1' | 'draw';

export type ChessClientMessage =
  | { t: 'challenge'; tc: TimeControl; color: 'random' | Color }
  | { t: 'cancelChallenge' }
  | { t: 'accept'; id: string }
  | { t: 'move'; uci: string }
  | { t: 'resign' }
  | { t: 'draw'; accept?: boolean }
  | { t: 'berserk' }
  | { t: 'watch'; id: string | null }
  | { t: 'tjoin'; id: string }
  | { t: 'tleave'; id: string }
  | { t: 'tpause'; id: string; paused: boolean }
  | { t: 'tcreate'; settings: TourneySettings }
  | { t: 'tedit'; id: string; settings: Partial<TourneySettings> }
  | { t: 'tdelete'; id: string }
  | { t: 'tstart'; id: string }
  | { t: 'tkick'; id: string; user: string }
  | { t: 'decide'; game: string; verdict: ModVerdict }
  | { t: 'chat'; text: string };

/** Board squares a1..h8. */
export const isSquare = (s: unknown): s is string => typeof s === 'string' && /^[a-h][1-8]$/.test(s);
export const isUci = (s: unknown): s is string => typeof s === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s);
