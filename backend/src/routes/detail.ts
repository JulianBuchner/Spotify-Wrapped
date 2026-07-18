import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import { num } from "../lib/query";

const detailRoutes: FastifyPluginAsync = async (app) => {
  // Song detail by spotifyUri (Fastify URL-decodes the path param).
  app.get("/api/song/:spotifyUri", async (request, reply) => {
    const { spotifyUri } = request.params as { spotifyUri: string };
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });

    const conditions = [
      Prisma.sql`"spotifyUri" = ${spotifyUri}`,
      ...playedAtConditions(from, to),
    ];
    const where = whereClause(conditions);

    const [agg, timeline] = await Promise.all([
      prisma.$queryRaw<Array<any>>`
        SELECT "trackName" AS trackName, "artistName" AS artistName, "albumName" AS albumName,
               COUNT(*) AS streams, SUM("durationMs") AS playtimeMs,
               MIN("playedAt") AS firstPlayedAt, MAX("playedAt") AS lastPlayedAt
        FROM "Play" ${where}`,
      prisma.$queryRaw<Array<any>>`
        SELECT strftime('%Y-%m', "playedAt") AS bucket, COUNT(*) AS streams
        FROM "Play" ${where} GROUP BY bucket ORDER BY bucket`,
    ]);

    const r = agg[0] ?? {};
    if (!num(r.streams)) {
      return reply.status(404).send({ error: "No plays for that spotifyUri" });
    }
    return {
      data: {
        spotifyUri,
        trackName: r.trackName,
        artistName: r.artistName,
        albumName: r.albumName,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
        firstPlayedAt: r.firstPlayedAt,
        lastPlayedAt: r.lastPlayedAt,
        timeline: timeline.map((t) => ({ bucket: t.bucket, streams: num(t.streams) })),
      },
    };
  });

  // Artist detail by name (query param; artist names can contain slashes).
  app.get("/api/artist", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const name = typeof query.name === "string" ? query.name.trim() : "";
    if (!name) return reply.status(400).send({ error: "Query param 'name' is required." });
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });

    const conditions = [
      Prisma.sql`"artistName" = ${name}`,
      ...playedAtConditions(from, to),
    ];
    const where = whereClause(conditions);

    const [agg, topTracks, topAlbums] = await Promise.all([
      prisma.$queryRaw<Array<any>>`
        SELECT COUNT(*) AS streams, SUM("durationMs") AS playtimeMs,
               COUNT(DISTINCT "spotifyUri") AS distinctTracks,
               MIN("playedAt") AS firstPlayedAt, MAX("playedAt") AS lastPlayedAt
        FROM "Play" ${where}`,
      prisma.$queryRaw<Array<any>>`
        SELECT "spotifyUri" AS spotifyUri, "trackName" AS trackName, COUNT(*) AS streams
        FROM "Play" ${where} GROUP BY "spotifyUri" ORDER BY streams DESC LIMIT 10`,
      prisma.$queryRaw<Array<any>>`
        SELECT "albumName" AS albumName, COUNT(*) AS streams
        FROM "Play" ${where} GROUP BY "albumName" ORDER BY streams DESC LIMIT 10`,
    ]);

    const r = agg[0] ?? {};
    if (!num(r.streams)) return reply.status(404).send({ error: "No plays for that artist" });
    return {
      data: {
        artistName: name,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
        distinctTracks: num(r.distinctTracks),
        firstPlayedAt: r.firstPlayedAt,
        lastPlayedAt: r.lastPlayedAt,
        topTracks: topTracks.map((t) => ({
          spotifyUri: t.spotifyUri,
          trackName: t.trackName,
          streams: num(t.streams),
        })),
        topAlbums: topAlbums.map((a) => ({ albumName: a.albumName, streams: num(a.streams) })),
      },
    };
  });

  // Album detail by name (query param).
  app.get("/api/album", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const name = typeof query.name === "string" ? query.name.trim() : "";
    if (!name) return reply.status(400).send({ error: "Query param 'name' is required." });
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });

    const conditions = [
      Prisma.sql`"albumName" = ${name}`,
      ...playedAtConditions(from, to),
    ];
    const where = whereClause(conditions);

    const [agg, tracks] = await Promise.all([
      prisma.$queryRaw<Array<any>>`
        SELECT "artistName" AS artistName, COUNT(*) AS streams, SUM("durationMs") AS playtimeMs,
               COUNT(DISTINCT "spotifyUri") AS distinctTracks,
               MIN("playedAt") AS firstPlayedAt, MAX("playedAt") AS lastPlayedAt
        FROM "Play" ${where}`,
      prisma.$queryRaw<Array<any>>`
        SELECT "spotifyUri" AS spotifyUri, "trackName" AS trackName, COUNT(*) AS streams
        FROM "Play" ${where} GROUP BY "spotifyUri" ORDER BY streams DESC`,
    ]);

    const r = agg[0] ?? {};
    if (!num(r.streams)) return reply.status(404).send({ error: "No plays for that album" });
    return {
      data: {
        albumName: name,
        artistName: r.artistName,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
        distinctTracks: num(r.distinctTracks),
        firstPlayedAt: r.firstPlayedAt,
        lastPlayedAt: r.lastPlayedAt,
        tracks: tracks.map((t) => ({
          spotifyUri: t.spotifyUri,
          trackName: t.trackName,
          streams: num(t.streams),
        })),
      },
    };
  });
};

export default detailRoutes;
