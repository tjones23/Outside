/** Display formatting shared by the lists and detail views. */

/** "Sep 24, 3:05 PM" in the viewer's locale and time zone. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "3:05 PM". */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Wed 3 PM" — for loops that span days. */
export function formatDayClock(ms: number): string {
  return new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** "just now", "4 min ago", "2 hr ago". */
export function formatAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hr ago`;
}

/** SPC "1435" → "14:35 UTC". */
export function formatUtcTime(hhmm: string): string {
  return /^\d{4}$/.test(hhmm) ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)} UTC` : `${hhmm} UTC`;
}

export function formatMiles(miles: number): string {
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}
