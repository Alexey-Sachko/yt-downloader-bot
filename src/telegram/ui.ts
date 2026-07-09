import type { QualityOption } from "../types.js";
import { formatBytes } from "../util/format-bytes.js";

export interface ButtonSpec {
  text: string;
  data: string; // e.g. "dl:0"
}

/** One button per quality option; callback data references the option by index. */
export function buttonRows(options: QualityOption[]): ButtonSpec[][] {
  return options.map((o, i) => [
    { text: `${o.label} (~${formatBytes(o.approxBytes)})`, data: `dl:${i}` },
  ]);
}

export type Status =
  | { kind: "queued"; position: number }
  | { kind: "downloading"; percent: number }
  | { kind: "uploading"; percent: number }
  | { kind: "done" };

export function statusText(s: Status): string {
  switch (s.kind) {
    case "queued": return `⏳ In queue (position ${s.position})…`;
    case "downloading": return `⬇️ Downloading… ${Math.floor(s.percent)}%`;
    case "uploading": return `⬆️ Uploading to Telegram… ${Math.floor(s.percent)}%`;
    case "done": return `✅ Done`;
  }
}

/** Parse "dl:<index>" callback data back into an index, or null. */
export function parseCallbackData(data: string): number | null {
  const m = /^dl:(\d+)$/.exec(data);
  return m ? Number(m[1]) : null;
}
