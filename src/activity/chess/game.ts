import { Chess } from 'chess.js';
import {
  FIRST_MOVE_MS,
  isUci,
  MAX_DRAW_OFFERS,
  parseTc,
  type BoardSummary,
  type BoardView,
  type Color,
  type EndReason,
  type GameResult,
  type MyBoardView,
  type TimeControl,
} from '../../shared/chess.js';
import { log } from '../../util/log.js';

export interface ChessPlayer {
  id: string;
  name: string;
}

export interface GameOptions {
  id: string;
  white: ChessPlayer;
  black: ChessPlayer;
  tc: TimeControl;
  tourneyId?: string | null;
  now?: () => number;
  /** Tests turn timers off and call `check()` themselves. */
  timers?: boolean;
  /** Something visible changed (a move, an offer, the end). */
  onChange(game: ChessGame): void;
  /** Called once, when the game ends for any reason. */
  onEnd(game: ChessGame): void;
}

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/**
 * One chess game with Lichess-style clocks: each side gets FIRST_MOVE_MS for
 * their first move, then the clocks run from move 2 with an increment after
 * every move. Rules (legality, mate, draws) come from chess.js. In memory only.
 */
export class ChessGame {
  readonly id: string;
  readonly white: ChessPlayer;
  readonly black: ChessPlayer;
  readonly tc: TimeControl;
  readonly tourneyId: string | null;
  readonly createdAt: number;
  result: GameResult = '*';
  reason: EndReason | null = null;
  /** Who is online in the Activity (kept up to date by the owner). */
  online = { w: true, b: true };
  /** Arena points scored, set by the tournament when the game ends. */
  points: { w: number; b: number } | undefined;
  private readonly chess = new Chess();
  private readonly incMs: number;
  private clocks: { w: number; b: number };
  private berserked = { w: false, b: false };
  private turnStart: number;
  private drawOffer: Color | null = null;
  private offers = { w: 0, b: 0 };
  private last: [string, string] | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: GameOptions) {
    this.id = opts.id;
    this.white = opts.white;
    this.black = opts.black;
    this.tc = opts.tc;
    this.tourneyId = opts.tourneyId ?? null;
    this.now = opts.now ?? Date.now;
    const { baseMs, incMs } = parseTc(opts.tc);
    this.incMs = incMs;
    this.clocks = { w: baseMs, b: baseMs };
    this.createdAt = this.turnStart = this.now();
    this.schedule();
  }

  get over(): boolean {
    return this.result !== '*' || this.reason !== null;
  }

  get plies(): number {
    return this.chess.history().length;
  }

  get turn(): Color {
    return this.chess.turn();
  }

  /** Clocks only run once both sides have made a move. */
  get running(): boolean {
    return this.plies >= 2 && !this.over;
  }

  colorOf(userId: string): Color | null {
    return userId === this.white.id ? 'w' : userId === this.black.id ? 'b' : null;
  }

  playerOf(c: Color): ChessPlayer {
    return c === 'w' ? this.white : this.black;
  }

  berserkOf(c: Color): boolean {
    return this.berserked[c];
  }

  /** Remaining clock for one side right now. */
  clock(c: Color, now = this.now()): number {
    if (this.running && this.turn === c) return Math.max(0, this.clocks[c] - (now - this.turnStart));
    return this.clocks[c];
  }

  /** Plays a UCI move for `userId`. Returns an error message, or null if it was played. */
  move(userId: string, uci: string): string | null {
    if (this.check()) return 'The game is over.';
    const color = this.colorOf(userId);
    if (!color) return "You're not playing this game.";
    if (color !== this.turn) return "It's not your turn.";
    if (!isUci(uci)) return 'That move is not valid.';
    const now = this.now();
    let played;
    try {
      played = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
    } catch {
      return 'That move is not legal.';
    }
    if (this.plies > 2) {
      // Clock was running for this move.
      this.clocks[color] = Math.max(0, this.clocks[color] - (now - this.turnStart)) + this.incMs;
    }
    this.turnStart = now;
    this.last = [played.from, played.to];
    // Moving answers (declines) a draw offer from the other side.
    if (this.drawOffer === other(color)) this.drawOffer = null;
    if (this.chess.isGameOver()) this.finishByRules();
    else {
      this.schedule();
      this.opts.onChange(this);
    }
    return null;
  }

  resign(userId: string): void {
    const c = this.colorOf(userId);
    if (!c || this.check()) return;
    // Before both sides have moved, leaving is just an abort (no result), except in tournaments.
    if (this.plies < 2 && !this.tourneyId) return this.end('*', 'aborted');
    this.end(c === 'w' ? '0-1' : '1-0', 'resign');
  }

  /** Offer a draw, or accept/decline the opponent's offer. */
  draw(userId: string, accept?: boolean): string | null {
    const c = this.colorOf(userId);
    if (!c || this.check()) return null;
    if (this.drawOffer === other(c)) {
      if (accept === false) {
        this.drawOffer = null;
        this.opts.onChange(this);
        return null;
      }
      this.end('1/2-1/2', 'agreement');
      return null;
    }
    if (accept === false || this.drawOffer === c) return null;
    if (this.plies < 2) return 'Make a move first.';
    if (this.offers[c] >= MAX_DRAW_OFFERS) return 'You have no draw offers left in this game.';
    this.offers[c]++;
    this.drawOffer = c;
    this.opts.onChange(this);
    return null;
  }

  canBerserk(c: Color): boolean {
    return Boolean(this.tourneyId) && !this.over && !this.berserked[c] && this.chess.history().length < (c === 'w' ? 1 : 2);
  }

  /** Tournament only, before your first move: halve your clock and drop the increment for an extra point if you win. */
  berserk(userId: string): void {
    const c = this.colorOf(userId);
    if (!c || !this.canBerserk(c)) return;
    this.berserked[c] = true;
    this.clocks[c] = Math.ceil(this.clocks[c] / 2);
    this.opts.onChange(this);
  }

  /** A moderator decides the game. */
  decide(verdict: 'abort' | '1-0' | '0-1' | 'draw'): void {
    if (this.over) return;
    if (verdict === 'abort') this.end('*', 'aborted');
    else this.end(verdict === 'draw' ? '1/2-1/2' : verdict, 'moderator');
  }

  /** The side gave up by leaving: a loss, or an abort before it really started (casual only). */
  abandon(c: Color): void {
    if (this.check()) return;
    if (this.plies < 2 && !this.tourneyId) return this.end('*', 'aborted');
    this.end(c === 'w' ? '0-1' : '1-0', 'abandon');
  }

  /** Ends the game on a flag or a missed first move. Returns whether it's over. */
  check(now = this.now()): boolean {
    if (this.over) return true;
    if (this.plies < 2) {
      if (now - this.turnStart >= FIRST_MOVE_MS) {
        const c = this.turn;
        // Casual: just abort. Tournament: whoever didn't move loses (Lichess arena rules).
        if (this.tourneyId) this.end(c === 'w' ? '0-1' : '1-0', 'nostart');
        else this.end('*', 'aborted');
        return true;
      }
      return false;
    }
    const c = this.turn;
    if (this.clock(c, now) <= 0) {
      this.clocks[c] = 0;
      // Lichess: flagging against a lone king (or anything that can't mate) is a draw.
      this.end(this.canMate(other(c)) ? (c === 'w' ? '0-1' : '1-0') : '1/2-1/2', 'timeout');
      return true;
    }
    return false;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ── Views ────────────────────────────────────────────────────────────────

  view(now = this.now()): BoardView {
    const first = this.plies < 2 && !this.over ? this.turnStart + FIRST_MOVE_MS : null;
    const side = (c: Color) => {
      const p = this.playerOf(c);
      return { id: p.id, name: p.name, clock: this.clock(c, now), berserk: this.berserked[c], online: this.online[c] };
    };
    return {
      id: this.id,
      now,
      white: side('w'),
      black: side('b'),
      fen: this.chess.fen(),
      turn: this.turn,
      moves: this.chess.history(),
      last: this.last,
      check: this.chess.inCheck(),
      running: this.running,
      firstMoveBy: first,
      drawOffer: this.drawOffer,
      result: this.result,
      reason: this.reason,
      tc: this.tc,
      tourneyId: this.tourneyId,
      ...(this.points ? { points: this.points } : {}),
    };
  }

  viewFor(userId: string, now = this.now()): MyBoardView | BoardView {
    const base = this.view(now);
    const c = this.colorOf(userId);
    if (!c) return base;
    const legal = !this.over && this.turn === c ? this.chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? '')) : [];
    return { ...base, color: c, legal, canBerserk: this.canBerserk(c) };
  }

  summary(): BoardSummary {
    return { id: this.id, white: this.white.name, black: this.black.name, tc: this.tc, tourneyId: this.tourneyId, moves: Math.ceil(this.plies / 2) };
  }

  /** Score from one side's point of view. */
  outcomeFor(c: Color): 'win' | 'draw' | 'loss' | null {
    if (this.result === '*') return null;
    if (this.result === '1/2-1/2') return 'draw';
    return (this.result === '1-0') === (c === 'w') ? 'win' : 'loss';
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private finishByRules(): void {
    const c = this.chess;
    if (c.isCheckmate()) return this.end(c.turn() === 'w' ? '0-1' : '1-0', 'checkmate');
    if (c.isStalemate()) return this.end('1/2-1/2', 'stalemate');
    if (c.isInsufficientMaterial()) return this.end('1/2-1/2', 'insufficient');
    if (c.isThreefoldRepetition()) return this.end('1/2-1/2', 'repetition');
    return this.end('1/2-1/2', 'fifty');
  }

  /** Whether `c` has any material that could ever mate. */
  private canMate(c: Color): boolean {
    let minors = 0;
    for (const row of this.chess.board()) {
      for (const sq of row) {
        if (!sq || sq.color !== c || sq.type === 'k') continue;
        if (sq.type === 'p' || sq.type === 'q' || sq.type === 'r') return true;
        minors++;
      }
    }
    return minors >= 2;
  }

  private end(result: GameResult, reason: EndReason): void {
    if (this.over) return;
    // Freeze the clock of the side that was thinking.
    if (this.plies >= 2) this.clocks[this.turn] = this.clock(this.turn);
    this.result = result;
    this.reason = reason;
    this.drawOffer = null;
    this.dispose();
    try {
      this.opts.onEnd(this);
    } catch (err) {
      log.error('Chess game end hook failed', err);
    }
    this.opts.onChange(this);
  }

  private schedule(): void {
    if (this.opts.timers === false) return;
    if (this.timer) clearTimeout(this.timer);
    const wait = this.plies < 2 ? this.turnStart + FIRST_MOVE_MS - this.now() : this.clock(this.turn);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        try {
          if (!this.check()) this.schedule();
        } catch (err) {
          log.error('Chess clock failed', err);
        }
      },
      Math.max(50, wait + 20),
    );
    this.timer.unref?.();
  }
}
