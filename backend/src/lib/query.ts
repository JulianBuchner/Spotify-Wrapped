import { Prisma } from "@prisma/client";

export function parseLimit(
  query: Record<string, unknown>,
  def = 50,
  max = 200
): number {
  const n = Number(query.limit);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

export function parseOffset(query: Record<string, unknown>): number {
  const n = Number(query.offset);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function parseSort(query: Record<string, unknown>): "streams" | "playtime" {
  return query.sort === "playtime" ? "playtime" : "streams";
}

export function parseOrder(query: Record<string, unknown>): "ASC" | "DESC" {
  return query.order === "asc" ? "ASC" : "DESC";
}

/** Case-insensitive LIKE %q% on a known column (mirrors /api/stats/artist). */
export function likeCondition(column: string, q: string): Prisma.Sql {
  return Prisma.sql`LOWER(${Prisma.raw(`"${column}"`)}) LIKE '%' || LOWER(${q}) || '%'`;
}

/**
 * Optional ?playlist=<contextUri> filter (e.g. "spotify:playlist:3cEY...").
 * Filters by contextUri rather than name: URIs are stable across renames and
 * unique, while names can collide. Returns null when the param is absent.
 */
export function playlistCondition(query: Record<string, unknown>): Prisma.Sql | null {
  const playlist = typeof query.playlist === "string" ? query.playlist.trim() : "";
  if (!playlist) return null;
  return Prisma.sql`("contextType" = 'playlist' AND "contextUri" = ${playlist})`;
}

/** SQLite COUNT/SUM come back as number | bigint; normalize to number. */
export const num = (v: number | bigint | null | undefined): number => Number(v ?? 0);
