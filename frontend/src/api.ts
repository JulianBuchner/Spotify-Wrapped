import type {
  BucketValue,
  DateWindow,
  DiscoveryPoint,
  ForgottenTrack,
  Granularity,
  HistoryPointRow,
  RecentPlay,
  StatsSummary,
  TopAlbum,
  TopArtist,
  TopSong,
} from "./types";

const API = import.meta.env.VITE_API_BASE_URL;

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

function windowParams(w: DateWindow): Record<string, QueryValue> {
  return { range: w.range, from: w.from, to: w.to };
}

export function getPlayCount() {
  return apiGet<{ count: number }>("/api/plays/count");
}

export function getSummary(w: DateWindow) {
  return apiGet<{ data: StatsSummary }>("/api/stats/summary", windowParams(w));
}

export function getStreamsOverTime(w: DateWindow, granularity: Granularity, metric: "streams" | "playtime") {
  return apiGet<{ data: BucketValue[] }>("/api/stats/streams-over-time", {
    ...windowParams(w),
    granularity,
    metric,
  });
}

export function getListeningClock(w: DateWindow) {
  return apiGet<{ data: Array<{ hour: number; value: number }> }>(
    "/api/stats/listening-clock",
    windowParams(w)
  );
}

export function getListeningByWeekday(w: DateWindow) {
  return apiGet<{ data: Array<{ weekday: number; value: number }> }>(
    "/api/stats/listening-by-weekday",
    windowParams(w)
  );
}

export function getDiscovery(w: DateWindow, granularity: Granularity) {
  return apiGet<{ data: DiscoveryPoint[] }>("/api/stats/discovery", {
    ...windowParams(w),
    granularity,
  });
}

export function getTopSongs(w: DateWindow, limit = 10) {
  return apiGet<{ data: TopSong[]; meta: { total: number } }>("/api/top/songs", {
    ...windowParams(w),
    limit,
  });
}

export function getTopArtists(w: DateWindow, limit = 10) {
  return apiGet<{ data: TopArtist[]; meta: { total: number } }>("/api/top/artists", {
    ...windowParams(w),
    limit,
  });
}

export function getTopAlbums(w: DateWindow, limit = 10) {
  return apiGet<{ data: TopAlbum[]; meta: { total: number } }>("/api/top/albums", {
    ...windowParams(w),
    limit,
  });
}

export function getRecentlyPlayed(limit = 12) {
  return apiGet<{ data: RecentPlay[] }>("/api/recently-played", { limit });
}

export function getForgotten(limit = 10) {
  return apiGet<{ data: ForgottenTrack[] }>("/api/forgotten", { limit });
}

export function getHistoryPoints(w: DateWindow) {
  return apiGet<{ data: HistoryPointRow[]; meta: { total: number } }>(
    "/api/history/points",
    windowParams(w)
  );
}
