const RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

/** Extract download percent (0–100) from a yt-dlp stdout line, or null. */
export function parseProgress(line: string): number | null {
  const m = RE.exec(line);
  return m ? Number(m[1]) : null;
}
