import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const datasourceUrl = process.env.DATABASE_URL;
if (!datasourceUrl) {
  throw new Error("DATABASE_URL is missing");
}

const adapter = new PrismaBetterSqlite3({ url: datasourceUrl });
export const prisma = new PrismaClient({ adapter });

/**
 * Read-heavy tuning for the single-connection SQLite setup. WAL lets the
 * poller write while dashboard queries read; the cache/mmap settings matter
 * on the Pi, where 190k-row scans otherwise hit the SD card.
 */
export async function applySqlitePragmas() {
  const pragmas = [
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA cache_size=-64000", // 64 MB page cache
    "PRAGMA temp_store=MEMORY",
    "PRAGMA mmap_size=268435456", // 256 MB
  ];
  for (const p of pragmas) {
    try {
      await prisma.$queryRawUnsafe(p);
    } catch (err) {
      console.warn(`[db] pragma failed: ${p}`, err);
    }
  }
}
