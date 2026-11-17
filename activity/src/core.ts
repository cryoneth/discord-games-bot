/**
 * Shared client building blocks for every game screen.
 * DOM is only ever built with textContent, never innerHTML with user data.
 */

// ── Contracts between the hub and game screens ─────────────────────────────

export interface Ctx {
  me: () => string;
  /** Sends a message to the current game. */
  send: (m: { t: string } & Record<string, unknown>) => void;
  /** Server time in ms, corrected for clock skew. */
  now: () => number;
  setClock: (serverNow: number) => void;
  /** "All games" button for the host, or null for everyone else. */
  menuButton: () => HTMLElement | null;
  /** Tell the hub whether a game is in progress (shows the host's "End game" button). */
  setPlaying: (playing: boolean) => void;
}

export interface View {
  mount(root: HTMLElement): void;
  unmount(): void;
  onMessage(m: { t: string } & Record<string, any>): void;
}

import { icon, rich } from './icons';

// ── DOM helpers ────────────────────────────────────────────────────────────

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  node.append(...(children.filter((c) => c !== null && c !== undefined && c !== false) as (Node | string)[]));
  return node;
}

export function button(text: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', className }, ...rich(text));
  b.onclick = onClick;
  return b;
}

export function card(...children: (Node | null | false)[]) {
  return el('div', { className: 'card' }, ...children);
}

export function waiting(text: string) {
  return el('div', { className: 'waiting' }, el('span', { className: 'dots' }, el('i'), el('i'), el('i')), text);
}

/** Initial-letter avatar with a stable per-name colour. */
export function avatar(name: string, size = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  const a = el('span', { className: `avatar ${size}`, textContent: [...name.trim()][0]?.toUpperCase() ?? '?' });
  a.style.setProperty('--hue', String(h));
  return a;
}

/** Segmented control. */
export function chips<T extends number | string>(options: readonly T[], current: T, label: (v: T) => string, enabled: boolean, pick: (v: T) => void) {
  return el(
    'div',
    { className: 'chips' },
    ...options.map((v) => {
      const b = el('button', { type: 'button', className: `chip${v === current ? ' active' : ''}` }, ...rich(label(v)));
      b.disabled = !enabled && v !== current;
      if (enabled) b.onclick = () => pick(v);
      return b;
    }),
  );
}

export function settingRow(label: string, control: Node) {
  return el('div', { className: 'row' }, el('span', { className: 'label', textContent: label }), control);
}

export interface Ranked {
  id: string;
  name: string;
  score: number;
}

export function podium(ranking: Ranked[], me: string, unit = 'pts') {
  const top = ranking.slice(0, 3);
  const order = [1, 0, 2].filter((i) => top[i]);
  const fmt = (n: number) => (unit === '$' ? `$${Math.round(n).toLocaleString('en-US')}` : `${n} ${unit}`);
  const wrap = el(
    'div',
    { className: 'podium-wrap' },
    el(
      'div',
      { className: 'podium' },
      ...order.map((i) => {
        const p = top[i]!;
        return el(
          'div',
          { className: `step place-${i + 1}${p.id === me ? ' me' : ''}` },
          i === 0 && el('span', { className: 'winner-crown' }, icon('crown')),
          avatar(p.name, i === 0 ? 'xl' : 'lg'),
          el('div', { className: 'step-name', textContent: p.name, title: p.name }),
          el('div', { className: 'step-score', textContent: fmt(p.score) }),
          el('div', { className: 'block', textContent: String(i + 1) }),
        );
      }),
    ),
  );
  const rest = ranking.slice(3);
  if (rest.length) {
    wrap.append(
      el(
        'ol',
        { className: 'rest', start: 4 },
        ...rest.map((p) => el('li', { className: p.id === me ? 'me' : '' }, el('span', { textContent: p.name }), el('span', { className: 'score', textContent: fmt(p.score) }))),
      ),
    );
  }
  return wrap;
}

export function secondsLeft(ctx: Ctx, endsAt: number | null): number {
  return endsAt ? Math.max(0, Math.ceil((endsAt - ctx.now()) / 1000)) : 0;
}

// ── Player list ────────────────────────────────────────────────────────────

export interface PlayerRow {
  id: string;
  name: string;
  connected: boolean;
  host: boolean;
  score?: string;
  status?: string;
  /** Extra classes: 'guessed' (green), 'drawing' (amber), 'team-0'/'team-1'. */
  cls?: string;
}

export function renderPlayers(list: HTMLElement, rows: PlayerRow[], me: string, ranked: boolean) {
  list.replaceChildren(
    ...rows.map((p, i) => {
      const cls = [p.cls, !p.connected && 'offline', p.id === me && 'me'].filter(Boolean).join(' ');
      const status = !p.connected ? 'away' : p.status || (p.id === me ? 'you' : '');
      return el(
        'li',
        { className: cls },
        el('span', { className: 'rank', textContent: ranked ? String(i + 1) : '' }),
        avatar(p.name),
        el(
          'span',
          { className: 'who' },
          el('span', { className: 'name', textContent: p.name, title: p.name }, p.host && el('span', { className: 'crown', title: 'Host' }, icon('crown'))),
          status && el('span', { className: 'status' }, ...rich(status)),
        ),
        p.score !== undefined && el('span', { className: 'score', textContent: p.score }),
      );
    }),
  );
}

// ── Chat panel ─────────────────────────────────────────────────────────────

export class Chat {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly log: HTMLUListElement;

  constructor(title: string, onSend: (text: string) => void, maxLength = 120) {
    this.log = el('ul', { className: 'chatlog' });
    this.input = el('input', { className: 'field', maxLength, placeholder: 'Say something…', autocomplete: 'off' });
    this.input.setAttribute('enterkeyhint', 'send');
    const form = el('form', { className: 'chat-form', autocomplete: 'off' }, this.input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      onSend(text.slice(0, maxLength));
      this.input.value = '';
    });
    this.root = el('aside', { className: 'panel chat' }, el('h2', { textContent: title }), this.log, form);
  }

  add(kind: string, text: string, name?: string) {
    const li = el('li', { className: kind });
    if (name) li.append(el('span', { className: 'who', textContent: name + ':' }));
    // Server lines may carry emoji; players' own words are shown as typed.
    li.append(...(name ? [text] : rich(text)));
    this.log.append(li);
    while (this.log.children.length > 150) this.log.firstChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  setInput(placeholder: string, enabled = true) {
    this.input.placeholder = placeholder;
    this.input.disabled = !enabled;
  }
}

// ── Standard table layout: top bar, players, stage, chat ───────────────────

export interface Shell {
  status: HTMLElement;
  center: HTMLElement;
  timer: HTMLElement;
  players: HTMLOListElement;
  playersTitle: HTMLElement;
  stage: HTMLElement;
  chat: Chat;
}

export function shell(root: HTMLElement, chatTitle: string, onChat: (text: string) => void, className = ''): Shell {
  const status = el('div', { className: 'pill' });
  const center = el('div', { className: 'hint' });
  const timer = el('div', { className: 'pill timer' });
  const players = el('ol', { className: 'plist' });
  const playersTitle = el('h2', { textContent: 'Players' });
  const stage = el('section', { className: 'stage table-stage' });
  const chat = new Chat(chatTitle, onChat);
  root.replaceChildren(
    el(
      'div',
      { className: `app ${className}` },
      el('header', { className: 'topbar' }, topLeft(status), center, timer),
      el('main', { className: 'layout' }, el('aside', { className: 'panel players' }, playersTitle, players), stage, chat.root),
    ),
  );
  return { status, center, timer, players, playersTitle, stage, chat };
}

/** Left cell of a top bar: the status pill plus a slot the hub fills with the host's End game button. */
export function topLeft(status: HTMLElement) {
  return el('div', { className: 'top-left' }, status, el('span', { className: 'end-slot' }));
}

export function setTimer(t: HTMLElement, seconds: number | null, lowAt = 5) {
  if (seconds === null) {
    t.textContent = '';
    t.classList.remove('low');
    return;
  }
  t.replaceChildren(icon('clock', 'inline'), ` ${seconds}s`);
  t.classList.toggle('low', seconds <= lowAt);
}

/** Start button for the host, or a waiting line for everyone else. */
export function startFooter(opts: { isHost: boolean; connected: number; min: number; hostName?: string; label: string; onStart: () => void; ready?: string | null }) {
  if (opts.connected < opts.min) {
    const missing = opts.min - opts.connected;
    return waiting(`Waiting for ${missing} more player${missing === 1 ? '' : 's'}…`);
  }
  if (opts.ready) return waiting(opts.ready);
  if (!opts.isHost) return waiting(`Waiting for ${opts.hostName ?? 'the host'} to start…`);
  const b = button(opts.label, opts.onStart, 'primary');
  return b;
}

/** A centered card inside the stage. */
export function stageCard(stage: HTMLElement, ...children: (Node | null | false)[]) {
  const c = card(...children);
  stage.replaceChildren(el('div', { className: 'stage-center' }, c));
  return c;
}

export function money(n: number, decimals = 0): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
