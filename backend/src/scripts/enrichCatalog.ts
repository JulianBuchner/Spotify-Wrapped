import { prisma } from "../db";
import { ensureAccessToken } from "../spotify";
import { acquireEnrichLock, coverageReport, enrichCatalog, enrichLockPath } from "../catalog";

/**
 * Fills the Track/Artist catalog from Spotify for every play and assigns genre groups,
 * then prints the coverage report. Idempotent: only missing rows are fetched.
 *
 *   npm run enrich:catalog                 # fetch what is missing, group still-unmapped artists
 *   npm run enrich:catalog -- --reassign   # re-run the rules in data/genreGroups.ts for ALL artists
 *   npm run enrich:catalog -- --refresh    # also refetch artists older than 90 days
 */
async function main() {
  const args = new Set(process.argv.slice(2));
  const reassign = args.has("--reassign");
  const refresh = args.has("--refresh");

  const account = await prisma.spotifyAccount.findFirst();
  if (!account) throw new Error("No SpotifyAccount found. Run: npm run connect");
  const accessToken = await ensureAccessToken(account);

  const release = acquireEnrichLock();
  if (!release) throw new Error(`Another enrichment is running (lock file ${enrichLockPath()}); try again later.`);
  let r;
  try {
    r = await enrichCatalog({
      accessToken,
      reassign,
      refresh,
      log: (m) => console.log(`[enrich] ${m}`),
    });
  } finally {
    release();
  }
  console.log(
    `[enrich] done in ${(r.elapsedMs / 1000).toFixed(1)} s: ` +
      `${r.tracksFetched} tracks fetched (${r.tracksUnresolved} unresolved), ` +
      `${r.artistsFetched} artists fetched (${r.artistsUnresolved} unresolved, ${r.artistsRefreshed} refreshed), ` +
      `${r.groupsAssigned} artists grouped, ${r.rateLimited} x HTTP 429`
  );

  const c = await coverageReport();
  const h = (ms: number) => (ms / 3_600_000).toFixed(1) + " h";
  const pct = (x: number) => (x * 100).toFixed(1) + " %";
  console.log("");
  console.log("=== Coverage (all time) ===");
  console.log(
    `listened time mapped to a group: ${pct(c.coverage.share)} (${h(c.coverage.mappedMs)} of ${h(c.coverage.ms)})` +
      (c.coverage.share >= 0.85 ? "  [target >= 85 % reached]" : "  [target >= 85 % NOT reached]")
  );
  console.log(
    `plays without a Track row: ${c.coverage.playsWithoutTrack} of ${c.coverage.plays}`
  );
  console.log(
    `artists: ${c.artistsTotal} total, ${c.artistsWithGenres} with genres, ${c.artistsWithGroup} with a group; ` +
      `tracks: ${c.tracksTotal} total, ${c.tracksUnresolved} unresolved`
  );
  console.log("");
  console.log("Top unmapped genres (listened time):");
  for (const g of c.unmappedGenres) console.log(`  ${h(g.ms).padStart(9)}  ${g.genre}`);
  console.log("");
  console.log("Top unmapped artists (listened time):");
  for (const a of c.unmappedArtists) {
    console.log(`  ${h(a.ms).padStart(9)}  ${String(a.streams).padStart(5)} plays  ${a.artistName}  [${a.genres.join(", ")}]`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
