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
