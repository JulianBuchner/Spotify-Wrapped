import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  ensureAccessToken,
  fetchArtists,
  fetchTracks,
  spotifyStats,
  type SpotifyTrackMeta,
} from "./spotify";
import { ARTIST_OVERRIDES, BROAD_GROUPS, GENRE_GROUPS, groupForArtist } from "./data/genreGroups";
import { num } from "./lib/query";
import { whereClause } from "./lib/dateFilter";

// ---------------------------------------------------------------------------
// Catalog enrichment: fills the Track and Artist tables from Spotify for every
// play, then assigns each artist a readable genre group via genreGroups.ts.
// Idempotent and resumable — every step only touches rows that are missing,
// so a crash mid-run just leaves fewer rows for the next run.
//   Play.spotifyId -> Track.spotifyId -> Artist(Track.primaryArtistId)
// ---------------------------------------------------------------------------

/** Track ids the poller saw without a Track row; drained by the server's 10-min timer. */
export const pendingTrackIds = new Set<string>();

const BATCH = 50;
const PACE_MS = 150;
const REFRESH_AFTER_DAYS = 90;
/** Secondary artists (artistIds[1..]) are fetched only when few are missing — not used for grouping. */
const MAX_EXTRA_ARTISTS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EnrichOptions {
  accessToken: string;
  log?: (msg: string) => void;
  /** Only these track ids (server timer path); default = every Play.spotifyId without a Track row. */
  trackIds?: string[];
  /** Re-run the group rules for every artist, not only those still unmapped. */
  reassign?: boolean;
  /** Refetch artists whose row is older than 90 days (genres/popularity drift). */
  refresh?: boolean;
}

export interface EnrichResult {
  tracksFetched: number;
  tracksUnresolved: number;
  artistsFetched: number;
  artistsUnresolved: number;
  artistsRefreshed: number;
  groupsAssigned: number;
  rateLimited: number;
  elapsedMs: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Ids of plays without a Track row — all of them, or only the given ones. */
async function missingTrackIds(only?: string[]): Promise<string[]> {
  if (only) {
    const ids = [...new Set(only)].filter((id) => id.length > 0);
    if (ids.length === 0) return [];
    const have = await prisma.track.findMany({
      where: { spotifyId: { in: ids } },
      select: { spotifyId: true },
    });
    const haveSet = new Set(have.map((t) => t.spotifyId));
    return ids.filter((id) => !haveSet.has(id));
  }
  const rows = await prisma.$queryRaw<Array<{ spotifyId: string }>>`
    SELECT DISTINCT "spotifyId" FROM "Play"
    WHERE "spotifyId" IS NOT NULL AND "spotifyId" != ''
      AND "spotifyId" NOT IN (SELECT "spotifyId" FROM "Track")`;
  return rows.map((r) => r.spotifyId);
}

async function upsertTracks(tracks: SpotifyTrackMeta[]) {
  if (tracks.length === 0) return;
  await prisma.$transaction(
    tracks.map((t) => {
      const data = {
        name: t.name,
        primaryArtistId: t.artists[0]?.id ?? null,
        artistIds: JSON.stringify(t.artists.map((a) => a.id)),
        albumName: t.albumName,
        releaseDate: t.releaseDate,
        durationMs: t.durationMs,
        imageUrl: t.imageUrl,
        fetchedAt: new Date(),
      };
      return prisma.track.upsert({
        where: { spotifyId: t.id },
        create: { spotifyId: t.id, ...data },
        update: data,
      });
    })
  );
}

/**
 * Ids Spotify answered null for (removed/relinked tracks): store a Track row named after
 * the play with no artist ids, so they are not refetched every run. `artistIds = '[]'`
 * + `primaryArtistId IS NULL` is what marks an unresolved track.
 */
async function insertUnresolvedTracks(ids: string[]) {
  if (ids.length === 0) return;
  const names = await prisma.$queryRaw<Array<{ spotifyId: string; trackName: string }>>`
    SELECT "spotifyId", MAX("trackName") AS trackName FROM "Play"
    WHERE "spotifyId" IN (${Prisma.join(ids)}) GROUP BY "spotifyId"`;
  const nameById = new Map(names.map((r) => [r.spotifyId, r.trackName]));
  await prisma.$transaction(
    ids.map((id) =>
      prisma.track.upsert({
        where: { spotifyId: id },
        create: { spotifyId: id, name: nameById.get(id) ?? "", artistIds: "[]" },
        update: {},
      })
    )
  );
}

async function upsertArtists(
  artists: Awaited<ReturnType<typeof fetchArtists>>,
  opts: { keepGroup: boolean }
) {
  if (artists.length === 0) return;
  await prisma.$transaction(
    artists.map((a) => {
      const data = {
        name: a.name,
        genres: JSON.stringify(a.genres),
        imageUrl: a.imageUrl,
        popularity: a.popularity,
        fetchedAt: new Date(),
      };
      return prisma.artist.upsert({
        where: { spotifyId: a.id },
        create: { spotifyId: a.id, ...data, group: groupForArtist(a.name, a.genres) },
        // A refresh keeps the stored group; assignGroups() below fills still-null ones.
        update: opts.keepGroup ? data : { ...data, group: groupForArtist(a.name, a.genres) },
      });
    })
  );
}

/**
 * Artist ids Spotify answered null for: a placeholder row (empty genres) named after the
 * first play of one of its tracks, so the id is not refetched every run.
 */
async function insertUnresolvedArtists(ids: string[]) {
  if (ids.length === 0) return;
  const names = await prisma.$queryRaw<Array<{ id: string; artistName: string }>>`
    SELECT t."primaryArtistId" AS id, MAX(p."artistName") AS artistName
    FROM "Track" t JOIN "Play" p ON p."spotifyId" = t."spotifyId"
    WHERE t."primaryArtistId" IN (${Prisma.join(ids)}) GROUP BY t."primaryArtistId"`;
  const nameById = new Map(names.map((r) => [r.id, r.artistName.split(", ")[0] ?? ""]));
  await prisma.$transaction(
    ids.map((id) =>
      prisma.artist.upsert({
        where: { spotifyId: id },
        create: { spotifyId: id, name: nameById.get(id) ?? "", genres: "[]" },
        update: {},
      })
    )
  );
}

/**
 * Writes Artist.group from the rule table for every artist whose group is null
 * (or for all when `all`). Returns how many rows got a non-null group.
 */
export async function assignGroups(all = false): Promise<{ assigned: number; updated: number }> {
  const artists = all
    ? await prisma.artist.findMany({ select: { spotifyId: true, name: true, genres: true, group: true } })
    : await prisma.artist.findMany({
        where: { group: null },
        select: { spotifyId: true, name: true, genres: true, group: true },
      });
  const updates: Array<{ id: string; group: string | null }> = [];
  let assigned = 0;
  for (const a of artists) {
    let genres: string[] = [];
    try {
      genres = JSON.parse(a.genres);
    } catch {
      genres = [];
    }
    const group = groupForArtist(a.name, genres);
    if (group) assigned++;
    if (group !== a.group) updates.push({ id: a.spotifyId, group });
  }
  for (const part of chunk(updates, 500)) {
    await prisma.$transaction(
      part.map((u) => prisma.artist.update({ where: { spotifyId: u.id }, data: { group: u.group } }))
    );
  }
  return { assigned, updated: updates.length };
}

export async function enrichCatalog(opts: EnrichOptions): Promise<EnrichResult> {
  const log = opts.log ?? ((m: string) => console.log(`[catalog] ${m}`));
  const started = Date.now();
  const rateLimitedBefore = spotifyStats.rateLimited;
  const result: EnrichResult = {
    tracksFetched: 0,
    tracksUnresolved: 0,
    artistsFetched: 0,
    artistsUnresolved: 0,
    artistsRefreshed: 0,
    groupsAssigned: 0,
    rateLimited: 0,
    elapsedMs: 0,
  };

  // 1. Tracks ---------------------------------------------------------------
  const trackIds = await missingTrackIds(opts.trackIds);
  const trackBatches = chunk(trackIds, BATCH);
  if (trackIds.length) log(`tracks: ${trackIds.length} missing in ${trackBatches.length} batches`);
  for (let i = 0; i < trackBatches.length; i++) {
    const ids = trackBatches[i]!;
    const found = await fetchTracks(opts.accessToken, ids);
    const foundIds = new Set(found.map((t) => t.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    await upsertTracks(found);
    await insertUnresolvedTracks(missing);
    result.tracksFetched += found.length;
    result.tracksUnresolved += missing.length;
    log(
      `tracks batch ${i + 1}/${trackBatches.length}: ${found.length} fetched` +
        (missing.length ? `, ${missing.length} unknown to Spotify (stored as unresolved)` : "")
    );
    if (i < trackBatches.length - 1) await sleep(PACE_MS);
  }

  // 2. Artists --------------------------------------------------------------
  const primaryRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT "primaryArtistId" AS id FROM "Track"
    WHERE "primaryArtistId" IS NOT NULL
      AND "primaryArtistId" NOT IN (SELECT "spotifyId" FROM "Artist")`;
  const primaryIds = primaryRows.map((r) => r.id);

  const extraRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT j.value AS id FROM "Track" t, json_each(t."artistIds") j
    WHERE j.value NOT IN (SELECT "spotifyId" FROM "Artist")
      AND (t."primaryArtistId" IS NULL OR j.value != t."primaryArtistId")`;
  const primarySet = new Set(primaryIds);
  const extraIds = extraRows.map((r) => r.id).filter((id) => !primarySet.has(id));
  let fetchExtra = extraIds;
  if (extraIds.length > MAX_EXTRA_ARTISTS) {
    log(`artists: skipping ${extraIds.length} secondary artists (> ${MAX_EXTRA_ARTISTS}, not needed for grouping)`);
    fetchExtra = [];
  }

  let refreshIds: string[] = [];
  if (opts.refresh) {
    const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000);
    const stale = await prisma.artist.findMany({
      where: { fetchedAt: { lt: cutoff } },
      select: { spotifyId: true },
    });
    refreshIds = stale.map((a) => a.spotifyId);
    if (refreshIds.length) log(`artists: ${refreshIds.length} older than ${REFRESH_AFTER_DAYS} days to refresh`);
  }

  const fetchPlan: Array<{ ids: string[]; kind: "primary" | "extra" | "refresh" }> = [
    ...chunk(primaryIds, BATCH).map((ids) => ({ ids, kind: "primary" as const })),
    ...chunk(fetchExtra, BATCH).map((ids) => ({ ids, kind: "extra" as const })),
    ...chunk(refreshIds, BATCH).map((ids) => ({ ids, kind: "refresh" as const })),
  ];
  if (primaryIds.length || fetchExtra.length) {
    log(`artists: ${primaryIds.length} primary + ${fetchExtra.length} secondary missing in ${fetchPlan.length} batches`);
  }
  for (let i = 0; i < fetchPlan.length; i++) {
    const { ids, kind } = fetchPlan[i]!;
    const found = await fetchArtists(opts.accessToken, ids);
    const foundIds = new Set(found.map((a) => a.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    await upsertArtists(found, { keepGroup: kind === "refresh" });
    if (kind !== "refresh") await insertUnresolvedArtists(missing);
    if (kind === "refresh") result.artistsRefreshed += found.length;
    else {
      result.artistsFetched += found.length;
      result.artistsUnresolved += missing.length;
    }
    log(
      `artists batch ${i + 1}/${fetchPlan.length} (${kind}): ${found.length} fetched` +
        (missing.length ? `, ${missing.length} unknown to Spotify` : "")
    );
    if (i < fetchPlan.length - 1) await sleep(PACE_MS);
  }

  // 3. Groups ---------------------------------------------------------------
  const groups = await assignGroups(Boolean(opts.reassign));
  result.groupsAssigned = groups.assigned;
  log(`groups: ${groups.assigned} artists mapped${opts.reassign ? " (reassigned all)" : ""}, ${groups.updated} rows changed`);

  result.rateLimited = spotifyStats.rateLimited - rateLimitedBefore;
  result.elapsedMs = Date.now() - started;
  return result;
}

// ---------------------------------------------------------------------------
// Coverage report — printed by the script and returned by /api/genres/summary.
// `conditions` scope the play log (window + playlist); the artist/track counts
// are always global.
// ---------------------------------------------------------------------------

export interface CoverageReport {
  artistsTotal: number;
  artistsWithGenres: number;
  artistsWithGroup: number;
  tracksTotal: number;
  tracksUnresolved: number;
  coverage: { ms: number; mappedMs: number; share: number; plays: number; playsWithoutTrack: number };
  lastFetchedAt: string | null;
  unmappedGenres: Array<{ genre: string; ms: number }>;
  unmappedArtists: Array<{ artistName: string; ms: number; streams: number; genres: string[] }>;
}

export async function coverageReport(conditions: Prisma.Sql[] = []): Promise<CoverageReport> {
  const where = whereClause(conditions);
  const whereUnmapped = whereClause([...conditions, Prisma.sql`a."group" IS NULL`]);
  const [counts, cov, last, genres, artists] = await Promise.all([
    prisma.$queryRaw<Array<any>>`
      SELECT (SELECT COUNT(*) FROM "Artist") AS artistsTotal,
             (SELECT COUNT(*) FROM "Artist" WHERE json_array_length("genres") > 0) AS artistsWithGenres,
             (SELECT COUNT(*) FROM "Artist" WHERE "group" IS NOT NULL) AS artistsWithGroup,
             (SELECT COUNT(*) FROM "Track") AS tracksTotal,
             (SELECT COUNT(*) FROM "Track" WHERE "primaryArtistId" IS NULL) AS tracksUnresolved`,
    prisma.$queryRaw<Array<any>>`
      SELECT COUNT(*) AS plays,
             SUM(p."durationMs") AS ms,
             SUM(CASE WHEN a."group" IS NOT NULL THEN p."durationMs" ELSE 0 END) AS mappedMs,
             SUM(CASE WHEN t."spotifyId" IS NULL THEN 1 ELSE 0 END) AS playsWithoutTrack
      FROM "Play" p
      LEFT JOIN "Track" t ON t."spotifyId" = p."spotifyId"
      LEFT JOIN "Artist" a ON a."spotifyId" = t."primaryArtistId"
      ${where}`,
    prisma.$queryRaw<Array<any>>`
      SELECT MAX(f) AS last FROM (
        SELECT MAX("fetchedAt") AS f FROM "Track" UNION ALL SELECT MAX("fetchedAt") FROM "Artist")`,
    prisma.$queryRaw<Array<any>>`
      SELECT g.value AS genre, SUM(p."durationMs") AS ms
      FROM "Play" p
      JOIN "Track" t ON t."spotifyId" = p."spotifyId"
      JOIN "Artist" a ON a."spotifyId" = t."primaryArtistId", json_each(a."genres") g
      ${whereUnmapped}
      GROUP BY g.value ORDER BY ms DESC LIMIT 20`,
    prisma.$queryRaw<Array<any>>`
      SELECT COALESCE(a."name", p."artistName") AS artistName,
             SUM(p."durationMs") AS ms, COUNT(*) AS streams,
             COALESCE(a."genres", '[]') AS genres
      FROM "Play" p
      LEFT JOIN "Track" t ON t."spotifyId" = p."spotifyId"
      LEFT JOIN "Artist" a ON a."spotifyId" = t."primaryArtistId"
      ${whereUnmapped}
      GROUP BY COALESCE(a."spotifyId", p."artistName") ORDER BY ms DESC LIMIT 20`,
  ]);
  const c = counts[0] ?? {};
  const v = cov[0] ?? {};
  const ms = num(v.ms);
  const mappedMs = num(v.mappedMs);
  const lastRaw = last[0]?.last;
  const lastDate = lastRaw ? new Date(typeof lastRaw === "number" ? lastRaw : String(lastRaw)) : null;
  return {
    artistsTotal: num(c.artistsTotal),
    artistsWithGenres: num(c.artistsWithGenres),
    artistsWithGroup: num(c.artistsWithGroup),
    tracksTotal: num(c.tracksTotal),
    tracksUnresolved: num(c.tracksUnresolved),
    coverage: {
      ms,
      mappedMs,
      share: ms ? Math.round((mappedMs / ms) * 10000) / 10000 : 0,
      plays: num(v.plays),
      playsWithoutTrack: num(v.playsWithoutTrack),
    },
    lastFetchedAt: lastDate && !Number.isNaN(lastDate.getTime()) ? lastDate.toISOString() : null,
    unmappedGenres: genres.map((r) => ({ genre: String(r.genre), ms: num(r.ms) })),
    unmappedArtists: artists.map((r) => ({
      artistName: String(r.artistName),
      ms: num(r.ms),
      streams: num(r.streams),
      genres: safeJsonArray(r.genres),
    })),
  };
}

export function safeJsonArray(v: unknown): string[] {
  if (typeof v !== "string") return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The rule table as data (for /api/genres/groups). */
export function ruleTable() {
  return {
    groups: GENRE_GROUPS.map((g) => ({ key: g.key, label: g.label, parent: g.parent, match: g.match.source })),
    broad: BROAD_GROUPS.map((b) => ({ key: b.key, label: b.label })),
    overrides: Object.keys(ARTIST_OVERRIDES).length,
  };
}

// ---------------------------------------------------------------------------
// Cross-process lock: the server's boot-time run and a manual `npm run
// enrich:catalog` must not fetch the same ids side by side (double Spotify
// calls, 429s). A lock file next to the DB; stale after an hour.
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 60 * 60_000;

export function enrichLockPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return path.resolve(url.replace(/^file:/, "")) + ".enrich.lock";
}

/** Returns a release function, or null when another enrichment holds the lock. */
export function acquireEnrichLock(): (() => void) | null {
  const p = enrichLockPath();
  try {
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return null;
    fs.unlinkSync(p); // stale: a crashed run
  } catch {
    // no lock file
  }
  try {
    fs.writeFileSync(p, `${process.pid} ${new Date().toISOString()}`, { flag: "wx" });
  } catch {
    return null;
  }
  return () => {
    try {
      fs.unlinkSync(p);
    } catch {
      // already gone
    }
  };
}

// ---------------------------------------------------------------------------
// Server-side runner: used by the boot timer (full run) and the 10-min timer
// (pending ids only). Never throws; overlapping runs are skipped.
// ---------------------------------------------------------------------------

let running = false;

export async function runEnrichment(mode: "full" | "pending", log = (m: string) => console.log(`[catalog] ${m}`)) {
  if (running) {
    log("enrichment already running, skipping");
    return;
  }
  const ids = mode === "pending" ? [...pendingTrackIds] : undefined;
  if (mode === "pending") {
    if (!ids || ids.length === 0) return;
    pendingTrackIds.clear();
  }
  const release = acquireEnrichLock();
  if (!release) {
    if (ids) for (const id of ids) pendingTrackIds.add(id);
    log(`another enrichment holds ${enrichLockPath()}, skipping`);
    return;
  }
  running = true;
  try {
    const account = await prisma.spotifyAccount.findFirst();
    if (!account) {
      log("no Spotify account connected, skipping enrichment");
      return;
    }
    const accessToken = await ensureAccessToken(account);
    const r = await enrichCatalog({ accessToken, log, trackIds: ids });
    log(
      `${mode} run done: ${r.tracksFetched} tracks (${r.tracksUnresolved} unresolved), ` +
        `${r.artistsFetched} artists (${r.artistsUnresolved} unresolved), ${r.groupsAssigned} grouped, ` +
        `${r.rateLimited} x 429, ${(r.elapsedMs / 1000).toFixed(1)} s`
    );
  } catch (err) {
    // Retry the same ids next time; a full run picks everything up by itself.
    if (ids) for (const id of ids) pendingTrackIds.add(id);
    console.error(`[catalog] ${mode} enrichment failed`, err);
  } finally {
    running = false;
    release();
  }
}
