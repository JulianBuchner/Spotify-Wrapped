import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { pollAllUsersOnce } from "./poller";
import { prisma } from "./db";

dotenv.config();

const PORT = Number(process.env.PORT ?? "3000");
const POLL_MIN = Number(process.env.POLL_INTERVAL_MINUTES ?? "30");
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

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
