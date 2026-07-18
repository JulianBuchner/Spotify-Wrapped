export interface PlayPoint {
  ts: number; // epoch ms
  hour: number; // 0..24 (local time, fractional)
  artist: string;
  track: string;
  ms: number; // durationMs
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

export interface HistoryPointRow {
  playedAt: string;
  trackName: string;
  artistName: string;
  durationMs: number;
  playlistName: string | null;
}

/** Date filter values shared by dashboard + cloud (maps 1:1 to query params). */
export interface DateWindow {
  range: string; // preset name or "" (custom / none)
  from: string; // YYYY-MM-DD or ""
  to: string; // YYYY-MM-DD or ""
}

export type Granularity = "day" | "week" | "month" | "year";
