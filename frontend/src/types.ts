export interface PlayPoint {
  ts: number; // epoch ms
  hour: number; // 0..24 (local time, fractional)
  artist: string;
  track: string;
  ms: number; // durationMs
}
