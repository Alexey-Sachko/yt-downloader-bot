# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Pre-implementation.** The repository currently contains only specs — no code, no `package.json`, no git history yet. The source of truth is [SPEC.md](SPEC.md) (written in Russian), distilled from [user-wish.md](user-wish.md). When implementing, follow SPEC.md; it defines the stack, architecture, and deployment before any code is written.

## What is being built

A Telegram bot that takes a YouTube link, uses `yt-dlp` to list available quality options, presents them as inline buttons, downloads the chosen quality, and sends the finished file back into the chat.

## Chosen stack (decided, do not re-litigate)

- **Runtime:** Node.js (JS/TypeScript).
- **Telegram library:** GramJS (npm package `telegram`) over **MTProto** — chosen specifically because MTProto allows **2 GB** file uploads vs. 50 MB on the HTTP Bot API. Do not swap to `node-telegram-bot-api`/`grammy`/HTTP Bot API; it would break the core file-size requirement.
- **Auth:** bot runs as a normal bot via Bot Token (`client.start({ botAuthToken })`), but still needs `api_id` + `api_hash` from my.telegram.org for MTProto. No personal/user account is involved.
- **Download:** `yt-dlp` invoked as an external process via `child_process` (not a library binding).
- **Muxing:** `ffmpeg` — required because 1080p+ on YouTube comes as separate video/audio streams that `yt-dlp` merges when `ffmpeg` is on PATH.

## Architecture (four layers)

1. **Telegram layer (GramJS):** receive messages, parse links, render inline buttons, upload files.
2. **yt-dlp layer:** wrapper around the CLI — `yt-dlp -J <url>` for the format list (JSON), `yt-dlp -f <format_id> <url>` to download.
3. **State layer:** maps `user ↔ link ↔ chosen format` across steps. Needed because a button press must recall which link is being processed. Design this so concurrent users don't collide.
4. **Temp file storage:** downloaded videos land in a temp dir and are cleaned up after sending.

## Key constraints and gotchas

- `yt-dlp` and `ffmpeg` are **never installed manually** — they arrive via the Docker image (local) and the VPS setup script (server). Same image is used for local dev and production.
- Downloads are long/async — surface status/progress so the bot doesn't appear hung.
- YouTube changes its protections often, so `yt-dlp` must be auto-updated (daily cron on the VPS); cookies may be needed to bypass captchas/blocks.

## Planned layout & tooling (from SPEC, not yet created)

- `Dockerfile` — Node base image + `yt-dlp` + `ffmpeg`.
- `docker-compose.yml` — local run: env vars, source mount for hot-reload, temp-dir mount.
- `.env` (gitignored) with `BOT_TOKEN`, `API_ID`, `API_HASH`; commit a `.env.example`.
- `scripts/setup-vps.sh` — idempotent VPS prep (Docker, ffmpeg, yt-dlp, deploy user/dirs, cron).
- `scripts/update-ytdlp.sh` — updates `yt-dlp`; run daily via cron.
- `.github/workflows/deploy.yml` — on push to main: build/push image → SSH to VPS → `docker compose up -d`. Secrets live in GitHub Secrets.

## Open questions (resolve before/while implementing — see SPEC §13)

Send as `video` (preview/seek) vs. `document` (no recompression); max size/duration cap; request queue for concurrent users; playlist support; user allowlist.
