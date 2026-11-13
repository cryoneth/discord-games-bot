/** Odd One Out messages. Shared by browser and server. */

export type Deck = 'general' | 'crypto' | 'mixed';

export interface OddSettings {
  rounds: number;
  /** How many times each player gives a clue per round. */
  clueRounds: number;
  clueSeconds: number;
  deck: Deck;
}

export const ODD_OPTIONS = {
  rounds: [3, 5, 8],
  clueRounds: [1, 2],
  clueSeconds: [20, 30, 45],
  deck: ['general', 'crypto', 'mixed'],
} as const;

export const DECK_LABELS: Record<Deck, string> = { general: '🌍 General', crypto: '🪙 Crypto & DeFi', mixed: '🎲 Mixed' };

export const DEFAULT_ODD_SETTINGS: OddSettings = { rounds: 5, clueRounds: 2, clueSeconds: 30, deck: 'mixed' };

export const ODD_TIMING = { voteSeconds: 60, guessSeconds: 20, revealSeconds: 9 } as const;
export const ODD_POINTS = { escaped: 300, stoleWord: 150, caught: 100, spotted: 50 } as const;
export const MAX_CLUE_LENGTH = 30;

export function validOddSettings(x: unknown): x is OddSettings {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return (
    (ODD_OPTIONS.rounds as readonly unknown[]).includes(s.rounds) &&
    (ODD_OPTIONS.clueRounds as readonly unknown[]).includes(s.clueRounds) &&
    (ODD_OPTIONS.clueSeconds as readonly unknown[]).includes(s.clueSeconds) &&
    (ODD_OPTIONS.deck as readonly unknown[]).includes(s.deck)
  );
}

export type OddPhase = 'lobby' | 'clues' | 'vote' | 'guess' | 'reveal' | 'finished';

export type OddClientMessage =
  | { t: 'start' }
  | { t: 'settings'; settings: OddSettings }
  | { t: 'clue'; text: string }
  | { t: 'vote'; target: string }
  | { t: 'guess'; text: string }
  | { t: 'chat'; text: string };

export interface OddPlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  host: boolean;
  /** Playing this round (late joiners sit out until the next one). */
  inRound: boolean;
  voted: boolean;
}

export interface OddClue {
  id: string;
  /** 1-based clue round. */
  pass: number;
  text: string;
}

export interface OddReveal {
  oddId: string;
  majorityWord: string;
  oddWord: string;
  votes: Record<string, string>;
  caught: boolean;
  guess: string | null;
  stole: boolean;
  gains: Record<string, number>;
}

export interface OddStateMessage {
  t: 'state';
  now: number;
  phase: OddPhase;
  players: OddPlayerView[];
  settings: OddSettings;
  round: number;
  pass: number;
  /** Your secret word this round (null if you sit out). */
  word: string | null;
  turnId: string | null;
  clues: OddClue[];
  endsAt: number | null;
  myVote: string | null;
  /** During the guess phase: the player who was voted out and gets one guess. */
  guesserId: string | null;
  reveal: OddReveal | null;
}
