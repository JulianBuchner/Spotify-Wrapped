import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import { num, playlistCondition } from "../lib/query";
import { readOnlyDb } from "../lib/rawDb";
import { denseBuckets } from "../lib/buckets";

// ---------------------------------------------------------------------------
// /api/record/* — the data behind the "Record" view (one ring per day vinyl
// plus the poster-style side charts). Same window + ?playlist= filter as the
// stats endpoints; all SQL is raw SQLite like stats.ts/wrapped.ts.
// Hour/weekday/day grouping uses 'localtime' = the SERVER's system TZ.
// ---------------------------------------------------------------------------

const GRANULARITY_FORMAT: Record<string, string> = {
  day: "%Y-%m-%d",
  week: "%Y-%W",
  month: "%Y-%m",
  year: "%Y",
};

/** Spotify's own rule: anything shorter than 30s counts as a skip. */
const SKIP_MS = 30_000;

function pickGranularity(query: Record<string, unknown>, def = "month"): string {
  const g = typeof query.granularity === "string" ? query.granularity : def;
  return GRANULARITY_FORMAT[g] ? g : def;
}

/** COUNT(*) for streams (default), SUM(durationMs) for playtime. */
function metricExpr(query: Record<string, unknown>): Prisma.Sql {
  return query.metric === "playtime" ? Prisma.sql`SUM("durationMs")` : Prisma.sql`COUNT(*)`;
}

function parseInt_(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Date window + optional ?playlist= filter (same as stats.ts). */
function scopedConditions(query: Record<string, unknown>, from?: Date, to?: Date): Prisma.Sql[] {
  const conditions = playedAtConditions(from, to);
  const pl = playlistCondition(query);
  if (pl) conditions.push(pl);
  return conditions;
}

function scopedWhere(query: Record<string, unknown>, from?: Date, to?: Date) {
  return whereClause(scopedConditions(query, from, to));
}

/** The same window + playlist filter as plain SQL for the raw better-sqlite3 path. */
function rawScopedWhere(
  query: Record<string, unknown>,
  from?: Date,
  to?: Date
): { sql: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (from) {
    conds.push(`"playedAt" >= ?`);
    params.push(from.toISOString());
  }
  if (to) {
    conds.push(`"playedAt" <= ?`);
    params.push(to.toISOString());
  }
  const playlist = typeof query.playlist === "string" ? query.playlist.trim() : "";
  if (playlist) {
    conds.push(`("contextType" = 'playlist' AND "contextUri" = ?)`);
    params.push(playlist);
  }
  return { sql: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

const SESSION_GAP_MS = 20 * 60_000;
const EARWORM_WINDOW_MS = 7 * 86_400_000;

/**
 * Longest session + worst earworm from one raw scan of the window, ascending
 * by playedAt. Both need every play; SQLite window functions over 209k rows
 * cost ~1.5s locally (~6s on the Pi), a raw-array scan plus two JS sweeps
 * ~0.5s.
 *   session: a play starts a new session when it begins more than 20 min after
 *            the END (start + durationMs) of everything played before it;
 *            ms = last end − first start (wall clock).
 *   earworm: for each play (≥ 30s listened), plays of the same track starting
 *            within the following 7 days — two-pointer per track.
 */
function scanSessionAndEarworm(where: { sql: string; params: unknown[] }) {
  const rows = readOnlyDb()
    .prepare(
      `SELECT "playedAt", "durationMs", "spotifyUri" FROM "Play" ${where.sql} ORDER BY "playedAt" ASC`
    )
    .raw()
    .all(...where.params) as Array<[string, number, string]>;

  type Session = { ms: number; start: number; end: number; plays: number };
  let session: Session | null = null;
  let sStart = 0;
  let sEnd = -Infinity;
  let sPlays = 0;
  const closeSession = () => {
    if (sPlays && (!session || sEnd - sStart > session.ms)) {
      session = { ms: sEnd - sStart, start: sStart, end: sEnd, plays: sPlays };
    }
  };
  const byUri = new Map<string, number[]>();
  for (const [playedAt, durationMs, uri] of rows) {
    const s = Date.parse(playedAt);
    const e = s + durationMs;
    if (s - sEnd > SESSION_GAP_MS) {
      closeSession();
      sStart = s;
      sEnd = e;
      sPlays = 1;
    } else {
      if (e > sEnd) sEnd = e;
      sPlays++;
    }
    if (durationMs >= SKIP_MS) {
      let list = byUri.get(uri);
      if (!list) byUri.set(uri, (list = []));
      list.push(s); // ascending, since the scan is ordered by playedAt
    }
  }
  closeSession();

  // best 7-day window per track (two-pointer sweep, plays are ascending)
  const earworms: Array<{ uri: string; at: number; plays: number }> = [];
  for (const [uri, ts] of byUri) {
    let best = { uri, at: ts[0]!, plays: 0 };
    let j = 0;
    for (let i = 0; i < ts.length; i++) {
      const limit = ts[i]! + EARWORM_WINDOW_MS;
      while (j < ts.length && ts[j]! <= limit) j++;
      if (j - i > best.plays) best = { uri, at: ts[i]!, plays: j - i };
    }
    if (best.plays > 0) earworms.push(best);
  }
  earworms.sort((a, b) => b.plays - a.plays || a.at - b.at);
  // TS narrows `session` to null (it is only assigned inside closeSession)
  return { session: session as Session | null, earworm: earworms[0] ?? null, earworms };
}

/** Track + artist names for a list of URIs (latest names win). */
async function namesForUris(uris: string[]): Promise<Map<string, { trackName: string; artistName: string }>> {
  const out = new Map<string, { trackName: string; artistName: string }>();
  if (!uris.length) return out;
  const rows = await prisma.$queryRaw<Array<any>>`
    SELECT "spotifyUri" AS uri, "trackName" AS trackName, "artistName" AS artistName
    FROM (
      SELECT "spotifyUri", "trackName", "artistName",
             ROW_NUMBER() OVER (PARTITION BY "spotifyUri" ORDER BY "playedAt" DESC) AS rn
      FROM "Play" WHERE "spotifyUri" IN (${Prisma.join(uris)})
    ) WHERE rn = 1`;
  for (const r of rows) out.set(String(r.uri), { trackName: r.trackName, artistName: r.artistName });
  return out;
}

/** Local calendar date (YYYY-MM-DD, server TZ) of an epoch ms — matches SQLite's date(..., 'localtime'). */
function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const recordRoutes: FastifyPluginAsync = async (app) => {
  // Weekday (0 = Sunday … 6 = Saturday, SQLite %w) × hour (0–23), local time.
  // Only cells with a value > 0 are returned.
  app.get("/api/record/week-hour-grid", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);
    const metric = metricExpr(query);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT CAST(strftime('%w', "playedAt", 'localtime') AS INTEGER) AS weekday,
             CAST(strftime('%H', "playedAt", 'localtime') AS INTEGER) AS hour,
             ${metric} AS value
      FROM "Play" ${where}
      GROUP BY weekday, hour ORDER BY weekday, hour`;
    return {
      data: rows
        .map((r) => ({ weekday: num(r.weekday), hour: num(r.hour), value: num(r.value) }))
        .filter((c) => c.value > 0),
    };
  });

  // Top N artists in the window, one series each over time, plus "other".
  // Buckets mirror /api/stats/streams-over-time (same strftime formats, UTC).
  app.get("/api/record/streams-by-artist", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);
    const fmt = GRANULARITY_FORMAT[pickGranularity(query)];
    const metric = metricExpr(query);
    const top = parseInt_(query.top, 10, 1, 20);

    const topRows = await prisma.$queryRaw<Array<any>>`
      SELECT "artistName" AS artistName, ${metric} AS value
      FROM "Play" ${where}
      GROUP BY "artistName"
      ORDER BY value DESC, "artistName" ASC
      LIMIT ${top}`;
    const artists: string[] = topRows.map((r) => String(r.artistName));
    if (artists.length === 0) {
      return { data: { buckets: [], artists: [], values: [], other: [] } };
    }

    // Everything outside the top N is folded into '' (= "other") inside SQL so
    // the result stays at most (#buckets × (N + 1)) rows.
    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT strftime(${fmt}, "playedAt") AS bucket,
             CASE WHEN "artistName" IN (${Prisma.join(artists)}) THEN "artistName" ELSE '' END AS artistName,
             ${metric} AS value
      FROM "Play" ${where}
      GROUP BY bucket, artistName ORDER BY bucket`;

    // dense buckets (empty ones included) so the time axis keeps its gaps
    const buckets = await denseBuckets(fmt, where);
    const bucketIndex = new Map<string, number>(buckets.map((b, i) => [b, i]));
    const artistIndex = new Map<string, number>(artists.map((a, i) => [a, i]));
    const values: number[][] = artists.map(() => new Array<number>(buckets.length).fill(0));
    const other: number[] = new Array<number>(buckets.length).fill(0);
    for (const r of rows) {
      const bi = bucketIndex.get(String(r.bucket));
      if (bi === undefined) continue;
      const ai = artistIndex.get(String(r.artistName));
      if (ai === undefined) other[bi] += num(r.value);
      else values[ai]![bi] += num(r.value);
    }
    return { data: { buckets, artists, values, other } };
  });

  // #1 artist per calendar year (local time) by ?metric=streams|playtime, ties by name.
  app.get("/api/record/top-artist-per-year", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);
    const metric = metricExpr(query);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT year, artistName, streams, playtimeMs FROM (
        SELECT CAST(strftime('%Y', "playedAt", 'localtime') AS INTEGER) AS year,
               "artistName" AS artistName,
               COUNT(*) AS streams,
               SUM("durationMs") AS playtimeMs,
               ROW_NUMBER() OVER (
                 PARTITION BY strftime('%Y', "playedAt", 'localtime')
                 ORDER BY ${metric} DESC, "artistName" ASC
               ) AS rn
        FROM "Play" ${where}
        GROUP BY year, "artistName"
      ) WHERE rn = 1 ORDER BY year`;
    return {
      data: rows.map((r) => ({
        year: num(r.year),
        artistName: r.artistName,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
      })),
    };
  });

  // The four poster stats on the disc + the worst earworm. Each is null when
  // the window holds no plays. Streak/biggest day/first play are cheap SQL;
  // session + earworm come from one raw scan (see scanSessionAndEarworm).
  app.get("/api/record/highlights", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);

    // Longest run of consecutive local calendar days with ≥ 1 play
    // (gaps-and-islands: julianday(day) - row_number is constant inside a run).
    const streakQ = prisma.$queryRaw<Array<any>>`
      WITH days AS (SELECT DISTINCT date("playedAt", 'localtime') AS d FROM "Play" ${where}),
           grp AS (SELECT d, julianday(d) - ROW_NUMBER() OVER (ORDER BY d) AS g FROM days)
      SELECT MIN(d) AS fromDay, MAX(d) AS toDay, COUNT(*) AS days
      FROM grp GROUP BY g ORDER BY days DESC, fromDay ASC LIMIT 1`;

    const dayQ = prisma.$queryRaw<Array<any>>`
      SELECT date("playedAt", 'localtime') AS d, SUM("durationMs") AS ms, COUNT(*) AS plays
      FROM "Play" ${where} GROUP BY d ORDER BY ms DESC, d ASC LIMIT 1`;

    const firstQ = prisma.$queryRaw<Array<any>>`
      SELECT "playedAt" AS playedAt, "trackName" AS trackName, "artistName" AS artistName
      FROM "Play" ${where} ORDER BY "playedAt" ASC LIMIT 1`;

    const [streak, day, first] = await Promise.all([streakQ, dayQ, firstQ]);
    const { session, earworm } = scanSessionAndEarworm(rawScopedWhere(query, from, to));
    const s = streak[0];
    const d = day[0];
    const f = first[0];

    let earwormOut: {
      spotifyUri: string;
      trackName: string;
      artistName: string;
      plays: number;
      weekStart: string;
    } | null = null;
    if (earworm) {
      const names = await prisma.$queryRaw<Array<any>>`
        SELECT "trackName" AS trackName, "artistName" AS artistName
        FROM "Play" WHERE "spotifyUri" = ${earworm.uri} ORDER BY "playedAt" DESC LIMIT 1`;
      earwormOut = {
        spotifyUri: earworm.uri,
        trackName: names[0]?.trackName ?? "",
        artistName: names[0]?.artistName ?? "",
        plays: earworm.plays,
        weekStart: localDate(earworm.at),
      };
    }

    return {
      data: {
        longestStreak: s ? { days: num(s.days), from: s.fromDay, to: s.toDay } : null,
        longestSession: session
          ? {
              ms: session.ms,
              start: new Date(session.start).toISOString(),
              end: new Date(session.end).toISOString(),
              plays: session.plays,
            }
          : null,
        biggestDay: d ? { date: d.d, ms: num(d.ms), plays: num(d.plays) } : null,
        firstPlay: f
          ? { playedAt: f.playedAt, trackName: f.trackName, artistName: f.artistName }
          : null,
        earworm: earwormOut,
      },
    };
  });

  // The worst earworms: tracks ranked by their best 7-day window.
  app.get("/api/record/earworms", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const limit = parseInt_(query.limit, 6, 1, 50);
    const { earworms } = scanSessionAndEarworm(rawScopedWhere(query, from, to));
    const top = earworms.slice(0, limit);
    const names = await namesForUris(top.map((e) => e.uri));
    return {
      data: top.map((e) => ({
        spotifyUri: e.uri,
        trackName: names.get(e.uri)?.trackName ?? "",
        artistName: names.get(e.uri)?.artistName ?? "",
        plays: e.plays,
        weekStart: localDate(e.at),
      })),
    };
  });

  // Share of plays skipped (< 30 s) per calendar year.
  app.get("/api/record/skip-rate-by-year", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);
    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT CAST(strftime('%Y', "playedAt", 'localtime') AS INTEGER) AS year,
             COUNT(*) AS plays,
             SUM(CASE WHEN "durationMs" < ${SKIP_MS} THEN 1 ELSE 0 END) AS skips
      FROM "Play" ${where}
      GROUP BY year ORDER BY year`;
    return {
      data: rows.map((r) => {
        const plays = num(r.plays);
        const skips = num(r.skips);
        return { year: num(r.year), plays, skips, skipRate: plays ? Math.round((skips / plays) * 10000) / 10000 : 0 };
      }),
    };
  });

  // "Explore, then obsess": per calendar year, the share of listening on artists
  // first heard that year (over the WHOLE history, so an old favourite never
  // counts as new) versus the share on the year's own top-10 artists.
  app.get("/api/record/explore-obsess", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = scopedWhere(query, from, to);
    const metric = metricExpr(query);

    const rows = await prisma.$queryRaw<Array<any>>`
      WITH firstYear AS (
        SELECT "artistName", CAST(strftime('%Y', MIN("playedAt"), 'localtime') AS INTEGER) AS fy
        FROM "Play" GROUP BY "artistName"
      ),
      perArtist AS (
        SELECT CAST(strftime('%Y', p."playedAt", 'localtime') AS INTEGER) AS year,
               p."artistName" AS artistName,
               ${metric} AS value
        FROM "Play" p ${where}
        GROUP BY year, p."artistName"
      ),
      ranked AS (
        SELECT pa.year, pa.artistName, pa.value,
               ROW_NUMBER() OVER (PARTITION BY pa.year ORDER BY pa.value DESC, pa.artistName ASC) AS rn,
               (f.fy = pa.year) AS isNew
        FROM perArtist pa JOIN firstYear f ON f."artistName" = pa.artistName
      )
      SELECT year,
             SUM(value) AS total,
             SUM(CASE WHEN isNew THEN value ELSE 0 END) AS newValue,
             SUM(CASE WHEN rn <= 10 THEN value ELSE 0 END) AS top10Value
      FROM ranked GROUP BY year ORDER BY year`;
    return {
      data: rows.map((r) => {
        const total = num(r.total);
        const share = (v: number) => (total ? Math.round((v / total) * 10000) / 10000 : 0);
        return {
          year: num(r.year),
          total,
          newArtistShare: share(num(r.newValue)),
          top10Share: share(num(r.top10Value)),
        };
      }),
    };
  });

  // "How songs wear out": skip rate on the nth play of a song. Plays are
  // numbered per track over the WHOLE history (no window, no playlist), only
  // songs with ≥ minPlays plays overall take part, and only plays inside the
  // window/playlist are counted. n ≥ maxPlay is pooled into the last step.
  app.get("/api/record/wear-out", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const maxPlay = parseInt_(query.maxPlay, 30, 2, 200);
    const minPlays = parseInt_(query.minPlays, 8, 1, 1000);
    const MIN_STEP_PLAYS = 20;

    const conditions = scopedConditions(query, from, to);
    conditions.push(Prisma.sql`total >= ${minPlays}`);
    const where = whereClause(conditions);

    const rows = await prisma.$queryRaw<Array<any>>`
      WITH numbered AS (
        SELECT "playedAt", "durationMs", "contextType", "contextUri",
               ROW_NUMBER() OVER (PARTITION BY "spotifyUri" ORDER BY "playedAt") AS n,
               COUNT(*) OVER (PARTITION BY "spotifyUri") AS total
        FROM "Play"
      )
      SELECT MIN(n, ${maxPlay}) AS step,
             COUNT(*) AS plays,
             SUM(CASE WHEN "durationMs" < ${SKIP_MS} THEN 1 ELSE 0 END) AS skips
      FROM numbered ${where}
      GROUP BY step ORDER BY step`;

    // Dense 1..maxPlay, then fold thin trailing steps into the pool at the end
    // so the curve does not end in noise.
    const byStep = new Map<number, { plays: number; skips: number }>(
      rows.map((r) => [num(r.step), { plays: num(r.plays), skips: num(r.skips) }])
    );
    const raw: Array<{ n: number; plays: number; skips: number }> = [];
    for (let n = 1; n <= maxPlay; n++) {
      const v = byStep.get(n);
      if (v) raw.push({ n, ...v });
    }
    while (raw.length >= 2) {
      const last = raw[raw.length - 1]!;
      const prev = raw[raw.length - 2]!;
      if (last.plays >= MIN_STEP_PLAYS && prev.plays >= MIN_STEP_PLAYS) break;
      raw.splice(raw.length - 2, 2, {
        n: prev.n,
        plays: prev.plays + last.plays,
        skips: prev.skips + last.skips,
      });
    }

    const steps = raw.map((r) => ({
      n: r.n,
      skipRate: r.plays ? Math.round((r.skips / r.plays) * 10000) / 10000 : 0,
      plays: r.plays,
    }));
    const totalPlays = raw.reduce((a, r) => a + r.plays, 0);
    const totalSkips = raw.reduce((a, r) => a + r.skips, 0);
    const average = totalPlays ? Math.round((totalSkips / totalPlays) * 10000) / 10000 : 0;

    let best: number | null = null;
    let bestRate = Infinity;
    for (const st of steps) {
      if (st.skipRate < bestRate) {
        bestRate = st.skipRate;
        best = st.n;
      }
    }
    let tiredAt: number | null = null;
    if (best !== null) {
      const after = steps.find((st) => st.n > best! && st.skipRate >= average);
      tiredAt = after ? after.n : null;
    }

    return { data: { steps, average, best, tiredAt } };
  });
};

export default recordRoutes;
