/** One format entry as returned by `yt-dlp -J` (only fields we use). */
export interface RawFormat {
  format_id: string;
  ext: string;
  height?: number | null;
  width?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  vcodec?: string;
  acodec?: string;
  fps?: number | null;
  tbr?: number | null; // total bitrate, kbit/s
}

/** Normalized result of probing a single video. */
export interface VideoInfo {
  id: string;
  title: string;
  durationSec: number | null;
  formats: RawFormat[];
}

/** A user-facing quality choice. */
export interface QualityOption {
  kind: "video" | "audio";
  label: string; // e.g. "1080p" or "🎵 Audio (mp3)"
  height: number | null; // null for audio-only
  formatSelector: string; // value passed to `yt-dlp -f`
  approxBytes: number | null;
}

/** Per-user session remembered between the link message and the button press. */
export interface Session {
  url: string;
  title: string;
  durationSec: number | null;
  options: QualityOption[];
  promptMessageId?: number;
  createdAt: number; // Date.now()
}
