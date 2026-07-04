import { spawn } from "node:child_process";
import path from "node:path";
import { parseProgress } from "./progress.js";
import { DownloadError } from "../errors.js";

export interface DownloadArgs {
  url: string;
  formatSelector: string;
  videoId: string;
  outDir: string;
  onProgress: (percent: number) => void;
}

/**
 * Run `yt-dlp -f <selector> --merge-output-format mp4` into outDir.
 * Resolves with the absolute path of the produced mp4 file.
 */
export function download(args: DownloadArgs): Promise<string> {
  const outPath = path.join(args.outDir, `${args.videoId}.mp4`);
  const outTemplate = path.join(args.outDir, `${args.videoId}.%(ext)s`);

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "-f", args.formatSelector,
      "--merge-output-format", "mp4",
      "--no-playlist",
      "--newline",
      "--no-warnings",
      "-o", outTemplate,
      args.url,
    ]);

    let stderr = "";
    let lastPercent = -1;

    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const p = parseProgress(line);
        if (p != null && Math.floor(p) !== Math.floor(lastPercent)) {
          lastPercent = p;
          args.onProgress(p);
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err) => reject(new DownloadError(`Failed to start yt-dlp: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(outPath);
      else reject(new DownloadError(`yt-dlp exited ${code}: ${stderr.trim() || "download failed"}`));
    });
  });
}
