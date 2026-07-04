import type { Session } from "../types.js";

/** Storage boundary. Swap InMemoryStore for a Redis-backed impl later. */
export interface StateStore {
  set(userId: number, session: Session): void;
  get(userId: number): Session | undefined;
  delete(userId: number): void;
}

export class InMemoryStore implements StateStore {
  private map = new Map<number, Session>();

  constructor(private ttlMs = 10 * 60 * 1000) {}

  set(userId: number, session: Session): void {
    this.map.set(userId, session);
  }

  get(userId: number): Session | undefined {
    const s = this.map.get(userId);
    if (!s) return undefined;
    if (Date.now() - s.createdAt > this.ttlMs) {
      this.map.delete(userId);
      return undefined;
    }
    return s;
  }

  delete(userId: number): void {
    this.map.delete(userId);
  }

  /** Optional periodic sweep to drop expired sessions. */
  sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.map) {
      if (now - s.createdAt > this.ttlMs) this.map.delete(id);
    }
  }
}
