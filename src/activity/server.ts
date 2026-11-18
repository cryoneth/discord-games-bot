import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmbedBuilder, type Client } from 'discord.js';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Config } from '../config.js';
import { gameInfo, HUB_LIMITS, type ClientMessage, type GameId, type ServerMessage } from '../shared/protocol.js';
import type { ScoreStore } from '../store.js';
import { isModeratorInGuild } from '../moderation.js';
import { log } from '../util/log.js';
import { TokenBucket } from '../util/ratelimit.js';
import { gameFactory } from './games/index.js';
import { Hub, type HubConn } from './hub.js';
import { cleanText, type RoomResult } from './room.js';

const STATIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const MAX_ROOMS = 1000;
/** Inner game messages that carry free text get a stricter rate limit. */
const TEXT_MESSAGES = new Set(['guess', 'chat', 'clue']);
const MAX_CONNS_PER_USER = 3;
const HELLO_TIMEOUT_MS = 10_000;
const ROOM_IDLE_MS = 2 * 60_000;
const DISCORD_API = 'https://discord.com/api/v10';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function discordGet<T>(path: string, authorization: string): Promise<T> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as T;
}

interface Deps {
  config: Config;
  store: ScoreStore;
  discord: Client;
}

export function startWebServer({ config, store, discord }: Deps) {
  const rooms = new Map<string, Hub>();
  const tokenBuckets = new Map<string, TokenBucket>();
  const allowedOrigin = `https://${config.clientId}.discordsays.com`;
  const isProd = process.env.NODE_ENV === 'production';

  const securityHeaders = (res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        `frame-ancestors ${config.frameAncestors}`,
      ].join('; '),
    );
  };

  const clientIp = (req: IncomingMessage): string => {
    if (config.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage, max: number) =>
    new Promise<string>((resolveBody, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > max) {
          reject(new HttpError(413));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  /** Exchange the OAuth code from the Activity for an access token. The client secret never leaves the server. */
  const handleToken = async (req: IncomingMessage, res: ServerResponse) => {
    // Activity traffic arrives through Discord's proxy, so many players can share one IP:
    // keep this loose enough for a busy server (Mass Reaction takes up to 100 players at once).
    // OAuth codes are single-use anyway.
    const ip = clientIp(req);
    let bucket = tokenBuckets.get(ip);
    if (!bucket) tokenBuckets.set(ip, (bucket = new TokenBucket(120, 3)));
    if (!bucket.take()) return json(res, 429, { error: 'rate_limited' });

    let code: unknown;
    try {
      code = (JSON.parse(await readBody(req, 2048)) as { code?: unknown }).code;
    } catch {
      return json(res, 400, { error: 'bad_request' });
    }
    if (typeof code !== 'string' || !/^[A-Za-z0-9]{10,100}$/.test(code)) return json(res, 400, { error: 'bad_request' });

    const r = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return json(res, 401, { error: 'exchange_failed' });
    const data = (await r.json()) as { access_token?: string; scope?: string };
    if (!data.access_token) return json(res, 401, { error: 'exchange_failed' });
    return json(res, 200, { access_token: data.access_token });
  };

  const serveStatic = (urlPath: string, res: ServerResponse) => {
    let rel: string;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = resolve(STATIC_DIR, '.' + (rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(STATIC_DIR + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) file = resolve(STATIC_DIR, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Activity not built. Run npm run build.');
      return;
    }
    const isAsset = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  };

  const server = createServer(async (req, res) => {
    securityHeaders(res);
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Discord's proxy may forward paths with or without the /.proxy prefix.
      const path = url.pathname.replace(/^\/\.proxy(?=\/)/, '');

      if (path === '/healthz') return json(res, 200, { ok: true });
      if (path === '/api/config' && req.method === 'GET') return json(res, 200, { clientId: config.clientId });
      if (path === '/api/token') {
        if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
        return await handleToken(req, res);
      }
      if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' });
      return serveStatic(path, res);
    } catch (err) {
      log.error('HTTP handler failed', err);
      if (!res.headersSent) json(res, err instanceof HttpError ? err.status : 500, { error: 'server_error' });
      else res.end();
    }
  });

  // ── WebSocket game connections ───────────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true, maxPayload: HUB_LIMITS.maxMessageBytes });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/^\/\.proxy(?=\/)/, '');
    const origin = req.headers.origin;
    const originOk = origin === allowedOrigin || (!isProd && origin !== undefined);
    if (path !== '/ws' || !originOk) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const onGameEnd = (hub: Hub, game: GameId, results: RoomResult[]) => {
    const counted = store.record(hub.guildId, game, results);
    if (!hub.channelId || results.length === 0) return;
    const info = gameInfo(game);
    void (async () => {
      const channel = await discord.channels.fetch(hub.channelId!).catch(() => null);
      if (!channel || !channel.isSendable()) return;
      const medals = ['🥇', '🥈', '🥉'];
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(`${info.emoji} ${info.name} results`)
            .setDescription(
              results
                .slice(0, 10)
                .map((r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.userId}>`)
                .join('\n'),
            )
            .setFooter({
              text: `${counted ? '' : 'Practice round: not counted for the leaderboard. '}🎈 All games and leaderboards are just for fun.`,
            }),
        ],
      });
    })().catch((err) => log.warn(`Could not post ${game} results`, err));
  };

  const createGame = gameFactory({ store, onGameEnd });

  interface Identity {
    id: string;
    name: string;
    guildId: string | null;
    channelId: string | null;
    mod: boolean;
  }

  const authenticate = async (accessToken: string, instanceId: string): Promise<Identity> => {
    const user = await discordGet<{ id: string; username: string; global_name?: string | null }>('/users/@me', `Bearer ${accessToken}`);
    let guildId: string | null = null;
    let channelId: string | null = null;
    if (config.verifyActivityInstance) {
      // Confirms with Discord that this user is really a participant of this Activity instance.
      const inst = await discordGet<{ users: string[]; location?: { guild_id?: string | null; channel_id?: string } }>(
        `/applications/${config.clientId}/activity-instances/${encodeURIComponent(instanceId)}`,
        `Bot ${config.token}`,
      );
      if (!inst.users.includes(user.id)) throw new HttpError(403);
      guildId = inst.location?.guild_id ?? null;
      channelId = inst.location?.channel_id ?? null;
    }
    const name = cleanText(user.global_name || user.username, 32) || 'Player';
    // The server is only known from the verified instance, so moderators need VERIFY_ACTIVITY_INSTANCE on.
    const mod = guildId ? await isModeratorInGuild(discord, guildId, user.id) : false;
    return { id: user.id, name, guildId, channelId, mod };
  };

  wss.on('connection', (ws: WebSocket) => {
    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const conn: HubConn = { send };
    const bucket = new TokenBucket(60, 40);
    const guessBucket = new TokenBucket(3, 1.5);
    let identity: Identity | null = null;
    let room: Hub | null = null;
    let authenticating = false;
    let alive = true;

    const fail = (text: string) => {
      send({ t: 'error', text, fatal: true });
      ws.close(1008, 'policy');
    };
    const helloTimer = setTimeout(() => !identity && fail('Authentication timed out.'), HELLO_TIMEOUT_MS);

    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);

    ws.on('message', async (raw, isBinary) => {
      if (isBinary) return fail('Unsupported message.');
      if (!bucket.take()) return; // silently drop floods
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return fail('Malformed message.');
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return fail('Malformed message.');

      if (!identity) {
        if (msg.t !== 'hello' || authenticating) return;
        if (typeof msg.accessToken !== 'string' || msg.accessToken.length > 200) return fail('Bad credentials.');
        if (typeof msg.instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(msg.instanceId)) return fail('Bad instance.');
        authenticating = true;
        try {
          identity = await authenticate(msg.accessToken, msg.instanceId);
        } catch (err) {
          const status = err instanceof HttpError ? err.status : 0;
          if (status !== 401 && status !== 403) log.warn('Activity authentication failed', err);
          return fail("Couldn't verify you with Discord. Close and relaunch the activity.");
        } finally {
          authenticating = false;
        }
        clearTimeout(helloTimer);
        if (ws.readyState !== ws.OPEN) return;

        room = rooms.get(msg.instanceId) ?? null;
        if (!room) {
          if (rooms.size >= MAX_ROOMS) return fail('The server is busy. Try again soon.');
          room = new Hub(msg.instanceId, identity.guildId, identity.channelId, createGame);
          rooms.set(msg.instanceId, room);
        }
        if (userConnCount(identity.id) >= MAX_CONNS_PER_USER) return fail('Too many open sessions.');
        if (!room.join({ id: identity.id, name: identity.name, mod: identity.mod }, conn)) return fail('This activity is full.');
        connsByUser.set(identity.id, userConnCount(identity.id) + 1);
        return;
      }

      if (msg.t === 'g' && msg.m && typeof msg.m === 'object' && TEXT_MESSAGES.has(msg.m.t) && !guessBucket.take()) {
        return send({ t: 'g', m: { t: 'chat', kind: 'private', text: 'Slow down a little!' } });
      }
      try {
        room?.handle(identity.id, msg);
      } catch (err) {
        log.error('Room handler failed', err);
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(ping);
      if (identity && room) {
        room.leave(identity.id, conn);
        const n = userConnCount(identity.id) - 1;
        if (n <= 0) connsByUser.delete(identity.id);
        else connsByUser.set(identity.id, n);
      }
    });
    ws.on('error', () => ws.terminate());
  });

  const connsByUser = new Map<string, number>();
  const userConnCount = (id: string) => connsByUser.get(id) ?? 0;

  // Dispose rooms nobody is connected to; clean up stale rate-limit buckets.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      if (room.connectedCount === 0 && now - room.lastActivity > ROOM_IDLE_MS) {
        room.dispose();
        rooms.delete(id);
      }
    }
    if (tokenBuckets.size > 10_000) tokenBuckets.clear();
  }, 30_000);
  sweeper.unref();

  server.listen(config.port, config.host, () => log.info(`Web server listening on ${config.host}:${config.port}`));

  return {
    /** Running activities in a server, for `/mod`. */
    activities: (guildId: string) =>
      [...rooms.values()].filter((r) => r.guildId === guildId && r.connectedCount > 0).map((r) => ({ channelId: r.channelId, ...r.summary() })),
    /** Stops the game in every activity of a server (optionally one channel). Returns how many were running a game. */
    stopActivities: (guildId: string, channelId: string | null, text: string): number => {
      let n = 0;
      for (const r of rooms.values()) {
        if (r.guildId !== guildId || (channelId && r.channelId !== channelId) || !r.currentGame) continue;
        r.forceStop(text);
        n++;
      }
      return n;
    },
    close: () =>
      new Promise<void>((done) => {
        clearInterval(sweeper);
        for (const ws of wss.clients) ws.close(1001, 'shutting down');
        for (const room of rooms.values()) room.dispose();
        server.close(() => done());
      }),
  };
}
