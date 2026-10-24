import type { DateWindow, Granularity } from "../types";

/**
 * Bucket size for the time charts, derived from the active window: short
 * presets bucket by day, a year by week, all time by month; a custom range
 * picks by its span. Shared by the Dashboard and Record views so the same
 * window always yields the same buckets.
 */
export function granularityFor(w: DateWindow): Granularity {
  switch (w.range) {
    case "today":
    case "this_week":
    case "previous_week":
    case "last_week":
    case "last_30_days":
      return "day";
    case "ytd":
      return "week";
    case "last_year":
      return "week";
    case "all_time":
      return "month";
  }
  // custom range: derive from span
  if (w.from && w.to) {
    const days = (new Date(w.to).getTime() - new Date(w.from).getTime()) / 86_400_000;
    if (days <= 31) return "day";
    if (days <= 200) return "week";
  } else if (w.from || w.to) {
    return "month";
  }
  return "month";
}
