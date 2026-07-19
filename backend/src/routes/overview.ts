import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  buildPlayedAtFilter,
  playedAtConditions,
  whereClause,
} from "../lib/dateFilter";
import {
  parseLimit,
  parseOffset,
  parseSort,
  parseOrder,
  likeCondition,
  num,
  playlistCondition,
} from "../lib/query";

/** Latest recorded name for the grouped playlist (playlists get renamed). */
const LATEST_PLAYLIST_NAME = Prisma.sql`(
  SELECT p2."playlistName" FROM "Play" p2
  WHERE p2."contextUri" = "Play"."contextUri" AND p2."playlistName" IS NOT NULL
  ORDER BY p2."playedAt" DESC LIMIT 1
)`;

const overviewRoutes: FastifyPluginAsync = async (app) => {
  // Top songs / artists / albums / playlists, filtered by date, sortable by streams|playtime.
  app.get("/api/top/:entity", async (request, reply) => {
    const { entity } = request.params as { entity: string };
    if (!["songs", "artists", "albums", "playlists"].includes(entity)) {
      return reply
        .status(400)
        .send({ error: "entity must be one of: songs, artists, albums, playlists" });
    }

    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });

    const sort = parseSort(query);
    const order = parseOrder(query);
    const limit = parseLimit(query);
    const offset = parseOffset(query);
    const q = typeof query.q === "string" ? query.q.trim() : "";

    const groupCol =
      entity === "songs"
        ? "spotifyUri"
        : entity === "artists"
          ? "artistName"
          : entity === "albums"
            ? "albumName"
            : "contextUri";
    const searchCol =
      entity === "artists"
        ? "artistName"
        : entity === "albums"
          ? "albumName"
          : entity === "playlists"
            ? "playlistName"
            : "trackName";

    const conditions = playedAtConditions(from, to);
    if (q) conditions.push(likeCondition(searchCol, q));
    if (entity === "playlists") {
      conditions.push(Prisma.sql`("contextType" = 'playlist' AND "contextUri" IS NOT NULL)`);
    } else {
      // Optional ?playlist= narrows songs/artists/albums to plays from that playlist.
      const pl = playlistCondition(query);
      if (pl) conditions.push(pl);
    }
    const where = whereClause(conditions);

    const orderExpr =
      sort === "playtime" ? Prisma.sql`SUM("durationMs")` : Prisma.sql`COUNT(*)`;
    const dir = Prisma.raw(order);

    // The distinct-group count costs a second full aggregation — callers that
    // don't paginate (the dashboard) skip it with ?total=0.
    let total: number | null = null;
    if (query.total !== "0") {
      const totalRows = await prisma.$queryRaw<Array<{ total: number | bigint }>>`
        SELECT COUNT(*) AS total FROM (
          SELECT 1 FROM "Play" ${where} GROUP BY ${Prisma.raw(`"${groupCol}"`)}
        )`;
      total = num(totalRows[0]?.total);
    }

    let data: unknown[];
    if (entity === "songs") {
      const rows = await prisma.$queryRaw<Array<any>>`
        SELECT "spotifyUri" AS spotifyUri, "trackName" AS trackName,
               "artistName" AS artistName, "albumName" AS albumName,
               COUNT(*) AS streams, SUM("durationMs") AS playtimeMs
        FROM "Play" ${where}
        GROUP BY "spotifyUri"
        ORDER BY ${orderExpr} ${dir}
        LIMIT ${limit} OFFSET ${offset}`;
      data = rows.map((r) => ({
        spotifyUri: r.spotifyUri,
        trackName: r.trackName,
        artistName: r.artistName,
        albumName: r.albumName,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
      }));
    } else if (entity === "artists") {
      const rows = await prisma.$queryRaw<Array<any>>`
        SELECT "artistName" AS artistName, COUNT(*) AS streams, SUM("durationMs") AS playtimeMs
        FROM "Play" ${where}
        GROUP BY "artistName"
        ORDER BY ${orderExpr} ${dir}
        LIMIT ${limit} OFFSET ${offset}`;
      data = rows.map((r) => ({
        artistName: r.artistName,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
      }));
    } else if (entity === "albums") {
      const rows = await prisma.$queryRaw<Array<any>>`
        SELECT "albumName" AS albumName, "artistName" AS artistName,
               COUNT(*) AS streams, SUM("durationMs") AS playtimeMs
        FROM "Play" ${where}
        GROUP BY "albumName"
        ORDER BY ${orderExpr} ${dir}
        LIMIT ${limit} OFFSET ${offset}`;
      data = rows.map((r) => ({
        albumName: r.albumName,
        artistName: r.artistName,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
      }));
    } else {
      const rows = await prisma.$queryRaw<Array<any>>`
        SELECT "contextUri" AS playlistUri, ${LATEST_PLAYLIST_NAME} AS playlistName,
               COUNT(*) AS streams, SUM("durationMs") AS playtimeMs
        FROM "Play" ${where}
        GROUP BY "contextUri"
        ORDER BY ${orderExpr} ${dir}
        LIMIT ${limit} OFFSET ${offset}`;
      data = rows.map((r) => ({
        playlistUri: r.playlistUri,
        playlistName: r.playlistName ?? null,
        streams: num(r.streams),
        playtimeMs: num(r.playtimeMs),
      }));
    }

    return { data, meta: { total, limit, offset } };
  });

  // Distinct playlists seen in the play log (for filter dropdowns), most-played first.
  app.get("/api/playlists", async (request) => {
    const query = request.query as Record<string, unknown>;
    const limit = parseLimit(query, 100, 500);
    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT "contextUri" AS playlistUri, ${LATEST_PLAYLIST_NAME} AS playlistName,
             COUNT(*) AS streams
      FROM "Play"
      WHERE "contextType" = 'playlist' AND "contextUri" IS NOT NULL
      GROUP BY "contextUri"
      ORDER BY streams DESC
      LIMIT ${limit}`;
    return {
      data: rows.map((r) => ({
        playlistUri: r.playlistUri,
        playlistName: r.playlistName ?? null,
        streams: num(r.streams),
      })),
    };
  });

  // Most recent plays, newest first.
  app.get("/api/recently-played", async (request) => {
    const query = request.query as Record<string, unknown>;
    const limit = parseLimit(query, 20, 200);
    const data = await prisma.play.findMany({
      orderBy: { playedAt: "desc" },
      take: limit,
      select: {
        playedAt: true,
        spotifyUri: true,
        trackName: true,
        artistName: true,
        albumName: true,
        contextType: true,
        playlistName: true,
      },
    });
    return { data };
  });

  // "Forgotten": high historic plays, but nothing inside the current window.
  app.get("/api/forgotten", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const boundary = from ?? new Date(Date.now() - 30 * 86_400_000);
    const limit = parseLimit(query, 20, 100);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT "spotifyUri" AS spotifyUri, "trackName" AS trackName, "artistName" AS artistName,
             COUNT(*) AS historicStreams, MAX("playedAt") AS lastPlayedAt
      FROM "Play"
      GROUP BY "spotifyUri"
      HAVING MAX("playedAt") < ${boundary}
      ORDER BY historicStreams DESC
      LIMIT 200`;

    const nowMs = Date.now();
    const scored = rows.map((r) => {
      const daysSinceLast = Math.max(
        0,
        Math.floor((nowMs - new Date(r.lastPlayedAt).getTime()) / 86_400_000)
      );
      const historicStreams = num(r.historicStreams);
      return {
        spotifyUri: r.spotifyUri,
        trackName: r.trackName,
        artistName: r.artistName,
        historicStreams,
        lastPlayedAt: r.lastPlayedAt,
        daysSinceLast,
        score: historicStreams / (daysSinceLast + 1),
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return { data: scored.slice(0, limit) };
  });
};

export default overviewRoutes;
