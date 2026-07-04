import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface Workspace {
  dir: string;
  cleanup(): Promise<void>;
}

/** Create a unique working directory under `baseDir`. */
export async function createWorkspace(baseDir: string): Promise<Workspace> {
  const dir = path.join(baseDir, randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return {
    dir,
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
