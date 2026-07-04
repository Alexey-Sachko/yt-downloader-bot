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
