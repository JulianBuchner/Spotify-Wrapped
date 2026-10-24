import { prisma } from "../db";

/**
 * One-off repair for api rows recorded before `trackDurationMs` existed: their `durationMs`
 * holds the full track length, not the time listened. Moves the length to `trackDurationMs`
 * and caps `durationMs` by the time until the next play started (a track can't have been
 * listened to for longer than that). A gap within 20 s of the length still counts as the full
 * track, like the poller's end slack: the next play's start is only estimated, and crossfades
 * shave a few seconds. Plays with no later play keep their length.
 *
 * Idempotent: only touches api rows whose `trackDurationMs` is still null.
 *
 *   npm run backfill:api-durations
 */
async function main() {
  const before = await prisma.$queryRaw<Array<{ n: number | bigint; ms: number | bigint | null }>>`
    SELECT COUNT(*) AS n, SUM("durationMs") AS ms FROM "Play"
    WHERE "source" = 'api' AND "trackDurationMs" IS NULL`;
  const todo = Number(before[0]?.n ?? 0);
  console.log(`[backfill] api rows without trackDurationMs: ${todo}`);
  if (todo === 0) return;

  // SET expressions see the row as it was before the update, so durationMs on the right-hand
  // side is still the track length. julianday works on the ISO strings Prisma stores.
  const changed = await prisma.$executeRaw`
    UPDATE "Play" SET
      "trackDurationMs" = "durationMs",
      "durationMs" = MAX(0, MIN("durationMs", COALESCE((
        SELECT CASE WHEN gapMs >= "Play"."durationMs" - 20000 THEN "Play"."durationMs" ELSE gapMs END
        FROM (SELECT CAST(ROUND((julianday(n."playedAt") - julianday("Play"."playedAt")) * 86400000) AS INTEGER) AS gapMs
              FROM "Play" n
              WHERE n."userId" = "Play"."userId" AND n."playedAt" > "Play"."playedAt"
              ORDER BY n."playedAt" LIMIT 1)), "durationMs")))
    WHERE "source" = 'api' AND "trackDurationMs" IS NULL`;

  const after = await prisma.$queryRaw<Array<{ ms: number | bigint | null }>>`
    SELECT SUM("durationMs") AS ms FROM "Play" WHERE "source" = 'api' AND "trackDurationMs" IS NOT NULL`;
  const hours = (v: number | bigint | null | undefined) => (Number(v ?? 0) / 3_600_000).toFixed(1);
  console.log(
    `[backfill] updated ${changed} rows; api listening time ${hours(before[0]?.ms)} h -> ${hours(after[0]?.ms)} h`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
