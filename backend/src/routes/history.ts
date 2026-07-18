import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import { parseLimit, parseOffset, likeCondition, num } from "../lib/query";

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
};

export default historyRoutes;
