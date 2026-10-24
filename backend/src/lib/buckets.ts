import { Prisma } from "@prisma/client";
import { prisma } from "../db";

/**
 * Every strftime bucket between the first and the last play of a window,
 * including the empty ones, so a time axis keeps its gaps (two silent years
 * stay two years wide) instead of skipping them. Buckets are UTC, like the
 * stats/record/genres queries that use the same formats.
 */
export async function denseBuckets(fmt: string, where: Prisma.Sql): Promise<string[]> {
  const span = await prisma.$queryRaw<Array<{ first: string | null; last: string | null }>>`
    SELECT MIN("playedAt") AS first, MAX("playedAt") AS last FROM "Play" ${where}`;
  const first = span[0]?.first;
  const last = span[0]?.last;
  if (!first || !last) return [];
  const rows = await prisma.$queryRaw<Array<{ bucket: string }>>`
    WITH RECURSIVE days(d) AS (
      SELECT date(${first})
      UNION ALL
      SELECT date(d, '+1 day') FROM days WHERE d < date(${last})
    )
    SELECT DISTINCT strftime(${fmt}, d) AS bucket FROM days ORDER BY bucket`;
  return rows.map((r) => String(r.bucket));
}
