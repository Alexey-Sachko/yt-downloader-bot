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
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const real = path.join(os.tmpdir(), "handler-test.mp4");
    await fs.writeFile(real, "x");
    (d.download as any) = vi.fn(async () => real);

    await handleCallback(d, { userId: 42, chatId: "c", data: "dl:0", messageId: 1 });
    await new Promise((r) => setTimeout(r, 50));

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
