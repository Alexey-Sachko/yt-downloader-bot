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
