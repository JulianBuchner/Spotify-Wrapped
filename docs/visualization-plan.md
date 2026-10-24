# Visualization plan v2 — new routes inspired by r/dataisbeautiful (2026-10-24)

Scope agreed so far: fix the `durationMs` bug (done, on master), add loading skeletons first,
then one new route per Reddit poster, all in the existing Anytime Wrapped design. Genres are a
must-have (Eras streamgraph + genre-frequency strip), the vinyl itself is nice-to-have.

## 0. Already done: `durationMs` fix (master, commits 070f09e + 59f3f19)

- `Play.durationMs` now means **ms actually listened** for every row. Imported rows always had
  `ms_played`; api rows start at the progress seen by the first poll and the poller raises the
  value on every poll while the track plays. A play within 20 s of the end snaps to the full length
  when the track changes or playback stops. After a pm2 restart the poller keeps extending the
  existing row.
- New nullable `Play.trackDurationMs` = track length (api rows only). The song-length histogram
  uses it where present.
- `npm run backfill:api-durations` repairs the ~20k api rows written before the fix: moves the
  length to `trackDurationMs` and caps `durationMs` by the gap to the next play (within 20 s of
  the length counts as full). On the local copy: 1107 h → 1000 h listened in the api era.
- **Still to do on the Pi** (your deploy routine): `git pull`, `npx prisma migrate deploy`,
  `npx prisma generate`, `npm run build`, `pm2 restart Spotify-Wrapped-backend`, then once
  `npm run backfill:api-durations`. Until then the Pi keeps writing track lengths.
- Side effect worth having: a "skip" is now `durationMs < 30000` for **both** sources (Spotify's
  own rule). Import era: 4.4 % of plays. Api era going forward: exact to one poll interval.

## 1. Loading skeletons (before the new charts) — built 2026-10-24 on `feat/loading-skeletons`

Today `ChartCard` only dims the body while `loading` is true (`frontend/src/components/ChartCard.vue:21`),
which reads as "slightly darker" when a longer range takes seconds on the Pi.

- `ChartCard`: when `loading` and there is no data yet → render a **skeleton** (grey shimmer
  blocks shaped like the chart: a few bars for `ColumnChart`, a wavy band for `TimeSeriesChart`,
  rows for lists). When `loading` with stale data → keep the dimming **and** show a thin animated
  progress bar at the top edge of the card plus a "Loading…" chip next to the title.
- `StatCard`: shimmer placeholder for the number while `loading`.
- `DateRangeFilter`: a subtle busy indicator on the active preset while any request for that
  window is in flight (one shared `pendingCount` in `api.ts`), so switching to "All time" shows
  something immediately.
- Listening Cloud: same treatment for the points fetch (it already knows when it loads).
- All CSS-only (`@keyframes shimmer` on `--surface`-ish tokens, honoring `prefers-reduced-motion`),
  theme-aware through the existing CSS variables. Effort: small; touches 4 components + `style.css`.

## 2. New routes (one per poster)

Navigation becomes: **Dashboard · Listening Cloud · Record · Eras · Genres**
(`frontend/src/router.ts`, tabs in `App.vue:37-38`). Each view keeps the global
`DateRangeFilter` + `PlaylistFilter` like the dashboard, but defaults to **All time** since
the posters are long-term stories. Post 3 (camera-roll map) is not Spotify data and is skipped.

### 2a. `/record` — "6 years on a record" (post 1) — built 2026-10-24 on `feat/record-route`

Backend: `backend/src/routes/record.ts` (week-hour-grid, streams-by-artist, top-artist-per-year, highlights, wear-out) + `d` on history/points. Frontend: `RecordView.vue`, `RecordChart.vue` (canvas vinyl, always dark), `HeatmapGrid.vue`, `StackedColumnChart.vue`, `YearStrip.vue`, `lib/palette.ts`, `lib/granularity.ts`. The disc is drawn dark in both themes; the "usual time" line is the dominant half-hour per month (±4 months pooled), not a mean. Wheel zoom + drag pan on the disc (CSS-transform preview, chunked redraw with the old bitmap as backdrop). One ranking metric (Hours/Streams toggle) drives disc colours, legend, stacked chart and year strip.

| Panel | Data / approach | Class |
|---|---|---|
| **The Record** (vinyl: one ring per day, arcs by time of day, colored by top-10 artist, grey = rest; "usual time of day" line; markers for longest streak, longest session, first play, biggest day) | `/api/history/points` already streams every play as columnar arrays (`t`, `track`, `artist`, `playlist`) — add `d` (durationMs). Canvas drawing in a new `RecordChart.vue`, modelled on `ListeningCloud.vue` (same data, polar instead of cartesian, same pan/zoom + search-highlight idea). Plays split at midnight; ~200k arcs drawn in chunks. | A, nice-to-have, M–L |
| **When I listen** — weekday × hour heatmap | new `/api/stats/week-hour-grid` (`%w` × `%H`, `localtime`, metric streams or playtime). New `HeatmapGrid.vue`, used on `/eras` too. | A, must, S |
| **Who I listened to** — hours per month stacked by top-10 artist + other | new `/api/stats/streams-over-time-by-artist?top=10` (month buckets, one series per top artist + "other"). New `StackedColumnChart.vue` (extends `ColumnChart`). | A, must, S–M |
| **How songs wear out** — skip rate on the nth play of a song | per track, plays in time order numbered 1…n; skip = `durationMs < 30000`; rate per n, pooled past 30, min 8 plays per song (`on-record/src/data/stats.ts` logic). SQL window `ROW_NUMBER() OVER (PARTITION BY spotifyUri ORDER BY playedAt)`. Honest caveat: api rows before the fix only know skips via the next-play gap. | A, must, M |
| **My #1 artist, year by year** | yearly variant of `/api/wrapped/top-artist-per-month` (ROW_NUMBER already there). Simple colored bar strip. | A, must, S |
| Stat tiles: longest streak, longest session, first play, biggest day | SQL: consecutive-day runs; sessions = gaps ≤ 20 min; max `SUM(durationMs)` per day; `MIN(playedAt)`. | A, S |

### 2b. `/eras` — "Twelve years … how my taste moved in eras" (post 2) — built 2026-10-24 on `feat/genres`

`ErasView.vue` + `GenreStreamgraph.vue` (Gaussian-smoothed, expand-stacked, monotone curves, era header + in-band peak labels), `MultiLineChart.vue`, `BarList.vue`, `EarwormList.vue`; stat strip from `/api/record/{earworms,skip-rate-by-year,highlights}` + top song. Hours/Streams toggle.

| Panel | Data / approach | Class |
|---|---|---|
| **Genre streamgraph with eras** (hero) | monthly listened ms per genre group → centered Gaussian smoothing (7 months) → shares → stacked, normalized area with smooth curves (`curveBasis` equivalent, hand-written SVG path, no d3 dependency). Era labels = consecutive years with the same dominant group; "32 % in 2018" labels at each group's peak. Needs §3. | C, **must**, M (+ §3) |
| Stat strip: most-played song · worst earworm · longest streak · skip rate first vs last year | earworm = max plays of one track inside any 7-day window (sliding window over sorted `playedAt`, per track; SQL self-join or JS over points). Skip rate per year = share of plays < 30 s. | A, must, S–M |
| Explore, then obsess | per year: share of listened time on artists whose first play is in that year vs on that year's top-10 artists. `MIN(playedAt)` per artist. | A, must, S |
| Two artists, then everyone else (top artists bars) | `/api/top/artists?sort=playtime` exists; poster-style horizontal bars. | A, S |
| Worst earworms list (top 6) | same query as the earworm stat. | A, S |
| When I listen heatmap | shared `HeatmapGrid.vue` from 2a. | A, S |
| Podcasts vs music | dropped: only 96 podcast rows exist in the export, none in the DB. | — |

### 2c. `/genres` — "Genre listen frequency" (post 4) — built 2026-10-24 on `feat/genres`

`GenresView.vue` + `GenreStripPlot.vue` (always-dark panel, rainbow rows, intensity = value/rowMax^0.7, click → top artists), Genres|Groups|Broad and Streams|Hours toggles, Coverage card with the unmapped lists for tuning `genreGroups.ts`. Groups have two levels (18 detailed groups with a `parent` each, 8 broad parents; `?level=broad`); hypertechno and German rap / German pop & indie are own groups since the owner's review.

Post 4 (u/Poa_Alpina, repo <https://github.com/Conchobhar/spotify-unwrapped>): rows = ~30 genre
clusters, x = time, every listen a semi-transparent dot so density becomes color intensity, rows
colored on a rainbow scale. Method: Spotify artist genres → word2vec over each artist's genre
list → k-means into ~30 clusters → cluster named by its two most-listened genres.

| Panel | Data / approach | Class |
|---|---|---|
| **Genre frequency strip plot** | rows = genre rows (see §3 for the two row options), x = month (or week for short ranges), one cell per row×bucket with opacity = listens relative to the row's max (post 4's "intensity"). Row hue from a perceptual rainbow, all on the existing dark/light surfaces. Hover → listens, top artists in that cell. Click a row → artists of that genre. | C, **must**, M (+ §3) |
| Genre shares per year (small multiples or a 100 % bar per year) | same table as the streamgraph. | C, S |
| "Genre of the hour" (optional): weekday×hour grid per genre | reuse `HeatmapGrid.vue`. | C, S |

## 3. Genres: how to get them into the Wrapped — backend built 2026-10-24 on `feat/genres`

Status: steps 1, 2, 4 (both layers) and 6 are done (`backend/src/catalog.ts`,
`backend/src/data/genreGroups.ts`, `backend/src/routes/genres.ts`, see the backend README
"Genres" section); step 3 only in its manual-override half (`ARTIST_OVERRIDES` in
`genreGroups.ts`, no MusicBrainz yet); step 5 reached: 86.6 % of all-time listening mapped on
the local copy (rules alone 74.0 % = everything Spotify has genres for; 40 name overrides add
the rest). Frontend views still open.

**Verified today with your app's token**: `GET /artists/{id}` and the bulk `GET /artists?ids=`
still return `genres` (4 of your top 5 artists had them; Alan Walker came back empty). Spotify
marks the field deprecated, so fetch once and **store** the result, never read it live.

Data we have: 202k plays, 14,096 distinct tracks (every row has a `spotifyId`), 5,468 distinct
artist strings. Top 300 artists cover 67.5 % of plays, top 1000 cover 88.6 %.

Pipeline (backend job, runs on the Pi where the token lives):
1. New tables `Track` (`spotifyId` PK, `artistIds` JSON, `albumName`, `releaseDate`,
   `durationMs`, `imageUrl`, `fetchedAt`) and `Artist` (`spotifyId` PK, `name`, `genres` JSON,
   `imageUrl`, `popularity`, `fetchedAt`). No change to `Play`; joins go `Play.spotifyId → Track →
   Artist` (primary artist). ✅ done (migration `add_catalog`; `Track` also has `name` +
   `primaryArtistId`, `Artist` has `group`).
2. ✅ done — `npm run enrich:catalog`: distinct `spotifyId` → `GET /tracks?ids=` (50 per call ≈ 282 calls)
   → distinct artist ids → `GET /artists?ids=` (≈ 120 calls). Minutes, well inside the rate limit;
   idempotent (skips rows with `fetchedAt`). The poller calls the same code for new tracks, so
   the catalog stays current. (Actual first run: 291 + 94 calls, ~2.5 min, no 429s; the poller
   queues new ids and the server drains them every 10 min.)
3. ⏳ partly — only the manual overrides exist (`ARTIST_OVERRIDES` in `genreGroups.ts`, 40
   names); no MusicBrainz fallback yet. Fallback for artists with empty genres: MusicBrainz artist tags by name (free, no key,
   1 req/s, only for the top ~500 uncovered) plus a small manual override file
   (`backend/src/data/genreOverrides.ts`), e.g. Alan Walker → edm.
4. ✅ done (16 groups, `by=group` / `by=genre` on the over-time endpoint). **Grouping** — two layers, both needed:
   - **Groups (~12–15)** for the Eras streamgraph, like post 2's "Dream pop & indie pop" bands:
     rule table `genreGroups.ts` mapping Spotify micro-genres to a group by keyword/priority
     (e.g. `hardstyle|rawstyle|hardcore|frenchcore → Hardstyle`, `big room|edm|progressive house →
     EDM`, …). I generate the first draft from **your** actual genre frequency list; you review the
     names and assignments once (this is the "by hand" part both OPs did, ~30 min of your time).
     One group per artist (first matching rule), so shares add up to 100 %.
   - **Rows (~30)** for the Genres strip: the top 30 raw Spotify genres by listened time, where a
     play counts for every genre of its artist (post 4's approach). Optional toggle to show the
     groups instead. Automatic clustering (word2vec + k-means) is possible later in a Python
     one-off, but the raw top-30 already reads like post 4's rows for one person's data.
5. ✅ reached (86.6 % local). Coverage target: ≥ 85 % of listened time mapped (post 2 managed
   68 % by hand). The streamgraph shows shares of covered time and the footer states the coverage
   (`/api/genres/summary` → `coverage.share`), as post 2 did.
6. ✅ done — endpoints: `/api/genres/over-time?granularity=month&by=group|genre`, `/api/genres/eras`,
   `/api/genres/summary`, plus `/api/genres/artists` (tooltips) and `/api/genres/groups` (rule
   table). Behind the existing 60 s cache prefix; no precomputed monthly table was needed
   (all_time `by=genre` ≈ 1.3–1.5 s locally after aggregating per artist before `json_each`,
   `by=group` ≈ 0.6 s; ≈ 4× that on the Pi, served from the 60 s cache after the first hit).

## 4. Design rules for the new views

- Same page skeleton as the dashboard: `ChartCard` + `StatCard`, CSS variables from `style.css`,
  `--series` palette extended with a colorblind-checked 12-color set for groups/artists, dark and
  light themes, every chart with its screen-reader table (frontend/README convention).
- No chart library: hand-written SVG for the heatmap, stacked columns, streamgraph, strip plot;
  canvas only for the record (like the cloud).
- Poster typography is not copied; headings follow the existing type scale. The posters' editorial
  touches that fit (big-number stat strip, era labels on the streamgraph, "x % in YEAR" annotations)
  are kept.

## 5. Order of work and effort

| Step | What | Effort |
|---|---|---|
| 1 | Loading skeletons (§1) | 0.5 day |
| 2 | Shared pieces: `HeatmapGrid`, `StackedColumnChart`, week-hour endpoint, by-artist endpoint, stat endpoints (streak, session, biggest day, earworm, first vs last skip rate, explore/obsess) | 1 day |
| 3 | `/record` route: panels first, vinyl last | 1–2 days (vinyl 1 of them) |
| 4 | Catalog enrichment job + tables + your review of the group map (§3) | 1 day + your 30 min |
| 5 | `/eras` route with the genre streamgraph | 1 day |
| 6 | `/genres` route with the strip plot | 0.5–1 day |
| later | Schema extension + re-import for `skipped`/`platform`/`conn_country`/`shuffle` (device history, country stat, exact skips for 2014–2025); constellation, bar-chart race, poster export | optional |

Everything in steps 1–3 needs no data you don't already have. Steps 4–6 need the enrichment job
to have run on the Pi once.

## 6. What I need from you

1. **Deploy the two master commits on the Pi** (your routine in the vault note) and run
   `npm run backfill:api-durations` once — or say so and I do it over SSH.
2. **Genre rows for `/genres`**: top-30 raw Spotify genres (recommended, closest to post 4), the
   ~15 curated groups, or both with a toggle?
3. **30 minutes once** to review the drafted genre→group map (names + assignments) before the
   Eras streamgraph is final.
4. Confirm the new routes default to **All time** and also obey the playlist filter.
5. OK to run the enrichment job on the Pi with the stored token (read-only Spotify calls, ~400
   requests once, then a few per day)?
6. Later, optional: approval for the `skipped`/`platform`/`conn_country` migration and re-import
   (gives device history, "plays abroad" and exact skips for the import era).

No API keys, exports or new accounts are needed for steps 1–6.
