import {
  DEFAULT_FORBIDDEN_SETTINGS,
  FORBIDDEN_TIMING,
  MAX_FORBIDDEN_CLUE,
  TEAM_NAMES,
  validForbiddenSettings,
  type CardResult,
  type ForbiddenPhase,
  type ForbiddenServerMessage,
  type ForbiddenSettings,
  type ForbiddenStateMessage,
  type Team,
} from '../../shared/forbidden.js';
import { shuffle } from '../../util/random.js';
import { BaseRoom, type RoomContext, type Seat } from '../base.js';
import { CRYPTO_CARDS, GENERAL_CARDS } from '../data/forbidden.js';
import { cleanText, normalizeGuess } from '../room.js';
import { sameWord } from './oddoneout.js';

interface ForbiddenSeat extends Seat {
  team: Team;
}

type Card = { word: string; banned: string[] };

export interface ForbiddenTiming {
  secondMs: number;
  readyMs: number;
  betweenMs: number;
}

const DEFAULT_TIMING: ForbiddenTiming = {
  secondMs: 1000,
  readyMs: FORBIDDEN_TIMING.readySeconds * 1000,
  betweenMs: FORBIDDEN_TIMING.betweenSeconds * 1000,
};

/** Whether `text` uses the word or one of its banned words (whole-word match, ignoring plurals). */
export function usesForbidden(text: string, card: Card): string | null {
  const words = normalizeGuess(text).split(' ');
  const stem = (w: string) => w.replace(/(es|s)$/, '');
  const said = new Set(words.flatMap((w) => [w, stem(w)]));
  const joined = ` ${words.join(' ')} `;
  for (const term of [card.word, ...card.banned]) {
    const t = normalizeGuess(term);
    if (!t) continue;
    if (t.includes(' ') ? joined.includes(` ${t} `) : said.has(t) || said.has(stem(t))) return term;
  }
  return null;
}

/**
 * Two teams take turns. The describer explains a word (out loud in voice, or
 * typed) without its banned words while their team guesses; the other team
 * watches the card and buzzes if a banned word slips out.
 */
export class ForbiddenRoom extends BaseRoom<ForbiddenSeat> {
  protected readonly minPlayers = 4;
  protected readonly maxPlayers = 16;
  private phase: ForbiddenPhase = 'lobby';
  private settings: ForbiddenSettings = { ...DEFAULT_FORBIDDEN_SETTINGS };
  private teamScores: [number, number] = [0, 0];
  private round = 0;
  private activeTeam: Team = 0;
  /** How many turns each team has had (to rotate describers). */
  private turnsTaken: [number, number] = [0, 0];
  private describerId: string | null = null;
  private deck: Card[] = [];
  private card: Card | null = null;
  private buzzed = false;
  private endsAt: number | null = null;
  private log: ForbiddenStateMessage['log'] = [];

  constructor(
    ctx: RoomContext,
    private readonly timing: ForbiddenTiming = DEFAULT_TIMING,
  ) {
    super(ctx);
  }

  get idle(): boolean {
    return this.phase === 'lobby' || this.phase === 'finished';
  }

  get currentPhase(): ForbiddenPhase {
    return this.phase;
  }

  /** For tests. */
  get currentCard(): Card | null {
    return this.card;
  }

  get scores(): [number, number] {
    return [...this.teamScores];
  }

  protected createSeat(user: { id: string; name: string }): ForbiddenSeat {
    const counts = [0, 0];
    for (const s of this.players.values()) counts[s.team]!++;
    return { ...user, score: 0, team: counts[0]! <= counts[1]! ? 0 : 1, conns: new Set() };
  }

  protected override applySettings(raw: unknown): boolean {
    if (!validForbiddenSettings(raw)) return false;
    this.settings = { turnSeconds: raw.turnSeconds, rounds: raw.rounds, deck: raw.deck };
    return true;
  }

  private teamMembers(team: Team): ForbiddenSeat[] {
    return this.connected().filter((s) => s.team === team);
  }

  protected override canStart(userId: string): boolean {
    if (this.teamMembers(0).length >= 2 && this.teamMembers(1).length >= 2) return true;
    this.direct(userId, 'Each team needs at least 2 players.');
    return false;
  }

  protected begin(): void {
    this.teamScores = [0, 0];
    this.turnsTaken = [0, 0];
    this.round = 1;
    this.activeTeam = Math.random() < 0.5 ? 0 : 1;
    const deck = this.settings.deck === 'general' ? GENERAL_CARDS : this.settings.deck === 'crypto' ? CRYPTO_CARDS : [...GENERAL_CARDS, ...CRYPTO_CARDS];
    this.deck = shuffle(deck);
    this.system(`🚫 ${this.settings.rounds} rounds. ${TEAM_NAMES[this.activeTeam]} goes first!`);
    this.nextTurn(true);
  }

  protected abort(): void {
    this.phase = 'lobby';
    this.describerId = null;
    this.card = null;
    this.endsAt = null;
    this.log = [];
  }

  protected onDeparture(seat: ForbiddenSeat): void {
    if (this.teamMembers(seat.team).length < 2) {
      this.system(`${TEAM_NAMES[seat.team]} is down to one player. Back to the lobby.`);
      this.clearTimers();
      this.abort();
      return;
    }
    if (seat.id === this.describerId && (this.phase === 'ready' || this.phase === 'turn')) {
      this.system('The describer left. Next turn.');
      this.clearTimers();
      if (this.phase === 'turn') this.endTurn();
      else this.nextTurn(false);
    }
  }

  protected override onChat(seat: ForbiddenSeat, text: string): void {
    if (this.phase === 'turn' && this.card) {
      if (seat.id === this.describerId) return this.clue(seat, text);
      if (seat.team === this.activeTeam) {
        if (sameWord(text, this.card.word)) {
          seat.score++;
          const describer = this.players.get(this.describerId!);
          if (describer) describer.score++;
          this.resolve('guessed', seat.name);
          return;
        }
        // Guesses go to everyone: the other team can enjoy the wrong ones.
        this.broadcast({ t: 'chat', kind: 'guess', name: seat.name, text } satisfies ForbiddenServerMessage);
        return;
      }
    }
    super.onChat(seat, text);
  }

  protected onMessage(seat: ForbiddenSeat, msg: { t: string } & Record<string, unknown>): void {
    switch (msg.t) {
      case 'team':
        if (!this.idle || (msg.team !== 0 && msg.team !== 1)) return;
        seat.team = msg.team;
        return this.broadcastState();
      case 'shuffle': {
        if (!this.idle || !this.isHost(seat.id)) return;
        shuffle([...this.players.values()]).forEach((s, i) => (s.team = (i % 2) as Team));
        return this.broadcastState();
      }
      case 'go':
        if (this.phase === 'ready' && seat.id === this.describerId) this.beginTurn();
        return;
      case 'got':
        if (this.phase === 'turn' && seat.id === this.describerId) {
          seat.score++;
          this.resolve('got', seat.name);
        }
        return;
      case 'skip':
        if (this.phase === 'turn' && seat.id === this.describerId) this.resolve('skip');
        return;
      case 'buzz':
        if (this.phase === 'turn' && seat.team !== this.activeTeam && !this.buzzed) {
          this.buzzed = true;
          this.resolve('buzz', seat.name);
        }
        return;
      case 'clue':
        if (this.phase === 'turn' && seat.id === this.describerId) this.clue(seat, cleanText(msg.text, MAX_FORBIDDEN_CLUE));
        return;
    }
  }

  private clue(seat: ForbiddenSeat, text: string): void {
    if (!text || !this.card) return;
    const hit = usesForbidden(text, this.card);
    if (hit) {
      this.direct(seat.id, `"${hit}" is on the card!`);
      this.resolve('said', seat.name);
      return;
    }
    this.broadcast({ t: 'clue', text } satisfies ForbiddenServerMessage);
  }

  // ── Flow ─────────────────────────────────────────────────────────────────

  private drawCard(): void {
    if (this.deck.length === 0) {
      const all = this.settings.deck === 'general' ? GENERAL_CARDS : this.settings.deck === 'crypto' ? CRYPTO_CARDS : [...GENERAL_CARDS, ...CRYPTO_CARDS];
      this.deck = shuffle(all);
    }
    this.card = this.deck.pop()!;
    this.buzzed = false;
  }

  private resolve(result: CardResult, by?: string): void {
    if (!this.card) return;
    if (result === 'got' || result === 'guessed') this.teamScores[this.activeTeam]++;
    if (result === 'buzz' || result === 'said') this.teamScores[this.activeTeam]--;
    this.log.push({ word: this.card.word, result, ...(by ? { by } : {}) });
    const text =
      result === 'guessed'
        ? `${by} got it: "${this.card.word}"! +1`
        : result === 'got'
          ? `✓ "${this.card.word}" +1`
          : result === 'skip'
            ? `Skipped "${this.card.word}".`
            : result === 'buzz'
              ? `🚨 ${by} buzzed! "${this.card.word}" −1`
              : `🚨 Banned word typed! "${this.card.word}" −1`;
    this.system(text, result === 'got' || result === 'guessed' ? 'correct' : 'system');
    this.drawCard();
    this.broadcastState();
  }

  private nextTurn(first: boolean): void {
    this.clearTimers();
    if (!first) {
      // Alternate teams; a round ends once both have played.
      this.activeTeam = (1 - this.activeTeam) as Team;
      if (this.turnsTaken[0] === this.turnsTaken[1]) this.round++;
    }
    if (this.round > this.settings.rounds) return this.finish();
    const members = this.teamMembers(this.activeTeam);
    if (members.length === 0) return this.finish();
    const describer = members[this.turnsTaken[this.activeTeam] % members.length]!;
    this.turnsTaken[this.activeTeam]++;
    this.describerId = describer.id;
    this.card = null;
    this.log = [];
    this.phase = 'ready';
    this.endsAt = Date.now() + this.timing.readyMs;
    this.broadcastState();
    this.later(this.timing.readyMs, () => this.beginTurn());
  }

  private beginTurn(): void {
    if (this.phase !== 'ready') return;
    this.clearTimers();
    this.phase = 'turn';
    this.drawCard();
    const ms = this.settings.turnSeconds * this.timing.secondMs;
    this.endsAt = Date.now() + ms;
    this.broadcastState();
    this.later(ms, () => this.endTurn());
  }

  private endTurn(): void {
    if (this.phase !== 'turn') return;
    this.clearTimers();
    this.phase = 'between';
    this.card = null;
    this.endsAt = Date.now() + this.timing.betweenMs;
    const got = this.log.filter((l) => l.result === 'got' || l.result === 'guessed').length;
    this.system(`⏰ Time! ${TEAM_NAMES[this.activeTeam]} scored ${got} this turn.`);
    this.broadcastState();
    this.later(this.timing.betweenMs, () => this.nextTurn(false));
  }

  private finish(): void {
    this.phase = 'finished';
    this.describerId = null;
    this.card = null;
    this.endsAt = null;
    const [a, b] = this.teamScores;
    const winner: Team | null = a === b ? null : a > b ? 0 : 1;
    this.system(winner === null ? `🤝 It's a tie, ${a} to ${b}!` : `🏆 ${TEAM_NAMES[winner]} wins ${Math.max(a, b)} to ${Math.min(a, b)}!`);
    this.broadcastState();
    const ranking = [...this.players.values()].sort((x, y) => this.teamScores[y.team] - this.teamScores[x.team] || y.score - x.score);
    this.reportResults(
      ranking,
      (s) => s.team === winner,
      (s) => Math.max(0, this.teamScores[s.team]) * 10 + s.score * 5,
    );
  }

  protected stateFor(userId: string): ForbiddenStateMessage {
    const seat = this.players.get(userId);
    const seesCard = this.phase === 'turn' && this.card && (userId === this.describerId || (seat && seat.team !== this.activeTeam));
    return {
      t: 'state',
      now: Date.now(),
      phase: this.phase,
      players: this.seatViews().map((v) => ({ ...v, team: this.players.get(v.id)!.team })),
      settings: this.settings,
      teamScores: this.teamScores,
      round: Math.min(this.round, this.settings.rounds),
      activeTeam: this.activeTeam,
      describerId: this.describerId,
      card: seesCard ? this.card : null,
      endsAt: this.endsAt,
      log: this.log,
    };
  }
}
