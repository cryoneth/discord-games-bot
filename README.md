# Discord Games Bot

Privacy-focused party games that run entirely inside Discord, built to be safe for company servers.

| Game | How it's played | Where |
|---|---|---|
| 🧠 **Trivia** | `/trivia start`: multiple-choice questions answered with buttons, speed bonus, scoreboard | Chat |
| ⚔️ **Battle royale** | `/royale start`: players join with a button, the bot narrates rounds until one is left | Chat |
| 🎯 **Last One Standing** | `/laststanding start`: up to 250 players. Each round everyone secretly calls a coin flip, card colour, die, number or trap door. Wrong calls and no-shows are out until one player is left | Chat |
| 🐑 **Minority Wins** | `/minority start`: up to 250 players vote on a question with no right answer, and only the least popular answer survives. Ties keep everyone in, and the final two share the win | Chat |
| 🔤 **Word guess** | `/wordguess start`: the channel shares a set of guesses to find a secret five-letter word, entered through a pop-up and checked against a dictionary | Chat |
| ❌ **Tic-tac-toe** | `/tictactoe @user`: challenge someone and play on a button grid | Chat |
| 🔴 **Four in a row** | `/fourinarow @user`: drop discs into a 7×6 board until someone connects four | Chat |
| ✂️ **Rock paper scissors** | `/rps @user` for best of 3 with hidden picks, or `/rps` for one round against the bot | Chat |
| 🔳 **Dots and boxes** | `/dotsandboxes @user`: draw lines on a 3×3 grid of boxes (pick a box, then a side). Close a box to score it and go again | Chat |
| 🪵 **Matchsticks** | `/matchsticks @user`: take 1, 2 or 3 sticks from a pile of 15–23. Whoever takes the last stick loses | Chat |
| ⚫ **Five in a row** | `/fiveinarow @user`: place stones on a 9×9 board (pick a row letter, then a column) until someone gets five in a row | Chat |
| 🫘 **Mancala** | `/mancala @user`: sow seeds around the board (Kalah rules). Last seed in your store gives a free turn, landing in an empty pit captures the pit opposite | Chat |
| 🃏 **Higher or lower** | `/higherlower @user`: take turns calling whether the next card is higher or lower. A same-rank card is safe, one wrong call loses | Chat |
| 🪢 **Hangman duel** | `/hangman @user`: each player hides a word for the other through a pop-up (or gets a random one), then you take turns guessing letters or the whole answer. Six misses and you hang | Chat |
| 🔢 **Number duel** | `/numberduel @user`: each player hides a number from 1 to 100, then you take turns guessing the other's with higher/lower hints. Equal turns, so the second player can still draw level | Chat |
| ⚡ **Reaction duel** | `/reaction @user`: wait for the button to turn green, then click first. Clicking early loses the round. First to 2 | Chat |
| 🤔 **Would you rather** | `/wouldyourather`: an anonymous two-option vote with a results bar | Chat |
| 🎨 **Sketch Party** | One player draws a secret word, everyone else guesses. The host sets the game length: a time limit (5–20 min), first to a score (300–1200), or 1–3 rounds, plus 45/60/80 s per drawing | Activity |
| 🕵️ **Odd One Out** | Everyone gets the same secret word except one player, who gets a similar one and doesn't know it. Players give clues in turn, discuss, then vote. A caught odd one can still steal points by guessing the real word. General and crypto/DeFi word decks | Activity |
| 🚫 **Forbidden Words** | Two teams. The describer explains a word without five banned words, by voice or typed clues. Teammates guess, and the other team sees the card and buzzes slips. Typed clues are checked automatically. General and crypto/DeFi decks | Activity |
| 🚦 **Mass Reaction** | Up to 100 players. The pad turns red, then green at a random moment. Tap too early, miss it, or be among the slowest (20/30/50%, host's choice) and you're out. Reaction time is measured on each player's screen, so lag doesn't count | Activity |
| ⚡ **Quiz Arena** | Live multiple-choice quizzes with speed scoring and streaks. Two built-in crypto/DeFi quizzes, plus an in-app editor (with JSON import/export) so members can write quizzes for their server | Activity |
| 📈 **Perp Arena** | Trading simulator with play money on a fictional token: long/short with leverage, liquidations, funding, fees, stop-loss/take-profit, a safe lending vault and a risky farm that can get exploited. Scripted market scenarios with news. Ends with a personal debrief of what went right or wrong | Activity |

**Activity games** run in one Discord Activity: `/play` (or `/draw`) opens it in a voice channel, the host picks a game, and everyone in the call plays. The host can end a game early and switch to another between games.

Also: `/leaderboard`, `/privacy`, `/server-data wipe`.

## Privacy & security at a glance

- **Cannot read your chat.** Only the `Guilds` gateway intent is used. There is no Message Content access, and the bot can't see members or presence either.
- **Minimal data.** The only things stored are per-server score totals keyed by user ID, and quizzes members write for their server (with the author's user ID). Drawings, guesses, clues, votes, trades and in-game chat are kept in memory only. Old data is deleted automatically after 90 days by default.
- **User controls.** `/privacy my-data` exports a user's data, `/privacy forget-me` deletes it and `/privacy opt-out` stops tracking. Admins can delete all of a server's data with `/server-data wipe`.
- **No pings.** Every message the bot posts has mentions disabled, so it can never ping `@everyone`, roles or users.
- **Activity sandbox.** The Activity games run inside Discord's sandboxed iframe, and every request goes through Discord's proxy, so the server never sees players' IP addresses. It uses the `identify` OAuth scope only. Players are checked with Discord to confirm they're really in that Activity instance.
- **No third parties.** No analytics, trackers, CDNs or outside APIs other than Discord itself. Board images and animations are drawn on the server in memory with bundled fonts, contain no usernames and are never saved.
- **Hardened deploy.** The container runs as a non-root user with a read-only filesystem and all Linux capabilities dropped. HTTPS is handled by Caddy, and no access logs are written.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **General Information:** copy the **Application ID** into `DISCORD_CLIENT_ID`.
3. **Bot:** click **Reset Token** and copy it into `DISCORD_TOKEN`. Leave all **Privileged Gateway Intents OFF**.
4. **OAuth2:** copy the **Client Secret** into `DISCORD_CLIENT_SECRET`. Add the redirect `https://127.0.0.1` (Discord requires a placeholder for Activities).
5. **Activities → Settings:** enable Activities.
6. **Activities → URL Mappings:** map `/` to your domain, for example `games.example.com` (no `https://`).
7. **Installation:** use the scopes `bot` and `applications.commands` with the bot permissions **View Channels**, **Send Messages**, **Send Messages in Threads**, **Embed Links** and **Attach Files** (board images and animations are sent as attachments). Invite the bot with that link. If the bot is missing one of these in a channel, chat games reply with exactly which permission to grant instead of failing halfway.

## 2. Run locally

```bash
cp .env.example .env     # fill in the values
npm install
npm run build
npm run register         # registers slash commands (set DEV_GUILD_ID for instant updates)
npm run dev
```

Chat games work immediately. To test the Activity inside Discord, expose port 3000 over HTTPS, for example with `cloudflared tunnel --url http://localhost:3000`, and put that hostname in the URL mapping.

**Activity playground (no Discord needed).** Run `npm run play:server` and `npm run play:web` (two terminals, from the project folder), then open `http://localhost:5173/?name=Alice` in one tab and `?name=Bob` in others (without a name you get a random one). Each tab is a player with a fake sign-in. The mock mode only exists in the Vite dev server and is compiled out of production builds.

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
  render/             board images and confetti GIFs (@napi-rs/canvas + gifenc)
  ui/card.ts          Components V2 message cards shared by every game
  games/              all chat games, duel/turn helpers, pure rules (logic.ts), session lock, content
  commands/           /play, /draw, /leaderboard, /privacy, /server-data
  activity/server.ts  HTTP + WebSocket server for the Activity (auth, rate limits)
  activity/hub.ts     one per Activity instance: players, host, game picker, message envelope
  activity/base.ts    shared room plumbing for Activity games (seats, host, chat, timers)
  activity/room.ts    Sketch Party logic
  activity/games/     Odd One Out, Forbidden Words, Quiz Arena, Perp Arena (+ pure market engine)
  activity/data/      word pairs, cards and built-in quizzes
  shared/             message types shared with the Activity frontend, one file per game
activity/             Activity frontend (Vite, vanilla TypeScript): hub in main.ts, one screen per game
scripts/              image preview, Activity playground
test/                 node:test suites
```

`npm run typecheck` · `npm test` · `npm run build` · `npx tsx scripts/preview-images.ts <dir>` renders every game image for a visual check
