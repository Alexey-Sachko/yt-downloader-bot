type Task = () => Promise<void>;

/** Minimal promise queue. Default concurrency 1 serializes all downloads. */
export class Queue {
  private queue: Task[] = [];
  private active = 0;

  constructor(private concurrency = 1) {}

  /** Number of jobs waiting or running. */
  size(): number {
    return this.queue.length + this.active;
  }

  add<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: Task = async () => {
        try {
          resolve(await job());
        } catch (err) {
          reject(err as Error);
        }
      };
      this.queue.push(task);
      this.next();
    });
  }

  private next(): void {
    if (this.active >= this.concurrency) return;
    const task = this.queue.shift();
    if (!task) return;
    this.active++;
    task().finally(() => {
      this.active--;
      this.next();
    });
  }
}
