import { WORDS } from '../games/data/words.js';
import {
  CANVAS_H,
  CANVAS_W,
  COLORS,
  DEFAULT_SETTINGS,
  LIMITS,
  POINTS_MODE_MAX_MINUTES,
  TIMING,
  validSettings,
  WIDTHS,
  type ChatKind,
  type GameSettings,
  type ClientMessage,
  type Phase,
  type ServerMessage,
  type StateMessage,
  type StrokeChunk,
} from '../shared/sketch.js';
import { shuffle } from '../util/random.js';

export interface Conn {
  send(msg: ServerMessage): void;
}

interface Player {
  id: string;
  name: string;
  score: number;
  guessed: boolean;
  conns: Set<Conn>;
}

export interface RoomResult {
  userId: string;
  points: number;
  won: boolean;
}

export interface RoomHooks {
  onGameEnd(room: Room, results: RoomResult[]): void;
  /** Who the host is, when the room runs inside a hub. */
  hostId?(): string | null;
}

export interface RoomTiming {
  chooseMs: number;
  revealMs: number;
  /** Length of one "second" for settings-based durations (draw time, time limit). Tests shrink it. */
  secondMs: number;
}

const DEFAULT_TIMING: RoomTiming = {
  chooseMs: TIMING.chooseSeconds * 1000,
  revealMs: TIMING.revealSeconds * 1000,
  secondMs: 1000,
};

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeGuess(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Strip control characters and trim to a max length. */
export function cleanText(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, max);
}

export function validStroke(s: unknown): s is StrokeChunk {
  if (!s || typeof s !== 'object') return false;
  const { id, c, w, p } = s as Record<string, unknown>;
  if (!Number.isInteger(id) || (id as number) < 0 || (id as number) > 1e9) return false;
  if (!Number.isInteger(c) || (c as number) < 0 || (c as number) >= COLORS.length) return false;
  if (!Number.isInteger(w) || (w as number) < 0 || (w as number) >= WIDTHS.length) return false;
  if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0 || p.length > LIMITS.maxPointsPerChunk * 2) return false;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], y = p[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < -50 || x > CANVAS_W + 50 || y < -50 || y > CANVAS_H + 50) return false;
  }
  return true;
}

/**
 * One drawing game, bound to a single Discord Activity instance.
 * All state is in memory and is discarded when the room is disposed.
 */
export class Room {
  private readonly players = new Map<string, Player>();
  /** Join order; used for host selection and turn order. */
  private order: string[] = [];
  private phase: Phase = 'lobby';
  private round = 0;
  private queue: string[] = [];
  private drawerId: string | null = null;
  private word = '';
  private choices: string[] = [];
  private revealed = new Set<number>();
  private endsAt: number | null = null;
  private turnStarted = 0;
  private strokes: StrokeChunk[] = [];
  private timers: NodeJS.Timeout[] = [];
  private recentWords: string[] = [];
  private settings: GameSettings = { ...DEFAULT_SETTINGS };
  private turn = 0;
  private gameStarted = 0;
  private gameEndsAt: number | null = null;
  private gameTimer: NodeJS.Timeout | null = null;
  lastActivity = Date.now();

  constructor(
    readonly instanceId: string,
    readonly guildId: string | null,
    readonly channelId: string | null,
    private readonly hooks: RoomHooks,
    private readonly timing: RoomTiming = DEFAULT_TIMING,
  ) {}

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.conns.size > 0) n++;
    return n;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /** Between games, so the host may switch to another game. */
  get idle(): boolean {
    return this.phase === 'lobby' || this.phase === 'finished';
  }

  /** Returns false if the room is full. */
  join(user: { id: string; name: string }, conn: Conn): boolean {
    let player = this.players.get(user.id);
    if (!player) {
      if (this.players.size >= LIMITS.maxPlayers) return false;
      player = { id: user.id, name: user.name, score: 0, guessed: false, conns: new Set() };
      this.players.set(user.id, player);
      this.order.push(user.id);
    }
    player.name = user.name;
    const wasConnected = player.conns.size > 0;
    player.conns.add(conn);
    this.lastActivity = Date.now();

    conn.send({ t: 'welcome', you: user.id });
    conn.send({ t: 'canvas', strokes: this.phase === 'drawing' ? this.strokes : [] });
    if (this.phase === 'choosing' && this.drawerId === user.id) {
      conn.send({ t: 'choices', words: this.choices, endsAt: this.endsAt ?? Date.now() });
    }
    if (!wasConnected) this.system(`${player.name} joined.`);
    this.broadcastState();
    return true;
  }

  leave(userId: string, conn: Conn): void {
    const player = this.players.get(userId);
    if (!player) return;
    player.conns.delete(conn);
    if (player.conns.size > 0) return;

    this.system(`${player.name} left.`);
    if (this.phase === 'lobby' || this.phase === 'finished') {
      // Nobody owes them points in the lobby; forget them entirely.
      this.players.delete(userId);
      this.order = this.order.filter((id) => id !== userId);
    } else if (this.connectedCount < 2) {
      this.system('Not enough players left. Back to the lobby.');
      this.toLobby();
      return;
    } else if (userId === this.drawerId) {
      this.system('The drawer left, skipping the turn.');
      this.endTurn();
      return;
    } else if (this.phase === 'drawing') {
      this.maybeEndEarly();
    }
    this.broadcastState();
  }

  handle(userId: string, msg: ClientMessage): void {
    const player = this.players.get(userId);
    if (!player) return;
    this.lastActivity = Date.now();
    switch (msg.t) {
      case 'start':
        return this.start(userId);
      case 'end':
        if (this.idle || !this.isHost(userId)) return;
        this.system(`${player.name} ended the game.`);
        this.toLobby();
        return;
      case 'settings':
        return this.updateSettings(userId, msg.settings);
      case 'pick':
        if (this.phase === 'choosing' && userId === this.drawerId && Number.isInteger(msg.index)) {
          const word = this.choices[msg.index];
          if (word) this.beginDrawing(word);
        }
        return;
      case 'stroke': {
        if (this.phase !== 'drawing' || userId !== this.drawerId || !validStroke(msg.s)) return;
        if (this.strokes.length >= LIMITS.maxStrokeChunks) return;
        const s: StrokeChunk = { id: msg.s.id, c: msg.s.c, w: msg.s.w, p: msg.s.p.map((n) => Math.round(n)) };
        this.strokes.push(s);
        this.broadcast({ t: 'stroke', s }, userId);
        return;
      }
      case 'undo': {
        if (this.phase !== 'drawing' || userId !== this.drawerId || this.strokes.length === 0) return;
        const lastId = this.strokes[this.strokes.length - 1]!.id;
        this.strokes = this.strokes.filter((s) => s.id !== lastId);
        this.broadcast({ t: 'canvas', strokes: this.strokes });
        return;
      }
      case 'clear':
        if (this.phase !== 'drawing' || userId !== this.drawerId) return;
        this.strokes = [];
        this.broadcast({ t: 'canvas', strokes: [] });
        return;
      case 'guess':
        return this.guess(player, cleanText(msg.text, LIMITS.maxGuessLength));
    }
  }

  dispose(): void {
    this.clearTimers();
    this.clearGameTimer();
    this.players.clear();
    this.strokes = [];
  }

  // ── Game flow ────────────────────────────────────────────────────────────

  private isHost(userId: string): boolean {
    return this.hostId() === userId;
  }

  private hostId(): string | null {
    if (this.hooks.hostId) return this.hooks.hostId();
    return this.order.find((id) => (this.players.get(id)?.conns.size ?? 0) > 0) ?? null;
  }

  private start(userId: string): void {
    if (this.phase !== 'lobby' && this.phase !== 'finished') return;
    if (!this.isHost(userId)) return this.direct(userId, 'Only the host can start the game.');
    if (this.connectedCount < 2) return this.direct(userId, 'You need at least 2 players to start.');
    for (const id of [...this.players.keys()]) {
      const p = this.players.get(id)!;
      if (p.conns.size === 0) {
        this.players.delete(id);
        this.order = this.order.filter((o) => o !== id);
      } else {
        p.score = 0;
      }
    }
    this.round = 1;
    this.turn = 0;
    this.queue = this.connectedOrder();
    this.gameStarted = Date.now();
    this.clearGameTimer();
    const { mode, value } = this.settings;
    if (mode === 'time') {
      const ms = value * 60 * this.timing.secondMs;
      this.gameEndsAt = this.gameStarted + ms;
      this.gameTimer = setTimeout(() => {
        if (this.phase === 'choosing' || this.phase === 'drawing') this.system("⏰ Time's up! This is the last turn.");
        this.broadcastState();
      }, ms);
    } else {
      this.gameEndsAt = null;
    }
    const goal =
      mode === 'rounds'
        ? `${value} round${value === 1 ? '' : 's'}, everyone draws once per round.`
        : mode === 'time'
          ? `${value} minutes on the clock.`
          : `first to ${value} points wins.`;
    this.system(`Game on! ${goal}`);
    this.nextTurn();
  }

  private updateSettings(userId: string, settings: unknown): void {
    if (this.phase !== 'lobby' && this.phase !== 'finished') return;
    if (!this.isHost(userId)) return this.direct(userId, 'Only the host can change the game settings.');
    if (!validSettings(settings)) return;
    this.settings = { mode: settings.mode, value: settings.value, drawSeconds: settings.drawSeconds };
    this.broadcastState();
  }

  /** Whether the game should end instead of starting another turn. */
  private goalReached(): boolean {
    const { mode, value } = this.settings;
    if (mode === 'time') return this.gameEndsAt !== null && Date.now() >= this.gameEndsAt;
    if (mode === 'points') {
      if ([...this.players.values()].some((p) => p.score >= value)) return true;
      return Date.now() - this.gameStarted >= POINTS_MODE_MAX_MINUTES * 60 * this.timing.secondMs;
    }
    return false; // rounds mode ends when the queue runs out in the last round
  }

  private get drawMs(): number {
    return this.settings.drawSeconds * this.timing.secondMs;
  }

  private get totalRounds(): number {
    return this.settings.mode === 'rounds' ? this.settings.value : 0;
  }

  private clearGameTimer(): void {
    if (this.gameTimer) clearTimeout(this.gameTimer);
    this.gameTimer = null;
  }

  private connectedOrder(): string[] {
    return this.order.filter((id) => (this.players.get(id)?.conns.size ?? 0) > 0);
  }

  private nextTurn(): void {
    this.clearTimers();
    for (const p of this.players.values()) p.guessed = false;
    this.strokes = [];
    this.word = '';
    this.revealed.clear();

    if (this.turn > 0 && this.goalReached()) return this.finish();

    let next: string | undefined;
    while (!next) {
      if (this.queue.length === 0) {
        this.round++;
        if (this.settings.mode === 'rounds' && this.round > this.settings.value) return this.finish();
        this.queue = this.connectedOrder();
        if (this.queue.length < 2) return this.toLobby();
      }
      const candidate = this.queue.shift()!;
      if ((this.players.get(candidate)?.conns.size ?? 0) > 0) next = candidate;
    }

    this.turn++;
    this.drawerId = next;
    this.phase = 'choosing';
    const available = WORDS.filter((w) => !this.recentWords.includes(w));
    this.choices = shuffle(available).slice(0, 3);
    this.endsAt = Date.now() + this.timing.chooseMs;
    this.broadcast({ t: 'canvas', strokes: [] });
    this.sendTo(next, { t: 'choices', words: this.choices, endsAt: this.endsAt });
    this.broadcastState();
    this.later(this.timing.chooseMs, () => {
      if (this.phase === 'choosing') this.beginDrawing(this.choices[Math.floor(Math.random() * this.choices.length)]!);
    });
  }

  private beginDrawing(word: string): void {
    this.clearTimers();
    this.word = word;
    this.recentWords = [...this.recentWords, word].slice(-60);
    this.phase = 'drawing';
    this.turnStarted = Date.now();
    this.endsAt = this.turnStarted + this.drawMs;
    this.broadcastState();
    // Reveal letters at 50% and 75% of the time (never the whole word).
    const letters = [...word].map((ch, i) => (ch === ' ' ? -1 : i)).filter((i) => i >= 0);
    const reveals = Math.min(2, Math.max(0, letters.length - 2));
    const order = shuffle(letters);
    for (let r = 0; r < reveals; r++) {
      this.later(this.drawMs * (0.5 + 0.25 * r), () => {
        this.revealed.add(order[r]!);
        this.broadcastState();
      });
    }
    this.later(this.drawMs, () => this.endTurn());
  }

  private guess(player: Player, text: string): void {
    if (!text) return;
    if (this.phase !== 'drawing') {
      // Free chat outside of drawing turns.
      this.broadcast({ t: 'chat', kind: 'guess', name: player.name, text });
      return;
    }
    if (player.id === this.drawerId) return this.direct(player.id, "You're drawing — no hints in chat!");

    if (player.guessed) {
      // Players who already know the word only chat among themselves.
      for (const p of this.players.values()) {
        if (p.guessed || p.id === this.drawerId) this.sendTo(p.id, { t: 'chat', kind: 'private', name: player.name, text });
      }
      return;
    }

    const g = normalizeGuess(text);
    const target = normalizeGuess(this.word);
    if (g === target) {
      player.guessed = true;
      const remaining = Math.max(0, (this.endsAt ?? 0) - Date.now()) / this.drawMs;
      player.score += 50 + Math.round(100 * remaining);
      const drawer = this.drawerId ? this.players.get(this.drawerId) : undefined;
      if (drawer) drawer.score += 25;
      this.broadcast({ t: 'chat', kind: 'correct', text: `${player.name} guessed the word!` });
      this.maybeEndEarly();
      this.broadcastState();
      return;
    }
    this.broadcast({ t: 'chat', kind: 'guess', name: player.name, text });
    if (target.length >= 4 && levenshtein(g, target) === 1) {
      this.sendTo(player.id, { t: 'chat', kind: 'close', text: `"${text}" is very close!` });
    }
  }

  private maybeEndEarly(): void {
    const guessers = [...this.players.values()].filter((p) => p.id !== this.drawerId && p.conns.size > 0);
    if (guessers.length > 0 && guessers.every((p) => p.guessed)) this.endTurn();
  }

  private endTurn(): void {
    if (this.phase !== 'drawing' && this.phase !== 'choosing') return;
    this.clearTimers();
    const word = this.word || this.choices[0] || '';
    this.word = word;
    this.phase = 'reveal';
    this.endsAt = Date.now() + this.timing.revealMs;
    if (word) this.system(`The word was "${word}".`);
    this.broadcastState();
    this.later(this.timing.revealMs, () => this.nextTurn());
  }

  private finish(): void {
    this.clearTimers();
    this.clearGameTimer();
    this.gameEndsAt = null;
    this.phase = 'finished';
    this.drawerId = null;
    this.endsAt = null;
    this.word = '';
    const ranking = [...this.players.values()].sort((a, b) => b.score - a.score);
    const top = ranking[0]?.score ?? 0;
    this.system(ranking[0] && top > 0 ? `🏆 ${ranking[0].name} wins with ${top} points!` : 'Game over!');
    this.broadcastState();
    try {
      this.hooks.onGameEnd(
        this,
        ranking.map((p) => ({ userId: p.id, points: p.score, won: p.score === top && top > 0 })),
      );
    } catch {
      /* hooks must never break the room */
    }
  }

  private toLobby(): void {
    this.clearTimers();
    this.clearGameTimer();
    this.gameEndsAt = null;
    this.phase = 'lobby';
    this.drawerId = null;
    this.endsAt = null;
    this.word = '';
    this.strokes = [];
    this.broadcast({ t: 'canvas', strokes: [] });
    this.broadcastState();
  }

  // ── Messaging ────────────────────────────────────────────────────────────

  private stateFor(userId: string): StateMessage {
    const hostId = this.hostId();
    const showWord = this.phase === 'reveal' || (userId === this.drawerId && this.phase === 'drawing');
    const hint =
      this.phase === 'drawing' || this.phase === 'reveal'
        ? [...this.word].map((ch, i) => (ch === ' ' ? ' ' : showWord || this.revealed.has(i) ? ch : '_')).join(' ')
        : '';
    return {
      t: 'state',
      now: Date.now(),
      phase: this.phase,
      players: this.order
        .map((id) => this.players.get(id)!)
        .filter(Boolean)
        .map((p) => ({ id: p.id, name: p.name, score: p.score, guessed: p.guessed, connected: p.conns.size > 0, host: p.id === hostId })),
      drawerId: this.drawerId,
      round: this.settings.mode === 'rounds' ? Math.min(this.round, this.totalRounds) : this.turn,
      totalRounds: this.totalRounds,
      turn: this.turn,
      settings: this.settings,
      gameEndsAt: this.gameEndsAt,
      hint,
      ...(showWord && this.word ? { word: this.word } : {}),
      endsAt: this.endsAt,
    };
  }

  private broadcastState(): void {
    for (const p of this.players.values()) {
      if (p.conns.size === 0) continue;
      const state = this.stateFor(p.id);
      for (const c of p.conns) c.send(state);
    }
  }

  private broadcast(msg: ServerMessage, exceptUserId?: string): void {
    for (const p of this.players.values()) {
      if (p.id === exceptUserId) continue;
      for (const c of p.conns) c.send(msg);
    }
  }

  private sendTo(userId: string, msg: ServerMessage): void {
    const p = this.players.get(userId);
    if (p) for (const c of p.conns) c.send(msg);
  }

  private system(text: string, kind: ChatKind = 'system'): void {
    this.broadcast({ t: 'chat', kind, text });
  }

  private direct(userId: string, text: string): void {
    this.sendTo(userId, { t: 'chat', kind: 'private', text });
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
