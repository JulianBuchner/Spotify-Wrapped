import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { Prisma } from "@prisma/client";
import { pollAllUsersOnce } from "./poller";
import { prisma } from "./db";

dotenv.config();

const PORT = Number(process.env.PORT ?? "3000");
const POLL_MIN = Number(process.env.POLL_INTERVAL_MINUTES ?? "30");
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

function buildPlayedAtFilter(query: Record<string, unknown>) {
  const fromRaw = query.from;
  const toRaw = query.to;
  let from: Date | undefined;
  let to: Date | undefined;
  const errors: string[] = [];

  if (typeof fromRaw === "string" && fromRaw.trim() !== "") {
    const parsed = new Date(fromRaw);
    if (Number.isNaN(parsed.getTime())) errors.push("from");
    else from = parsed;
  } else if (fromRaw !== undefined) {
    errors.push("from");
  }

  if (typeof toRaw === "string" && toRaw.trim() !== "") {
    const parsed = new Date(toRaw);
    if (Number.isNaN(parsed.getTime())) errors.push("to");
    else to = parsed;
  } else if (toRaw !== undefined) {
    errors.push("to");
  }

  if (errors.length) {
    return { error: `Invalid date for: ${errors.join(", ")}` };
  }

  if (!from && !to) return { filter: {}, from, to };

  return {
    filter: {
      playedAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    },
    from,
    to,
  };
}

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
  });

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

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);

  // poll once on startup
  pollAllUsersOnce().catch((err) => app.log.error(err));

  // poll on interval
  setInterval(() => {
    pollAllUsersOnce().catch((err) => app.log.error(err));
  }, POLL_MIN * 60 * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
