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
  it("renders a percentage while uploading", () => {
    const t = statusText({ kind: "uploading", percent: 73 });
    expect(t).toContain("73");
    expect(t).toMatch(/upload/i);
  });
});
