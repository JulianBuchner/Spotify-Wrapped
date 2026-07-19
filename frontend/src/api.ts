import type {
  BucketValue,
  DateWindow,
  DiscoveryPoint,
  ForgottenTrack,
  Granularity,
  HistoryPointRow,
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

/** `playlist` is a playlist contextUri; empty string / undefined means "all". */
function windowParams(w: DateWindow, playlist?: string): Record<string, QueryValue> {
  return { range: w.range, from: w.from, to: w.to, playlist };
}

export function getPlayCount() {
  return apiGet<{ count: number }>("/api/plays/count");
}

export function getSummary(w: DateWindow, playlist?: string) {
  return apiGet<{ data: StatsSummary }>("/api/stats/summary", windowParams(w, playlist));
}

export function getStreamsOverTime(
  w: DateWindow,
  granularity: Granularity,
  metric: "streams" | "playtime",
  playlist?: string
) {
  return apiGet<{ data: BucketValue[] }>("/api/stats/streams-over-time", {
    ...windowParams(w, playlist),
    granularity,
    metric,
  });
}

export function getListeningClock(w: DateWindow, playlist?: string) {
  return apiGet<{ data: Array<{ hour: number; value: number }> }>(
    "/api/stats/listening-clock",
    windowParams(w, playlist)
  );
}

export function getListeningByWeekday(w: DateWindow, playlist?: string) {
  return apiGet<{ data: Array<{ weekday: number; value: number }> }>(
    "/api/stats/listening-by-weekday",
    windowParams(w, playlist)
  );
}

export function getDiscovery(w: DateWindow, granularity: Granularity, playlist?: string) {
  return apiGet<{ data: DiscoveryPoint[] }>("/api/stats/discovery", {
    ...windowParams(w, playlist),
    granularity,
  });
}

export function getTopSongs(w: DateWindow, limit = 10, playlist?: string) {
  return apiGet<{ data: TopSong[]; meta: { total: number } }>("/api/top/songs", {
    ...windowParams(w, playlist),
    limit,
  });
}

export function getTopArtists(w: DateWindow, limit = 10, playlist?: string) {
  return apiGet<{ data: TopArtist[]; meta: { total: number } }>("/api/top/artists", {
    ...windowParams(w, playlist),
    limit,
  });
}

export function getTopAlbums(w: DateWindow, limit = 10, playlist?: string) {
  return apiGet<{ data: TopAlbum[]; meta: { total: number } }>("/api/top/albums", {
    ...windowParams(w, playlist),
    limit,
  });
}

export function getTopPlaylists(w: DateWindow, limit = 10) {
  return apiGet<{ data: TopPlaylist[]; meta: { total: number } }>("/api/top/playlists", {
    ...windowParams(w),
    limit,
  });
}

export function getPlaylists() {
  return apiGet<{ data: PlaylistInfo[] }>("/api/playlists");
}

export function getRecentlyPlayed(limit = 12) {
  return apiGet<{ data: RecentPlay[] }>("/api/recently-played", { limit });
}

export function getForgotten(limit = 10) {
  return apiGet<{ data: ForgottenTrack[] }>("/api/forgotten", { limit });
}

export function getHistoryPoints(w: DateWindow, playlist?: string) {
  return apiGet<{ data: HistoryPointRow[]; meta: { total: number } }>(
    "/api/history/points",
    windowParams(w, playlist)
  );
}
