import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Prisma } from "@prisma/client";
import { pollAllUsersOnce } from "./poller";
import { prisma, applySqlitePragmas } from "./db";
import { buildPlayedAtFilter } from "./lib/dateFilter";
import searchRoutes from "./routes/search";
import overviewRoutes from "./routes/overview";
import statsRoutes from "./routes/stats";
import wrappedRoutes from "./routes/wrapped";
import historyRoutes from "./routes/history";
import detailRoutes from "./routes/detail";

dotenv.config();

const PORT = Number(process.env.PORT ?? "3000");
const POLL_MIN = Number(process.env.POLL_INTERVAL_MINUTES ?? "30");
const POLL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS ?? "15");
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

// buildPlayedAtFilter now lives in ./lib/dateFilter
// (extended with range presets + single-day support; existing callers unchanged).

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
  });

  // ---------------------------------------------------------------------
  // Tiny in-memory response cache for the heavy read-only endpoints.
  // Aggregations over 190k rows take seconds on the Pi; the data changes
  // at most every few minutes (one poll), so 60s of staleness is free
  // speed. recently-played and plays/count stay uncached for freshness.
  // NOTE: these hooks must be registered BEFORE @fastify/compress — onSend
  // hooks run in registration order, and the cache needs the uncompressed
  // JSON string (compression then still applies to cache hits and misses).
  // ---------------------------------------------------------------------
  const CACHE_TTL_MS = 60_000;
  const CACHE_MAX_ENTRIES = 200;
  const CACHEABLE = /^\/api\/(stats\/|top\/|history\/points|playlists|forgotten|wrapped\/)/;
  const responseCache = new Map<string, { body: string; at: number }>();

  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "GET") return;
    const key = request.raw.url ?? "";
    if (!CACHEABLE.test(key)) return;
    const hit = responseCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      reply.header("x-cache", "hit").type("application/json");
      return reply.send(hit.body);
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (
      request.method === "GET" &&
      reply.statusCode === 200 &&
      typeof payload === "string" &&
      reply.getHeader("x-cache") !== "hit"
    ) {
      const key = request.raw.url ?? "";
      if (CACHEABLE.test(key)) {
        if (responseCache.size >= CACHE_MAX_ENTRIES) {
          const oldest = responseCache.keys().next().value;
          if (oldest !== undefined) responseCache.delete(oldest);
        }
        responseCache.set(key, { body: payload, at: Date.now() });
      }
    }
    return payload;
  });

  // gzip responses (the history/points payload is several MB of JSON;
  // level 3 keeps CPU cost low on the Pi)
  await app.register(compress, {
    encodings: ["gzip"],
    threshold: 1024,
    zlibOptions: { level: 3 },
  });

  // New endpoint groups (see ENDPOINT-PLAN.md)
  await app.register(searchRoutes);
  await app.register(overviewRoutes);
  await app.register(statsRoutes);
  await app.register(wrappedRoutes);
  await app.register(historyRoutes);
  await app.register(detailRoutes);

  // Serve the built frontend (LAN hosting on the Pi) under the same prefix
  // as the Vite base path. Works from both src/ (ts-node-dev) and dist/
  // (compiled) since both sit one level below backend/.
  const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
  if (fs.existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/Spotify-Wrapped/",
    });

    // SPA fallback: deep links like /Spotify-Wrapped/cloud must serve
    // index.html and let vue-router take over. API 404s stay JSON.
    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url ?? "";
      if (request.method === "GET" && url.startsWith("/Spotify-Wrapped")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ error: "Not found" });
    });

    app.get("/", async (_request, reply) => reply.redirect("/Spotify-Wrapped/"));
  } else {
    app.log.warn(`frontend dist not found at ${frontendDist} — dashboard not served`);
  }

  app.get("/health", async () => ({ status: "ok" }));

  // minimal endpoint the Vue app can call
  app.get("/api/plays/count", async () => {
    const count = await prisma.play.count();
    return { count };
  });

  app.get("/api/stats/artist", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const nameRaw = query.name;
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    if (!name) {
      return reply.status(400).send({ error: "Query param 'name' is required." });
    }

    const { filter, error, from, to } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });

    const conditions: Prisma.Sql[] = [
      Prisma.sql`LOWER("artistName") LIKE '%' || LOWER(${name}) || '%'`,
    ];
    if (from) conditions.push(Prisma.sql`"playedAt" >= ${from}`);
    if (to) conditions.push(Prisma.sql`"playedAt" <= ${to}`);
    const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

    const [aggRows, uniqueRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          playCount: number | bigint;
          totalMs: number | bigint | null;
        }>
      >`SELECT COUNT(*) AS playCount, SUM("durationMs") AS totalMs FROM "Play" ${whereSql}`,
      prisma.$queryRaw<
        Array<{
          uniqueTracks: number | bigint;
        }>
      >`SELECT COUNT(DISTINCT "spotifyUri") AS uniqueTracks FROM "Play" ${whereSql}`,
    ]);

    const agg = aggRows[0] ?? { playCount: 0, totalMs: 0 };
    const unique = uniqueRows[0] ?? { uniqueTracks: 0 };
    const playCount = Number(agg.playCount ?? 0);
    const uniqueTracks = Number(unique.uniqueTracks ?? 0);
    const totalMs = Number(agg.totalMs ?? 0);

    return {
      artist: name,
      playCount,
      uniqueTracks,
      totalMs,
    };
  });

  app.get("/api/stats/unique-tracks", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { filter, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });

    const unique = await prisma.play.findMany({
      where: filter,
      distinct: ["spotifyUri"],
      select: { spotifyUri: true },
    });

    return { count: unique.length };
  });

  app.get("/api/stats/listen-time", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { filter, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });

    const agg = await prisma.play.aggregate({
      where: filter,
      _sum: { durationMs: true },
    });

    return { totalMs: agg._sum.durationMs ?? 0 };
  });

  await applySqlitePragmas();

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);

  // poll once on startup
  pollAllUsersOnce().catch((err) => app.log.error(err));

  // poll on interval
  setInterval(() => {
    pollAllUsersOnce().catch((err) => app.log.error(err));
  }, POLL_SECONDS * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
