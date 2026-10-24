export interface PlayPoint {
  ts: number; // epoch ms
  hour: number; // 0..24 (local time, fractional)
  artist: string;
  track: string;
  playlist: string | null; // playlist name when the play came from one
}

export interface StatsSummary {
  totalStreams: number;
  totalPlaytimeMs: number;
  distinctTracks: number;
  distinctArtists: number;
  distinctAlbums: number;
  avgPlaytimePerDayMs: number;
}

export interface TopSong {
  spotifyUri: string;
  trackName: string;
  artistName: string;
  albumName: string;
  streams: number;
  playtimeMs: number;
}

export interface TopArtist {
  artistName: string;
  streams: number;
  playtimeMs: number;
}

export interface TopAlbum {
  albumName: string;
  artistName: string;
  streams: number;
  playtimeMs: number;
}

export interface TopPlaylist {
  playlistUri: string;
  playlistName: string | null;
  streams: number;
  playtimeMs: number;
}

export interface PlaylistInfo {
  playlistUri: string;
  playlistName: string | null;
  streams: number;
}

export interface RecentPlay {
  playedAt: string;
  spotifyUri: string;
  trackName: string;
  artistName: string;
  albumName: string;
  contextType: string | null;
  playlistName: string | null;
}

export interface ForgottenTrack {
  spotifyUri: string;
  trackName: string;
  artistName: string;
  historicStreams: number;
  lastPlayedAt: string;
  daysSinceLast: number;
  score: number;
}

export interface BucketValue {
  bucket: string;
  value: number;
}

export interface DiscoveryPoint {
  bucket: string;
  new: number;
  cumulative: number;
}

/** Columnar /api/history/points payload — parallel arrays, index-aligned. */
export interface HistoryPointsData {
  t: number[]; // playedAt as epoch ms
  d: number[]; // durationMs (time actually listened)
  track: string[];
  artist: string[];
  playlist: (string | null)[];
}

// --- /api/record/* (Record route) -------------------------------------------

/** One weekday × hour cell; weekday uses SQLite %w (0 = Sunday … 6 = Saturday). */
export interface WeekHourCell {
  weekday: number;
  hour: number;
  value: number;
}

/** Top-N artists per bucket plus "other"; values[artistIndex][bucketIndex]. */
export interface ArtistSeries {
  buckets: string[];
  artists: string[];
  values: number[][];
  other: number[];
}

export interface YearTopArtist {
  year: number;
  artistName: string;
  streams: number;
  playtimeMs: number;
}

export interface RecordHighlights {
  longestStreak: { days: number; from: string; to: string } | null; // YYYY-MM-DD local
  longestSession: { ms: number; start: string; end: string; plays: number } | null; // ISO
  biggestDay: { date: string; ms: number; plays: number } | null; // YYYY-MM-DD local
  firstPlay: { playedAt: string; trackName: string; artistName: string } | null;
  earworm: {
    spotifyUri: string;
    trackName: string;
    artistName: string;
    plays: number;
    weekStart: string; // YYYY-MM-DD local
  } | null;
}

export interface WearOut {
  steps: Array<{ n: number; skipRate: number; plays: number }>; // skipRate 0..1
  average: number;
  best: number;
  tiredAt: number | null;
}

/** /api/record/earworms — most plays of one track within any 7-day window. */
export interface Earworm {
  spotifyUri: string;
  trackName: string;
  artistName: string;
  plays: number;
  weekStart: string; // YYYY-MM-DD local
}

/** /api/record/skip-rate-by-year — skips = plays stopped within 30 s. */
export interface SkipRateYear {
  year: number;
  plays: number;
  skips: number;
  skipRate: number; // 0..1
}

/** /api/record/explore-obsess — share of the year's listening on artists new that year vs. on the year's top 10. */
export interface ExploreObsessYear {
  year: number;
  total: number;
  newArtistShare: number; // 0..1
  top10Share: number; // 0..1
}

// --- /api/genres/* (Eras + Genres routes) -----------------------------------

export interface GenreSummary {
  artistsTotal: number;
  artistsWithGenres: number;
  artistsWithGroup: number;
  tracksTotal: number;
  tracksUnresolved: number;
  coverage: { ms: number; mappedMs: number; share: number }; // share 0..1
  lastFetchedAt: string | null;
  unmappedGenres: Array<{ genre: string; ms: number }>;
  unmappedArtists: Array<{ artistName: string; ms: number; streams: number }>;
}

/**
 * Listening per bucket by genre group (one group per play) or by genre (a play
 * counts once per genre of its artist, so sums exceed the play count).
 * values[rowIndex][bucketIndex]; rows are sorted by total desc.
 */
export interface GenreOverTime {
  buckets: string[];
  rows: Array<{ key: string; label: string; total: number }>;
  values: number[][];
  unmapped: number[];
}

/**
 * Genre groups come in two levels: "group" = the ~18 detailed groups (hardstyle,
 * trance, bounce, …), "broad" = their 8 coarse parents (hard, dance, techno, …).
 */
export type GenreLevel = "group" | "broad";

export interface GenreEra {
  group: string; // group key on the requested level (broad key with level=broad)
  label: string;
  start: number | string; // year (or bucket key)
  end: number | string;
  peakYear: number;
  peakShare: number; // 0..1
}

/** `groups`, `years[].shares` and `eras` are all on the requested level. */
export interface GenreEras {
  years: Array<{ year: number; total: number; shares: Record<string, number> }>; // shares 0..1 per group key
  groups: Array<{ key: string; label: string; total: number }>;
  eras: GenreEra[];
}

export interface GenreArtist {
  artistName: string;
  ms: number;
  streams: number;
  genres: string[];
}

/**
 * Rule-table order of the genre groups — the stable order colours are assigned
 * in: `groups` for the group level, `broad` for the broad level. Each group
 * names its broad `parent` key.
 */
export interface GenreGroupInfo {
  groups: Array<{
    key: string;
    label: string;
    parent: string;
    match: string;
    artists: number;
    ms: number;
    streams: number;
  }>;
  broad: Array<{ key: string; label: string }>;
  overrides: number;
  unmapped: { artists: number; ms: number; streams: number };
}

/** Date filter values shared by dashboard + cloud (maps 1:1 to query params). */
export interface DateWindow {
  range: string; // preset name or "" (custom / none)
  from: string; // YYYY-MM-DD or ""
  to: string; // YYYY-MM-DD or ""
}

export type Granularity = "day" | "week" | "month" | "year";
