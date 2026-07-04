FROM node:22-bookworm-slim

# System deps: ffmpeg (muxing) + python/curl to fetch yt-dlp
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp static binary (auto-updated by cron on the VPS)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
