import { spawn } from "node:child_process";
import path from "node:path";
import { parseProgress } from "./progress.js";
import { DownloadError } from "../errors.js";

export interface DownloadArgs {
  url: string;
  formatSelector: string;
  videoId: string;
  outDir: string;
  audioOnly?: boolean;
  onProgress: (percent: number) => void;
}

/**
 * Run yt-dlp into outDir. For video, merges to mp4; for audio-only, extracts
 * the best audio track to mp3 (best VBR quality).
 * Resolves with the absolute path of the produced file.
 */
export function download(args: DownloadArgs): Promise<string> {
  const ext = args.audioOnly ? "mp3" : "mp4";
  const outPath = path.join(args.outDir, `${args.videoId}.${ext}`);
  const outTemplate = path.join(args.outDir, `${args.videoId}.%(ext)s`);

  const formatArgs = args.audioOnly
    ? ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
    : ["--merge-output-format", "mp4"];

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "-f", args.formatSelector,
      ...formatArgs,
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
