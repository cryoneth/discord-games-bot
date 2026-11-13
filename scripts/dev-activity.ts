/**
 * Local playground for the games Activity, outside Discord. Never used in production.
 *
 *   npx tsx scripts/dev-activity.ts          # game server on :3000 with fake sign-in
 *   npx vite --config activity/vite.config.ts
 *
 * Then open http://localhost:5173/?mock&name=Alice in one tab and
 * ?mock&name=Bob in another. The name doubles as the user ID, and nothing is
 * verified, which is why this only binds to localhost.
 */
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { gameFactory } from '../src/activity/games/index.js';
import { Hub, type HubConn } from '../src/activity/hub.js';
import { cleanText } from '../src/activity/room.js';
import { HUB_LIMITS, type ClientMessage, type ServerMessage } from '../src/shared/protocol.js';
import { ScoreStore } from '../src/store.js';

const store = new ScoreStore(mkdtempSync(join(tmpdir(), 'games-dev-')));
const createGame = gameFactory({
  store,
  onGameEnd: (_hub, game, results) => console.log(`[${game}] results`, results),
});
const hubs = new Map<string, Hub>();

const server = createServer((_req, res) => res.writeHead(404).end());
const wss = new WebSocketServer({ server, maxPayload: HUB_LIMITS.maxMessageBytes });

wss.on('connection', (ws, req) => {
  if (new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/\.proxy/, '') !== '/ws') return ws.close();
  const conn: HubConn = { send: (m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)) };
  let hub: Hub | null = null;
  let id = '';
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as ClientMessage;
    if (!hub) {
      if (msg.t !== 'hello' || !msg.accessToken.startsWith('mock:')) return ws.close();
      id = cleanText(msg.accessToken.slice(5), 32) || 'Player';
      hub = hubs.get(msg.instanceId) ?? new Hub(msg.instanceId, 'dev-guild', null, createGame);
      hubs.set(msg.instanceId, hub);
      hub.join({ id, name: id }, conn);
      return;
    }
    hub.handle(id, msg);
  });
  ws.on('close', () => hub?.leave(id, conn));
});

server.listen(3000, '127.0.0.1', () => console.log('Dev game server on ws://127.0.0.1:3000/ws. Open http://localhost:5173/?mock&name=Alice'));
