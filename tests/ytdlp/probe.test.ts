import { describe, it, expect, vi, beforeEach } from "vitest";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { probe } from "../../src/ytdlp/probe.js";

// execFile(cmd, args, opts, cb) — invoke the callback with (err, stdout, stderr)
function mockExec(err: unknown, stdout: string, stderr = "") {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb) => cb(err, stdout, stderr));
}

describe("probe", () => {
  beforeEach(() => { execFileMock.mockReset(); });

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
