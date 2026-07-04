#!/usr/bin/env bash
set -euo pipefail

# Idempotent VPS prep for the yt-downloader bot.
# Safe to re-run.

DEPLOY_DIR=/opt/yt-bot

echo "== installing base packages =="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
apt-get update
apt-get install -y --no-install-recommends ffmpeg curl ca-certificates

echo "== yt-dlp binary =="
if [ ! -x /usr/local/bin/yt-dlp ]; then
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod a+rx /usr/local/bin/yt-dlp
fi

echo "== deploy dir =="
mkdir -p "$DEPLOY_DIR" "$DEPLOY_DIR/tmp"

echo "== daily yt-dlp update cron =="
CRON_LINE="0 4 * * * $DEPLOY_DIR/scripts/update-ytdlp.sh"
# add only if absent
( crontab -l 2>/dev/null | grep -Fv "update-ytdlp.sh" ; echo "$CRON_LINE" ) | crontab -

echo "== done. Put .env in $DEPLOY_DIR and run: docker compose up -d =="
