import { FastifyPluginAsync } from "fastify";
import { prisma } from "../db";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import { parseLimit, num } from "../lib/query";

const wrappedRoutes: FastifyPluginAsync = async (app) => {
  // Most-streamed artist for each month.
  app.get("/api/wrapped/top-artist-per-month", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = whereClause(playedAtConditions(from, to));

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT month, artistName, streams FROM (
        SELECT strftime('%Y-%m', "playedAt") AS month,
               "artistName" AS artistName,
               COUNT(*) AS streams,
               ROW_NUMBER() OVER (
                 PARTITION BY strftime('%Y-%m', "playedAt")
                 ORDER BY COUNT(*) DESC, "artistName" ASC
               ) AS rn
        FROM "Play" ${where}
        GROUP BY month, "artistName"
      ) WHERE rn = 1 ORDER BY month`;
    return {
      data: rows.map((r) => ({
        month: r.month,
        artistName: r.artistName,
        streams: num(r.streams),
      })),
    };
  });

  // First day each album was played twice or more ("obsessions").
  app.get("/api/wrapped/album-obsessions", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = whereClause(playedAtConditions(from, to));

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT albumName, artistName, MIN(day) AS firstObsessionDay FROM (
        SELECT "albumName" AS albumName, "artistName" AS artistName,
               strftime('%Y-%m-%d', "playedAt") AS day, COUNT(*) AS c
        FROM "Play" ${where}
        GROUP BY "albumName", day
        HAVING c >= 2
      ) GROUP BY albumName ORDER BY firstObsessionDay`;
    return {
      data: rows.map((r) => ({
        date: r.firstObsessionDay,
        albumName: r.albumName,
        artistName: r.artistName,
      })),
    };
  });

  // Proxy for "albums played front to back": true playthrough detection needs
  // track lists (deferred with enrichment). Until then: top albums by streams,
  // with how many distinct tracks of the album were actually heard.
  app.get("/api/wrapped/top-albums", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = whereClause(playedAtConditions(from, to));
    const limit = parseLimit(query, 50, 200);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT "albumName" AS albumName, "artistName" AS artistName,
             COUNT(*) AS streams, SUM("durationMs") AS playtimeMs,
             COUNT(DISTINCT "spotifyUri") AS distinctTracksPlayed
      FROM "Play" ${where}
      GROUP BY "albumName"
      ORDER BY streams DESC
      LIMIT ${limit}`;
    return {
      data: rows.map((r) => ({
        albumName: r.albumName,
        artistName: r.artistName,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
        distinctTracksPlayed: num(r.distinctTracksPlayed),
      })),
    };
  });
};

export default wrappedRoutes;
