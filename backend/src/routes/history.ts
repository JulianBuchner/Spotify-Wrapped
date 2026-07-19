import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import { parseLimit, parseOffset, likeCondition, num, playlistCondition } from "../lib/query";

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
    const conditions = playedAtConditions(from, to);
    const pl = playlistCondition(query);
    if (pl) conditions.push(pl);
    const where = whereClause(conditions);

    // Safety cap only — must stay above the full play count so the cloud
    // shows the whole history (a 100k cap silently chopped off everything
    // after ~2024 once the 171k-row export import landed).
    const CAP = 500_000;
    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT "playedAt" AS playedAt, "trackName" AS trackName,
             "artistName" AS artistName, "playlistName" AS playlistName
      FROM "Play" ${where}
      ORDER BY "playedAt" ASC
      LIMIT ${CAP}`;

    // Columnar payload: with ~190k rows, per-row objects cost ~26MB of JSON
    // and seconds of stringify time on the Pi. Parallel arrays (epoch ms +
    // names) more than halve the size and serialize far faster.
    const n = rows.length;
    const t = new Array<number>(n);
    const track = new Array<string>(n);
    const artist = new Array<string>(n);
    const playlist = new Array<string | null>(n);
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      t[i] = new Date(r.playedAt).getTime();
      track[i] = r.trackName;
      artist[i] = r.artistName;
      playlist[i] = r.playlistName ?? null;
    }

    return {
      data: { t, track, artist, playlist },
      meta: { total: n, capped: n === CAP },
    };
  });
};

export default historyRoutes;
