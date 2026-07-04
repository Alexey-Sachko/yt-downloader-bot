import { describe, it, expect } from "vitest";
import { Queue } from "../../src/queue/queue.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Queue", () => {
  it("runs jobs one at a time (concurrency 1)", async () => {
    const q = new Queue(1);
    const running: number[] = [];
    let maxConcurrent = 0;
    let current = 0;
    const job = () => async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await delay(10);
      current--;
      running.push(1);
    };
    await Promise.all([q.add(job()), q.add(job()), q.add(job())]);
    expect(maxConcurrent).toBe(1);
    expect(running.length).toBe(3);
  });

  it("preserves FIFO order", async () => {
    const q = new Queue(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => q.add(async () => { await delay(5); order.push(n); })));
    expect(order).toEqual([1, 2, 3]);
  });

  it("returns the job result", async () => {
    const q = new Queue(1);
    await expect(q.add(async () => 42)).resolves.toBe(42);
  });

  it("a failing job does not stall the queue", async () => {
    const q = new Queue(1);
    await expect(q.add(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(q.add(async () => "ok")).resolves.toBe("ok");
  });

  it("reports pending size", async () => {
    const q = new Queue(1);
    const p1 = q.add(async () => { await delay(20); });
    const p2 = q.add(async () => {});
    expect(q.size()).toBeGreaterThanOrEqual(1);
    await Promise.all([p1, p2]);
    expect(q.size()).toBe(0);
  });
});
