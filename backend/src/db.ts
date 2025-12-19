import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const datasourceUrl = process.env.DATABASE_URL;
if (!datasourceUrl) {
  throw new Error("DATABASE_URL is missing");
}

const adapter = new PrismaBetterSqlite3({ url: datasourceUrl });
export const prisma = new PrismaClient({ adapter });
