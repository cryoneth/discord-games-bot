# Privacy Policy

This document describes the data handled by this bot as shipped in this repository. Whoever operates an instance of the bot is the data controller for that instance.

## Data we store

| Data | Why | Retention |
|---|---|---|
| Discord user ID, server ID, game, points, wins, games played, last-updated time | Leaderboards | Deleted automatically after 90 days without updates (configurable) |
| Discord user ID of users who opted out | To honor the opt-out | Until the user opts back in |
| Quizzes written in Quiz Arena: title, questions, answers, the author's Discord user ID, the server ID, created/edited/last-played times | So the server's members can play them again, and so only the author can edit or delete them | Deleted automatically after 90 days without being edited or played (configurable) |

That is all. No usernames, nicknames, avatars, emails, IP addresses, message content, drawings or guesses are stored.

## Data we process temporarily (memory only)

- **Activity games:** display names, drawings, guesses, clues, votes, simulated trades and in-game chat. These are discarded when the game ends or everyone leaves. Perp Arena uses play money and a fictional asset; no real funds or market data are involved.
- **OAuth access token:** sent by the Activity once so the server can confirm who the player is with Discord. It is never stored or logged.
- **Chat games:** button clicks, word guesses and would-you-rather votes during a game. Votes are anonymous and discarded when voting closes.
- **Game images:** boards and animations are drawn in memory and uploaded to Discord as message attachments. They contain only the game state (no usernames) and are never saved on the server.

## Data we never access

- **Server messages.** The bot has no Message Content intent.
- **Member lists and presence.** The bot has no privileged intents.
- **Players' IP addresses in the Activity.** Discord proxies all traffic, and the server writes no access logs.

## Your rights

- `/privacy info` explains what is stored.
- `/privacy my-data` gives you a JSON export of everything stored about you.
- `/privacy forget-me` deletes all of your records immediately, including quizzes you wrote.
- `/privacy opt-out` deletes your records and stops new ones from being recorded.
- Server managers can use `/server-data wipe` to delete all records for their server, including its quizzes.

## Third parties

None. The only external service contacted is Discord's API.
