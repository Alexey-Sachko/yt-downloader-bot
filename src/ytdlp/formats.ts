import type { RawFormat, VideoInfo, QualityOption } from "../types.js";

export interface FormatLimits {
  maxBytes: number;
  maxDurationSec: number;
}

function bytesOf(f: RawFormat): number | null {
  return f.filesize ?? f.filesize_approx ?? null;
}

/**
 * Reduce raw yt-dlp formats to user-facing quality options.
 * One option per distinct video height, sorted high→low, filtered by size limit.
 */
export function buildQualityOptions(info: VideoInfo, limits: FormatLimits): QualityOption[] {
  const videoFormats = info.formats.filter((f) => f.vcodec && f.vcodec !== "none" && f.height);

  // best audio (video-only formats need it added for a realistic size estimate)
  const audioBytes = info.formats
    .filter((f) => (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none")
    .map(bytesOf)
    .filter((b): b is number => b != null)
    .sort((a, b) => b - a)[0] ?? null;

  // pick the largest (best) format per height
  const byHeight = new Map<number, RawFormat>();
  for (const f of videoFormats) {
    const h = f.height!;
    const current = byHeight.get(h);
    if (!current || (bytesOf(f) ?? 0) > (bytesOf(current) ?? 0)) byHeight.set(h, f);
  }

  const options: QualityOption[] = [];
  for (const [height, f] of byHeight) {
    const isProgressive = !!f.acodec && f.acodec !== "none";
    const own = bytesOf(f);
    const approxBytes = own == null ? null : isProgressive ? own : own + (audioBytes ?? 0);
    if (approxBytes != null && approxBytes > limits.maxBytes) continue;
    options.push({
      kind: "video",
      label: `${height}p`,
      height,
      width: f.width ?? null,
      // Prefer H.264 video + AAC audio so Telegram can stream/play inline.
      // Falls back to whatever exists (e.g. VP9/AV1 at 1440p+) so downloads never fail.
      formatSelector:
        `bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/` +
        `best[height<=${height}][vcodec^=avc1]/` +
        `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      approxBytes,
    });
  }

  options.sort((a, b) => b.height! - a.height!);

  // Audio-only, always best quality. Appended after the video options.
  if (audioBytes == null || audioBytes <= limits.maxBytes) {
    options.push({
      kind: "audio",
      label: "🎵 Audio (mp3)",
      height: null,
      width: null,
      formatSelector: "bestaudio/best",
      approxBytes: audioBytes,
    });
  }

  return options;
}
