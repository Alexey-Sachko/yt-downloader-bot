import { describe, it, expect } from "vitest";
import info from "../fixtures/yt-dlp-info.json";
import { buildQualityOptions } from "../../src/ytdlp/formats.js";
import type { VideoInfo } from "../../src/types.js";

const asInfo: VideoInfo = {
  id: (info as any).id,
  title: (info as any).title,
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
