# Doodle Den: profile kit

Everything to paste into the [Discord Developer Portal](https://discord.com/developers/applications). Images are rendered by `npx tsx scripts/branding.ts`, using the same hand-drawn kit as the game boards.

## Images

| File | Size | Where it goes |
|---|---|---|
| `avatar.png` | 1024 × 1024 | **General Information → App Icon** (also becomes the bot's avatar) |
| `banner.png` | 1360 × 480 | **Bot → Banner** (profile header; the avatar sits over the bottom-left) |
| `activity-cover.png` | 1920 × 1080 | **Activities → Art Assets → Cover Image** (shown in the Activity shelf) |
| `avatar-preview-64.png` | 64 × 64 | Not uploaded. A check that the icon still reads at small sizes |

## Name

**Doodle Den** (General Information → Name, and Bot → Username)

## Description (General Information → Description, shown as the bot's "About me", max 400)

```
Party games that live in your server 🎲

Duel a friend right in chat (/tictactoe, /mancala, /hangman and 12 more) or run /play in a voice channel for Sketch Party, Odd One Out, Forbidden Words, Quiz Arena and Perp Arena.

🔒 Can't read your messages, never pings anyone, stores only scores. See /privacy
```

## Tags (General Information → Tags, max 5)

`Games` · `Party Games` · `Drawing` · `Trivia` · `Fun`

## App Directory

**Short description** (one line on the listing card):

```
Hand-drawn party games: chat duels, drawing, trivia and bluffing, with no message access.
```

**Detailed description:**

```
Doodle Den brings game night into your server, with everything drawn in a hand-sketched notebook style.

🎨 Activity games (run /play in a voice channel)
• Sketch Party: one player draws a secret word, everyone else races to guess it
• Odd One Out: everyone gets the same word except one player. Give clues, then find them
• Forbidden Words: describe the word without the five banned words, in teams
• Quiz Arena: live quizzes with speed scoring and streaks, plus an editor for your own
• Perp Arena: a play-money trading sim with leverage, liquidations and a debrief at the end

⚔️ Chat duels (challenge someone with a slash command)
Tic-tac-toe, four in a row, five in a row, dots and boxes, mancala, matchsticks, hangman, number duel, higher or lower, reaction duel and rock paper scissors.

🎉 Group games in chat
Trivia, battle royale, word guess and would you rather.

🔒 Built for privacy
• No message content access: the bot can't read your chat
• Never pings @everyone, roles or users
• Stores only per-server scores, deleted after 90 days
• /privacy my-data, forget-me and opt-out for members; /server-data wipe for admins
• No trackers, analytics or third-party services
```

## Links

| Field | Value |
|---|---|
| Privacy Policy URL | `https://github.com/cryoneth/discord-games-bot/blob/main/PRIVACY.md` |
| Terms of Service URL | No terms page exists yet. Discord asks for one for verification (75+ servers) and the App Directory |

## Colours

| Role | Hex |
|---|---|
| Brand blue (avatar background) | `#5A82FF` |
| Ink | `#2B2D42` |
| Paper | `#FDF8EC` |
| Highlighter yellow | `#FFCF3F` |
| Marker red | `#FF5A6E` |
| Teal | `#22C4B2` |
