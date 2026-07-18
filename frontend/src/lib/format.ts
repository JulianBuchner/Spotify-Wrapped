import type { Granularity } from "../types";

/** 5_243_112 -> "5,243,112" */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** 5_243_112 -> "5.2M", 12_940 -> "12.9K" (stat-tile values) */
export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return formatNumber(n);
}

/** ms -> "123h 45m" / "45m" */
export function formatMs(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${formatNumber(hours)}h ${minutes}m`;
  return `${minutes}m`;
}

/** ms -> compact "1.2K h" / "834h" / "45m" (stat-tile values) */
export function formatMsCompact(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 10_000) return `${(hours / 1000).toFixed(1)}K h`;
  if (hours >= 100) return `${Math.round(hours).toLocaleString("en-US")}h`;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  return `${Math.round(ms / 60_000)}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a bucket string from the stats endpoints for axis/tooltip display.
 *   day   "2026-07-18" -> "Jul 18 '26"
 *   week  "2026-29"    -> "W29 '26"
 *   month "2026-07"    -> "Jul '26"
 *   year  "2026"       -> "2026"
 */
export function formatBucket(bucket: string, granularity: Granularity): string {
  const [year = "", p1 = "", p2 = ""] = bucket.split("-");
  if (granularity === "year") return bucket;
  if (granularity === "week") return `W${p1} '${year.slice(2)}`;
  const m = MONTHS[Number(p1) - 1] ?? p1;
  if (granularity === "month") return `${m} '${year.slice(2)}`;
  return `${m} ${Number(p2)} '${year.slice(2)}`;
}

/** "2026-07-18T09:12:00.000Z" -> "Jul 18, 09:12" (local time) */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Relative "2h ago" / "3d ago" for recently-played rows. */
export function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Nice round ticks for a value axis: 0..max in 4 steps. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rawStep = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}
