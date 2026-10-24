# Backend — API + Spotify poller

Fastify server with two jobs:

1. **Record**: poll Spotify's `currently-playing` endpoint every `POLL_INTERVAL_SECONDS` (default 15s) for every connected account and write one row per play into SQLite — including the playback context (playlist/album/artist it was played from).
2. **Serve**: aggregate that play log into a REST API for the dashboard.

**Stack:** Node 20 · TypeScript · Fastify 5 · Prisma 7 (better-sqlite3 adapter) · axios · SQLite.

## Setup

```bash
cp .env.example .env        # fill in your Spotify app credentials
npm install
npx prisma migrate deploy   # creates dev.db + tables on first run
npx prisma generate
npm run connect             # one-time OAuth per Spotify account
npm run dev                 # ts-node-dev with auto-reload, port 3000
```

`npm run connect` prints an authorize URL; open it, approve, and paste the `code=` back into the prompt. Tokens are stored in the DB and refreshed automatically. Requested scopes include `playlist-read-private` / `playlist-read-collaborative` so playlist names can be resolved — if you connected before those scopes existed, re-run `connect` once.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | run with auto-reload (ts-node-dev) |
| `npm run build` | compile TypeScript → `dist/` |
| `npm start` | run compiled `dist/server.js` (production/pm2) |
| `npm run connect` | one-time Spotify OAuth, stores tokens in DB |
| `npm run backfill:playlist-names` | one-off: resolve + fill missing `playlistName`s (idempotent) |
| `npm run backfill:api-durations` | one-off after the 2026-10-24 duration fix: moves the track length of old api rows to `trackDurationMs` and caps `durationMs` by the gap to the next play (idempotent) |
| `npm run enrich:catalog` | fills the `Track`/`Artist` catalog from Spotify for every play and assigns genre groups, then prints the coverage report (idempotent + resumable: only missing rows are fetched). Flags: `-- --reassign` re-runs the rules in `src/data/genreGroups.ts` for **all** artists (after editing the rule table), `-- --refresh` also refetches artists older than 90 days. Takes a lock file (`dev.db.enrich.lock`) so it never runs beside the server's own enrichment |
| `npm run studio` | Prisma Studio DB browser |
| `npm run migrate:dev` / `migrate:deploy` | create / apply migrations |

## How the poller works (`src/poller.ts`)

- Polls each `SpotifyAccount` on the interval; ignores anything that isn't an actively playing track.
- Estimates the track's start time from `timestamp - progress_ms` and dedupes via an in-memory last-seen map **and** a DB check (same URI within ±60s), so restarts don't double-insert. Track restarts (seek back to start) count as a new play.
- Records the playback **context**: `contextType` + `contextUri` straight from the API, and `playlistName` resolved via `GET /playlists/{id}?fields=name` behind an in-memory cache (24h TTL, 1h for failures). When the Web API answers 403/404 — notably Spotify-owned algorithmic/editorial playlists, which 404 since Spotify's Nov 2024 API change — resolution falls back to the public no-auth **oEmbed** endpoint (`https://open.spotify.com/oembed`). Name resolution failing entirely never blocks the insert — the name just stays `null`, and `npm run backfill:playlist-names` can fill it in later.

Plays recorded before the context feature existed have `null` context columns; Spotify offers no way to backfill *those* (the backfill script only names playlists whose URI was recorded).

## Data model (`prisma/schema.prisma`)

`User` ←1:1→ `SpotifyAccount` (OAuth tokens) and `User` ←1:n→ `Play`:

| `Play` column | Meaning |
|---|---|
| `spotifyUri`, `spotifyId` | track identity |
| `trackName`, `artistName`, `albumName` | denormalized display fields |
| `playedAt`, `durationMs` | when the play started + ms actually listened (import: `ms_played`; api: grows with every poll while the track plays) |
| `trackDurationMs` | full track length, api rows only |
| `contextType`, `contextUri`, `playlistName` | what it was played *from* |
| `source` | `api` (poller) or `import` (Spotify Extended Streaming History export) |

Catalog tables filled by `npm run enrich:catalog` (and kept current by the server, see [Genres](#genres)). `Play` rows never change; joins go `Play.spotifyId → Track.spotifyId → Artist(Track.primaryArtistId)`:

| Table / column | Meaning |
|---|---|
| `Track.spotifyId` (PK), `name`, `albumName`, `releaseDate`, `durationMs`, `imageUrl` | track metadata from `GET /tracks?ids=`; `releaseDate` as Spotify gives it (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), `imageUrl` = the 300 px album image |
| `Track.primaryArtistId`, `artistIds` | `artists[0].id` (the artist whose genres count for the play) and the full id list as a JSON array. A track Spotify no longer knows is stored with `primaryArtistId = null`, `artistIds = '[]'` and the play's `trackName`, so it is not refetched every run |
| `Artist.spotifyId` (PK), `name`, `genres`, `imageUrl`, `popularity` | from `GET /artists?ids=`; `genres` is the JSON array exactly as returned (may be `[]`) |
| `Artist.group` | readable genre group from the rule table (`src/data/genreGroups.ts`), `null` = unmapped |
| `fetchedAt` (both) | when the row was fetched; `--refresh` refetches artists older than 90 days |

## API

All endpoints are `GET`. Most accept a date window — either `?range=today|this_week|previous_week|last_week|last_30_days|ytd|last_year|all_time`, a single `?date=YYYY-MM-DD`, or explicit `?from=&to=` — and (where noted) `?playlist=<contextUri>` to scope to one playlist. `this_week`/`previous_week` are Monday-based calendar weeks (server-local time); `last_week` is a rolling 7 days.

| Endpoint | Returns |
|---|---|
| `/health`, `/api/plays/count` | liveness, total rows |
| `/api/stats/summary` | totals: streams, playtime, distinct tracks/artists/albums, avg/day *(playlist ✓)* |
| `/api/stats/streams-over-time?granularity=day\|week\|month\|year&metric=streams\|playtime` | time series *(playlist ✓)* |
| `/api/stats/listening-clock` | plays per hour 0–23 *(playlist ✓)* |
| `/api/stats/listening-by-weekday` | plays per weekday, 0=Sun *(playlist ✓)* |
| `/api/stats/discovery` | cumulative first-time-heard tracks *(playlist ✓)* |
| `/api/stats/new-share` | share of streams that were first-ever plays *(playlist ✓)* |
| `/api/stats/duration-distribution?bucketSize=15` | song-length histogram |
| `/api/top/:entity` (`songs\|artists\|albums\|playlists`) | ranked lists, `?sort=streams\|playtime`, paginated; `?total=0` skips the costly distinct-group count *(playlist ✓ for non-playlist entities)* |
| `/api/playlists` | distinct playlists seen *within the date window*, for filter dropdowns |
| `/api/recently-played?limit=` | latest plays incl. playlist name |
| `/api/forgotten` | high historic plays, silent for 30+ days |
| `/api/history?q=&limit=&offset=` | paginated raw play log, searchable |
| `/api/history/points` | columnar per-play feed for the listening cloud and the record (parallel arrays `t/track/artist/playlist/d`, `d` = ms listened) *(playlist ✓)* |
| `/api/search?q=&types=` | fuzzy search across songs/artists/albums |
| `/api/song/:spotifyUri`, `/api/artist?name=`, `/api/album?name=` | detail + timelines |
| `/api/wrapped/top-artist-per-month`, `/api/wrapped/album-obsessions`, `/api/wrapped/top-albums` | wrapped-style fun facts |
| `/api/record/week-hour-grid?metric=streams\|playtime` | weekday (0=Sun) × hour (local) cells with a value > 0 *(playlist ✓)* |
| `/api/record/streams-by-artist?granularity=day\|week\|month\|year&top=10&metric=streams\|playtime` | top-N artists (1–20) as one series each over time plus `other`; `values[artist][bucket]` *(playlist ✓)* |
| `/api/record/top-artist-per-year?metric=streams|playtime` | #1 artist per calendar year (local) by streams or listening time *(playlist ✓)* |
| `/api/record/highlights` | longest streak of listening days, longest session (20-min gap rule), biggest day, first play, worst earworm (most plays of one track within 7 days); each `null` when the window is empty *(playlist ✓)* |
| `/api/record/earworms?limit=6` | tracks ranked by their best 7-day window (plays, weekStart) *(playlist ✓)* |
| `/api/record/skip-rate-by-year` | plays, skips (< 30 s) and skip rate per calendar year *(playlist ✓)* |
| `/api/record/explore-obsess?metric=playtime|streams` | per year: share on artists first heard that year vs. on the year's top-10 artists *(playlist ✓)* |
| `/api/record/wear-out?maxPlay=30&minPlays=8` | skip rate (< 30 s listened) by nth play of a song; plays are numbered over the whole history, thin trailing steps (< 20 plays) are pooled into the last one *(playlist ✓)* |
| `/api/genres/summary` | catalog health + coverage: artists/tracks counts, `coverage { ms, mappedMs, share, plays, playsWithoutTrack }` for the window, `lastFetchedAt`, top-20 `unmappedGenres` and `unmappedArtists` (with their genres) by listened time *(playlist ✓)* |
| `/api/genres/over-time?level=group|broad&granularity=day\|week\|month\|year&by=group\|genre&top=30&metric=streams\|playtime` | time series per genre group (`by=group`, one group per play = its primary artist's, all groups as rows sorted by total) or per raw Spotify genre (`by=genre`, a play counts once for **every** genre of its primary artist, so the sums exceed the play count; top 1–100 genres as rows). `values[row][bucket]` dense, buckets ascending (UTC); `unmapped[bucket]` = plays without a group / without genres, in the metric's unit *(playlist ✓)* |
| `/api/genres/eras?level=group|broad&metric=streams\|playtime` | per calendar year (local): `total` of **mapped** listening, `shares { [groupKey]: 0..1 }` of it, `unmapped`; `groups` with totals; `eras` = runs of consecutive full years (≥ 10 % of the busiest year) with the same dominant group, with `peakYear`/`peakShare` *(playlist ✓)* |
| `/api/genres/artists?level=group|broad&group=<key>\|genre=<name>&limit=10&metric=streams\|playtime` | top artists (catalog names) of one group or one raw genre in the window, with their genres — for tooltips; 400 without `group`/`genre` *(playlist ✓)* |
| `/api/genres/groups` | the rule table (`key`, `label`, `parent`, `match` regex source) plus the `broad` parent list (stable colour order) with artists per group (global) and `ms`/`streams` in the window, the overrides count, and the same for `unmapped` *(playlist ✓)* |
| `/api/stats/artist?name=`, `/api/stats/unique-tracks`, `/api/stats/listen-time` | legacy endpoints, superseded by `summary` |

Responses are gzipped (>1 KB), and the heavy read endpoints (`stats/*`, `top/*`, `history/points`, `playlists`, `forgotten`, `wrapped/*`, `record/*`, `genres/*`) sit behind an in-memory response cache (`x-cache: hit`; key = path + sorted query) — aggregations over the ~200k-row play log take seconds on the Pi otherwise. TTL is 60 s, except `record/*`, `genres/*` and `wrapped/*` over `range=all_time|ytd|last_year`, which stay cached for 15 min; the default all-time requests of the Record, Eras and Genres pages are prewarmed through the app 20 s after boot and every 14 min (`PREWARM_VIEW_URLS` in `server.ts` — extend it when a page's default request changes). SQLite runs in WAL mode with enlarged cache/mmap (`applySqlitePragmas`).

## Genres

Spotify only exposes genres **per artist**, through the `genres` field of `GET /artists` — a field
Spotify marks deprecated (it still answers today, but sparsely: some well-known artists come back
with `[]`). So the catalog fetches it once and **stores** it; nothing reads genres live.

- **Pipeline** (`src/catalog.ts`, `enrichCatalog`): distinct `Play.spotifyId` without a `Track` row →
  `GET /tracks?ids=` (50 per call) → distinct `Track.primaryArtistId` without an `Artist` row →
  `GET /artists?ids=` → `assignGroups()`. Secondary artists (`artistIds[1..]`) are only fetched when
  fewer than 1,000 are missing; they are not used for grouping. Calls are paced at ~150 ms, HTTP 429
  honours `Retry-After` (max 5 tries). A play's genres are those of its track's **primary** artist.
- **Kept current by the server**: the poller queues the id of every inserted play whose track is not
  in the catalog yet (`pendingTrackIds`); `server.ts` drains that set every 10 min with the same code
  path, and runs a full catch-up 60 s after boot (cheap when nothing is missing). Failures are logged,
  never fatal. The script and the server share a lock file so they never fetch side by side.
- **Grouping** (`src/data/genreGroups.ts`): `GENRE_GROUPS` is an ordered list of
  `{ key, label, match: RegExp }` — the **first** rule whose regex matches **any** of the artist's
  genres wins, so specific rules go first and the catch-alls (`electronic|dance`, …) last.
  `ARTIST_OVERRIDES` maps artist **names** to a group key for artists whose Spotify genres are empty
  or misleading; an override always beats the rules. One group per artist, so the Eras shares add up
  to 100 % of mapped time.
- **Two levels**: every rule has a `parent` in `BROAD_GROUPS` (hardstyle, EDM & dance, techno & house,
  bass, hip hop, pop & Schlager, rock & indie, other). The stored `Artist.group` is always the detailed
  key; `?level=broad` on `over-time`, `eras` and `artists` maps it to the parent at query time, so
  switching levels needs no reassignment. Adding a group = one rule with a parent, then `--reassign`.
- **Tuning**: edit the rule table or the overrides, run `npm run enrich:catalog -- --reassign` (re-runs
  `groupForArtist` for every artist and rewrites `Artist.group`), and read the coverage report it
  prints — or `GET /api/genres/summary` — for the share of listened time that has a group plus the top
  unmapped genres and artists. Target: ≥ 85 % of all-time listening mapped. Only artists that are
  reachable through a `Track` row can be grouped; plays whose track Spotify no longer knows stay
  unmapped (`playsWithoutTrack` in the summary).

## Serving the frontend

The server also hosts the built dashboard: if `../frontend/dist` exists, it is
served under `/Spotify-Wrapped/` (matching the Vite base path) with an SPA
fallback for deep links, and `/` redirects there. On the Pi that makes the
whole app available LAN-wide at `http://julian-pi.fritz.box:3000/Spotify-Wrapped/`
— same origin, so no CORS involved. Without a `dist` folder the server just
logs a warning and serves the API only.

## Deployment (Raspberry Pi + pm2)

pm2 runs the **compiled** server, so a change is live only after build + restart:

```bash
pm2 stop Spotify-Wrapped-backend
git pull
npm install                  # if dependencies changed
npx prisma migrate deploy    # if there are new migrations
npx prisma generate          # required after any schema change (stale client → TS2353 on build)
npm run build
(cd ../frontend && npm ci && npm run build)   # if the frontend changed
pm2 restart Spotify-Wrapped-backend
```

The SQLite file (`dev.db`) is the single source of truth — snapshot it with `sqlite3 dev.db ".backup out.db"` (never plain-copy while the app is writing).
