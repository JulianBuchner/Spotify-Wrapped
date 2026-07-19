// One-off (NOT committed): import Spotify Extended Streaming History exports
// into a COPY of the local DB (dev-with-history.db). Refuses to run against
// anything else.
//
//   $env:DATABASE_URL='file:./dev-with-history.db'
//   npx ts-node-dev --transpile-only src/scripts/importStreamingHistory.ts
//
// Field mapping (export -> Play):
//   spotify_track_uri                  -> spotifyUri (+ spotifyId from its tail)
//   master_metadata_track_name         -> trackName
//   master_metadata_album_artist_name  -> artistName ("Unknown Artist" if null)
//   master_metadata_album_album_name   -> albumName
//   ts - ms_played                     -> playedAt (ts is the STOP time; the
//                                         poller stores estimated start times)
//   ms_played                          -> durationMs
//   "import"                           -> source
// Context columns stay null — the export carries no playlist information.
import fs from "fs";
import path from "path";
import { prisma } from "../db";

const EXPORT_DIR = "D:\\my_spotify_data_streamingverlauf\\Spotify Extended Streaming History";
const OVERLAP_MARGIN_MS = 90_000;
const BATCH = 1000;

interface ExportRow {
  ts: string;
  ms_played: number;
  master_metadata_track_name: string | null;
  master_metadata_album_artist_name: string | null;
  master_metadata_album_album_name: string | null;
  spotify_track_uri: string | null;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("dev-with-history.db")) {
    throw new Error(
      `Refusing to run: DATABASE_URL must point at dev-with-history.db (got "${url}")`
    );
  }

  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found in the DB copy.");

  const files = fs
    .readdirSync(EXPORT_DIR)
    .filter((f) => f.startsWith("Streaming_History_") && f.endsWith(".json"))
    .sort();

  let total = 0;
  let skippedNoTrack = 0; // podcasts/audiobooks/videos without a track uri
  let skippedZeroMs = 0; // rows that never actually played
  let dupWithinExport = 0;
  let dupVsPolled = 0;

  type Row = {
    playedAt: Date;
    spotifyUri: string;
    spotifyId: string | null;
    trackName: string;
    artistName: string;
    albumName: string | null;
    durationMs: number;
  };
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    const data: ExportRow[] = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, f), "utf8"));
    total += data.length;
    for (const r of data) {
      if (!r.spotify_track_uri || !r.master_metadata_track_name) {
        skippedNoTrack++;
        continue;
      }
      if (!Number.isFinite(r.ms_played) || r.ms_played <= 0) {
        skippedZeroMs++;
        continue;
      }
      const endMs = Date.parse(r.ts);
      if (!Number.isFinite(endMs)) {
        skippedNoTrack++;
        continue;
      }
      const playedAtMs = endMs - r.ms_played;
      const key = `${r.spotify_track_uri}|${playedAtMs}`;
      if (seen.has(key)) {
        dupWithinExport++;
        continue;
      }
      seen.add(key);
      rows.push({
        playedAt: new Date(playedAtMs),
        spotifyUri: r.spotify_track_uri,
        spotifyId: r.spotify_track_uri.split(":")[2] ?? null,
        trackName: r.master_metadata_track_name,
        artistName: r.master_metadata_album_artist_name ?? "Unknown Artist",
        albumName: r.master_metadata_album_album_name,
        durationMs: Math.round(r.ms_played),
      });
    }
    console.log(`[import] read ${f}`);
  }

  // Dedupe against the polled data where the export overlaps it: the poller's
  // estimated start times won't match the export's exactly, so the unique
  // constraint can't catch these — match same track within ±90s instead.
  const existing = await prisma.play.findMany({
    select: { spotifyUri: true, playedAt: true },
  });
  let earliestPolledMs = Infinity;
  const polledByUri = new Map<string, number[]>();
  for (const p of existing) {
    const t = p.playedAt.getTime();
    if (t < earliestPolledMs) earliestPolledMs = t;
    const list = polledByUri.get(p.spotifyUri);
    if (list) list.push(t);
    else polledByUri.set(p.spotifyUri, [t]);
  }

  const overlapStart = earliestPolledMs - 3_600_000;
  const toInsert = rows.filter((r) => {
    const t = r.playedAt.getTime();
    if (t < overlapStart) return true;
    const times = polledByUri.get(r.spotifyUri);
    if (!times) return true;
    const isDup = times.some((pt) => Math.abs(pt - t) <= OVERLAP_MARGIN_MS);
    if (isDup) dupVsPolled++;
    return !isDup;
  });

  toInsert.sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());

  console.log(
    `[import] ${total} export rows -> ${toInsert.length} to insert ` +
      `(no track: ${skippedNoTrack}, 0ms: ${skippedZeroMs}, ` +
      `dup in export: ${dupWithinExport}, dup vs polled: ${dupVsPolled})`
  );

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH).map((r) => ({
      userId: user.id,
      spotifyUri: r.spotifyUri,
      spotifyId: r.spotifyId,
      trackName: r.trackName,
      artistName: r.artistName,
      albumName: r.albumName,
      playedAt: r.playedAt,
      durationMs: r.durationMs,
      source: "import",
    }));
    const res = await prisma.play.createMany({ data: batch });
    inserted += res.count;
    if ((i / BATCH) % 20 === 0 || i + BATCH >= toInsert.length) {
      console.log(`[import] inserted ${inserted}/${toInsert.length}`);
    }
  }

  const [minMax] = await prisma.$queryRaw<Array<any>>`
    SELECT COUNT(*) AS c, MIN("playedAt") AS min, MAX("playedAt") AS max FROM "Play"`;
  console.log(
    `[import] DONE. Play rows in copy: ${Number(minMax.c)}, spanning ${minMax.min} .. ${minMax.max}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
