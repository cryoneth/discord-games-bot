import { DiscordSDK } from '@discord/embedded-app-sdk';
import {
  CANVAS_H,
  CANVAS_W,
  COLORS,
  describeGoal,
  estimateMinutes,
  LIMITS,
  SETTING_OPTIONS,
  WIDTHS,
  type ClientMessage,
  type GameSettings,
  type GoalMode,
  type PlayerView,
  type ServerMessage,
  type StateMessage,
  type StrokeChunk,
} from '../../src/shared/protocol';

// ── DOM helpers (textContent only — never innerHTML with user data) ────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;
const overlay = $('overlay');
const toolbar = $('toolbar');
const playersEl = $('players');
const messagesEl = $('messages');
const guessForm = $<HTMLFormElement>('guess-form');
const guessInput = $<HTMLInputElement>('guess');
const hintEl = $('hint');
const roundEl = $('round');
const timerEl = $('timer');

function showOverlay(...children: (Node | string)[]) {
  const first = children[0];
  const wrapped = first instanceof HTMLElement && first.classList.contains('card') ? children : [el('div', { className: 'card' }, ...children)];
  overlay.replaceChildren(...wrapped);
  overlay.classList.remove('peek');
  overlay.classList.remove('hidden');
}
function hideOverlay() {
  overlay.classList.add('hidden');
}

// ── State ──────────────────────────────────────────────────────────────────

let me = '';
let state: StateMessage | null = null;
let clockOffset = 0;
let choices: { words: string[]; endsAt: number } | null = null;
let strokes: StrokeChunk[] = [];
let color = 0;
let width = 1;
let ws: WebSocket | null = null;
let accessToken = '';
let instanceId = '';
let fatal = false;
let turnStartScores = new Map<string, number>();
let settingsOpen = false;

const send = (msg: ClientMessage) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};
const amDrawing = () => state?.phase === 'drawing' && state.drawerId === me;

// ── Canvas ─────────────────────────────────────────────────────────────────

function drawChunk(s: StrokeChunk) {
  const p = s.p;
  ctx.strokeStyle = ctx.fillStyle = COLORS[s.c] ?? '#000';
  ctx.lineWidth = WIDTHS[s.w] ?? 4;
  ctx.lineCap = ctx.lineJoin = 'round';
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0]!, p[1]!, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  ctx.stroke();
}

function redraw() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  for (const s of strokes) drawChunk(s);
}

let strokeId = Math.floor(Math.random() * 1e6);
let pending: number[] = [];
let lastPoint: [number, number] | null = null;
let drawing = false;

function toCanvas(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) / r.width) * CANVAS_W), Math.round(((e.clientY - r.top) / r.height) * CANVAS_H)];
}

function flush() {
  if (pending.length === 0) return;
  const p = lastPoint && pending.length >= 2 && (pending[0] !== lastPoint[0] || pending[1] !== lastPoint[1]) ? [...lastPoint, ...pending] : pending;
  for (let i = 0; i < p.length; i += LIMITS.maxPointsPerChunk * 2 - 2) {
    const chunk: StrokeChunk = { id: strokeId, c: color, w: width, p: p.slice(i, i + LIMITS.maxPointsPerChunk * 2) };
    strokes.push(chunk);
    send({ t: 'stroke', s: chunk });
  }
  lastPoint = [pending[pending.length - 2]!, pending[pending.length - 1]!];
  pending = [];
}
setInterval(() => drawing && flush(), 50);

canvas.addEventListener('pointerdown', (e) => {
  if (!amDrawing()) return;
  canvas.setPointerCapture(e.pointerId);
  drawing = true;
  strokeId = (strokeId + 1) % 1e9;
  lastPoint = null;
  const [x, y] = toCanvas(e);
  pending = [x, y];
  drawChunk({ id: strokeId, c: color, w: width, p: [x, y] });
});
canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const [x, y] = toCanvas(e);
  const px = pending.length ? pending[pending.length - 2]! : lastPoint?.[0];
  const py = pending.length ? pending[pending.length - 1]! : lastPoint?.[1];
  if (px !== undefined && py !== undefined) {
    if (Math.hypot(x - px, y - py) < 2) return;
    drawChunk({ id: strokeId, c: color, w: width, p: [px, py, x, y] });
  }
  pending.push(x, y);
});
const endStroke = () => {
  if (!drawing) return;
  flush();
  drawing = false;
  lastPoint = null;
};
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

// Toolbar
const colorsEl = $('colors');
const widthsEl = $('widths');
function renderTools() {
  colorsEl.replaceChildren(
    ...COLORS.map((c, i) => {
      const b = el('button', { type: 'button', className: `swatch${i === color ? ' active' : ''}`, title: i === 1 ? 'Eraser' : c });
      b.style.background = c;
      b.onclick = () => ((color = i), renderTools());
      return b;
    }),
  );
  widthsEl.replaceChildren(
    ...WIDTHS.map((w, i) => {
      const dot = el('span');
      dot.style.width = dot.style.height = `${Math.max(4, Math.min(24, w * 0.6))}px`;
      const b = el('button', { type: 'button', className: `width${i === width ? ' active' : ''}`, title: `${w}px` }, dot);
      b.onclick = () => ((width = i), renderTools());
      return b;
    }),
  );
}
renderTools();
$('undo').onclick = () => send({ t: 'undo' });
$('clear').onclick = () => send({ t: 'clear' });

// ── Chat ───────────────────────────────────────────────────────────────────

function addMessage(kind: string, text: string, name?: string) {
  const li = el('li', { className: kind });
  if (name) li.append(el('span', { className: 'who', textContent: name + ':' }));
  li.append(text);
  messagesEl.append(li);
  while (messagesEl.children.length > 150) messagesEl.firstChild?.remove();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

guessForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = guessInput.value.trim();
  if (!text) return;
  send({ t: 'guess', text: text.slice(0, LIMITS.maxGuessLength) });
  guessInput.value = '';
});

// ── Rendering game state ───────────────────────────────────────────────────

function render() {
  if (!state) return;
  const s = state;
  const drawer = s.players.find((p) => p.id === s.drawerId);
  const meP = s.players.find((p) => p.id === me);

  renderProgress();
  hintEl.textContent = s.hint;

  const inGame = s.phase !== 'lobby';
  playersEl.replaceChildren(
    ...[...s.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => {
        const isDrawer = p.id === s.drawerId && s.phase !== 'finished';
        const cls = [p.guessed && (s.phase === 'drawing' || s.phase === 'reveal') && 'guessed', isDrawer && 'drawing', !p.connected && 'offline', p.id === me && 'me'].filter(Boolean).join(' ');
        const status = !p.connected ? 'away' : isDrawer ? '✏️ drawing' : p.guessed && s.phase === 'drawing' ? '✓ guessed' : p.id === me ? 'you' : '';
        return el(
          'li',
          { className: cls },
          el('span', { className: 'rank', textContent: inGame ? String(i + 1) : '' }),
          avatar(p.name),
          el(
            'span',
            { className: 'who' },
            el('span', { className: 'name', textContent: p.name, title: p.name }, ...(p.host ? [el('span', { className: 'crown', textContent: '👑', title: 'Host' })] : [])),
            ...(status ? [el('span', { className: 'status', textContent: status })] : []),
          ),
          el('span', { className: 'score', textContent: String(p.score) }),
        );
      }),
  );

  toolbar.classList.toggle('hidden', !amDrawing());
  canvas.classList.toggle('can-draw', amDrawing());
  const canGuess = s.phase !== 'drawing' || (s.drawerId !== me && !meP?.guessed);
  guessInput.disabled = s.phase === 'drawing' && s.drawerId === me;
  guessInput.placeholder =
    s.phase === 'drawing' ? (s.drawerId === me ? "You're drawing!" : canGuess ? 'Type your guess…' : 'Chat with others who guessed…') : 'Say something…';

  const isHost = meP?.host ?? false;
  const connected = s.players.filter((p) => p.connected).length;
  if (s.phase === 'lobby' || s.phase === 'finished') {
    const host = s.players.find((p) => p.host);
    const ranking = [...s.players].sort((a, b) => b.score - a.score);
    const head: Node[] = [];
    if (s.phase === 'finished') {
      const tie = ranking.length > 1 && ranking[0]!.score === ranking[1]!.score;
      head.push(
        el('div', { className: 'eyebrow', textContent: 'Game over' }),
        el('h1', { textContent: tie ? 'It’s a tie!' : `${ranking[0]?.name ?? ''} wins!` }),
        podium(ranking),
      );
    } else {
      head.push(
        el('div', { className: 'logo', textContent: '🎨' }),
        el('h1', { textContent: 'Sketch Party' }),
        el('p', { className: 'sub', textContent: 'Take turns drawing a secret word while everyone else races to guess it.' }),
      );
    }
    let footer: Node;
    if (connected < 2) {
      footer = waiting('Waiting for one more player to join…');
    } else if (isHost) {
      const start = el('button', { type: 'button', className: 'primary', textContent: s.phase === 'finished' ? 'Play again' : `Start game · ${connected} players` });
      start.onclick = () => send({ t: 'start' });
      footer = start;
    } else {
      footer = waiting(`Waiting for ${host?.name ?? 'the host'} to start…`);
    }
    showOverlay(card(...head, settingsPanel(s.settings, isHost, connected, s.phase === 'finished'), footer));
  } else if (s.phase === 'choosing') {
    if (s.drawerId === me && choices) {
      showOverlay(
        card(
          el('div', { className: 'eyebrow', textContent: 'Your turn' }),
          el('h1', { textContent: 'Pick a word to draw' }),
          el(
            'div',
            { className: 'choices' },
            ...choices.words.map((w, i) => {
              const b = el('button', { type: 'button', className: 'word', textContent: w });
              b.onclick = () => send({ t: 'pick', index: i });
              return b;
            }),
          ),
        ),
      );
    } else {
      showOverlay(
        card(
          ...(drawer ? [avatar(drawer.name, 'lg')] : []),
          el('h1', { className: 'small', textContent: `${drawer?.name ?? 'Someone'} is choosing a word` }),
          waiting('Get ready to guess'),
        ),
      );
    }
  } else if (s.phase === 'reveal') {
    showOverlay(
      card(
        el('div', { className: 'eyebrow', textContent: s.word ? 'The word was' : 'Time’s up!' }),
        ...(s.word ? [el('div', { className: 'reveal-word', textContent: s.word })] : []),
        roundScores(s),
      ),
    );
    overlay.classList.add('peek');
  } else {
    hideOverlay();
  }
}

// ── Game length settings ───────────────────────────────────────────────────

const MODE_LABELS: Record<GoalMode, string> = { time: '⏳ Time limit', points: '🎯 Points', rounds: '🔁 Rounds' };
const valueLabel = (mode: GoalMode, v: number) => (mode === 'time' ? `${v} min` : mode === 'points' ? `${v} pts` : `${v}`);

function formatEstimate(minutes: number): string {
  if (minutes < 1.5) return '≈ 1 min';
  return `≈ ${Math.round(minutes)} min`;
}

function chips<T extends number | string>(options: readonly T[], current: T, label: (v: T) => string, enabled: boolean, pick: (v: T) => void) {
  return el(
    'div',
    { className: 'chips' },
    ...options.map((v) => {
      const b = el('button', { type: 'button', className: `chip${v === current ? ' active' : ''}`, textContent: label(v) });
      b.disabled = !enabled && v !== current;
      if (enabled) b.onclick = () => pick(v);
      return b;
    }),
  );
}

function settingsPanel(settings: GameSettings, isHost: boolean, players: number, next: boolean) {
  const estimate = estimateMinutes(settings, players);
  const timeNote = settings.mode === 'time' ? ' (last turn finishes after time is up)' : '';
  // Non-hosts can't change anything, so a row of disabled chips is just noise. Show one line instead.
  if (!isHost) {
    return el(
      'div',
      { className: 'settings summary' },
      el('span', { className: 'label', textContent: next ? 'Next game' : 'Game' }),
      el('span', { textContent: `${describeGoal(settings)} · ${settings.drawSeconds}s per drawing · ${formatEstimate(estimate)}${timeNote}` }),
    );
  }
  const update = (next: Partial<GameSettings>) => {
    const merged = { ...settings, ...next };
    // Switching mode picks a sensible value for that mode.
    if (next.mode && next.mode !== settings.mode) merged.value = next.mode === 'time' ? 10 : next.mode === 'points' ? 500 : 1;
    send({ t: 'settings', settings: merged });
  };
  const summary = `${describeGoal(settings)} · ${settings.drawSeconds}s per drawing · ${formatEstimate(estimate)}`;
  // After a game the host mostly wants "Play again", so the controls start collapsed there.
  if (next && !settingsOpen) {
    const edit = el('button', { type: 'button', className: 'link', textContent: 'Change' });
    edit.onclick = () => ((settingsOpen = true), render());
    return el('div', { className: 'settings summary' }, el('span', { className: 'label', textContent: 'Next game' }), el('span', { textContent: summary }), edit);
  }
  const panel = el(
    'div',
    { className: 'settings' },
    el('div', { className: 'settings-title', textContent: next ? 'Next game' : 'Game settings' }),
    el('div', { className: 'row' }, el('span', { className: 'label', textContent: 'Ends by' }), chips(['time', 'points', 'rounds'] as GoalMode[], settings.mode, (m) => MODE_LABELS[m], isHost, (mode) => update({ mode }))),
    el(
      'div',
      { className: 'row' },
      el('span', { className: 'label', textContent: settings.mode === 'time' ? 'Length' : settings.mode === 'points' ? 'Target' : 'Rounds' }),
      chips(SETTING_OPTIONS[settings.mode] as readonly number[], settings.value, (v) => valueLabel(settings.mode, v), isHost, (value) => update({ value })),
    ),
    el(
      'div',
      { className: 'row' },
      el('span', { className: 'label', textContent: 'Draw time' }),
      chips(SETTING_OPTIONS.drawSeconds as readonly number[], settings.drawSeconds, (v) => `${v}s`, isHost, (drawSeconds) => update({ drawSeconds })),
    ),
    el('div', {
      className: 'estimate',
      textContent: `${describeGoal(settings)} · ${formatEstimate(estimate)} with ${Math.max(2, players)} players${timeNote}`,
    }),
  );
  return panel;
}

// ── Overlay building blocks ────────────────────────────────────────────────

function card(...children: Node[]) {
  return el('div', { className: 'card' }, ...children);
}

function waiting(text: string) {
  return el('div', { className: 'waiting' }, el('span', { className: 'dots' }, el('i'), el('i'), el('i')), text);
}

/** Initial-letter avatar with a stable per-name colour. */
function avatar(name: string, size = '') {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  const a = el('span', { className: `avatar ${size}`, textContent: [...name.trim()][0]?.toUpperCase() ?? '?' });
  a.style.setProperty('--hue', String(h));
  return a;
}

function podium(ranking: PlayerView[]) {
  const top = ranking.slice(0, 3);
  const order = [1, 0, 2].filter((i) => top[i]);
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
          ...(i === 0 ? [el('span', { className: 'winner-crown', textContent: '👑' })] : []),
          avatar(p.name, i === 0 ? 'xl' : 'lg'),
          el('div', { className: 'step-name', textContent: p.name, title: p.name }),
          el('div', { className: 'step-score', textContent: `${p.score} pts` }),
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
        ...rest.map((p) => el('li', { className: p.id === me ? 'me' : '' }, el('span', { textContent: p.name }), el('span', { className: 'score', textContent: String(p.score) }))),
      ),
    );
  }
  return wrap;
}

/** Points each player picked up this turn. */
function roundScores(s: StateMessage) {
  const gains = s.players
    .map((p) => ({ p, d: p.score - (turnStartScores.get(p.id) ?? p.score) }))
    .filter((g) => g.d > 0)
    .sort((a, b) => b.d - a.d);
  if (!gains.length) return el('p', { className: 'sub', textContent: 'Nobody got it this time.' });
  return el(
    'ul',
    { className: 'gains' },
    ...gains.map(({ p, d }) =>
      el('li', { className: p.id === me ? 'me' : '' }, avatar(p.name), el('span', { className: 'name', textContent: p.name + (p.id === s.drawerId ? ' ✏️' : '') }), el('span', { className: 'plus', textContent: `+${d}` })),
    ),
  );
}

function renderProgress() {
  const s = state;
  if (!s) return;
  if (s.phase === 'lobby') roundEl.textContent = 'Lobby';
  else if (s.phase === 'finished') roundEl.textContent = 'Game over';
  else if (s.settings.mode === 'rounds') roundEl.textContent = `Round ${s.round}/${s.totalRounds}`;
  else if (s.settings.mode === 'points') roundEl.textContent = `🎯 First to ${s.settings.value} · turn ${s.turn}`;
  else if (s.gameEndsAt) {
    const left = Math.max(0, Math.ceil((s.gameEndsAt - (Date.now() + clockOffset)) / 1000));
    roundEl.textContent = left > 0 ? `⏳ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : '⏳ Last turn!';
  }
}

function tick() {
  if (state?.settings.mode === 'time') renderProgress();
  if (state?.endsAt) {
    const left = Math.max(0, Math.ceil((state.endsAt - (Date.now() + clockOffset)) / 1000));
    timerEl.textContent = `⏱ ${left}s`;
    timerEl.classList.toggle('low', left <= 10 && state.phase === 'drawing');
  } else {
    timerEl.textContent = '';
    timerEl.classList.remove('low');
  }
}
setInterval(tick, 250);

// ── Networking ─────────────────────────────────────────────────────────────

function onMessage(msg: ServerMessage) {
  switch (msg.t) {
    case 'welcome':
      me = msg.you;
      break;
    case 'state': {
      const prevPhase = state?.phase;
      state = msg;
      clockOffset = msg.now - Date.now();
      if (msg.phase !== 'choosing') choices = null;
      if (prevPhase === 'drawing' && msg.phase !== 'drawing') endStroke();
      if (msg.phase !== prevPhase) settingsOpen = false;
      if (msg.phase === 'choosing' || (msg.phase === 'drawing' && prevPhase !== 'drawing' && prevPhase !== 'choosing')) {
        turnStartScores = new Map(msg.players.map((p) => [p.id, p.score]));
      }
      render();
      tick();
      break;
    }
    case 'choices':
      choices = { words: msg.words, endsAt: msg.endsAt };
      render();
      break;
    case 'stroke':
      strokes.push(msg.s);
      drawChunk(msg.s);
      break;
    case 'canvas':
      strokes = msg.strokes;
      redraw();
      break;
    case 'chat':
      addMessage(msg.kind, msg.text, msg.name);
      break;
    case 'error':
      if (msg.fatal) fatal = true;
      showOverlay(el('h1', { textContent: '⚠️' }), el('p', { textContent: msg.text }));
      break;
  }
}

let retry = 0;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/.proxy/ws`);
  ws.onopen = () => {
    retry = 0;
    send({ t: 'hello', accessToken, instanceId });
  };
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data as string) as ServerMessage);
    } catch {
      /* ignore malformed */
    }
  };
  ws.onclose = () => {
    if (fatal) return;
    showOverlay(el('h1', { textContent: 'Reconnecting…' }));
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * 2 ** retry);
  };
}

async function boot() {
  showOverlay(el('h1', { textContent: 'Connecting…' }));
  redraw();
  try {
    const cfg = (await (await fetch('/.proxy/api/config')).json()) as { clientId: string };
    const sdk = new DiscordSDK(cfg.clientId);
    await sdk.ready();
    instanceId = sdk.instanceId;
    // Only the `identify` scope: username and avatar. No email, no server list.
    const { code } = await sdk.commands.authorize({
      client_id: cfg.clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });
    const res = await fetch('/.proxy/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error('token exchange failed');
    accessToken = ((await res.json()) as { access_token: string }).access_token;
    connect();
  } catch {
    showOverlay(el('h1', { textContent: '⚠️' }), el('p', { textContent: 'Could not sign in with Discord. Close the activity and try again.' }));
  }
}

void boot();
