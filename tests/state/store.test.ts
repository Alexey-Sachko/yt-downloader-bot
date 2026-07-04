import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/state/store.js";
import type { Session } from "../../src/types.js";

function session(url = "u"): Session {
  return { url, title: "t", durationSec: 10, options: [], createdAt: Date.now() };
}

describe("InMemoryStore", () => {
  it("stores and retrieves a session by user id", () => {
    const s = new InMemoryStore(1000);
    s.set(42, session("abc"));
    expect(s.get(42)?.url).toBe("abc");
  });
  it("returns undefined for unknown users", () => {
    const s = new InMemoryStore(1000);
    expect(s.get(99)).toBeUndefined();
  });
  it("deletes a session", () => {
    const s = new InMemoryStore(1000);
    s.set(42, session());
    s.delete(42);
    expect(s.get(42)).toBeUndefined();
  });
  it("expires sessions older than the TTL", () => {
    const s = new InMemoryStore(1000);
    const old = session();
    old.createdAt = Date.now() - 2000; // older than 1000ms TTL
    s.set(7, old);
    expect(s.get(7)).toBeUndefined();
  });
});
