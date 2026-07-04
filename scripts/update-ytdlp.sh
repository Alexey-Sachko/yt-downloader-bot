#!/usr/bin/env bash
set -euo pipefail

# Update yt-dlp binary and rebuild/restart the bot container.
# Logged so cron failures are traceable.
LOG=/var/log/yt-dlp-update.log
echo "[$(date -Is)] updating yt-dlp" >> "$LOG"

curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp >> "$LOG" 2>&1
chmod a+rx /usr/local/bin/yt-dlp

# Rebuild the image so the container picks up the new binary, then restart.
cd /opt/yt-bot
docker compose build >> "$LOG" 2>&1
docker compose up -d >> "$LOG" 2>&1
echo "[$(date -Is)] done: $(/usr/local/bin/yt-dlp --version)" >> "$LOG"
