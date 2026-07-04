import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { download } from "../../src/ytdlp/download.js";

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

describe("download", () => {
  beforeEach(() => { spawnMock.mockReset(); });

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
