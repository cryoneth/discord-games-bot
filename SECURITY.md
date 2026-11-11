# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability** on this repository. Don't open a public issue.

## Security design

**Discord permissions**
- Gateway intent: `Guilds` only. No privileged intents.
- Bot permissions: Send Messages, Embed Links and Attach Files. No admin, moderation or message-history permissions.
- `allowedMentions: { parse: [] }` is set on the client, so no output can ping anyone.
- `/server-data wipe` requires Manage Server and asks for confirmation.
- Stopping a game is limited to its host or a server manager.

**Activity (drawing game)**
- OAuth scope `identify` only. The code exchange happens server-side, and the client secret never reaches the browser.
- Every WebSocket player is verified twice. First the access token is checked against `GET /users/@me`. Then the bot token is used to confirm the user is a participant of that exact Activity instance.
- WebSocket upgrades are only accepted from `https://<client_id>.discordsays.com` in production.
- All server-authoritative logic runs on the server: only the current drawer can draw, the word is never sent to guessers, and correct guesses are never broadcast.
- Input is validated strictly. Colors and sizes must come from a fixed list, and strokes have limits on point count and coordinates. Text is length-limited and control characters are stripped.
- Rate limits apply per connection (messages and guesses), per IP on token exchange, per user on slash commands, and to room and connection counts. The maximum WebSocket payload is 16 KB.
- The frontend renders user data only via `textContent`; there is no `innerHTML`. A strict CSP is set with `script-src 'self'`, and there are no inline scripts or third-party origins.

**Server and deployment**
- Responses include a strict CSP, `nosniff`, `no-referrer`, a restrictive `Permissions-Policy` and HSTS (via Caddy).
- The static file server rejects path traversal.
- The container runs as a non-root user with a read-only root filesystem and all Linux capabilities dropped. `no-new-privileges` is set, along with memory and PID limits.
- The bot port is bound to localhost only. Only Caddy is exposed publicly.
- Secrets come from `.env`, which is git-ignored and never logged.
- CI runs type checks, tests, `npm audit` and a Docker build. Dependabot keeps dependencies current.
