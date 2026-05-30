/** Format an ISO timestamp as YY/MM/DD hh:mm. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getFullYear() % 100)}/${p(d.getMonth() + 1)}/${p(
    d.getDate(),
  )} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Human-readable file size with up to 2 decimals (B / KB / MB). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
