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
