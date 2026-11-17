#!/bin/sh
# Backs up the bot's SQLite database without stopping the bot.
#
# SQLite's VACUUM INTO writes a consistent snapshot even while games are being
# recorded. The snapshot is integrity-checked, copied out of the container,
# gzipped, and backups older than KEEP_DAYS are deleted.
#
# Usage (from anywhere):  sh deploy/backup.sh
# Nightly at 03:30 (crontab -e):
#   30 3 * * * PATH=/usr/local/bin:/usr/bin:/bin sh /root/discord-games-bot/deploy/backup.sh >> /root/backups/backup.log 2>&1
#
# Restore: see "Backups" in README.md.
set -eu

cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y-%m-%d-%H%M)"
SNAPSHOT=/data/.backup-snapshot.db
OUT="$DEST/games-$STAMP.db"

mkdir -p "$DEST"

docker compose exec -T bot node -e "
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const snap = '$SNAPSHOT';
fs.rmSync(snap, { force: true });
const db = new DatabaseSync(process.env.DATA_DIR + '/games.db');
db.exec(\"VACUUM INTO '\" + snap + \"'\");
db.close();
const copy = new DatabaseSync(snap, { readOnly: true });
const ok = copy.prepare('PRAGMA integrity_check').get();
copy.close();
if (Object.values(ok)[0] !== 'ok') { fs.rmSync(snap, { force: true }); throw new Error('integrity check failed'); }
"

docker compose cp "bot:$SNAPSHOT" "$OUT"
docker compose exec -T bot node -e "require('node:fs').rmSync('$SNAPSHOT', { force: true })"
gzip -f "$OUT"

find "$DEST" -maxdepth 1 -name 'games-*.db.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
