import { DiscordSDK } from '@discord/embedded-app-sdk';
import { GAMES, type ClientMessage, type GameId, type HubPlayer, type ServerMessage } from '../../src/shared/protocol';
import { button, card, el, renderPlayers, waiting, type Ctx, type View } from './core';
import { icon, type IconName } from './icons';
import { createForbidden } from './games/forbidden';
import { createMarket } from './games/market';
import { createMassReaction } from './games/massreaction';
import { createOddOneOut } from './games/oddoneout';
import { createQuiz } from './games/quiz';
import { createSketch } from './games/sketch';
import './games.css';
import './sketch.css';

const FACTORIES: Record<GameId, (ctx: Ctx) => View> = {
  drawing: createSketch,
  oddoneout: createOddOneOut,
  forbidden: createForbidden,
  quiz: createQuiz,
  market: createMarket,
  massreaction: createMassReaction,
};

const app = document.getElementById('app')!;

let me = '';
let ws: WebSocket | null = null;
let accessToken = '';
let instanceId = '';
let fatal = false;
let clockOffset = 0;
let players: HubPlayer[] = [];
let game: GameId | null = null;
let view: View | null = null;
/** Game messages that arrived before their screen was mounted. */
let pending: ({ t: string } & Record<string, unknown>)[] = [];
let playing = false;

/** Host-only control that floats over every game while one is running. */
const endLabel = el('span', { className: 'lbl', textContent: ' End game' });
const endButton = el('button', { type: 'button', className: 'end-game', title: 'End game' }, icon('square'), endLabel);
endButton.onclick = () => {
  if (endButton.dataset.armed) send({ t: 'g', m: { t: 'end' } });
  else {
    endButton.dataset.armed = '1';
    endLabel.textContent = ' Tap again to end';
    setTimeout(() => {
      delete endButton.dataset.armed;
      endLabel.textContent = ' End game';
    }, 3000);
  }
};
const syncEndButton = () => {
  endButton.classList.toggle('hidden', !(playing && game && isHost()));
  // Lives in the current screen's top bar so it never covers game content.
  const slot = app.querySelector('.end-slot');
  if (slot && endButton.parentElement !== slot) slot.append(endButton);
};

const send = (msg: ClientMessage) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

const isHost = () => players.some((p) => p.id === me && p.host);

const ctx: Ctx = {
  me: () => me,
  send: (m) => send({ t: 'g', m }),
  now: () => Date.now() + clockOffset,
  setClock: (serverNow) => (clockOffset = serverNow - Date.now()),
  menuButton: () => (isHost() ? button('← All games', () => send({ t: 'menu' }), 'link menu-link') : null),
  setPlaying: (p) => {
    playing = p;
    syncEndButton();
  },
};

/** Full-screen message (connecting, errors). */
function notice(...children: Node[]) {
  view?.unmount();
  view = null;
  app.replaceChildren(el('div', { className: 'app' }, el('div', { className: 'stage-center' }, card(...children))));
}

const GAME_ICONS: Record<GameId, IconName> = { drawing: 'palette', oddoneout: 'magnifier', forbidden: 'ban', quiz: 'bolt', market: 'chart', massreaction: 'target' };

// ── Game picker ────────────────────────────────────────────────────────────

function renderPicker() {
  const host = players.find((p) => p.host);
  const online = players.filter((p) => p.connected).length;
  const list = el('ol', { className: 'plist' });
  renderPlayers(list, players, me, false);
  const amHost = isHost();
  const grid = el(
    'div',
    { className: 'game-grid' },
    ...GAMES.map((g) => {
      const tooFew = online < g.minPlayers;
      const b = el(
        'button',
        { type: 'button', className: 'game-tile', disabled: !amHost },
        el('span', { className: 'tile-emoji' }, icon(GAME_ICONS[g.id])),
        el('span', { className: 'tile-name', textContent: g.name }),
        el('span', { className: 'tile-blurb', textContent: g.blurb }),
        el('span', { className: `tile-players${tooFew ? ' short' : ''}`, textContent: g.minPlayers === 1 ? `1–${g.maxPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players` }),
      );
      if (amHost) b.onclick = () => send({ t: 'choose', game: g.id });
      return b;
    }),
  );
  app.replaceChildren(
    el(
      'div',
      { className: 'app picker' },
      el(
        'header',
        { className: 'picker-head' },
        el('h1', {}, icon('party'), ' Game Night'),
        el('p', { className: 'sub', textContent: amHost ? 'You’re the host. Pick a game for everyone.' : '' }, !amHost ? waiting(`${host?.name ?? 'The host'} is picking a game…`) : ''),
      ),
      el('main', { className: 'picker-body' }, grid, el('aside', { className: 'panel players' }, el('h2', { textContent: `Here now · ${online}` }), list)),
    ),
  );
}

function onHub(next: GameId | null, nextPlayers: HubPlayer[]) {
  players = nextPlayers;
  if (next !== game || (next && !view)) {
    view?.unmount();
    view = null;
    playing = false;
    game = next;
    if (game) {
      view = FACTORIES[game](ctx);
      view.mount(app);
      const queued = pending;
      pending = [];
      for (const m of queued) view.onMessage(m);
    }
  }
  if (!game) renderPicker();
  syncEndButton();
}

// ── Networking ─────────────────────────────────────────────────────────────

function onMessage(msg: ServerMessage) {
  switch (msg.t) {
    case 'welcome':
      me = msg.you;
      break;
    case 'hub':
      clockOffset = msg.now - Date.now();
      onHub(msg.game, msg.players);
      break;
    case 'g':
      if (view) view.onMessage(msg.m);
      else pending.push(msg.m);
      break;
    case 'error':
      if (msg.fatal) fatal = true;
      notice(el('div', { className: 'logo' }, icon('warning')), el('p', { textContent: msg.text }));
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
    } catch (err) {
      console.error(err);
    }
  };
  ws.onclose = () => {
    if (fatal) return;
    game = null;
    pending = [];
    notice(el('h1', { textContent: 'Reconnecting…' }));
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * 2 ** retry);
  };
}

async function boot() {
  notice(el('h1', { textContent: 'Connecting…' }));
  // Local playground (scripts/dev-activity.ts). Compiled out of production builds.
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search);
    // Discord always adds frame_id; without it we're in a plain browser tab, so use mock sign-in.
    if (params.has('mock') || !params.has('frame_id')) {
      instanceId = params.get('room') || 'dev';
      accessToken = `mock:${params.get('name') || `Player${Math.floor(Math.random() * 900 + 100)}`}`;
      return connect();
    }
  }
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
    notice(el('div', { className: 'logo' }, icon('warning')), el('p', { textContent: 'Could not sign in with Discord. Close the activity and try again.' }));
  }
}

void boot();
