# YouTube Downloader Telegram Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Telegram bot (GramJS/MTProto) that takes a YouTube link, shows quality options as inline buttons, downloads the chosen quality via `yt-dlp`, and sends the file back into the chat.

**Architecture:** Four layers behind well-defined interfaces — Telegram (GramJS), yt-dlp CLI wrappers, in-memory state (behind a `StateStore` interface so it can later become Redis), and temp-file storage. A single-worker global queue serializes downloads. Pure logic (URL parsing, format filtering, queue, state, config) is unit-tested with TDD; process/network layers are thin wrappers tested with mocks.

**Tech Stack:** Node.js, TypeScript, GramJS (`telegram`), `yt-dlp` + `ffmpeg` (external processes via `child_process`), vitest, Docker.

**Design decisions (from spec):** send as **video** with **document** fallback; limits **500 MB / 2 h**; **global queue, concurrency 1**; **allowlist** by Telegram user ID (env); **single videos only** (no playlists).

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .gitignore, .env.example, .dockerignore
src/
  config.ts              — load+validate env → Config
  index.ts               — entry point, wire everything, graceful shutdown
  types.ts               — shared domain types (VideoInfo, RawFormat, QualityOption, Session)
  errors.ts              — typed error classes
  util/
    url.ts               — extract/validate YouTube video id
    format-bytes.ts      — human-readable byte sizes
    logger.ts            — structured console logger
  ytdlp/
    formats.ts           — buildQualityOptions(info, limits) pure logic
    probe.ts             — `yt-dlp -J` wrapper → VideoInfo
    download.ts          — `yt-dlp -f` wrapper → file path, progress
    progress.ts          — parseProgress(line) pure parser
  state/
    store.ts             — StateStore interface + InMemoryStore
  queue/
    queue.ts             — Queue (concurrency=1)
  files/
    tempdir.ts           — temp workspace create + cleanup
  telegram/
    client.ts            — build/start GramJS client
    ui.ts                — render inline buttons + status text (pure)
    handlers.ts          — message + callback handlers (orchestration)
tests/                   — mirrors src/ for unit tests + fixtures
Dockerfile, docker-compose.yml
scripts/setup-vps.sh, scripts/update-ytdlp.sh
.github/workflows/deploy.yml
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.dockerignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "yt-downloader-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "telegram": "^2.26.22"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
tmp/
*.log
```

- [ ] **Step 5: Create `.dockerignore`**

```
node_modules
dist
.git
.env
tmp
docs
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .dockerignore
git commit -m "chore: project scaffold (TS, vitest, GramJS dep)"
```

---

## Task 2: Shared types and errors

**Files:**
- Create: `src/types.ts`, `src/errors.ts`

- [ ] **Step 1: Create `src/types.ts`**

```typescript
/** One format entry as returned by `yt-dlp -J` (only fields we use). */
export interface RawFormat {
  format_id: string;
  ext: string;
  height?: number | null;
  width?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  vcodec?: string;
  acodec?: string;
  fps?: number | null;
  tbr?: number | null; // total bitrate, kbit/s
}

/** Normalized result of probing a single video. */
export interface VideoInfo {
  id: string;
  title: string;
  durationSec: number | null;
  formats: RawFormat[];
}

/** A user-facing quality choice. */
export interface QualityOption {
  label: string; // e.g. "1080p"
  height: number;
  formatSelector: string; // value passed to `yt-dlp -f`
  approxBytes: number | null;
}

/** Per-user session remembered between the link message and the button press. */
export interface Session {
  url: string;
  title: string;
  durationSec: number | null;
  options: QualityOption[];
  promptMessageId?: number;
  createdAt: number; // Date.now()
}
```

- [ ] **Step 2: Create `src/errors.ts`**

```typescript
export class UnauthorizedError extends Error {}
export class InvalidUrlError extends Error {}
export class ProbeError extends Error {}
export class NoSuitableFormatError extends Error {}
export class DownloadError extends Error {}
export class TooLargeError extends Error {}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/errors.ts
git commit -m "feat: shared domain types and typed errors"
```

---

## Task 3: URL parsing (TDD)

**Files:**
- Create: `src/util/url.ts`
- Test: `tests/util/url.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/util/url.test.ts
import { describe, it, expect } from "vitest";
import { extractYouTubeVideoId, isPlaylistOnly } from "../../src/util/url.js";

describe("extractYouTubeVideoId", () => {
  it("parses standard watch URLs", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses youtu.be short URLs", () => {
    expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses Shorts URLs", () => {
    expect(extractYouTubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("extracts the video id even when a playlist param is present", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz")).toBe("dQw4w9WgXcQ");
  });
  it("returns null for a playlist-only URL", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/playlist?list=PLxyz")).toBeNull();
  });
  it("returns null for a non-YouTube URL", () => {
    expect(extractYouTubeVideoId("https://vimeo.com/12345")).toBeNull();
  });
});

describe("isPlaylistOnly", () => {
  it("is true for a playlist URL without a video id", () => {
    expect(isPlaylistOnly("https://www.youtube.com/playlist?list=PLxyz")).toBe(true);
  });
  it("is false for a watch URL", () => {
    expect(isPlaylistOnly("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/util/url.test.ts`
Expected: FAIL — cannot find module `src/util/url.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/util/url.ts
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"]);

/** Returns the 11-char video id, or null if the URL has no single video. */
export function extractYouTubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  // youtu.be/<id>
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return isValidId(id) ? id : null;
  }
  // /shorts/<id>  or  /embed/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "shorts" || parts[0] === "embed") {
    return isValidId(parts[1]) ? parts[1] : null;
  }
  // /watch?v=<id>
  const v = url.searchParams.get("v");
  return v && isValidId(v) ? v : null;
}

/** True when the URL points at a playlist but not a single video. */
export function isPlaylistOnly(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return false;
  }
  return url.searchParams.has("list") && extractYouTubeVideoId(input) === null;
}

function isValidId(id: string | undefined): id is string {
  return !!id && /^[A-Za-z0-9_-]{11}$/.test(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/util/url.test.ts`
Expected: PASS (6 + 2 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/util/url.ts tests/util/url.test.ts
git commit -m "feat: YouTube URL parsing with playlist handling"
```

---

## Task 4: Byte formatting + logger

**Files:**
- Create: `src/util/format-bytes.ts`, `src/util/logger.ts`
- Test: `tests/util/format-bytes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/util/format-bytes.test.ts
import { describe, it, expect } from "vitest";
import { formatBytes } from "../../src/util/format-bytes.js";

describe("formatBytes", () => {
  it("formats null as unknown", () => {
    expect(formatBytes(null)).toBe("? MB");
  });
  it("formats megabytes", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("formats gigabytes", () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/util/format-bytes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/util/format-bytes.ts
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "? MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}
```

```typescript
// src/util/logger.ts
type Level = "info" | "warn" | "error";
function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), level, msg, ...meta };
  const out = level === "error" ? console.error : console.log;
  out(JSON.stringify(line));
}
export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/util/format-bytes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/util/format-bytes.ts src/util/logger.ts tests/util/format-bytes.test.ts
git commit -m "feat: byte formatting and structured logger"
```

---

## Task 5: Config loading (TDD)

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  BOT_TOKEN: "123:abc",
  API_ID: "12345",
  API_HASH: "deadbeef",
};

describe("loadConfig", () => {
  it("loads required values", () => {
    const c = loadConfig(base);
    expect(c.botToken).toBe("123:abc");
    expect(c.apiId).toBe(12345);
    expect(c.apiHash).toBe("deadbeef");
  });
  it("throws when a required var is missing", () => {
    expect(() => loadConfig({ API_ID: "1", API_HASH: "x" })).toThrow(/BOT_TOKEN/);
  });
  it("throws when API_ID is not a number", () => {
    expect(() => loadConfig({ ...base, API_ID: "notanumber" })).toThrow(/API_ID/);
  });
  it("parses allowlist into numbers", () => {
    const c = loadConfig({ ...base, ALLOWED_USER_IDS: "111, 222 ,333" });
    expect(c.allowedUserIds).toEqual([111, 222, 333]);
  });
  it("defaults limits to 500MB / 2h", () => {
    const c = loadConfig(base);
    expect(c.maxFilesizeBytes).toBe(500 * 1024 * 1024);
    expect(c.maxDurationSec).toBe(2 * 60 * 60);
  });
  it("isAllowed denies users not on a non-empty allowlist", () => {
    const c = loadConfig({ ...base, ALLOWED_USER_IDS: "111" });
    expect(c.isAllowed(111)).toBe(true);
    expect(c.isAllowed(999)).toBe(false);
  });
  it("isAllowed permits everyone when the allowlist is empty", () => {
    const c = loadConfig(base);
    expect(c.isAllowed(999)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/config.ts
import os from "node:os";
import path from "node:path";

export interface Config {
  botToken: string;
  apiId: number;
  apiHash: string;
  allowedUserIds: number[];
  maxFilesizeBytes: number;
  maxDurationSec: number;
  tempDir: string;
  isAllowed(userId: number): boolean;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v || v.trim() === "") throw new Error(`Missing required env var: ${key}`);
  return v.trim();
}

function intVar(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env var ${key} must be a number, got: ${raw}`);
  return n;
}

export function loadConfig(env: Env = process.env): Config {
  const botToken = required(env, "BOT_TOKEN");
  const apiIdRaw = required(env, "API_ID");
  const apiId = Number(apiIdRaw);
  if (!Number.isInteger(apiId)) throw new Error(`Env var API_ID must be an integer, got: ${apiIdRaw}`);
  const apiHash = required(env, "API_HASH");

  const allowedUserIds = (env.ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n)) throw new Error(`ALLOWED_USER_IDS contains a non-integer: ${s}`);
      return n;
    });

  const maxFilesizeBytes = intVar(env, "MAX_FILESIZE_BYTES", 500 * 1024 * 1024);
  const maxDurationSec = intVar(env, "MAX_DURATION_SEC", 2 * 60 * 60);
  const tempDir = env.TEMP_DIR?.trim() || path.join(os.tmpdir(), "yt-bot");

  return {
    botToken,
    apiId,
    apiHash,
    allowedUserIds,
    maxFilesizeBytes,
    maxDurationSec,
    tempDir,
    isAllowed(userId: number) {
      return allowedUserIds.length === 0 || allowedUserIds.includes(userId);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: env config loading and validation"
```

---

## Task 6: Format filtering (TDD)

**Files:**
- Create: `src/ytdlp/formats.ts`
- Test: `tests/ytdlp/formats.test.ts`, `tests/fixtures/yt-dlp-info.json`

- [ ] **Step 1: Create the fixture** `tests/fixtures/yt-dlp-info.json`

```json
{
  "id": "vid123",
  "title": "Test Video",
  "duration": 300,
  "formats": [
    { "format_id": "18", "ext": "mp4", "height": 360, "width": 640, "vcodec": "avc1", "acodec": "mp4a", "filesize": 20000000 },
    { "format_id": "136", "ext": "mp4", "height": 720, "width": 1280, "vcodec": "avc1", "acodec": "none", "filesize": 60000000 },
    { "format_id": "137", "ext": "mp4", "height": 1080, "width": 1920, "vcodec": "avc1", "acodec": "none", "filesize": 120000000 },
    { "format_id": "401", "ext": "mp4", "height": 2160, "width": 3840, "vcodec": "av01", "acodec": "none", "filesize": 900000000 },
    { "format_id": "140", "ext": "m4a", "height": null, "width": null, "vcodec": "none", "acodec": "mp4a", "filesize": 5000000 }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/ytdlp/formats.test.ts
import { describe, it, expect } from "vitest";
import info from "../fixtures/yt-dlp-info.json";
import { buildQualityOptions } from "../../src/ytdlp/formats.js";
import type { VideoInfo } from "../../src/types.js";

const video = info as unknown as VideoInfo;
// note: fixture uses `duration`; probe maps it to `durationSec`. Adapt here:
const asInfo: VideoInfo = {
  id: video.id,
  title: video.title,
  durationSec: (info as any).duration,
  formats: (info as any).formats,
};

const limits = { maxBytes: 500 * 1024 * 1024, maxDurationSec: 2 * 60 * 60 };

describe("buildQualityOptions", () => {
  it("produces one option per distinct height, sorted descending", () => {
    const opts = buildQualityOptions(asInfo, limits);
    const labels = opts.map((o) => o.label);
    // 2160p (~905MB) is over the 500MB limit and must be filtered out
    expect(labels).toEqual(["1080p", "720p", "360p"]);
  });

  it("estimates size = video bytes + best audio bytes for video-only formats", () => {
    const opts = buildQualityOptions(asInfo, limits);
    const p1080 = opts.find((o) => o.label === "1080p")!;
    expect(p1080.approxBytes).toBe(120000000 + 5000000);
  });

  it("uses the format's own bytes for progressive (already has audio) formats", () => {
    const opts = buildQualityOptions(asInfo, limits);
    const p360 = opts.find((o) => o.label === "360p")!;
    expect(p360.approxBytes).toBe(20000000);
  });

  it("builds an ffmpeg-merge selector for a given height", () => {
    const opts = buildQualityOptions(asInfo, limits);
    const p720 = opts.find((o) => o.label === "720p")!;
    expect(p720.formatSelector).toBe("bestvideo[height<=720]+bestaudio/best[height<=720]");
  });

  it("returns [] when all heights exceed the size limit", () => {
    const tiny = { maxBytes: 1000, maxDurationSec: 99999 };
    expect(buildQualityOptions(asInfo, tiny)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/ytdlp/formats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```typescript
// src/ytdlp/formats.ts
import type { RawFormat, VideoInfo, QualityOption } from "../types.js";

export interface FormatLimits {
  maxBytes: number;
  maxDurationSec: number;
}

function bytesOf(f: RawFormat): number | null {
  return f.filesize ?? f.filesize_approx ?? null;
}

/**
 * Reduce raw yt-dlp formats to user-facing quality options.
 * One option per distinct video height, sorted high→low, filtered by size limit.
 */
export function buildQualityOptions(info: VideoInfo, limits: FormatLimits): QualityOption[] {
  const videoFormats = info.formats.filter((f) => f.vcodec && f.vcodec !== "none" && f.height);

  // best audio (video-only formats need it added for a realistic size estimate)
  const audioBytes = info.formats
    .filter((f) => (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none")
    .map(bytesOf)
    .filter((b): b is number => b != null)
    .sort((a, b) => b - a)[0] ?? null;

  // pick the largest (best) format per height
  const byHeight = new Map<number, RawFormat>();
  for (const f of videoFormats) {
    const h = f.height!;
    const current = byHeight.get(h);
    if (!current || (bytesOf(f) ?? 0) > (bytesOf(current) ?? 0)) byHeight.set(h, f);
  }

  const options: QualityOption[] = [];
  for (const [height, f] of byHeight) {
    const isProgressive = !!f.acodec && f.acodec !== "none";
    const own = bytesOf(f);
    const approxBytes = own == null ? null : isProgressive ? own : own + (audioBytes ?? 0);
    if (approxBytes != null && approxBytes > limits.maxBytes) continue;
    options.push({
      label: `${height}p`,
      height,
      formatSelector: `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      approxBytes,
    });
  }

  return options.sort((a, b) => b.height - a.height);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ytdlp/formats.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ytdlp/formats.ts tests/ytdlp/formats.test.ts tests/fixtures/yt-dlp-info.json
git commit -m "feat: reduce yt-dlp formats to size-limited quality options"
```

---

## Task 7: State store (TDD)

**Files:**
- Create: `src/state/store.ts`
- Test: `tests/state/store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/state/store.test.ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/state/store.js";
import type { Session } from "../../src/types.js";

function session(url = "u"): Session {
  return { url, title: "t", durationSec: 10, options: [], createdAt: Date.now() };
}

describe("InMemoryStore", () => {
  it("stores and retrieves a session by user id", () => {
    const s = new InMemoryStore(1000);
    s.set(42, session("abc"));
    expect(s.get(42)?.url).toBe("abc");
  });
  it("returns undefined for unknown users", () => {
    const s = new InMemoryStore(1000);
    expect(s.get(99)).toBeUndefined();
  });
  it("deletes a session", () => {
    const s = new InMemoryStore(1000);
    s.set(42, session());
    s.delete(42);
    expect(s.get(42)).toBeUndefined();
  });
  it("expires sessions older than the TTL", () => {
    const s = new InMemoryStore(1000);
    const old = session();
    old.createdAt = Date.now() - 2000; // older than 1000ms TTL
    s.set(7, old);
    expect(s.get(7)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/state/store.ts
import type { Session } from "../types.js";

/** Storage boundary. Swap InMemoryStore for a Redis-backed impl later. */
export interface StateStore {
  set(userId: number, session: Session): void;
  get(userId: number): Session | undefined;
  delete(userId: number): void;
}

export class InMemoryStore implements StateStore {
  private map = new Map<number, Session>();

  constructor(private ttlMs = 10 * 60 * 1000) {}

  set(userId: number, session: Session): void {
    this.map.set(userId, session);
  }

  get(userId: number): Session | undefined {
    const s = this.map.get(userId);
    if (!s) return undefined;
    if (Date.now() - s.createdAt > this.ttlMs) {
      this.map.delete(userId);
      return undefined;
    }
    return s;
  }

  delete(userId: number): void {
    this.map.delete(userId);
  }

  /** Optional periodic sweep to drop expired sessions. */
  sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.map) {
      if (now - s.createdAt > this.ttlMs) this.map.delete(id);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts tests/state/store.test.ts
git commit -m "feat: StateStore interface + in-memory implementation with TTL"
```

---

## Task 8: Download queue (TDD)

**Files:**
- Create: `src/queue/queue.ts`
- Test: `tests/queue/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/queue/queue.test.ts
import { describe, it, expect } from "vitest";
import { Queue } from "../../src/queue/queue.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Queue", () => {
  it("runs jobs one at a time (concurrency 1)", async () => {
    const q = new Queue(1);
    const running: number[] = [];
    let maxConcurrent = 0;
    let current = 0;
    const job = () => async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await delay(10);
      current--;
      running.push(1);
    };
    await Promise.all([q.add(job()), q.add(job()), q.add(job())]);
    expect(maxConcurrent).toBe(1);
    expect(running.length).toBe(3);
  });

  it("preserves FIFO order", async () => {
    const q = new Queue(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => q.add(async () => { await delay(5); order.push(n); })));
    expect(order).toEqual([1, 2, 3]);
  });

  it("returns the job result", async () => {
    const q = new Queue(1);
    await expect(q.add(async () => 42)).resolves.toBe(42);
  });

  it("a failing job does not stall the queue", async () => {
    const q = new Queue(1);
    await expect(q.add(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(q.add(async () => "ok")).resolves.toBe("ok");
  });

  it("reports pending size", async () => {
    const q = new Queue(1);
    const p1 = q.add(async () => { await delay(20); });
    const p2 = q.add(async () => {});
    expect(q.size()).toBeGreaterThanOrEqual(1);
    await Promise.all([p1, p2]);
    expect(q.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/queue/queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/queue/queue.ts
type Task = () => Promise<void>;

/** Minimal promise queue. Default concurrency 1 serializes all downloads. */
export class Queue {
  private queue: Task[] = [];
  private active = 0;

  constructor(private concurrency = 1) {}

  /** Number of jobs waiting or running. */
  size(): number {
    return this.queue.length + this.active;
  }

  add<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: Task = async () => {
        try {
          resolve(await job());
        } catch (err) {
          reject(err as Error);
        }
      };
      this.queue.push(task);
      this.next();
    });
  }

  private next(): void {
    if (this.active >= this.concurrency) return;
    const task = this.queue.shift();
    if (!task) return;
    this.active++;
    task().finally(() => {
      this.active--;
      this.next();
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/queue/queue.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/queue/queue.ts tests/queue/queue.test.ts
git commit -m "feat: single-worker promise queue for downloads"
```

---

## Task 9: Progress parser (TDD)

**Files:**
- Create: `src/ytdlp/progress.ts`
- Test: `tests/ytdlp/progress.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ytdlp/progress.test.ts
import { describe, it, expect } from "vitest";
import { parseProgress } from "../../src/ytdlp/progress.js";

describe("parseProgress", () => {
  it("parses a percentage from a yt-dlp download line", () => {
    expect(parseProgress("[download]  45.2% of 100.00MiB at 2.00MiB/s ETA 00:30")).toBe(45.2);
  });
  it("parses an integer percentage", () => {
    expect(parseProgress("[download] 100% of 10.00MiB")).toBe(100);
  });
  it("returns null for non-progress lines", () => {
    expect(parseProgress("[info] Writing video subtitles")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ytdlp/progress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/ytdlp/progress.ts
const RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

/** Extract download percent (0–100) from a yt-dlp stdout line, or null. */
export function parseProgress(line: string): number | null {
  const m = RE.exec(line);
  return m ? Number(m[1]) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ytdlp/progress.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ytdlp/progress.ts tests/ytdlp/progress.test.ts
git commit -m "feat: parse yt-dlp download progress lines"
```

---

## Task 10: yt-dlp probe wrapper (mock test)

**Files:**
- Create: `src/ytdlp/probe.ts`
- Test: `tests/ytdlp/probe.test.ts`

- [ ] **Step 1: Write the failing test** (mocks `child_process.execFile`)

```typescript
// tests/ytdlp/probe.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { probe } from "../../src/ytdlp/probe.js";

// execFile(cmd, args, opts, cb) — invoke the callback with (err, stdout, stderr)
function mockExec(err: unknown, stdout: string, stderr = "") {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb) => cb(err, stdout, stderr));
}

describe("probe", () => {
  beforeEach(() => execFileMock.mockReset());

  it("parses yt-dlp -J output into VideoInfo", async () => {
    mockExec(null, JSON.stringify({
      id: "abc", title: "Hi", duration: 120,
      formats: [{ format_id: "18", ext: "mp4", height: 360, vcodec: "avc1", acodec: "mp4a" }],
    }));
    const info = await probe("https://youtu.be/abc");
    expect(info.id).toBe("abc");
    expect(info.title).toBe("Hi");
    expect(info.durationSec).toBe(120);
    expect(info.formats).toHaveLength(1);
  });

  it("throws ProbeError on non-zero exit", async () => {
    mockExec(Object.assign(new Error("exit 1"), { code: 1 }), "", "ERROR: unavailable");
    await expect(probe("https://youtu.be/abc")).rejects.toThrow(/unavailable|probe/i);
  });

  it("throws ProbeError on invalid JSON", async () => {
    mockExec(null, "not json");
    await expect(probe("https://youtu.be/abc")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ytdlp/probe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/ytdlp/probe.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoInfo, RawFormat } from "../types.js";
import { ProbeError } from "../errors.js";

const execFileAsync = promisify(execFile);

/** Run `yt-dlp -J <url>` and normalize the result. Single video only. */
export async function probe(url: string): Promise<VideoInfo> {
  let stdout: string;
  try {
    const res = await execFileAsync(
      "yt-dlp",
      ["-J", "--no-playlist", "--no-warnings", url],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    stdout = res.stdout;
  } catch (err: any) {
    throw new ProbeError(`yt-dlp probe failed: ${err?.stderr || err?.message || "unknown error"}`);
  }

  let raw: any;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new ProbeError("yt-dlp returned invalid JSON");
  }

  return {
    id: raw.id,
    title: raw.title ?? "video",
    durationSec: raw.duration ?? null,
    formats: (raw.formats ?? []) as RawFormat[],
  };
}
```

> NOTE for the executor: `promisify(execFile)` yields `{ stdout, stderr }`; on non-zero exit it rejects with an error carrying `.stderr`. The test mocks the callback-style `execFile`, which `promisify` adapts — this works because `promisify` calls the mocked function with a trailing callback.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ytdlp/probe.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ytdlp/probe.ts tests/ytdlp/probe.test.ts
git commit -m "feat: yt-dlp -J probe wrapper"
```

---

## Task 11: yt-dlp download wrapper (mock test)

**Files:**
- Create: `src/ytdlp/download.ts`
- Test: `tests/ytdlp/download.test.ts`

- [ ] **Step 1: Write the failing test** (mocks `child_process.spawn` with a fake emitter)

```typescript
// tests/ytdlp/download.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { download } from "../../src/ytdlp/download.js";

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

describe("download", () => {
  beforeEach(() => spawnMock.mockReset());

  it("reports progress and resolves with the output path on exit 0", async () => {
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const seen: number[] = [];

    const promise = download({
      url: "https://youtu.be/abc",
      formatSelector: "best",
      videoId: "abc",
      outDir: "/tmp/work",
      onProgress: (p) => seen.push(p),
    });

    proc.stdout.emit("data", Buffer.from("[download]  50.0% of 10MiB\n"));
    proc.stdout.emit("data", Buffer.from("[download] 100% of 10MiB\n"));
    proc.emit("close", 0);

    const path = await promise;
    expect(path).toBe("/tmp/work/abc.mp4");
    expect(seen).toContain(50);
    expect(seen).toContain(100);
  });

  it("rejects with DownloadError on non-zero exit", async () => {
    const proc = new FakeProc();
    spawnMock.mockReturnValue(proc);
    const promise = download({
      url: "u", formatSelector: "best", videoId: "abc", outDir: "/tmp/work", onProgress: () => {},
    });
    proc.stderr.emit("data", Buffer.from("ERROR: blocked\n"));
    proc.emit("close", 1);
    await expect(promise).rejects.toThrow(/blocked|download/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ytdlp/download.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/ytdlp/download.ts
import { spawn } from "node:child_process";
import path from "node:path";
import { parseProgress } from "./progress.js";
import { DownloadError } from "../errors.js";

export interface DownloadArgs {
  url: string;
  formatSelector: string;
  videoId: string;
  outDir: string;
  onProgress: (percent: number) => void;
}

/**
 * Run `yt-dlp -f <selector> --merge-output-format mp4` into outDir.
 * Resolves with the absolute path of the produced mp4 file.
 */
export function download(args: DownloadArgs): Promise<string> {
  const outPath = path.join(args.outDir, `${args.videoId}.mp4`);
  const outTemplate = path.join(args.outDir, `${args.videoId}.%(ext)s`);

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "-f", args.formatSelector,
      "--merge-output-format", "mp4",
      "--no-playlist",
      "--newline",
      "--no-warnings",
      "-o", outTemplate,
      args.url,
    ]);

    let stderr = "";
    let lastPercent = -1;

    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const p = parseProgress(line);
        if (p != null && Math.floor(p) !== Math.floor(lastPercent)) {
          lastPercent = p;
          args.onProgress(p);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err) => reject(new DownloadError(`Failed to start yt-dlp: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(outPath);
      else reject(new DownloadError(`yt-dlp exited ${code}: ${stderr.trim() || "download failed"}`));
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ytdlp/download.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ytdlp/download.ts tests/ytdlp/download.test.ts
git commit -m "feat: yt-dlp download wrapper with progress and mp4 merge"
```

---

## Task 12: Temp workspace (mock-free integration test)

**Files:**
- Create: `src/files/tempdir.ts`
- Test: `tests/files/tempdir.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/files/tempdir.test.ts
import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createWorkspace } from "../../src/files/tempdir.js";

describe("createWorkspace", () => {
  it("creates a unique directory and cleans it up", async () => {
    const ws = await createWorkspace(path.join(os.tmpdir(), "yt-bot-test"));
    expect(fs.existsSync(ws.dir)).toBe(true);
    fs.writeFileSync(path.join(ws.dir, "f.txt"), "x");
    await ws.cleanup();
    expect(fs.existsSync(ws.dir)).toBe(false);
  });

  it("cleanup is safe to call twice", async () => {
    const ws = await createWorkspace(path.join(os.tmpdir(), "yt-bot-test"));
    await ws.cleanup();
    await expect(ws.cleanup()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/files/tempdir.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/files/tempdir.ts
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface Workspace {
  dir: string;
  cleanup(): Promise<void>;
}

/** Create a unique working directory under `baseDir`. */
export async function createWorkspace(baseDir: string): Promise<Workspace> {
  const dir = path.join(baseDir, randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return {
    dir,
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/files/tempdir.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/files/tempdir.ts tests/files/tempdir.test.ts
git commit -m "feat: temp workspace with guaranteed cleanup"
```

---

## Task 13: Telegram UI rendering (TDD)

**Files:**
- Create: `src/telegram/ui.ts`
- Test: `tests/telegram/ui.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telegram/ui.test.ts
import { describe, it, expect } from "vitest";
import { buttonRows, statusText } from "../../src/telegram/ui.js";
import type { QualityOption } from "../../src/types.js";

const opts: QualityOption[] = [
  { label: "1080p", height: 1080, formatSelector: "s1080", approxBytes: 125_000_000 },
  { label: "720p", height: 720, formatSelector: "s720", approxBytes: null },
];

describe("buttonRows", () => {
  it("creates one row per option with index-based callback data", () => {
    const rows = buttonRows(opts);
    expect(rows).toHaveLength(2);
    expect(rows[0][0].text).toContain("1080p");
    expect(rows[0][0].text).toContain("119.2 MB"); // 125,000,000 bytes
    expect(rows[0][0].data).toBe("dl:0");
    expect(rows[1][0].data).toBe("dl:1");
  });
  it("shows a ? size when unknown", () => {
    const rows = buttonRows(opts);
    expect(rows[1][0].text).toContain("? MB");
  });
});

describe("statusText", () => {
  it("renders a queued message", () => {
    expect(statusText({ kind: "queued", position: 2 })).toMatch(/queue|очеред/i);
  });
  it("renders a percentage while downloading", () => {
    expect(statusText({ kind: "downloading", percent: 42 })).toContain("42");
  });
});
```

> `buttonRows` returns a plain data structure (`{ text, data }`) so it's unit-testable
> without GramJS. `handlers.ts` maps it to real `Button.inline(...)` objects.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram/ui.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/telegram/ui.ts
import type { QualityOption } from "../types.js";
import { formatBytes } from "../util/format-bytes.js";

export interface ButtonSpec {
  text: string;
  data: string; // e.g. "dl:0"
}

/** One button per quality option; callback data references the option by index. */
export function buttonRows(options: QualityOption[]): ButtonSpec[][] {
  return options.map((o, i) => [
    { text: `${o.label} (~${formatBytes(o.approxBytes)})`, data: `dl:${i}` },
  ]);
}

export type Status =
  | { kind: "queued"; position: number }
  | { kind: "downloading"; percent: number }
  | { kind: "uploading" }
  | { kind: "done" };

export function statusText(s: Status): string {
  switch (s.kind) {
    case "queued": return `⏳ In queue (position ${s.position})…`;
    case "downloading": return `⬇️ Downloading… ${Math.floor(s.percent)}%`;
    case "uploading": return `⬆️ Uploading to Telegram…`;
    case "done": return `✅ Done`;
  }
}

/** Parse "dl:<index>" callback data back into an index, or null. */
export function parseCallbackData(data: string): number | null {
  const m = /^dl:(\d+)$/.exec(data);
  return m ? Number(m[1]) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram/ui.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/telegram/ui.ts tests/telegram/ui.test.ts
git commit -m "feat: testable Telegram UI rendering (buttons + status)"
```

---

## Task 14: GramJS client factory

**Files:**
- Create: `src/telegram/client.ts`

> No unit test — this is a thin wrapper over GramJS I/O, verified end-to-end later.

- [ ] **Step 1: Implement**

```typescript
// src/telegram/client.ts
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { Config } from "../config.js";
import { logger } from "../util/logger.js";

/** Build and start a GramJS client authenticated as a bot. */
export async function startClient(config: Config): Promise<TelegramClient> {
  const client = new TelegramClient(
    new StringSession(""),
    config.apiId,
    config.apiHash,
    { connectionRetries: 5 },
  );
  await client.start({ botAuthToken: config.botToken });
  logger.info("Telegram client started");
  return client;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/telegram/client.ts
git commit -m "feat: GramJS bot client factory"
```

---

## Task 15: Handlers — link message flow

**Files:**
- Create: `src/telegram/handlers.ts`

> Orchestration layer. It wires config, probe, formats, state, queue, download, and
> the GramJS client. GramJS I/O is accessed through a small `Bot` port object so the
> pure orchestration can be unit-tested in Task 16 without a live client.

- [ ] **Step 1: Implement the port + link handler**

```typescript
// src/telegram/handlers.ts
import type { Config } from "../config.js";
import type { StateStore } from "../state/store.js";
import type { Queue } from "../queue/queue.js";
import type { VideoInfo } from "../types.js";
import { extractYouTubeVideoId, isPlaylistOnly } from "../util/url.js";
import { buildQualityOptions } from "../ytdlp/formats.js";
import { buttonRows, statusText, parseCallbackData } from "./ui.js";
import { createWorkspace } from "../files/tempdir.js";
import { formatBytes } from "../util/format-bytes.js";
import {
  InvalidUrlError, NoSuitableFormatError, TooLargeError,
} from "../errors.js";
import { logger } from "../util/logger.js";
import fs from "node:fs/promises";

/** I/O port over GramJS so handlers stay testable. */
export interface Bot {
  reply(chatId: string, text: string, buttons?: { text: string; data: string }[][]): Promise<number>;
  editText(chatId: string, messageId: number, text: string): Promise<void>;
  sendVideo(chatId: string, filePath: string, opts: { durationSec: number | null; title: string; asDocument: boolean }): Promise<void>;
}

export interface Deps {
  config: Config;
  store: StateStore;
  queue: Queue;
  bot: Bot;
  probe: (url: string) => Promise<VideoInfo>;
  download: (a: { url: string; formatSelector: string; videoId: string; outDir: string; onProgress: (p: number) => void }) => Promise<string>;
}

/** Handle an incoming text message (expected to be a YouTube link). */
export async function handleMessage(
  deps: Deps,
  input: { userId: number; chatId: string; text: string },
): Promise<void> {
  const { config, store, bot } = deps;

  if (!config.isAllowed(input.userId)) {
    await bot.reply(input.chatId, "⛔ Sorry, you are not allowed to use this bot.");
    return;
  }

  const url = input.text.trim();
  try {
    if (isPlaylistOnly(url)) {
      throw new InvalidUrlError("playlist");
    }
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      throw new InvalidUrlError("not-a-video");
    }

    await bot.reply(input.chatId, "🔎 Analyzing the video…");
    const info = await deps.probe(url);

    if (info.durationSec != null && info.durationSec > config.maxDurationSec) {
      const hrs = (config.maxDurationSec / 3600).toFixed(0);
      await bot.reply(input.chatId, `⛔ Video is too long (limit ${hrs}h).`);
      return;
    }

    const options = buildQualityOptions(info, {
      maxBytes: config.maxFilesizeBytes,
      maxDurationSec: config.maxDurationSec,
    });
    if (options.length === 0) {
      throw new NoSuitableFormatError();
    }

    const promptId = await bot.reply(
      input.chatId,
      `🎬 ${info.title}\nChoose a quality:`,
      buttonRows(options),
    );

    store.set(input.userId, {
      url,
      title: info.title,
      durationSec: info.durationSec,
      options,
      promptMessageId: promptId,
      createdAt: Date.now(),
    });
  } catch (err) {
    await replyForError(bot, input.chatId, err, config);
  }
}

async function replyForError(bot: Bot, chatId: string, err: unknown, config: Config): Promise<void> {
  if (err instanceof InvalidUrlError) {
    const msg = err.message === "playlist"
      ? "This is a playlist link. Send a link to a single video."
      : "That doesn't look like a YouTube video link.";
    await bot.reply(chatId, `⚠️ ${msg}`);
  } else if (err instanceof NoSuitableFormatError) {
    await bot.reply(chatId, `⛔ No quality fits the ${formatBytes(config.maxFilesizeBytes)} size limit.`);
  } else if (err instanceof TooLargeError) {
    await bot.reply(chatId, `⛔ The downloaded file exceeds the ${formatBytes(config.maxFilesizeBytes)} limit.`);
  } else {
    logger.error("handler error", { err: String(err) });
    await bot.reply(chatId, "❌ Something went wrong. Please try again.");
  }
}
```

- [ ] **Step 2: Implement the callback (button press) handler in the same file**

```typescript
// append to src/telegram/handlers.ts

/** Handle a quality-button press. */
export async function handleCallback(
  deps: Deps,
  input: { userId: number; chatId: string; data: string; messageId: number },
): Promise<void> {
  const { config, store, queue, bot } = deps;

  if (!config.isAllowed(input.userId)) return;

  const index = parseCallbackData(input.data);
  const session = store.get(input.userId);
  if (index == null || !session || !session.options[index]) {
    await bot.editText(input.chatId, input.messageId, "⌛ This choice expired. Please send the link again.");
    return;
  }

  const option = session.options[index];
  const position = queue.size() + 1;
  await bot.editText(input.chatId, input.messageId, statusText({ kind: "queued", position }));

  await queue.add(async () => {
    const ws = await createWorkspace(config.tempDir);
    try {
      let lastShown = -1;
      const filePath = await deps.download({
        url: session.url,
        formatSelector: option.formatSelector,
        videoId: extractYouTubeVideoId(session.url) ?? "video",
        outDir: ws.dir,
        onProgress: (p) => {
          if (Math.floor(p) >= lastShown + 5) { // throttle edits to every ~5%
            lastShown = Math.floor(p);
            void bot.editText(input.chatId, input.messageId, statusText({ kind: "downloading", percent: p }));
          }
        },
      });

      const size = (await fs.stat(filePath)).size;
      if (size > config.maxFilesizeBytes) throw new TooLargeError();

      await bot.editText(input.chatId, input.messageId, statusText({ kind: "uploading" }));
      await bot.sendVideo(input.chatId, filePath, {
        durationSec: session.durationSec,
        title: session.title,
        asDocument: false,
      });
      await bot.editText(input.chatId, input.messageId, statusText({ kind: "done" }));
    } catch (err) {
      await replyForError(bot, input.chatId, err, config);
    } finally {
      await ws.cleanup();
      store.delete(input.userId);
    }
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/telegram/handlers.ts
git commit -m "feat: message + callback orchestration behind a Bot port"
```

---

## Task 16: Handler orchestration tests (mock Bot port)

**Files:**
- Test: `tests/telegram/handlers.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// tests/telegram/handlers.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleMessage, handleCallback, type Deps, type Bot } from "../../src/telegram/handlers.js";
import { InMemoryStore } from "../../src/state/store.js";
import { Queue } from "../../src/queue/queue.js";
import { loadConfig } from "../../src/config.js";
import type { VideoInfo } from "../../src/types.js";

function makeBot(): Bot & { calls: any } {
  const calls: any = { replies: [], edits: [], videos: [] };
  return {
    calls,
    async reply(chatId, text) { calls.replies.push({ chatId, text }); return calls.replies.length; },
    async editText(chatId, messageId, text) { calls.edits.push({ messageId, text }); },
    async sendVideo(chatId, filePath, opts) { calls.videos.push({ filePath, opts }); },
  };
}

const config = loadConfig({ BOT_TOKEN: "t", API_ID: "1", API_HASH: "h", ALLOWED_USER_IDS: "42" });

const fakeInfo: VideoInfo = {
  id: "abc12345678", title: "Clip", durationSec: 100,
  formats: [
    { format_id: "18", ext: "mp4", height: 360, vcodec: "avc1", acodec: "mp4a", filesize: 1000 },
    { format_id: "140", ext: "m4a", height: null, vcodec: "none", acodec: "mp4a", filesize: 100 },
  ],
};

function deps(bot: Bot, over: Partial<Deps> = {}): Deps {
  return {
    config, bot,
    store: new InMemoryStore(),
    queue: new Queue(1),
    probe: vi.fn(async () => fakeInfo),
    download: vi.fn(async () => "/tmp/does-not-matter.mp4"),
    ...over,
  };
}

describe("handleMessage", () => {
  it("rejects users not on the allowlist", async () => {
    const bot = makeBot();
    await handleMessage(deps(bot), { userId: 999, chatId: "c", text: "https://youtu.be/abc12345678" });
    expect(bot.calls.replies.at(-1).text).toMatch(/not allowed/i);
  });

  it("rejects playlist links", async () => {
    const bot = makeBot();
    await handleMessage(deps(bot), { userId: 42, chatId: "c", text: "https://youtube.com/playlist?list=PL1" });
    expect(bot.calls.replies.at(-1).text).toMatch(/single video/i);
  });

  it("probes and shows quality buttons for a valid link, storing a session", async () => {
    const bot = makeBot();
    const d = deps(bot);
    await handleMessage(d, { userId: 42, chatId: "c", text: "https://youtu.be/abc12345678" });
    const stored = d.store.get(42);
    expect(stored?.options.length).toBeGreaterThan(0);
    expect(bot.calls.replies.some((r: any) => /Choose a quality/i.test(r.text))).toBe(true);
  });
});

describe("handleCallback", () => {
  it("downloads and sends the chosen quality, then clears the session", async () => {
    const bot = makeBot();
    const d = deps(bot);
    await handleMessage(d, { userId: 42, chatId: "c", text: "https://youtu.be/abc12345678" });
    // download returns a path; stat would fail on a fake path, so stub fs via a real small file:
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const real = path.join(os.tmpdir(), "handler-test.mp4");
    await fs.writeFile(real, "x");
    (d.download as any) = vi.fn(async () => real);

    await handleCallback(d, { userId: 42, chatId: "c", data: "dl:0", messageId: 1 });
    // queue runs async; allow microtasks/timers to flush
    await new Promise((r) => setTimeout(r, 30));

    expect(bot.calls.videos.length).toBe(1);
    expect(d.store.get(42)).toBeUndefined();
    await fs.rm(real, { force: true });
  });

  it("tells the user when the session expired", async () => {
    const bot = makeBot();
    const d = deps(bot);
    await handleCallback(d, { userId: 42, chatId: "c", data: "dl:0", messageId: 1 });
    expect(bot.calls.edits.at(-1).text).toMatch(/expired/i);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/telegram/handlers.test.ts`
Expected: PASS (5 tests). If the async queue test is flaky, increase the `setTimeout` flush to 50ms.

- [ ] **Step 3: Commit**

```bash
git add tests/telegram/handlers.test.ts
git commit -m "test: handler orchestration via mock Bot port"
```

---

## Task 17: Entry point — wire GramJS to handlers

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement**

```typescript
// src/index.ts
import { Api } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { CallbackQuery } from "telegram/events/CallbackQuery.js";
import { Button } from "telegram/tl/custom/button.js";
import { loadConfig } from "./config.js";
import { startClient } from "./telegram/client.js";
import { InMemoryStore } from "./state/store.js";
import { Queue } from "./queue/queue.js";
import { probe } from "./ytdlp/probe.js";
import { download } from "./ytdlp/download.js";
import { handleMessage, handleCallback, type Bot, type Deps } from "./telegram/handlers.js";
import { logger } from "./util/logger.js";
import fs from "node:fs/promises";

async function main() {
  const config = loadConfig();
  if (config.allowedUserIds.length === 0) {
    logger.warn("ALLOWED_USER_IDS is empty — the bot is open to everyone");
  }
  await fs.mkdir(config.tempDir, { recursive: true });

  const client = await startClient(config);
  const store = new InMemoryStore();
  const queue = new Queue(1);

  // Adapt GramJS to the Bot port used by handlers.
  const bot: Bot = {
    async reply(chatId, text, buttons) {
      const gramButtons = buttons?.map((row) =>
        row.map((b) => Button.inline(b.text, Buffer.from(b.data))));
      const msg = await client.sendMessage(chatId, { message: text, buttons: gramButtons });
      return msg.id;
    },
    async editText(chatId, messageId, text) {
      await client.editMessage(chatId, { message: messageId, text });
    },
    async sendVideo(chatId, filePath, opts) {
      const attributes = opts.asDocument ? undefined : [
        new Api.DocumentAttributeVideo({
          duration: Math.round(opts.durationSec ?? 0),
          w: 0, h: 0, supportsStreaming: true,
        }),
      ];
      try {
        await client.sendFile(chatId, {
          file: filePath,
          caption: opts.title,
          attributes,
          forceDocument: opts.asDocument,
          supportsStreaming: !opts.asDocument,
        });
      } catch (err) {
        // Fallback: if sending as video failed, retry as a plain document.
        if (!opts.asDocument) {
          logger.warn("video send failed, retrying as document", { err: String(err) });
          await client.sendFile(chatId, { file: filePath, caption: opts.title, forceDocument: true });
        } else {
          throw err;
        }
      }
    },
  };

  const deps: Deps = { config, store, queue, bot, probe, download };

  client.addEventHandler(async (event: any) => {
    const message = event.message;
    if (!message || !message.text || message.out) return;
    const userId = Number(event.senderId ?? message.senderId);
    const chatId = String(event.chatId ?? message.chatId);
    await handleMessage(deps, { userId, chatId, text: message.text });
  }, new NewMessage({}));

  client.addEventHandler(async (event: any) => {
    const userId = Number(event.senderId);
    const chatId = String(event.chatId);
    const data = event.data ? Buffer.from(event.data).toString() : "";
    await event.answer().catch(() => {}); // ack the button press
    await handleCallback(deps, { userId, chatId, data, messageId: event.messageId });
  }, new CallbackQuery({}));

  logger.info("Bot is running");

  const shutdown = async () => {
    logger.info("Shutting down…");
    await client.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal startup error", { err: String(err) });
  process.exit(1);
});
```

> NOTE for executor: GramJS event field names (`senderId`, `chatId`, `messageId`, `data`)
> can vary slightly by version. Verify against the installed `telegram` version during
> the end-to-end smoke test (Task 21) and adjust the adapter only.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Fix any import-path issues against the installed `telegram` package (some builds expose `CallbackQuery` from `telegram/events/index.js`).

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: entry point wiring GramJS events to handlers"
```

---

## Task 18: Environment example + README note

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

```
# Telegram Bot token from @BotFather
BOT_TOKEN=

# MTProto app credentials from https://my.telegram.org
API_ID=
API_HASH=

# Comma-separated Telegram numeric user IDs allowed to use the bot.
# Leave empty to allow everyone (NOT recommended).
ALLOWED_USER_IDS=

# Optional limits (defaults: 500MB / 2h)
MAX_FILESIZE_BYTES=524288000
MAX_DURATION_SEC=7200

# Optional temp dir (default: <os tmp>/yt-bot)
TEMP_DIR=/data/tmp
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: .env.example with all config vars"
```

---

## Task 19: Docker image + compose

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
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
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./tmp:/data/tmp
    environment:
      - TEMP_DIR=/data/tmp
```

- [ ] **Step 3: Verify the image builds**

Run: `docker build -t yt-bot .`
Expected: build succeeds; `ffmpeg -version` and `yt-dlp --version` runnable inside.
Verify: `docker run --rm yt-bot yt-dlp --version` prints a version string.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "build: Docker image (node + ffmpeg + yt-dlp) and compose"
```

---

## Task 20: VPS + update scripts

**Files:**
- Create: `scripts/setup-vps.sh`, `scripts/update-ytdlp.sh`

- [ ] **Step 1: Create `scripts/update-ytdlp.sh`**

```bash
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
```

- [ ] **Step 2: Create `scripts/setup-vps.sh` (idempotent)**

```bash
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
```

- [ ] **Step 3: Make scripts executable**

Run: `chmod +x scripts/setup-vps.sh scripts/update-ytdlp.sh`
Verify: `bash -n scripts/setup-vps.sh && bash -n scripts/update-ytdlp.sh` (syntax check) exits 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup-vps.sh scripts/update-ytdlp.sh
git commit -m "ops: idempotent VPS setup + daily yt-dlp update scripts"
```

---

## Task 21: CI/CD deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run typecheck
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/yt-bot
            git pull --ff-only
            docker compose build
            docker compose up -d
```

> Secrets required in GitHub: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. The bot's
> `.env` lives on the VPS at `/opt/yt-bot/.env` (never committed).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: test + SSH deploy workflow on push to main"
```

---

## Task 22: Full test run + end-to-end smoke test

- [ ] **Step 1: Run the whole unit suite**

Run: `npm test`
Expected: all suites PASS (url, format-bytes, config, formats, store, queue, progress, probe, download, tempdir, ui, handlers).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: End-to-end smoke test (manual, requires real credentials)**

1. Fill `.env` with real `BOT_TOKEN`, `API_ID`, `API_HASH`, and your own `ALLOWED_USER_IDS`.
2. Run: `docker compose up --build`
3. In Telegram, send the bot a short YouTube link.
4. Verify: quality buttons appear → press one → status updates (queued → % → uploading) → the video arrives and plays inline.
5. Verify cleanup: `ls ./tmp` is empty after sending.
6. If the video does not play inline, confirm `sendVideo` attributes; if GramJS event field names differ, fix only the adapter in `src/index.ts`.

- [ ] **Step 4: Commit any adapter fixes discovered during smoke test**

```bash
git add -A
git commit -m "fix: align GramJS event adapter with installed version"
```

---

## Notes for the executor

- Run `npx tsc --noEmit` after each TS task; strict mode is on.
- Keep the `Bot` port boundary intact — all GramJS specifics live in `src/index.ts` only. Everything else is testable without a network.
- `callback_data` stays under 64 bytes by design (`dl:<index>`), so long format selectors never hit the limit.
- If a real download exceeds 500 MB despite the pre-filter, `TooLargeError` after `fs.stat` is the safety net.
```
