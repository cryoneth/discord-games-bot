# Discord Games Bot

Privacy-focused party games that run entirely inside Discord, built to be safe for company servers.

| Game | How it's played | Where |
|---|---|---|
| 🧠 **Trivia** | `/trivia start`: multiple-choice questions answered with buttons, speed bonus, scoreboard | Chat |
| ⚔️ **Battle royale** | `/royale start`: players join with a button, the bot narrates rounds until one is left | Chat |
| 🎨 **Sketch Party** | `/draw`: one player draws a secret word, everyone else guesses | Discord Activity (embedded in Discord) |

Also: `/leaderboard`, `/privacy`, `/server-data wipe`.

## Privacy & security at a glance

- **Cannot read your chat.** Only the `Guilds` gateway intent is used. There is no Message Content access, and the bot can't see members or presence either.
- **Minimal data.** The only thing stored is per-server score totals keyed by user ID. Drawings, guesses and in-game chat are kept in memory only. Old data is deleted automatically after 90 days by default.
- **User controls.** `/privacy my-data` exports a user's data, `/privacy forget-me` deletes it and `/privacy opt-out` stops tracking. Admins can delete all of a server's data with `/server-data wipe`.
- **No pings.** Every message the bot posts has mentions disabled, so it can never ping `@everyone`, roles or users.
- **Activity sandbox.** The drawing game runs inside Discord's sandboxed iframe, and every request goes through Discord's proxy, so the server never sees players' IP addresses. It uses the `identify` OAuth scope only. Players are checked with Discord to confirm they're really in that Activity instance.
- **No third parties.** No analytics, trackers, CDNs or outside APIs other than Discord itself.
- **Hardened deploy.** The container runs as a non-root user with a read-only filesystem and all Linux capabilities dropped. HTTPS is handled by Caddy, and no access logs are written.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **General Information:** copy the **Application ID** into `DISCORD_CLIENT_ID`.
3. **Bot:** click **Reset Token** and copy it into `DISCORD_TOKEN`. Leave all **Privileged Gateway Intents OFF**.
4. **OAuth2:** copy the **Client Secret** into `DISCORD_CLIENT_SECRET`. Add the redirect `https://127.0.0.1` (Discord requires a placeholder for Activities).
5. **Activities → Settings:** enable Activities.
6. **Activities → URL Mappings:** map `/` to your domain, for example `games.example.com` (no `https://`).
7. **Installation:** use the scopes `bot` and `applications.commands` with the bot permissions **Send Messages**, **Embed Links** and **Attach Files** (Attach Files is only used for `/privacy my-data`). Invite the bot with that link.

## 2. Run locally

```bash
cp .env.example .env     # fill in the values
npm install
npm run build
npm run register         # registers slash commands (set DEV_GUILD_ID for instant updates)
npm run dev
```

Chat games work immediately. To test the drawing Activity locally, expose port 3000 over HTTPS, for example with `cloudflared tunnel --url http://localhost:3000`, and put that hostname in the URL mapping.

## 3. Deploy (Hetzner or any Docker host)

Point a DNS `A` record for your domain at the server, then:

```bash
git clone git@github.com:<you>/discord-games-bot.git && cd discord-games-bot
cp .env.example .env && nano .env      # set the Discord values and DOMAIN
docker compose up -d --build
docker compose run --rm bot node dist/register.js
```

If the server already runs a reverse proxy on ports 80/443, start only the bot with `docker compose up -d --build bot` and proxy your domain to `127.0.0.1:3000`. WebSocket upgrades must be allowed on `/ws`.

**Update:** `git pull && docker compose up -d --build`
**Logs:** `docker compose logs -f bot`

## Development

```
src/
  index.ts            bot entrypoint (Discord client + web server)
  register.ts         slash command registration
  store.ts            SQLite score store (node:sqlite)
  games/              trivia, battle royale, shared session lock, game content
  commands/           /draw, /leaderboard, /privacy, /server-data
  activity/server.ts  HTTP + WebSocket server for the drawing Activity
  activity/room.ts    drawing game logic (transport-agnostic, unit-tested)
  shared/protocol.ts  message types shared with the Activity frontend
activity/             Activity frontend (Vite, vanilla TypeScript)
test/                 node:test suites
```

`npm run typecheck` · `npm test` · `npm run build`
