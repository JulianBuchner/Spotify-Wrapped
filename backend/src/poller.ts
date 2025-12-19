import { prisma } from "./db";
import { ensureAccessToken, fetchRecentlyPlayed } from "./spotify";

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

async function pollOneAccount(accountId: number) {
  const account = await prisma.spotifyAccount.findUnique({ where: { id: accountId } });
  if (!account) return;

  const accessToken = await ensureAccessToken(account);

  const items = await fetchRecentlyPlayed(accessToken, account.lastAfterMs ?? undefined);
  if (!items.length) {
    console.log(`[poller] userId=${account.userId} no new plays`);
    return;
  }

  // insert in chronological order
  items.sort((a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime());

  let inserted = 0;
  let maxPlayedAtMs = account.lastAfterMs ?? BigInt(0);

  for (const item of items) {
    const playedAt = new Date(item.played_at);
    const playedAtMs = BigInt(playedAt.getTime());
    if (playedAtMs > maxPlayedAtMs) maxPlayedAtMs = playedAtMs;

    const track = item.track;
    const artistName = track.artists.map((a) => a.name).join(", ");

    // upsert-like behavior via unique constraint
    try {
      await prisma.play.create({
        data: {
          userId: account.userId,
          spotifyUri: track.uri,
          spotifyId: track.id ?? null,
          trackName: track.name,
          artistName,
          albumName: track.album?.name ?? null,
          playedAt,
          durationMs: track.duration_ms,
          source: "api",
        },
      });
      inserted++;
    } catch (e: any) {
      // ignore unique constraint violations
      // (Prisma error code for unique violation is P2002)
      if (e?.code !== "P2002") throw e;
    }
  }

  // move cursor forward so next poll only fetches newer plays
  await prisma.spotifyAccount.update({
    where: { id: account.id },
    data: { lastAfterMs: maxPlayedAtMs },
  });

  console.log(`[poller] userId=${account.userId} inserted=${inserted} cursor=${maxPlayedAtMs.toString()}`);
}
