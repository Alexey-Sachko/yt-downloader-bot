export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "? MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}
