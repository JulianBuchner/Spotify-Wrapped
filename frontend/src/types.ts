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

/** Date filter values shared by dashboard + cloud (maps 1:1 to query params). */
export interface DateWindow {
  range: string; // preset name or "" (custom / none)
  from: string; // YYYY-MM-DD or ""
  to: string; // YYYY-MM-DD or ""
}

export type Granularity = "day" | "week" | "month" | "year";
