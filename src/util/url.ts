const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"]);

/** Returns the 11-char video id, or null if the URL has no single video. */
export function extractYouTubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  // youtu.be/<id>
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return isValidId(id) ? id : null;
  }
  // /shorts/<id>  or  /embed/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "shorts" || parts[0] === "embed") {
    return isValidId(parts[1]) ? parts[1] : null;
  }
  // /watch?v=<id>
  const v = url.searchParams.get("v");
  return v && isValidId(v) ? v : null;
}

/** True when the URL points at a playlist but not a single video. */
export function isPlaylistOnly(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return false;
  }
  return url.searchParams.has("list") && extractYouTubeVideoId(input) === null;
}

function isValidId(id: string | undefined): id is string {
  return !!id && /^[A-Za-z0-9_-]{11}$/.test(id);
}
