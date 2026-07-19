import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import Database from "better-sqlite3";
import { gzipSync } from "zlib";
import path from "path";
import { prisma } from "../db";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import { parseLimit, parseOffset, likeCondition, num, playlistCondition } from "../lib/query";

// ---------------------------------------------------------------------------
// /api/history/points serves ~190k rows. Going through Prisma materializes
// every row as an object (seconds on the Pi), so this endpoint reads via a
// dedicated read-only better-sqlite3 connection in raw-array mode instead,
// and caches the final gzipped payload — the gzip alone costs >1s per hit.
// WAL mode (set at startup) lets this reader coexist with the poller's writes.
// ---------------------------------------------------------------------------
let roDb: Database.Database | null = null;
function readOnlyDb(): Database.Database {
  if (!roDb) {
    const url = process.env.DATABASE_URL ?? "";
    const file = path.resolve(url.replace(/^file:/, ""));
    roDb = new Database(file, { readonly: true, fileMustExist: true });
  }
  return roDb;
}

const POINTS_TTL_MS = 300_000;
const POINTS_MAX_ENTRIES = 3; // ~12MB json + ~2.5MB gz each — keep few
const pointsCache = new Map<string, { json: string; gz: Buffer; at: number }>();

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
    if (cached && Date.now() - cached.at < POINTS_TTL_MS) {
      reply.header("x-cache", "hit");
      return sendCached(cached);
    }

    // build plain SQL (this route bypasses Prisma — see header comment)
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
    const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    // Safety cap only — must stay above the full play count so the cloud
    // shows the whole history (a 100k cap silently chopped off everything
    // after ~2024 once the 171k-row export import landed).
    const CAP = 500_000;
    const rows = readOnlyDb()
      .prepare(
        `SELECT "playedAt", "trackName", "artistName", "playlistName"
         FROM "Play" ${whereSql}
         ORDER BY "playedAt" ASC
         LIMIT ${CAP}`
      )
      .raw()
      .all(...params) as Array<[string, string, string, string | null]>;

    // Columnar payload: with ~190k rows, per-row objects cost ~26MB of JSON
    // and seconds of stringify time on the Pi. Parallel arrays (epoch ms +
    // names) more than halve the size and serialize far faster.
    const n = rows.length;
    const t = new Array<number>(n);
    const track = new Array<string>(n);
    const artist = new Array<string>(n);
    const playlistCol = new Array<string | null>(n);
    for (let i = 0; i < n; i++) {
      const r = rows[i]!;
      t[i] = Date.parse(r[0]);
      track[i] = r[1];
      artist[i] = r[2];
      playlistCol[i] = r[3] ?? null;
    }

    const json = JSON.stringify({
      data: { t, track, artist, playlist: playlistCol },
      meta: { total: n, capped: n === CAP },
    });
    const gz = gzipSync(json, { level: 3 });
    if (pointsCache.size >= POINTS_MAX_ENTRIES) {
      const oldest = pointsCache.keys().next().value;
      if (oldest !== undefined) pointsCache.delete(oldest);
    }
    pointsCache.set(cacheKey, { json, gz, at: Date.now() });

    return sendCached({ json, gz });
  });
};

export default historyRoutes;
