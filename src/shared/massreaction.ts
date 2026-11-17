/** Mass Reaction messages. Shared by browser and server. */

export interface MassSettings {
  /** Share of the valid tappers cut each round, in percent. */
  cut: number;
}

export const MASS_OPTIONS = { cut: [20, 30, 50] } as const;
export const DEFAULT_MASS_SETTINGS: MassSettings = { cut: 30 };
export const CUT_LABELS: Record<number, string> = { 20: 'Gentle 20%', 30: 'Normal 30%', 50: 'Brutal 50%' };

/** A tap faster than this after green can't be a reaction to it, so it counts as a false start. */
export const MIN_REACTION_MS = 100;

export function validMassSettings(x: unknown): x is MassSettings {
  if (!x || typeof x !== 'object') return false;
  return (MASS_OPTIONS.cut as readonly unknown[]).includes((x as Record<string, unknown>).cut);
}

/**
 * ready: round intro, taps ignored. wait: red, a tap is a false start.
 * go: green (announced with a small `go` message so it reaches everyone fast).
 * result: who made it.
 */
export type MassPhase = 'lobby' | 'ready' | 'wait' | 'go' | 'result' | 'finished';

export type MassClientMessage =
  | { t: 'start' }
  | { t: 'settings'; settings: MassSettings }
  /** `ms`: reaction time measured on the player's screen. `early`: tapped while the screen was still red. */
  | { t: 'tap'; ms?: number; early?: boolean }
  | { t: 'chat'; text: string };

export type TapStatus = 'safe' | 'slow' | 'early' | 'missed';

export interface MassRoundResult {
  round: number;
  /** Every player who was alive at the start of the round. */
  entries: { id: string; ms: number | null; status: TapStatus }[];
  fastestId: string | null;
  /** Nobody tapped validly, so nobody was cut and the round is replayed. */
  replay: boolean;
}

export interface MassPlayerView {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  host: boolean;
  alive: boolean;
  /** Round the player was knocked out in (null while alive or before playing). */
  outRound: number | null;
  best: number | null;
}

export interface MassStateMessage {
  t: 'state';
  now: number;
  phase: MassPhase;
  players: MassPlayerView[];
  settings: MassSettings;
  round: number;
  /** End of the ready countdown or result screen (never revealed for the red wait). */
  endsAt: number | null;
  last: MassRoundResult | null;
  /** What you did this round. */
  me: { tapped: boolean; early: boolean; ms: number | null };
}

export type MassServerMessage = MassStateMessage | { t: 'go'; round: number };
