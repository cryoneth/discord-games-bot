# Privacy Policy

This document describes the data handled by this bot as shipped in this repository. Whoever operates an instance of the bot is the data controller for that instance.

## Data we store

| Data | Why | Retention |
|---|---|---|
| Discord user ID, server ID, game, points, wins, games played, last-updated time | Leaderboards | Deleted automatically after 90 days without updates (configurable) |
| Discord user ID of users who opted out | To honor the opt-out | Until the user opts back in |

That is all. No usernames, nicknames, avatars, emails, IP addresses, message content, drawings or guesses are stored.

## Data we process temporarily (memory only)

- **Drawing Activity:** display names, drawings, guesses and in-game chat. These are discarded when the game ends or everyone leaves.
- **OAuth access token:** sent by the Activity once so the server can confirm who the player is with Discord. It is never stored or logged.
- **Chat games:** button clicks during a game.

## Data we never access

- **Server messages.** The bot has no Message Content intent.
- **Member lists and presence.** The bot has no privileged intents.
- **Players' IP addresses in the Activity.** Discord proxies all traffic, and the server writes no access logs.

## Your rights

- `/privacy info` explains what is stored.
- `/privacy my-data` gives you a JSON export of everything stored about you.
- `/privacy forget-me` deletes all of your records immediately.
- `/privacy opt-out` deletes your records and stops new ones from being recorded.
- Server managers can use `/server-data wipe` to delete all records for their server.

## Third parties

None. The only external service contacted is Discord's API.
