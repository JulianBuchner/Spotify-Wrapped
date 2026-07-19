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
| `playedAt`, `durationMs` | when + how long |
| `contextType`, `contextUri`, `playlistName` | what it was played *from* |

## API

All endpoints are `GET`. Most accept a date window — either `?range=today|last_week|last_30_days|ytd|last_year|all_time`, a single `?date=YYYY-MM-DD`, or explicit `?from=&to=` — and (where noted) `?playlist=<contextUri>` to scope to one playlist.

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
| `/api/top/:entity` (`songs\|artists\|albums\|playlists`) | ranked lists, `?sort=streams\|playtime`, paginated *(playlist ✓ for non-playlist entities)* |
| `/api/playlists` | distinct playlists seen, for filter dropdowns |
| `/api/recently-played?limit=` | latest plays incl. playlist name |
| `/api/forgotten` | high historic plays, silent for 30+ days |
| `/api/history?q=&limit=&offset=` | paginated raw play log, searchable |
| `/api/history/points` | minimal per-play feed for the listening cloud *(playlist ✓)* |
| `/api/search?q=&types=` | fuzzy search across songs/artists/albums |
| `/api/song/:spotifyUri`, `/api/artist?name=`, `/api/album?name=` | detail + timelines |
| `/api/wrapped/top-artist-per-month`, `/api/wrapped/album-obsessions`, `/api/wrapped/top-albums` | wrapped-style fun facts |
| `/api/stats/artist?name=`, `/api/stats/unique-tracks`, `/api/stats/listen-time` | legacy endpoints, superseded by `summary` |

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
