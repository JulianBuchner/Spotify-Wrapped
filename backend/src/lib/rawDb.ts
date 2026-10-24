import Database from "better-sqlite3";
import path from "path";

// Dedicated read-only better-sqlite3 connection for the few endpoints that
// scan the whole play log (history/points, record/highlights). Going through
// Prisma materializes every row as an object (seconds on the Pi); raw-array
// mode on a direct connection is an order of magnitude cheaper. WAL mode (set
// at startup) lets this reader coexist with the poller's writes.
let roDb: Database.Database | null = null;
export function readOnlyDb(): Database.Database {
  if (!roDb) {
    const url = process.env.DATABASE_URL ?? "";
    const file = path.resolve(url.replace(/^file:/, ""));
    roDb = new Database(file, { readonly: true, fileMustExist: true });
  }
  return roDb;
}
