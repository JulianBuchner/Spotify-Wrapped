import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { gzipSync } from "zlib";
import { prisma } from "../db";
import { readOnlyDb } from "../lib/rawDb";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import { parseLimit, parseOffset, likeCondition, num, playlistCondition } from "../lib/query";
import {
  ALL_TIME_RANGE,
  cacheEntryValid,
  dataVersion,
  prewarmReason,
  probeExternalWrites,
  type CacheStamp,
} from "../lib/dataVersion";

// ---------------------------------------------------------------------------
// /api/history/points serves ~190k rows. Going through Prisma materializes
// every row as an object (seconds on the Pi), so this endpoint reads via the
// shared read-only better-sqlite3 connection (lib/rawDb) in raw-array mode
// instead, and caches the final gzipped payload — the gzip alone costs >1s
// per hit. All-time entries also stay valid past the TTL while the data
// version is unchanged (lib/dataVersion.ts), same as the response cache.
// ---------------------------------------------------------------------------

const POINTS_TTL_MS = 300_000;
const POINTS_MAX_ENTRIES = 12; // ~12MB json + ~2.5MB gz each: ≈180MB worst case, fine on the M3's 16GB
const pointsCache = new Map<string, { json: string; gz: Buffer } & CacheStamp>();
const pointsValid = (key: string, entry: CacheStamp, now = Date.now()) =>
  cacheEntryValid(entry, POINTS_TTL_MS, ALL_TIME_RANGE.test(key), now);

const historyRoutes: FastifyPluginAsync = async (app) => {
  // Paginated raw play log, newest first, searchable across track/artist/album.
  app.get("/api/history", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const limit = parseLimit(query, 50, 200);
    const offset = parseOffset(query);
    const q = typeof query.q === "string" ? query.q.trim() : "";

    const conditions = playedAtConditions(from, to);
    if (q) {
      conditions.push(
        Prisma.sql`(${likeCondition("trackName", q)} OR ${likeCondition(
          "artistName",
          q
        )} OR ${likeCondition("albumName", q)})`
      );
    }
    const where = whereClause(conditions);

    const [rows, totalRows] = await Promise.all([
      prisma.$queryRaw<Array<any>>`
        SELECT "playedAt" AS playedAt, "spotifyUri" AS spotifyUri, "trackName" AS trackName,
               "artistName" AS artistName, "albumName" AS albumName, "durationMs" AS durationMs
        FROM "Play" ${where}
        ORDER BY "playedAt" DESC
        LIMIT ${limit} OFFSET ${offset}`,
      prisma.$queryRaw<Array<{ total: number | bigint }>>`
        SELECT COUNT(*) AS total FROM "Play" ${where}`,
    ]);

    return {
      data: rows.map((r) => ({
        playedAt: r.playedAt,
        spotifyUri: r.spotifyUri,
        trackName: r.trackName,
        artistName: r.artistName,
        albumName: r.albumName,
        durationMs: num(r.durationMs),
      })),
      meta: { total: num(totalRows[0]?.total), limit, offset },
    };
  });

  // Lightweight feed for the interactive scatter ("listening cloud"):
  // all plays in the range, ascending, minimal fields.
  app.get("/api/history/points", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });

    const cacheKey = request.raw.url ?? "";
    const cached = pointsCache.get(cacheKey);
    const sendCached = (entry: { json: string; gz: Buffer }) => {
      reply.type("application/json");
      const acceptsGzip = String(request.headers["accept-encoding"] ?? "").includes("gzip");
      if (acceptsGzip) return reply.header("content-encoding", "gzip").send(entry.gz);
      return reply.send(entry.json);
    };
    if (cached && pointsValid(cacheKey, cached)) {
      reply.header("x-cache", "hit");
      return sendCached(cached);
    }

    const playlist = typeof query.playlist === "string" ? query.playlist.trim() : "";
    return sendCached(buildPointsPayload(cacheKey, from, to, playlist));
  });

  // Pre-warm the all-time window on boot and keep it fresh — the cold build
  // costs ~10s on the Pi (SD read + stringify + gzip of 10MB). CloudView now
  // defaults to this_week (cheap, built lazily), but all-time stays one click
  // away and must not take 10s when clicked. A run only rebuilds when the entry
  // is missing, the data changed since its build, or it nears the safety cap.
  const PREWARM_URL = "/api/history/points?range=all_time";
  const PREWARM_INTERVAL_MS = 4 * 60_000;
  const prewarm = async () => {
    try {
      await probeExternalWrites();
      const started = Date.now();
      const reason = prewarmReason(pointsCache.get(PREWARM_URL), PREWARM_INTERVAL_MS, started);
      if (!reason) return; // data unchanged: the cached entry stays valid
      const { from, to } = buildPlayedAtFilter({ range: "all_time" });
      buildPointsPayload(PREWARM_URL, from, to, "");
      app.log.info({ ms: Date.now() - started, reason }, "points prewarm done");
    } catch (err) {
      app.log.warn({ err }, "points prewarm failed");
    }
  };
  setTimeout(() => void prewarm(), 5_000).unref();
  setInterval(() => void prewarm(), PREWARM_INTERVAL_MS).unref();
};

/** Query (raw sqlite), serialize, gzip and cache one points window. */
function buildPointsPayload(
  cacheKey: string,
  from: Date | undefined,
  to: Date | undefined,
  playlist: string
): { json: string; gz: Buffer } {
  const version = dataVersion(); // before the read (see server.ts versionAtStart)
  // plain SQL — this path bypasses Prisma (see header comment)
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
  if (playlist) {
    conds.push(`("contextType" = 'playlist' AND "contextUri" = ?)`);
    params.push(playlist);
  }
  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  // Safety cap only — must stay above the full play count so the cloud
  // shows the whole history (a 100k cap silently chopped off everything
  // after ~2024 once the 171k-row export import landed).
  const CAP = 500_000;
  const rows = readOnlyDb()
    .prepare(
      `SELECT "playedAt", "trackName", "artistName", "playlistName", "durationMs"
       FROM "Play" ${whereSql}
       ORDER BY "playedAt" ASC
       LIMIT ${CAP}`
    )
    .raw()
    .all(...params) as Array<[string, string, string, string | null, number]>;

  // Columnar payload: with ~190k rows, per-row objects cost ~26MB of JSON
  // and seconds of stringify time on the Pi. Parallel arrays (epoch ms +
  // names + ms listened) more than halve the size and serialize far faster.
  const n = rows.length;
  const t = new Array<number>(n);
  const track = new Array<string>(n);
  const artist = new Array<string>(n);
  const playlistCol = new Array<string | null>(n);
  const d = new Array<number>(n); // durationMs, index-aligned with t
  for (let i = 0; i < n; i++) {
    const r = rows[i]!;
    t[i] = Date.parse(r[0]);
    track[i] = r[1];
    artist[i] = r[2];
    playlistCol[i] = r[3] ?? null;
    d[i] = r[4];
  }

  const json = JSON.stringify({
    data: { t, track, artist, playlist: playlistCol, d },
    meta: { total: n, capped: n === CAP },
  });
  const gz = gzipSync(json, { level: 3 });
  const now = Date.now();
  if (!pointsCache.has(cacheKey) && pointsCache.size >= POINTS_MAX_ENTRIES) {
    // an expired entry first, the oldest otherwise (keeps the long-lived all-time entry)
    let victim: string | undefined;
    for (const [k, e] of pointsCache) {
      if (!pointsValid(k, e, now)) {
        victim = k;
        break;
      }
    }
    victim ??= pointsCache.keys().next().value;
    if (victim !== undefined) pointsCache.delete(victim);
  }
  pointsCache.set(cacheKey, { json, gz, at: now, version });
  return { json, gz };
}

export default historyRoutes;
