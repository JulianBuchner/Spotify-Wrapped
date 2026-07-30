import { Prisma } from "@prisma/client";

const DAY = 86_400_000;

export interface DateFilter {
  filter: Prisma.PlayWhereInput;
  from?: Date;
  to?: Date;
  error?: string;
}

/**
 * Resolves a date window from query params. Priority:
 *   ?date=YYYY-MM-DD  ->  a single calendar day
 *   ?range=<preset>   ->  today | this_week | previous_week | last_week |
 *                         last_30_days | ytd | last_year | all_time
 *   ?from=&to=        ->  explicit ISO range (backwards compatible)
 *
 * Rolling presets (last_week/30d/year) are pure Date math and need no timezone.
 * today / this_week / previous_week / ytd / date are calendar-bound and use the
 * SERVER's local timezone. Calendar weeks start on Monday.
 * For guaranteed IANA/DST correctness later, resolve these boundaries with luxon.
 *
 * Always returns a `filter` (empty object on error) so call sites can safely
 * destructure and short-circuit on `error`.
 */
export function buildPlayedAtFilter(query: Record<string, unknown>): DateFilter {
  const now = new Date();
  const range = typeof query.range === "string" ? query.range.trim() : "";
  const date = typeof query.date === "string" ? query.date.trim() : "";

  let from: Date | undefined;
  let to: Date | undefined;

  if (date) {
    from = new Date(`${date}T00:00:00`);
    to = new Date(`${date}T23:59:59.999`);
    if (Number.isNaN(from.getTime())) return { filter: {}, error: "Invalid date" };
  } else if (range) {
    switch (range) {
      case "today":
        from = new Date(now);
        from.setHours(0, 0, 0, 0);
        to = now;
        break;
      case "this_week":
        from = new Date(now);
        from.setHours(0, 0, 0, 0);
        from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); // back to Monday
        to = now;
        break;
      case "previous_week": {
        const monday = new Date(now);
        monday.setHours(0, 0, 0, 0);
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        to = new Date(monday.getTime() - 1);
        from = new Date(monday);
        from.setDate(from.getDate() - 7); // setDate, not -7*DAY: stays midnight across DST
        break;
      }
      case "last_week":
        from = new Date(now.getTime() - 7 * DAY);
        to = now;
        break;
      case "last_30_days":
        from = new Date(now.getTime() - 30 * DAY);
        to = now;
        break;
      case "last_year":
        from = new Date(now.getTime() - 365 * DAY);
        to = now;
        break;
      case "ytd":
        from = new Date(now.getFullYear(), 0, 1);
        to = now;
        break;
      case "all_time":
        from = undefined;
        to = now;
        break;
      default:
        return { filter: {}, error: `Unknown range: ${range}` };
    }
  } else {
    const f = query.from;
    const t = query.to;
    if (typeof f === "string" && f.trim() !== "") {
      const parsed = new Date(f);
      if (Number.isNaN(parsed.getTime())) return { filter: {}, error: "from" };
      from = parsed;
    } else if (f !== undefined) {
      return { filter: {}, error: "from" };
    }
    if (typeof t === "string" && t.trim() !== "") {
      const parsed = new Date(t);
      if (Number.isNaN(parsed.getTime())) return { filter: {}, error: "to" };
      to = parsed;
    } else if (t !== undefined) {
      return { filter: {}, error: "to" };
    }
  }

  const filter: Prisma.PlayWhereInput =
    from || to
      ? { playedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {};

  return { filter, from, to };
}

/** Raw-SQL conditions for the playedAt window (mirrors the /api/stats/artist pattern). */
export function playedAtConditions(from?: Date, to?: Date): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (from) conditions.push(Prisma.sql`"playedAt" >= ${from}`);
  if (to) conditions.push(Prisma.sql`"playedAt" <= ${to}`);
  return conditions;
}

/** Turns a list of conditions into a WHERE clause (or nothing when empty). */
export function whereClause(conditions: Prisma.Sql[]): Prisma.Sql {
  return conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;
}
