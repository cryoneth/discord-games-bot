# Privacy Policy

This document describes the data handled by this bot as shipped in this repository. Whoever operates an instance of the bot is the data controller for that instance.

## Data we store

| Data | Why | Retention |
|---|---|---|
| Discord user ID, server ID, game, points, wins, games played, last-updated time | Leaderboards | Deleted automatically after 90 days without updates (configurable) |
| The same points, wins and games played split by UTC day | Daily, weekly and monthly leaderboards | Days older than 90 days are deleted automatically (configurable) |
| Discord user ID of users who opted out | To honor the opt-out | Until the user opts back in |
| Quizzes written in Quiz Arena: title, questions, answers, the author's Discord user ID, the server ID, created/edited/last-played times | So the server's members can play them again, and so only the author can edit them (server managers can delete them) | Deleted automatically after 90 days without being edited or played (configurable) |
| Chess tournaments: name, time control, start time, length, player limit, announcement channel ID, the organising moderator's user ID. For each player who joins: user ID, tournament points, wins, draws, losses, games, win streak, points per game, colour balance, whether a moderator removed them | To run tournaments scheduled ahead of time, keep standings across restarts and show results | Deleted automatically 90 days after the tournament ends (configurable), or when a moderator removes it |

That is all. No usernames, nicknames, avatars, emails, IP addresses, message content, drawings or guesses are stored.

## Data we process temporarily (memory only)

- **Activity games:** display names, drawings, guesses, clues, votes, simulated trades, chess moves and in-game chat. These are discarded when the game ends or everyone leaves. Perp Arena uses play money and a fictional asset; no real funds or market data are involved.
- **Chess tournament names:** to show standings of players who aren't online, their display name is looked up from Discord with the bot's token and kept in memory only.
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
- `/privacy forget-me` deletes all of your records immediately, including quizzes you wrote and your chess tournament entries (tournaments you organised stay, without your user ID).
- `/privacy opt-out` deletes your records and stops new ones from being recorded.
- Server managers can use `/server-data wipe` to delete all records for their server, including its quizzes and chess tournaments, and `/server-data delete-quiz` to remove a single quiz.

## Just for fun

All games and leaderboards are just for fun.

## Third parties

None. The only external service contacted is Discord's API.
