import { computed, ref } from "vue";
import type {
  ArtistSeries,
  BucketValue,
  DateWindow,
  DiscoveryPoint,
  Earworm,
  ExploreObsessYear,
  ForgottenTrack,
  GenreArtist,
  GenreEras,
  GenreGroupInfo,
  GenreLevel,
  GenreOverTime,
  GenreSummary,
  Granularity,
  HistoryPointsData,
  PlaylistInfo,
  RecentPlay,
  RecordHighlights,
  SkipRateYear,
  StatsSummary,
  TopAlbum,
  TopArtist,
  TopPlaylist,
  TopSong,
  WearOut,
  WeekHourCell,
  YearTopArtist,
} from "./types";

export type Metric = "streams" | "playtime";

// Empty string = same-origin (production build served by the backend).
const API = import.meta.env.VITE_API_BASE_URL ?? "";

export type QueryValue = string | number | undefined;

function buildQuery(params: Record<string, QueryValue>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const trimmed = String(value).trim();
    if (trimmed) search.set(key, trimmed);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Requests on the wire right now (client-cache hits don't count). Views read
 * `isFetching` to show a page-level busy state, e.g. on the date-range filter,
 * so a slow all-time aggregation is visibly in progress.
 */
export const pendingRequests = ref(0);
export const isFetching = computed(() => pendingRequests.value > 0);

async function apiGet<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  pendingRequests.value++;
  try {
    const res = await fetch(`${API}${path}${buildQuery(params)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    return body as T;
  } finally {
    pendingRequests.value--;
  }
}

// ---------------------------------------------------------------------------
// Small client cache for the read-heavy endpoints, so switching between
// Dashboard and Listening Cloud doesn't refetch multi-second aggregations
// (the server has its own 60s cache; this saves the round trip entirely).
// Caches the in-flight promise, which also dedupes concurrent calls.
// ---------------------------------------------------------------------------
const clientCache = new Map<string, { at: number; promise: Promise<unknown> }>();

function cachedGet<T>(
  ttlMs: number,
  path: string,
  params: Record<string, QueryValue> = {}
): Promise<T> {
  const key = `${path}${buildQuery(params)}`;
  const hit = clientCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = apiGet<T>(path, params);
  clientCache.set(key, { at: Date.now(), promise });
  // a failed request must not poison the cache
  promise.catch(() => clientCache.delete(key));
  return promise;
}

/** `playlist` is a playlist contextUri; empty string / undefined means "all". */
function windowParams(w: DateWindow, playlist?: string): Record<string, QueryValue> {
  return { range: w.range, from: w.from, to: w.to, playlist };
}

export function getPlayCount() {
  return apiGet<{ count: number }>("/api/plays/count");
}

const STATS_TTL = 60_000;
const POINTS_TTL = 300_000;

export function getSummary(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: StatsSummary }>(STATS_TTL, "/api/stats/summary", windowParams(w, playlist));
}

export function getStreamsOverTime(
  w: DateWindow,
  granularity: Granularity,
  metric: "streams" | "playtime",
  playlist?: string
) {
  return cachedGet<{ data: BucketValue[] }>(STATS_TTL, "/api/stats/streams-over-time", {
    ...windowParams(w, playlist),
    granularity,
    metric,
  });
}

export function getListeningClock(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: Array<{ hour: number; value: number }> }>(
    STATS_TTL,
    "/api/stats/listening-clock",
    windowParams(w, playlist)
  );
}

export function getListeningByWeekday(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: Array<{ weekday: number; value: number }> }>(
    STATS_TTL,
    "/api/stats/listening-by-weekday",
    windowParams(w, playlist)
  );
}

export function getDiscovery(w: DateWindow, granularity: Granularity, playlist?: string) {
  return cachedGet<{ data: DiscoveryPoint[] }>(STATS_TTL, "/api/stats/discovery", {
    ...windowParams(w, playlist),
    granularity,
  });
}

/** `sort` omitted = the backend default (streams). */
export function getTopSongs(w: DateWindow, limit = 10, playlist?: string, sort?: Metric) {
  return cachedGet<{ data: TopSong[] }>(STATS_TTL, "/api/top/songs", {
    ...windowParams(w, playlist),
    limit,
    total: 0,
    sort,
  });
}

/** `sort` omitted = the backend default (streams). */
export function getTopArtists(w: DateWindow, limit = 10, playlist?: string, sort?: Metric) {
  return cachedGet<{ data: TopArtist[] }>(STATS_TTL, "/api/top/artists", {
    ...windowParams(w, playlist),
    limit,
    total: 0,
    sort,
  });
}

export function getTopAlbums(w: DateWindow, limit = 10, playlist?: string) {
  return cachedGet<{ data: TopAlbum[] }>(STATS_TTL, "/api/top/albums", {
    ...windowParams(w, playlist),
    limit,
    total: 0,
  });
}

export function getTopPlaylists(w: DateWindow, limit = 10) {
  return cachedGet<{ data: TopPlaylist[] }>(STATS_TTL, "/api/top/playlists", {
    ...windowParams(w),
    limit,
    total: 0,
  });
}

export function getPlaylists(w: DateWindow) {
  return cachedGet<{ data: PlaylistInfo[] }>(STATS_TTL * 2, "/api/playlists", windowParams(w));
}

export function getRecentlyPlayed(limit = 12) {
  return apiGet<{ data: RecentPlay[] }>("/api/recently-played", { limit });
}

export function getForgotten(limit = 10) {
  return cachedGet<{ data: ForgottenTrack[] }>(STATS_TTL * 2, "/api/forgotten", { limit });
}

export function getHistoryPoints(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: HistoryPointsData; meta: { total: number; capped: boolean } }>(
    POINTS_TTL,
    "/api/history/points",
    windowParams(w, playlist)
  );
}

// --- Record route -----------------------------------------------------------

export function getWeekHourGrid(w: DateWindow, playlist?: string, metric: Metric = "streams") {
  return cachedGet<{ data: WeekHourCell[] }>(STATS_TTL, "/api/record/week-hour-grid", {
    ...windowParams(w, playlist),
    metric,
  });
}

export function getStreamsByArtist(
  w: DateWindow,
  granularity: Granularity,
  top = 10,
  metric: Metric = "streams",
  playlist?: string
) {
  return cachedGet<{ data: ArtistSeries }>(STATS_TTL, "/api/record/streams-by-artist", {
    ...windowParams(w, playlist),
    granularity,
    top,
    metric,
  });
}

export function getTopArtistPerYear(w: DateWindow, playlist?: string, metric: Metric = "streams") {
  return cachedGet<{ data: YearTopArtist[] }>(STATS_TTL, "/api/record/top-artist-per-year", {
    ...windowParams(w, playlist),
    metric,
  });
}

export function getRecordHighlights(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: RecordHighlights }>(
    STATS_TTL,
    "/api/record/highlights",
    windowParams(w, playlist)
  );
}

export function getWearOut(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: WearOut }>(STATS_TTL, "/api/record/wear-out", windowParams(w, playlist));
}

export function getEarworms(w: DateWindow, limit = 6, playlist?: string) {
  return cachedGet<{ data: Earworm[] }>(STATS_TTL, "/api/record/earworms", {
    ...windowParams(w, playlist),
    limit,
  });
}

export function getSkipRateByYear(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: SkipRateYear[] }>(
    STATS_TTL,
    "/api/record/skip-rate-by-year",
    windowParams(w, playlist)
  );
}

export function getExploreObsess(w: DateWindow, metric: Metric = "playtime", playlist?: string) {
  return cachedGet<{ data: ExploreObsessYear[] }>(STATS_TTL, "/api/record/explore-obsess", {
    ...windowParams(w, playlist),
    metric,
  });
}

// --- Eras / Genres routes ----------------------------------------------------

export function getGenreSummary(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: GenreSummary }>(STATS_TTL, "/api/genres/summary", windowParams(w, playlist));
}

/** `level` only applies to `by = "group"` (group vs. broad rows); it is not sent for genre rows. */
export function getGenreOverTime(
  w: DateWindow,
  granularity: Granularity,
  by: "group" | "genre" = "group",
  level: GenreLevel = "group",
  top = 30,
  metric: Metric = "playtime",
  playlist?: string
) {
  return cachedGet<{ data: GenreOverTime }>(STATS_TTL, "/api/genres/over-time", {
    ...windowParams(w, playlist),
    granularity,
    by,
    level: by === "group" ? level : undefined,
    top,
    metric,
  });
}

export function getGenreEras(
  w: DateWindow,
  metric: Metric = "playtime",
  level: GenreLevel = "group",
  playlist?: string
) {
  return cachedGet<{ data: GenreEras }>(STATS_TTL, "/api/genres/eras", {
    ...windowParams(w, playlist),
    metric,
    level,
  });
}

/**
 * Exactly one of `group` (a group key — a broad key when `level` is "broad")
 * or `genre` (genre name). `level` defaults to "group" and is only sent with `group`.
 */
export function getGenreArtists(
  w: DateWindow,
  what: { group?: string; genre?: string; level?: GenreLevel },
  limit = 10,
  metric: Metric = "playtime",
  playlist?: string
) {
  return cachedGet<{ data: GenreArtist[] }>(STATS_TTL, "/api/genres/artists", {
    ...windowParams(w, playlist),
    group: what.group,
    level: what.group !== undefined ? (what.level ?? "group") : undefined,
    genre: what.genre,
    limit,
    metric,
  });
}

export function getGenreGroups(w: DateWindow, playlist?: string) {
  return cachedGet<{ data: GenreGroupInfo }>(STATS_TTL, "/api/genres/groups", windowParams(w, playlist));
}
