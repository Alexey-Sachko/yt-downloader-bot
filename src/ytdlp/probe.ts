import { execFile } from "node:child_process";
import type { VideoInfo, RawFormat } from "../types.js";
import { ProbeError } from "../errors.js";

/**
 * Manual promise wrapper around execFile's (err, stdout, stderr) callback.
 * We avoid `util.promisify(execFile)` because it only behaves like this
 * (resolving to `{ stdout, stderr }`) thanks to a `util.promisify.custom`
 * symbol Node attaches to its *real* execFile; a plain mock/stand-in
 * lacks that symbol, so generic promisify would resolve with just the
 * bare stdout value instead of an object.
 */
function execFileAsync(
  cmd: string,
  args: string[],
  opts: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        (err as NodeJS.ErrnoException & { stderr?: string }).stderr = String(stderr ?? "");
        reject(err);
      } else {
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      }
    });
  });
}

/** Run `yt-dlp -J <url>` and normalize the result. Single video only. */
export async function probe(url: string): Promise<VideoInfo> {
  let stdout: string;
  try {
    const res = await execFileAsync(
      "yt-dlp",
      ["-J", "--no-playlist", "--no-warnings", url],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    stdout = res.stdout;
  } catch (err: any) {
    throw new ProbeError(`yt-dlp probe failed: ${err?.stderr || err?.message || "unknown error"}`);
  }

  let raw: any;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new ProbeError("yt-dlp returned invalid JSON");
  }

  return {
    id: raw.id,
    title: raw.title ?? "video",
    durationSec: raw.duration ?? null,
    formats: (raw.formats ?? []) as RawFormat[],
  };
}
