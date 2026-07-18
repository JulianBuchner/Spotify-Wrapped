import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import { num, playlistCondition } from "../lib/query";

const GRANULARITY_FORMAT: Record<string, string> = {
  day: "%Y-%m-%d",
  week: "%Y-%W",
  month: "%Y-%m",
  year: "%Y",
};

function pickGranularity(query: Record<string, unknown>, def = "month"): string {
  const g = typeof query.granularity === "string" ? query.granularity : def;
  return GRANULARITY_FORMAT[g] ? g : def;
}

/** Date window + optional ?playlist= filter, shared by the stats endpoints. */
function scopedWhere(query: Record<string, unknown>, from?: Date, to?: Date) {
  const conditions = playedAtConditions(from, to);
  const pl = playlistCondition(query);
  if (pl) conditions.push(pl);
  return whereClause(conditions);
}

const statsRoutes: FastifyPluginAsync = async (app) => {
  // Headline numbers (supersedes /api/stats/unique-tracks + /api/stats/listen-time).
  app.get("/api/stats/summary", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT COUNT(*) AS totalStreams,
             SUM("durationMs") AS totalPlaytimeMs,
             COUNT(DISTINCT "spotifyUri") AS distinctTracks,
             COUNT(DISTINCT "artistName") AS distinctArtists,
             COUNT(DISTINCT "albumName") AS distinctAlbums,
             MIN("playedAt") AS firstPlay,
             MAX("playedAt") AS lastPlay
      FROM "Play" ${where}`;
    const r = rows[0] ?? {};
    const totalPlaytimeMs = num(r.totalPlaytimeMs);

    const spanFrom = from ?? (r.firstPlay ? new Date(r.firstPlay) : new Date());
    const spanTo = to ?? (r.lastPlay ? new Date(r.lastPlay) : new Date());
    const days = Math.max(
      1,
      Math.ceil((spanTo.getTime() - spanFrom.getTime()) / 86_400_000)
    );

    return {
      data: {
        totalStreams: num(r.totalStreams),
        totalPlaytimeMs,
        distinctTracks: num(r.distinctTracks),
        distinctArtists: num(r.distinctArtists),
        distinctAlbums: num(r.distinctAlbums),
        avgPlaytimePerDayMs: Math.round(totalPlaytimeMs / days),
      },
    };
  });

  // Plays by hour of day (0-23). NOTE: 'localtime' uses the server's system TZ.
  app.get("/api/stats/listening-clock", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT CAST(strftime('%H', "playedAt", 'localtime') AS INTEGER) AS hour, COUNT(*) AS value
      FROM "Play" ${where} GROUP BY hour ORDER BY hour`;
    const map = new Map<number, number>(rows.map((r) => [num(r.hour), num(r.value)]));
    const data = Array.from({ length: 24 }, (_, h) => ({ hour: h, value: map.get(h) ?? 0 }));
    return { data };
  });

  // Plays by weekday. 0 = Sunday ... 6 = Saturday (SQLite %w).
  app.get("/api/stats/listening-by-weekday", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT CAST(strftime('%w', "playedAt", 'localtime') AS INTEGER) AS weekday, COUNT(*) AS value
      FROM "Play" ${where} GROUP BY weekday ORDER BY weekday`;
    const map = new Map<number, number>(rows.map((r) => [num(r.weekday), num(r.value)]));
    const data = Array.from({ length: 7 }, (_, d) => ({ weekday: d, value: map.get(d) ?? 0 }));
    return { data };
  });

  // Streams (or playtime) over time.
  app.get("/api/stats/streams-over-time", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);
    const fmt = GRANULARITY_FORMAT[pickGranularity(query)];
    const metricExpr =
      query.metric === "playtime" ? Prisma.sql`SUM("durationMs")` : Prisma.sql`COUNT(*)`;

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT strftime(${fmt}, "playedAt") AS bucket, ${metricExpr} AS value
      FROM "Play" ${where} GROUP BY bucket ORDER BY bucket`;
    return { data: rows.map((r) => ({ bucket: r.bucket, value: num(r.value) })) };
  });

  // Cumulative count of first-time-heard tracks over time (the discovery S-curve).
  app.get("/api/stats/discovery", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const fmt = GRANULARITY_FORMAT[pickGranularity(query)];

    const conditions: Prisma.Sql[] = [];
    if (from) conditions.push(Prisma.sql`firstPlay >= ${from}`);
    if (to) conditions.push(Prisma.sql`firstPlay <= ${to}`);
    const outerWhere = whereClause(conditions);

    // With ?playlist= the curve becomes "first time heard in that playlist".
    const pl = playlistCondition(query);
    const innerWhere = whereClause(pl ? [pl] : []);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT strftime(${fmt}, firstPlay) AS bucket, COUNT(*) AS newCount
      FROM (SELECT "spotifyUri", MIN("playedAt") AS firstPlay FROM "Play" ${innerWhere} GROUP BY "spotifyUri")
      ${outerWhere}
      GROUP BY bucket ORDER BY bucket`;

    let cumulative = 0;
    const data = rows.map((r) => {
      const n = num(r.newCount);
      cumulative += n;
      return { bucket: r.bucket, new: n, cumulative };
    });
    return { data };
  });

  // Share of each period's streams that were first-time-ever plays.
  app.get("/api/stats/new-share", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const fmt = GRANULARITY_FORMAT[pickGranularity(query)];

    const conditions: Prisma.Sql[] = [];
    if (from) conditions.push(Prisma.sql`p."playedAt" >= ${from}`);
    if (to) conditions.push(Prisma.sql`p."playedAt" <= ${to}`);
    const pl = playlistCondition(query);
    if (pl) conditions.push(pl);
    const where = whereClause(conditions);

    // Scope the first-play lookup the same way so "new" means new within the filter.
    const innerWhere = whereClause(pl ? [pl] : []);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT strftime(${fmt}, p."playedAt") AS bucket,
             COUNT(*) AS total,
             SUM(CASE WHEN p."playedAt" = f.fp THEN 1 ELSE 0 END) AS newStreams
      FROM "Play" p
      JOIN (SELECT "spotifyUri", MIN("playedAt") AS fp FROM "Play" ${innerWhere} GROUP BY "spotifyUri") f
        ON f."spotifyUri" = p."spotifyUri"
      ${where}
      GROUP BY bucket ORDER BY bucket`;

    return {
      data: rows.map((r) => {
        const total = num(r.total);
        const newStreams = num(r.newStreams);
        return {
          bucket: r.bucket,
          total,
          newStreams,
          newSharePct: total ? Math.round((newStreams / total) * 1000) / 10 : 0,
        };
      }),
    };
  });

  // Song-length histogram (works today because durationMs is stored per play).
  app.get("/api/stats/duration-distribution", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);

    const bucketSizeRaw = Number(query.bucketSize);
    const bucketSize =
      Number.isFinite(bucketSizeRaw) && bucketSizeRaw > 0 ? Math.floor(bucketSizeRaw) : 15;
    const countExpr =
      query.weight === "distinct"
        ? Prisma.sql`COUNT(DISTINCT "spotifyUri")`
        : Prisma.sql`COUNT(*)`;

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT ((CAST("durationMs" / 1000 AS INTEGER) / ${bucketSize}) * ${bucketSize}) AS bucketStartSec,
             ${countExpr} AS count
      FROM "Play" ${where}
      GROUP BY bucketStartSec ORDER BY bucketStartSec`;
    return {
      data: rows.map((r) => ({
        bucketStartSec: num(r.bucketStartSec),
        count: num(r.count),
      })),
    };
  });
};

export default statsRoutes;
