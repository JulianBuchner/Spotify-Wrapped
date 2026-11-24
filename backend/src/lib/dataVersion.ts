import { prisma } from "../db";

// ---------------------------------------------------------------------------
// Data version for the response caches (server.ts responseCache, history.ts
// pointsCache): lets an all-time entry stay valid for hours while nothing is
// written, so the prewarm only rebuilds after the data really changed.
//
// One monotonic counter, bumped by
//   - every in-process write that changes what the views show: the poller
//     (play insert, listened-time update) and the catalog enrichment (Track/
//     Artist rows, genre groups). Bumped AFTER the write committed, so a request
//     that snapshots the new version also reads the new data;
//   - probeExternalWrites(): SQLite's `PRAGMA data_version` on Prisma's single
//     connection changes only when ANOTHER connection commits, i.e. a CLI script
//     in another process (enrich:catalog, backfills, import, connect). This
//     process's own writes (incl. the hourly token refresh) and all reads (the
//     read-only rawDb connection, the nightly `.backup`) leave it unchanged.
//     Sampled every 30 s and before each prewarm run.
// A forgotten write path or a time-dependent result is still bounded by
// CACHE_MAX_AGE_MS.
// ---------------------------------------------------------------------------

/** Safety cap for an entry kept alive by an unchanged data version. */
export const CACHE_MAX_AGE_MS = 6 * 60 * 60_000;
/** Prewarm runs refresh an entry this long before it would reach the cap. */
const PREWARM_SLACK_MS = 60_000;
/** How long we remember when a version was superseded (must exceed every TTL). */
const KEEP_CHANGES_MS = 60 * 60_000;

/** Cache keys whose result does not depend on the clock, only on the data. */
export const ALL_TIME_RANGE = /(^|[?&])range=all_time(&|$)/;

let version = 0;
/** version -> when it was superseded, i.e. when the data first changed after it (last hour only) */
const supersededAt = new Map<number, number>();
let lastExternal: string | null = null;
let probeWarned = false;

export function dataVersion(): number {
  return version;
}

/** Call after a committed write that changes what the cached views show. */
export function bumpDataVersion(): void {
  const now = Date.now();
  supersededAt.set(version, now);
  version++;
  for (const [v, at] of supersededAt) {
    if (now - at <= KEEP_CHANGES_MS) break; // insertion order = chronological
    supersededAt.delete(v);
  }
}

/** When the data first changed after `v`: null = unchanged, 0 = over an hour ago. */
function changedAfter(v: number): number | null {
  if (v === version) return null;
  return supersededAt.get(v) ?? 0;
}

/** Bumps the version when another process committed to the DB since the last probe. */
export async function probeExternalWrites(): Promise<void> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA data_version");
    const value = rows[0] ? Object.values(rows[0])[0] : undefined;
    if (value === undefined || value === null) throw new Error("PRAGMA data_version returned no value");
    const v = String(value);
    if (lastExternal !== null && v !== lastExternal) bumpDataVersion();
    lastExternal = v;
  } catch (err) {
    if (!probeWarned) console.warn("[cache] data_version probe failed (external writes go unnoticed until the TTL/cap)", err);
    probeWarned = true;
  }
}

export interface CacheStamp {
  /** when the entry was stored */
  at: number;
  /** dataVersion() at the start of the request that built it */
  version: number;
}

/**
 * Whether a cache entry may still be served: younger than its TTL, or — when
 * `versioned` (all-time keys) — younger than CACHE_MAX_AGE_MS and the data has
 * not changed since the build, or changed less than one TTL ago. That keeps the
 * staleness bound of the plain TTL (new data shows up at most one TTL after it
 * was written) without a cold gap between a change and the next prewarm run.
 */
export function cacheEntryValid(entry: CacheStamp, ttlMs: number, versioned: boolean, now = Date.now()): boolean {
  const age = now - entry.at;
  if (age < ttlMs) return true;
  if (!versioned || age >= CACHE_MAX_AGE_MS) return false;
  const changed = changedAfter(entry.version);
  return changed === null || now - changed < ttlMs;
}

/**
 * Why a prewarm run (every `intervalMs`) must rebuild an entry, or null to keep
 * it: missing, the data changed since it was built, or it would reach the cap
 * before the next run.
 */
export function prewarmReason(
  entry: CacheStamp | undefined,
  intervalMs: number,
  now = Date.now()
): "cold" | "data changed" | "max age" | null {
  if (!entry) return "cold";
  if (changedAfter(entry.version) !== null) return "data changed";
  if (now - entry.at + intervalMs + PREWARM_SLACK_MS >= CACHE_MAX_AGE_MS) return "max age";
  return null;
}
