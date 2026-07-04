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
