// One-off: fill in playlistName for plays whose context was recorded before
// name resolution worked (e.g. Spotify-owned playlists that 404'd until the
// oEmbed fallback existed).
//
//   npm run backfill:playlist-names
//
// Uses the Web API (+ oEmbed fallback) when a connected account exists,
// otherwise oEmbed alone. Safe to re-run: it only touches rows that still
// have playlistName IS NULL, and skips URIs that stay unresolvable.
import { prisma } from "../db";
import {
  ensureAccessToken,
  fetchPlaylistName,
  fetchPlaylistNameOembed,
} from "../spotify";

/** "spotify:playlist:3cEYpjA9oz9GiPac4AsH4n" -> "3cEYpjA9oz9GiPac4AsH4n" */
function playlistIdFromUri(uri: string): string | null {
  const parts = uri.split(":");
  return parts[0] === "spotify" && parts[1] === "playlist" && parts[2] ? parts[2] : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const account = await prisma.spotifyAccount.findFirst();
  const accessToken = account ? await ensureAccessToken(account) : null;
  if (!accessToken) {
    console.log("[backfill] No connected Spotify account — using oEmbed only.");
  }

  const rows = await prisma.$queryRaw<Array<{ contextUri: string }>>`
    SELECT DISTINCT "contextUri" AS contextUri
    FROM "Play"
    WHERE "contextType" = 'playlist'
      AND "contextUri" IS NOT NULL
      AND "playlistName" IS NULL`;

  console.log(`[backfill] ${rows.length} unresolved playlist URI(s) found.`);

  let resolved = 0;
  let updatedRows = 0;

  for (const { contextUri } of rows) {
    const id = playlistIdFromUri(contextUri);
    if (!id) {
      console.log(`[backfill] SKIP (unparseable uri): ${contextUri}`);
      continue;
    }

    let name: string | null = null;
    try {
      name = accessToken
        ? await fetchPlaylistName(accessToken, id) // includes the oEmbed fallback
        : await fetchPlaylistNameOembed(id);
    } catch (err) {
      console.error(`[backfill] ERROR resolving ${contextUri}:`, err);
      continue;
    }

    if (!name) {
      console.log(`[backfill] unresolved: ${contextUri}`);
      continue;
    }

    const res = await prisma.play.updateMany({
      where: { contextUri, playlistName: null },
      data: { playlistName: name },
    });
    resolved++;
    updatedRows += res.count;
    console.log(`[backfill] ${contextUri} -> "${name}" (${res.count} play(s))`);

    await sleep(250); // be polite to the endpoints
  }

  console.log(
    `[backfill] Done: ${resolved}/${rows.length} URI(s) resolved, ${updatedRows} play row(s) updated.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
