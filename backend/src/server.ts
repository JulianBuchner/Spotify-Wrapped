import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Prisma } from "@prisma/client";
import { pollAllUsersOnce } from "./poller";
import { runEnrichment } from "./catalog";
import { prisma, applySqlitePragmas } from "./db";
import { buildPlayedAtFilter } from "./lib/dateFilter";
import searchRoutes from "./routes/search";
import overviewRoutes from "./routes/overview";
import statsRoutes from "./routes/stats";
import wrappedRoutes from "./routes/wrapped";
import recordRoutes from "./routes/record";
import historyRoutes from "./routes/history";
import detailRoutes from "./routes/detail";
import genresRoutes from "./routes/genres";

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
  // Aggregations over 200k rows take seconds on the Pi; the data changes
  // at most every few minutes (one poll), so 60s of staleness is free
  // speed. recently-played and plays/count stay uncached for freshness.
  // The story views (record/*, genres/*, wrapped/*) over the big presets are
  // the expensive ones (5–17 s cold on the Pi) and barely move with one more
  // play, so they stay fresh for 15 min and their all-time defaults are
  // prewarmed below; short windows keep the 60 s TTL.
  // NOTE: these hooks must be registered BEFORE @fastify/compress — onSend
  // hooks run in registration order, and the cache needs the uncompressed
  // JSON string (compression then still applies to cache hits and misses).
  // ---------------------------------------------------------------------
  const CACHE_TTL_MS = 60_000;
  const CACHE_LONG_TTL_MS = 15 * 60_000;
  const CACHE_MAX_ENTRIES = 200;
  // history/points manages its own cache (pre-gzipped payloads) in its route
  const CACHEABLE = /^\/api\/(stats\/|top\/|playlists|forgotten|wrapped\/|record\/|genres\/)/;
  const LONG_TTL_PATH = /^\/api\/(record\/|genres\/|wrapped\/)/;
  const LONG_TTL_RANGE = /(^|[?&])range=(all_time|ytd|last_year)(&|$)/;
  const ttlFor = (key: string) =>
    LONG_TTL_PATH.test(key) && LONG_TTL_RANGE.test(key) ? CACHE_LONG_TTL_MS : CACHE_TTL_MS;
  const responseCache = new Map<string, { body: string; at: number }>();

  /**
   * Cache key = path + query with the params sorted and empty ones dropped, so
   * the prewarm requests and the frontend's own parameter order share entries.
   */
  function cacheKey(url: string): string {
    const q = url.indexOf("?");
    if (q < 0) return url;
    const entries = [...new URLSearchParams(url.slice(q + 1)).entries()]
      .filter(([, v]) => v !== "")
      .sort(([a], [b]) => a.localeCompare(b));
    return entries.length ? `${url.slice(0, q)}?${new URLSearchParams(entries).toString()}` : url.slice(0, q);
  }

  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "GET") return;
    const key = cacheKey(request.raw.url ?? "");
    if (!CACHEABLE.test(key)) return;
    const hit = responseCache.get(key);
    if (hit && Date.now() - hit.at < ttlFor(key)) {
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
      const key = cacheKey(request.raw.url ?? "");
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
  await app.register(recordRoutes);
  await app.register(genresRoutes);
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

  // Genre catalog (Track/Artist tables): a full catch-up run 60 s after boot — cheap
  // when nothing is missing — then every 10 min only the ids the poller queued.
  // runEnrichment never throws.
  const ENRICH_BOOT_DELAY_MS = 60_000;
  const ENRICH_INTERVAL_MS = 10 * 60_000;
  setTimeout(() => void runEnrichment("full"), ENRICH_BOOT_DELAY_MS);
  setInterval(() => void runEnrichment("pending"), ENRICH_INTERVAL_MS);

  // Prewarm the default all-time views of Record, Eras and Genres — exactly the
  // requests those pages make on load — through the app itself, 20 s after boot
  // and then every 14 min (just under the long cache TTL), so the first visit
  // never waits 10–20 s on the Pi. Sequential with a short gap so the poller and
  // real requests keep getting the event loop; a failure only logs.
  const PREWARM_VIEW_URLS = [
    // Record
    "/api/stats/summary?range=all_time",
    "/api/record/highlights?range=all_time",
    "/api/record/week-hour-grid?range=all_time&metric=streams",
    "/api/record/streams-by-artist?range=all_time&granularity=month&top=10&metric=playtime",
    "/api/record/top-artist-per-year?range=all_time&metric=playtime",
    "/api/record/wear-out?range=all_time",
    // Eras
    "/api/genres/summary?range=all_time",
    "/api/genres/groups?range=all_time",
    "/api/genres/over-time?range=all_time&granularity=month&by=group&level=group&top=30&metric=playtime",
    "/api/genres/eras?range=all_time&metric=playtime&level=group",
    "/api/top/songs?range=all_time&limit=1&total=0&sort=streams",
    "/api/record/earworms?range=all_time&limit=6",
    "/api/record/explore-obsess?range=all_time&metric=playtime",
    "/api/top/artists?range=all_time&limit=8&total=0&sort=playtime",
    "/api/record/skip-rate-by-year?range=all_time",
    // Genres
    "/api/genres/over-time?range=all_time&granularity=month&by=genre&top=30&metric=streams",
  ];
  const PREWARM_BOOT_DELAY_MS = 20_000;
  const PREWARM_INTERVAL_MS = 14 * 60_000;
  let prewarming = false;
  async function prewarmViews() {
    if (prewarming) return;
    prewarming = true;
    const started = Date.now();
    try {
      for (const url of PREWARM_VIEW_URLS) {
        try {
          const res = await app.inject({ method: "GET", url });
          if (res.statusCode !== 200) app.log.warn({ url, status: res.statusCode }, "view prewarm: non-200");
        } catch (err) {
          app.log.warn({ err, url }, "view prewarm failed");
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      app.log.info({ ms: Date.now() - started, urls: PREWARM_VIEW_URLS.length }, "view prewarm done");
    } finally {
      prewarming = false;
    }
  }
  setTimeout(() => void prewarmViews(), PREWARM_BOOT_DELAY_MS);
  setInterval(() => void prewarmViews(), PREWARM_INTERVAL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
