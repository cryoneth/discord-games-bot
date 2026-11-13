/** Forbidden Words messages. Shared by browser and server. */

import type { Deck } from './oddoneout.js';

export type { Deck } from './oddoneout.js';
export { DECK_LABELS } from './oddoneout.js';
export type Team = 0 | 1;

export const TEAM_NAMES = ['Team Bull', 'Team Bear'] as const;
export const TEAM_EMOJI = ['🐂', '🐻'] as const;

export interface ForbiddenSettings {
  turnSeconds: number;
  /** Each round, both teams play one turn. */
  rounds: number;
  deck: Deck;
}

export const FORBIDDEN_OPTIONS = {
  turnSeconds: [45, 60, 90],
  rounds: [2, 3, 4, 6],
  deck: ['general', 'crypto', 'mixed'],
} as const;

export const DEFAULT_FORBIDDEN_SETTINGS: ForbiddenSettings = { turnSeconds: 60, rounds: 3, deck: 'mixed' };
export const FORBIDDEN_TIMING = { readySeconds: 12, betweenSeconds: 6 } as const;
export const MAX_FORBIDDEN_CLUE = 80;

export function validForbiddenSettings(x: unknown): x is ForbiddenSettings {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return (
    (FORBIDDEN_OPTIONS.turnSeconds as readonly unknown[]).includes(s.turnSeconds) &&
    (FORBIDDEN_OPTIONS.rounds as readonly unknown[]).includes(s.rounds) &&
    (FORBIDDEN_OPTIONS.deck as readonly unknown[]).includes(s.deck)
  );
}

export type ForbiddenPhase = 'lobby' | 'ready' | 'turn' | 'between' | 'finished';
export type CardResult = 'got' | 'guessed' | 'skip' | 'buzz' | 'said';

export type ForbiddenClientMessage =
  | { t: 'start' }
  | { t: 'settings'; settings: ForbiddenSettings }
  | { t: 'team'; team: Team }
  /** Host: shuffle everyone into new teams. */
  | { t: 'shuffle' }
  /** Describer: start the turn now. */
  | { t: 'go' }
  /** Describer: their team said it out loud. */
  | { t: 'got' }
  | { t: 'skip' }
  /** Opponent: the describer said a banned word. */
  | { t: 'buzz' }
  /** Describer: a typed clue (checked for banned words). */
  | { t: 'clue'; text: string }
  /** Anyone: chat. The describer's teammates' messages count as guesses. */
  | { t: 'chat'; text: string };

export interface ForbiddenPlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  host: boolean;
  team: Team;
}

export interface ForbiddenStateMessage {
  t: 'state';
  now: number;
  phase: ForbiddenPhase;
  players: ForbiddenPlayerView[];
  settings: ForbiddenSettings;
  teamScores: [number, number];
  round: number;
  activeTeam: Team;
  describerId: string | null;
  /** The card: only for the describer and the other team. */
  card: { word: string; banned: string[] } | null;
  endsAt: number | null;
  /** Cards finished this turn (words are public once resolved). */
  log: { word: string; result: CardResult; by?: string }[];
}

export type ForbiddenServerMessage =
  | ForbiddenStateMessage
  | { t: 'clue'; text: string }
  | { t: 'chat'; kind: 'guess' | 'system' | 'correct' | 'close' | 'private'; name?: string; text: string };
