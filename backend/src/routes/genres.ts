import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { buildPlayedAtFilter, playedAtConditions, whereClause } from "../lib/dateFilter";
import { num, playlistCondition } from "../lib/query";
import { denseBuckets } from "../lib/buckets";
import { coverageReport, ruleTable, safeJsonArray } from "../catalog";
import { ARTIST_OVERRIDES, BROAD_GROUPS, GENRE_GROUPS, broadFor } from "../data/genreGroups";

// ---------------------------------------------------------------------------
// /api/genres/* — aggregations over the genre catalog for the "Eras"
// streamgraph (share of listening per group over time) and the "Genres" strip
// (top raw Spotify genres over time). Same window + ?playlist= filter and the
// same raw-SQL style as record.ts. Every query joins
//   Play p -> Track t (p.spotifyId) -> Artist a (t.primaryArtistId)
// so the play's genre is its PRIMARY artist's. Plays without a Track/Artist
// row (not enriched yet, or unknown to Spotify) count as unmapped.
// Column names that exist on both Play and Track (durationMs) are qualified.
// ---------------------------------------------------------------------------

const GRANULARITY_FORMAT: Record<string, string> = {
  day: "%Y-%m-%d",
  week: "%Y-%W",
  month: "%Y-%m",
  year: "%Y",
};

/** Years with less than this share of the busiest year's total are "partial" and form no era. */
const FULL_YEAR_SHARE = 0.1;

function pickGranularity(query: Record<string, unknown>, def = "month"): string {
  const g = typeof query.granularity === "string" ? query.granularity : def;
  return GRANULARITY_FORMAT[g] ? g : def;
}

/** COUNT(*) for streams (default), SUM(p.durationMs) for playtime — qualified, Track has a durationMs too. */
function metricExpr(query: Record<string, unknown>): Prisma.Sql {
  return query.metric === "playtime" ? Prisma.sql`SUM(p."durationMs")` : Prisma.sql`COUNT(*)`;
}

function parseInt_(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Date window + optional ?playlist= as conditions on the Play columns (unqualified: unique to Play). */
function scopedConditions(query: Record<string, unknown>, from?: Date, to?: Date): Prisma.Sql[] {
  const conditions = playedAtConditions(from, to);
  const pl = playlistCondition(query);
  if (pl) conditions.push(pl);
  return conditions;
}

const JOIN_CATALOG = Prisma.sql`
  LEFT JOIN "Track" t ON t."spotifyId" = p."spotifyId"
  LEFT JOIN "Artist" a ON a."spotifyId" = t."primaryArtistId"`;

const labelByKey = new Map(GENRE_GROUPS.map((g) => [g.key, g.label]));
const broadLabelByKey = new Map(BROAD_GROUPS.map((g) => [g.key, g.label]));

/**
 * Two levels of grouping: "group" = the detailed rule table (Artist.group),
 * "broad" = each group's parent. A stored group key is mapped at query time, so
 * switching levels needs no reassignment.
 */
type Level = "group" | "broad";
const levelOf = (query: Record<string, unknown>): Level => (query.level === "broad" ? "broad" : "group");
const keyAt = (level: Level, groupKey: string) => (level === "broad" ? broadFor(groupKey) : groupKey);
const labelAt = (level: Level, key: string) =>
  (level === "broad" ? broadLabelByKey.get(key) : labelByKey.get(key)) ?? key;
/** Detailed group keys under a broad key. */
const childrenOf = (broadKey: string) => GENRE_GROUPS.filter((g) => g.parent === broadKey).map((g) => g.key);

/** Dense [row][bucket] matrix from (bucket, key, value) rows. */
function pivot(
  rows: Array<{ bucket: string; key: string; value: number }>,
  buckets: string[],
  keys: string[]
): number[][] {
  const bi = new Map(buckets.map((b, i) => [b, i]));
  const ki = new Map(keys.map((k, i) => [k, i]));
  const values = keys.map(() => new Array<number>(buckets.length).fill(0));
  for (const r of rows) {
    const b = bi.get(r.bucket);
    const k = ki.get(r.key);
    if (b !== undefined && k !== undefined) values[k]![b] += r.value;
  }
  return values;
}

const genresRoutes: FastifyPluginAsync = async (app) => {
  // Catalog health + coverage for the window: how much listened time has a group,
  // and what is still unmapped (top genres/artists) so the rule table can be tuned.
  app.get("/api/genres/summary", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    return { data: await coverageReport(scopedConditions(query, from, to)) };
  });

  // Time series per group (by=group, one group per play — its primary artist's) or
  // per raw Spotify genre (by=genre, a play counts once for EVERY genre of its primary
  // artist, so the sums exceed the number of plays). `values[row][bucket]`, dense,
  // buckets ascending (UTC, same strftime formats as stats/record). `unmapped` per
  // bucket = plays whose artist has no group (by=group) / no genres (by=genre), in
  // the metric's unit.
  app.get("/api/genres/over-time", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const conditions = scopedConditions(query, from, to);
    const where = whereClause(conditions);
    const fmt = GRANULARITY_FORMAT[pickGranularity(query)];
    const metric = metricExpr(query);
    const by = query.by === "genre" ? "genre" : "group";
    const level = levelOf(query);
    const top = parseInt_(query.top, 30, 1, 100);

    // Dense buckets (empty ones included) so the time axis keeps its gaps.
    const buckets = await denseBuckets(fmt, where);

    if (by === "group") {
      const rows = await prisma.$queryRaw<Array<any>>`
        SELECT strftime(${fmt}, p."playedAt") AS bucket, a."group" AS key, ${metric} AS value
        FROM "Play" p ${JOIN_CATALOG} ${where}
        GROUP BY 1, 2`;
      const totals = new Map<string, number>();
      const flat: Array<{ bucket: string; key: string; value: number }> = [];
      const unmappedFlat: Array<{ bucket: string; value: number }> = [];
      for (const r of rows) {
        const v = num(r.value);
        if (r.key === null || r.key === undefined) {
          unmappedFlat.push({ bucket: String(r.bucket), value: v });
          continue;
        }
        const key = keyAt(level, String(r.key));
        totals.set(key, (totals.get(key) ?? 0) + v);
        flat.push({ bucket: String(r.bucket), key, value: v });
      }
      const keys = [...totals.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([k]) => k);
      return {
        data: {
          buckets,
          rows: keys.map((k) => ({ key: k, label: labelAt(level, k), total: totals.get(k) ?? 0 })),
          values: pivot(flat, buckets, keys),
          unmapped: pivot(unmappedFlat.map((r) => ({ ...r, key: "" })), buckets, [""])[0] ?? [],
        },
      };
    }

    // by=genre. Plays are first aggregated per (bucket, primary artist) — a few thousand
    // rows — and only those are exploded with json_each, instead of one json_each call per
    // play. Top N genres by total first, so the bucketed query stays at N × buckets rows.
    const playsByArtist = (bucketed: boolean) => Prisma.sql`
      SELECT ${bucketed ? Prisma.sql`strftime(${fmt}, p."playedAt") AS bucket,` : Prisma.empty}
             t."primaryArtistId" AS aid, ${metric} AS value
      FROM "Play" p JOIN "Track" t ON t."spotifyId" = p."spotifyId"
      ${whereClause([...conditions, Prisma.sql`t."primaryArtistId" IS NOT NULL`])}
      GROUP BY ${bucketed ? Prisma.sql`bucket,` : Prisma.empty} aid`;

    const topRows = await prisma.$queryRaw<Array<any>>`
      WITH pa AS (${playsByArtist(false)})
      SELECT g.value AS genre, SUM(pa.value) AS value
      FROM pa JOIN "Artist" a ON a."spotifyId" = pa.aid, json_each(a."genres") g
      GROUP BY g.value ORDER BY value DESC, genre ASC LIMIT ${top}`;
    const keys = topRows.map((r) => String(r.genre));
    const totals = new Map(topRows.map((r) => [String(r.genre), num(r.value)]));

    const [rows, unmappedRows] = await Promise.all([
      keys.length
        ? prisma.$queryRaw<Array<any>>`
            WITH pa AS (${playsByArtist(true)})
            SELECT pa.bucket AS bucket, g.value AS key, SUM(pa.value) AS value
            FROM pa JOIN "Artist" a ON a."spotifyId" = pa.aid, json_each(a."genres") g
            WHERE g.value IN (${Prisma.join(keys)})
            GROUP BY pa.bucket, g.value` // NOT "GROUP BY key": json_each has its own key column (the index)
        : Promise.resolve([] as any[]),
      prisma.$queryRaw<Array<any>>`
        SELECT strftime(${fmt}, p."playedAt") AS bucket, ${metric} AS value
        FROM "Play" p ${JOIN_CATALOG}
        ${whereClause([...conditions, Prisma.sql`(a."spotifyId" IS NULL OR json_array_length(a."genres") = 0)`])}
        GROUP BY bucket`,
    ]);
    const flat = rows.map((r) => ({ bucket: String(r.bucket), key: String(r.key), value: num(r.value) }));
    const unmappedFlat = unmappedRows.map((r) => ({ bucket: String(r.bucket), key: "", value: num(r.value) }));
    return {
      data: {
        buckets,
        rows: keys.map((k) => ({ key: k, label: k, total: totals.get(k) ?? 0 })),
        values: pivot(flat, buckets, keys),
        unmapped: pivot(unmappedFlat, buckets, [""])[0] ?? [],
      },
    };
  });

  // Per calendar year (local time): share of MAPPED listening per group, plus eras =
  // runs of consecutive "full" years (≥ 10 % of the busiest year's total) with the same
  // dominant group. peakYear/peakShare = the year inside the era where that group's
  // share was highest. `unmapped` per year is informational (not part of the shares).
  app.get("/api/genres/eras", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = whereClause(scopedConditions(query, from, to));
    const metric = metricExpr(query);
    const level = levelOf(query);

    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT CAST(strftime('%Y', p."playedAt", 'localtime') AS INTEGER) AS year,
             a."group" AS key, ${metric} AS value
      FROM "Play" p ${JOIN_CATALOG} ${where}
      GROUP BY 1, 2 ORDER BY year`;

    type YearAgg = { year: number; total: number; unmapped: number; byGroup: Map<string, number> };
    const byYear = new Map<number, YearAgg>();
    const groupTotals = new Map<string, number>();
    for (const r of rows) {
      const year = num(r.year);
      let y = byYear.get(year);
      if (!y) byYear.set(year, (y = { year, total: 0, unmapped: 0, byGroup: new Map() }));
      const v = num(r.value);
      if (r.key === null || r.key === undefined) {
        y.unmapped += v;
        continue;
      }
      const key = keyAt(level, String(r.key));
      y.total += v;
      y.byGroup.set(key, (y.byGroup.get(key) ?? 0) + v);
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + v);
    }
    const yearsAgg = [...byYear.values()].sort((x, y) => x.year - y.year);
    const years = yearsAgg.map((y) => {
      const shares: Record<string, number> = {};
      for (const [k, v] of y.byGroup) shares[k] = y.total ? Math.round((v / y.total) * 10000) / 10000 : 0;
      return { year: y.year, total: y.total, unmapped: y.unmapped, shares };
    });
    const groups = [...groupTotals.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .map(([key, total]) => ({ key, label: labelAt(level, key), total }));

    // Eras over full years only
    const busiest = Math.max(0, ...yearsAgg.map((y) => y.total));
    const eras: Array<{ group: string; label: string; start: number; end: number; peakYear: number; peakShare: number }> = [];
    for (const y of yearsAgg) {
      if (y.total <= 0 || y.total < busiest * FULL_YEAR_SHARE) continue;
      let dominant: string | null = null;
      let best = -1;
      for (const [k, v] of y.byGroup) {
        if (v > best || (v === best && dominant !== null && k < dominant)) {
          best = v;
          dominant = k;
        }
      }
      if (dominant === null) continue;
      const share = Math.round((best / y.total) * 10000) / 10000;
      const last = eras[eras.length - 1];
      if (last && last.group === dominant && last.end === y.year - 1) {
        last.end = y.year;
        if (share > last.peakShare) {
          last.peakShare = share;
          last.peakYear = y.year;
        }
      } else {
        eras.push({ group: dominant, label: labelAt(level, dominant), start: y.year, end: y.year, peakYear: y.year, peakShare: share });
      }
    }

    return { data: { years, groups, eras } };
  });

  // Top artists of one group (?group=<key>) or one raw genre (?genre=<name>) in the
  // window — for tooltips. Artists are the catalog's primary artists (Artist.name).
  app.get("/api/genres/artists", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const group = typeof query.group === "string" ? query.group.trim() : "";
    const genre = typeof query.genre === "string" ? query.genre.trim() : "";
    if (!group && !genre) return reply.status(400).send({ error: "Query param 'group' or 'genre' is required." });
    const limit = parseInt_(query.limit, 10, 1, 100);
    const order = query.metric === "playtime" ? Prisma.sql`ms DESC, streams DESC` : Prisma.sql`streams DESC, ms DESC`;

    const conditions = scopedConditions(query, from, to);
    if (group && levelOf(query) === "broad") {
      const children = childrenOf(group);
      if (!children.length) return reply.status(400).send({ error: `Unknown broad group '${group}'.` });
      conditions.push(Prisma.sql`a."group" IN (${Prisma.join(children)})`);
    } else {
      conditions.push(
        group
          ? Prisma.sql`a."group" = ${group}`
          : Prisma.sql`EXISTS (SELECT 1 FROM json_each(a."genres") g WHERE g.value = ${genre})`
      );
    }
    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT a."name" AS artistName, SUM(p."durationMs") AS ms, COUNT(*) AS streams, a."genres" AS genres
      FROM "Play" p
      JOIN "Track" t ON t."spotifyId" = p."spotifyId"
      JOIN "Artist" a ON a."spotifyId" = t."primaryArtistId"
      ${whereClause(conditions)}
      GROUP BY a."spotifyId" ORDER BY ${order}, artistName ASC LIMIT ${limit}`;
    return {
      data: rows.map((r) => ({
        artistName: String(r.artistName),
        ms: num(r.ms),
        streams: num(r.streams),
        genres: safeJsonArray(r.genres),
      })),
    };
  });

  // The rule table with usage: artists per group (global) and listened time / streams
  // in the window; `unmapped` = the same for plays without a group.
  app.get("/api/genres/groups", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { from, to, error } = buildPlayedAtFilter(query);
    if (error) return reply.status(400).send({ error });
    const where = whereClause(scopedConditions(query, from, to));

    const [artistRows, playRows] = await Promise.all([
      prisma.$queryRaw<Array<any>>`
        SELECT "group" AS key, COUNT(*) AS artists FROM "Artist" GROUP BY "group"`,
      prisma.$queryRaw<Array<any>>`
        SELECT a."group" AS key, SUM(p."durationMs") AS ms, COUNT(*) AS streams
        FROM "Play" p ${JOIN_CATALOG} ${where} GROUP BY 1`,
    ]);
    const artists = new Map<string | null, number>(artistRows.map((r) => [r.key ?? null, num(r.artists)]));
    const plays = new Map<string | null, { ms: number; streams: number }>(
      playRows.map((r) => [r.key ?? null, { ms: num(r.ms), streams: num(r.streams) }])
    );
    const table = ruleTable();
    return {
      data: {
        groups: table.groups.map((g) => ({
          ...g,
          artists: artists.get(g.key) ?? 0,
          ms: plays.get(g.key)?.ms ?? 0,
          streams: plays.get(g.key)?.streams ?? 0,
        })),
        broad: table.broad,
        overrides: Object.keys(ARTIST_OVERRIDES).length,
        unmapped: {
          artists: artists.get(null) ?? 0,
          ms: plays.get(null)?.ms ?? 0,
          streams: plays.get(null)?.streams ?? 0,
        },
      },
    };
  });
};

export default genresRoutes;
