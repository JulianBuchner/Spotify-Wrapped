import { prisma } from "./db";
import {
  ensureAccessToken,
  fetchCurrentlyPlaying,
  fetchPlaylistName,
  type PlayingContext,
} from "./spotify";

// In-memory dedupe so we don't hit the DB every 15s for the same track. `playId` is the row
// the current play is written to, so its listened time can grow with every poll.
const lastSeenByAccount = new Map<
  string,
  {
    uri: string;
    startMs: bigint;
    lastProgressMs: number | null;
    lastTimestampMs: number;
    playId: string | null;
    trackDurationMs: number;
  }
>();

// A play whose last seen progress got this close to the end of the track counts as played to the
// end: the last poll before the next track lands up to one poll interval short.
const FULL_PLAY_SLACK_MS = 20_000;

// Playlist-name cache so we don't call /playlists/{id} on every insert.
// Successful lookups live long (renames are rare); failed ones retry sooner.
const NAME_TTL_MS = 24 * 60 * 60 * 1000;
const NAME_NEGATIVE_TTL_MS = 60 * 60 * 1000;
const playlistNameCache = new Map<string, { name: string | null; fetchedAt: number }>();

/** "spotify:playlist:3cEYpjA9oz9GiPac4AsH4n" -> "3cEYpjA9oz9GiPac4AsH4n" */
function playlistIdFromUri(uri: string): string | null {
  const parts = uri.split(":");
  return parts[0] === "spotify" && parts[1] === "playlist" && parts[2] ? parts[2] : null;
}

async function resolvePlaylistName(accessToken: string, uri: string): Promise<string | null> {
  const id = playlistIdFromUri(uri);
  if (!id) return null;

  const cached = playlistNameCache.get(id);
  if (cached) {
    const ttl = cached.name === null ? NAME_NEGATIVE_TTL_MS : NAME_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) return cached.name;
  }

  try {
    const name = await fetchPlaylistName(accessToken, id);
    playlistNameCache.set(id, { name, fetchedAt: Date.now() });
    return name;
  } catch (err) {
    // Network/5xx errors: don't fail the play insert over a display name.
    console.error(`[poller] Failed to resolve playlist name for ${uri}`, err);
    return cached?.name ?? null;
  }
}

/** Listened time to store for a play seen at `progressMs`; snaps to the full track when `final` and close to the end. */
function listenedMs(progressMs: number, trackDurationMs: number, final: boolean): number {
  if (final && progressMs >= trackDurationMs - FULL_PLAY_SLACK_MS) return trackDurationMs;
  return Math.max(0, Math.min(progressMs, trackDurationMs));
}

/** Raise the play's listened time; never lowers it (a restart is a new row, not a rewind). */
async function recordProgress(playId: string, progressMs: number, trackDurationMs: number, final: boolean) {
  const ms = listenedMs(progressMs, trackDurationMs, final);
  try {
    await prisma.play.updateMany({
      where: { id: playId, durationMs: { lt: ms } },
      data: { durationMs: ms },
    });
  } catch (err) {
    console.error(`[poller] Failed to update listened time for play ${playId}`, err);
  }
}

export async function pollAllUsersOnce() {
  const accounts = await prisma.spotifyAccount.findMany();

  if (accounts.length === 0) {
    console.log("[poller] No Spotify accounts found. Run: npm run connect");
    return;
  }

  for (const account of accounts) {
    try {
      await pollOneAccount(account.id);
    } catch (err) {
      console.error(`[poller] Error polling account ${account.id}`, err);
    }
  }
}

async function pollOneAccount(accountId: string) {
  const account = await prisma.spotifyAccount.findUnique({ where: { id: accountId } });
  if (!account) return;

  const accessToken = await ensureAccessToken(account);

  const playing = await fetchCurrentlyPlaying(accessToken);
  const prev = lastSeenByAccount.get(accountId);

  if (!playing || !playing.isPlaying || playing.type !== "track" || !playing.item?.uri) {
    // Nothing (or something that isn't a track) playing. The play we were following may have
    // run to its end since the last poll, so let it count as complete if it got close enough.
    // The entry stays: a paused track that resumes keeps writing to the same row.
    if (prev?.playId && prev.lastProgressMs !== null) {
      await recordProgress(prev.playId, prev.lastProgressMs, prev.trackDurationMs, true);
    }
    return;
  }

  const track = playing.item;

  const progressMs = playing.progressMs ?? null;
  const timestampMs = playing.timestampMs;
  const startMs = BigInt(timestampMs - (progressMs ?? 0)); // estimated track start time (ms epoch)

  // If we're still on the same track, rely on progress to detect restarts and avoid
  // duplicates caused by timestamp/progress jitter.
  if (prev && prev.uri === track.uri) {
    if (progressMs === null) {
      lastSeenByAccount.set(accountId, { ...prev, lastTimestampMs: timestampMs });
      return;
    }

    const prevProgress = prev.lastProgressMs;
    if (prevProgress !== null) {
      const progressedForward = progressMs + 2000 >= prevProgress;
      const looksLikeRestart = progressMs < 10_000 && prevProgress > 30_000;
      if (progressedForward || !looksLikeRestart) {
        lastSeenByAccount.set(accountId, {
          ...prev,
          lastProgressMs: progressMs,
          lastTimestampMs: timestampMs,
        });
        if (prev.playId && progressMs > prevProgress) {
          await recordProgress(prev.playId, progressMs, prev.trackDurationMs, false);
        }
        return;
      }
    } else {
      lastSeenByAccount.set(accountId, {
        ...prev,
        lastProgressMs: progressMs,
        lastTimestampMs: timestampMs,
      });
      if (prev.playId) await recordProgress(prev.playId, progressMs, prev.trackDurationMs, false);
      return;
    }
  }

  // A different track, or the same one started over: the previous play is over.
  if (prev?.playId && prev.lastProgressMs !== null) {
    await recordProgress(prev.playId, prev.lastProgressMs, prev.trackDurationMs, true);
  }

  // Update in-memory "last seen" immediately (so we don't reprocess during DB work)
  const trackDurationMs = track.duration_ms;
  lastSeenByAccount.set(accountId, {
    uri: track.uri,
    startMs,
    lastProgressMs: progressMs,
    lastTimestampMs: timestampMs,
    playId: null,
    trackDurationMs,
  });

  // Prevent duplicates across restarts:
  // check whether we already have this URI inserted around that start time (+/- 60s)
  const window = 60_000n;
  const startLower = new Date(Number(startMs - window));
  const startUpper = new Date(Number(startMs + window));

  const existing = await prisma.play.findFirst({
    where: {
      userId: account.userId,
      spotifyUri: track.uri,
      playedAt: { gte: startLower, lte: startUpper },
    },
    select: { id: true },
  });

  if (existing) {
    // Recorded before a process restart: keep extending that row's listened time.
    const seen = lastSeenByAccount.get(accountId);
    if (seen && seen.uri === track.uri) lastSeenByAccount.set(accountId, { ...seen, playId: existing.id });
    if (progressMs !== null) await recordProgress(existing.id, progressMs, trackDurationMs, false);
    return;
  }

  const artistName = track.artists.map((a) => a.name).join(", ");
  const playedAt = new Date(Number(startMs));

  const context: PlayingContext | null = playing.context;
  const playlistName =
    context?.type === "playlist" ? await resolvePlaylistName(accessToken, context.uri) : null;

  const created = await prisma.play.create({
    data: {
      userId: account.userId,
      spotifyUri: track.uri,
      spotifyId: track.id ?? null,
      trackName: track.name,
      artistName,
      albumName: track.album?.name ?? null,
      playedAt,
      durationMs: listenedMs(progressMs ?? 0, trackDurationMs, false),
      trackDurationMs,
      contextType: context?.type ?? null,
      contextUri: context?.uri ?? null,
      playlistName,
      source: "api",
    },
    select: { id: true },
  });

  // Later polls of this track extend the row's listened time. Only if we are still on it:
  // the entry may already belong to the next track if the DB work took a while.
  const seen = lastSeenByAccount.get(accountId);
  if (seen && seen.uri === track.uri && seen.startMs === startMs) {
    lastSeenByAccount.set(accountId, { ...seen, playId: created.id });
  }

  // Optional: reuse lastAfterMs as "last inserted start time" (not required, but harmless)
  await prisma.spotifyAccount.update({
    where: { id: account.id },
    data: { lastAfterMs: startMs },
  });

  // Log only when something is inserted
  const fromInfo = context ? ` [${context.type}${playlistName ? `: ${playlistName}` : ""}]` : "";
  console.log(
    `[poller] userId=${account.userId} @ ${playedAt.toISOString()} inserted: "${track.name}" - ${artistName}${fromInfo}`
  );
}
