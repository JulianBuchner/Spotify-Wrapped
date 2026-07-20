import type {
  BucketValue,
  DateWindow,
  DiscoveryPoint,
  ForgottenTrack,
  Granularity,
  HistoryPointsData,
  PlaylistInfo,
  RecentPlay,
  StatsSummary,
  TopAlbum,
  TopArtist,
  TopPlaylist,
  TopSong,
} from "./types";

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

async function apiGet<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const res = await fetch(`${API}${path}${buildQuery(params)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return body as T;
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

export function getTopSongs(w: DateWindow, limit = 10, playlist?: string) {
  return cachedGet<{ data: TopSong[] }>(STATS_TTL, "/api/top/songs", {
    ...windowParams(w, playlist),
    limit,
    total: 0,
  });
}

export function getTopArtists(w: DateWindow, limit = 10, playlist?: string) {
  return cachedGet<{ data: TopArtist[] }>(STATS_TTL, "/api/top/artists", {
    ...windowParams(w, playlist),
    limit,
    total: 0,
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
