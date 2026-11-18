/**
 * Hub protocol between the Activity (browser, inside Discord) and the game
 * server. One Activity hosts several games: the host picks one, and every
 * game's own messages travel inside a `g` envelope.
 * Shared by both sides; must stay free of Node/DOM imports.
 */

export type GameId = 'drawing' | 'oddoneout' | 'forbidden' | 'quiz' | 'market' | 'massreaction';

export interface GameInfo {
  id: GameId;
  name: string;
  emoji: string;
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
}

export const GAMES: readonly GameInfo[] = [
  { id: 'drawing', name: 'Sketch Party', emoji: '🎨', blurb: 'Take turns drawing a secret word while everyone races to guess it.', minPlayers: 2, maxPlayers: 16 },
  { id: 'oddoneout', name: 'Odd One Out', emoji: '🕵️', blurb: 'Everyone shares a secret word except one player. Give clues, then vote out the odd one.', minPlayers: 3, maxPlayers: 12 },
  { id: 'forbidden', name: 'Forbidden Words', emoji: '🚫', blurb: 'Describe the word to your team without saying any of the banned words.', minPlayers: 4, maxPlayers: 16 },
  { id: 'quiz', name: 'Quiz Arena', emoji: '⚡', blurb: 'Fast live quizzes. Play a built-in one or build your own for the server.', minPlayers: 1, maxPlayers: 16 },
  { id: 'market', name: 'Perp Arena', emoji: '📈', blurb: 'A trading simulator with play money: leverage, funding, liquidations and yield farms.', minPlayers: 1, maxPlayers: 16 },
  { id: 'massreaction', name: 'Mass Reaction', emoji: '🚦', blurb: 'Tap the moment it turns green. Too early or too slow and you’re out. Built for big crowds.', minPlayers: 2, maxPlayers: 100 },
];

export const gameInfo = (id: GameId): GameInfo => GAMES.find((g) => g.id === id)!;
export const isGameId = (x: unknown): x is GameId => GAMES.some((g) => g.id === x);

export const HUB_LIMITS = {
  /** Whole Activity; each game also has its own cap (most are 16). */
  maxPlayers: 100,
  /** Large enough for a full quiz upload from the editor. */
  maxMessageBytes: 64 * 1024,
} as const;

export interface HubPlayer {
  id: string;
  name: string;
  connected: boolean;
  host: boolean;
}

export type ClientMessage =
  | { t: 'hello'; accessToken: string; instanceId: string }
  /** Host: switch to a game (only between games). */
  | { t: 'choose'; game: GameId }
  /** Host: back to the game picker (only between games). Moderators: also stops a running game. */
  | { t: 'menu' }
  /** Moderator: become the host. */
  | { t: 'takeover' }
  /** A message for the current game. */
  | { t: 'g'; m: { t: string } & Record<string, unknown> };

export type ServerMessage =
  | { t: 'welcome'; you: string; mod?: boolean }
  /** A short announcement from the hub (e.g. a moderator stopped the game). */
  | { t: 'notice'; text: string }
  | { t: 'hub'; game: GameId | null; players: HubPlayer[]; now: number }
  | { t: 'g'; m: { t: string } & Record<string, unknown> }
  | { t: 'error'; text: string; fatal?: boolean };

// ── Shared building blocks for game protocols ─────────────────────────────

export type ChatKind = 'guess' | 'system' | 'correct' | 'close' | 'private';
export interface ChatMessage {
  t: 'chat';
  kind: ChatKind;
  name?: string;
  text: string;
}
export const MAX_CHAT_LENGTH = 120;

/** Shown wherever scores appear. */
export const JUST_FOR_FUN = 'All games and leaderboards are just for fun.';
