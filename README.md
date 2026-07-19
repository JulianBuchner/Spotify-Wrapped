# Spotify Wrapped — Anytime

A self-hosted "Spotify Wrapped" that works all year round. A small backend polls the Spotify Web API every few seconds, records every track you play into its own database, and a dashboard visualizes your full listening history — totals, trends, top lists, listening habits, and an interactive "listening cloud" of every single play. Since Spotify's own API only exposes your last 50 plays, the point of this project is to *own the history yourself*: the longer it runs, the more interesting it gets.

## How it works

```
Spotify Web API ──(poll every 15s)──► Fastify backend ──► SQLite (Prisma)
                                          │
                                          ▼
                                     REST API (/api/…)
                                          │
                                          ▼
                              Vue 3 dashboard (this repo, /frontend)
```

- The **poller** calls Spotify's `currently-playing` endpoint, deduplicates repeats/jitter, and stores one row per play: track, artist, album, timestamp, duration — plus the **playback context** (which playlist/album/artist it was played from, with the playlist name resolved via a second API call).
- The **API** aggregates that play log into summaries, time series, top lists, "wrapped"-style fun facts, search, and per-song/artist/album detail.
- The **dashboard** shows it all with a date-range filter, playlist filter, dark/light mode, and a pannable/zoomable canvas visualization of every play (x = date, y = time of day).

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js 20, TypeScript, [Fastify](https://fastify.dev) 5, [Prisma](https://prisma.io) 7 (better-sqlite3 adapter), axios |
| Database | SQLite (single `dev.db` file) |
| Frontend | Vue 3 (`<script setup>` + TypeScript), Vite 7, vue-router 4, hand-rolled SVG/canvas charts (no chart library) |
| Hosting | Raspberry Pi, pm2, daily SQLite backups via cron |

## Repository layout

```
backend/    Fastify API + Spotify poller + Prisma schema   → backend/README.md
frontend/   Vue 3 dashboard                                → frontend/README.md
backups/    (local scratch for DB snapshots)
```

## Quick start

Prerequisites: Node 20+, a [Spotify Developer app](https://developer.spotify.com/dashboard) (client ID + secret, redirect URI `http://localhost:3000/callback`).

```bash
# 1. Backend — configure, create DB, link your Spotify account, run
cd backend
cp .env.example .env        # or create .env by hand — see backend/README.md
npm install
npx prisma migrate deploy
npx prisma generate
npm run connect             # one-time OAuth: open URL, approve, paste code
npm run dev                 # API on http://localhost:3000, poller starts

# 2. Frontend — point it at the API and run
cd ../frontend
npm install
echo VITE_API_BASE_URL="http://127.0.0.1:3000" > .env
npm run dev                 # dashboard on http://localhost:5173/Spotify-Wrapped/
```

Play something on Spotify and watch the play count climb.

## Deployment

The reference deployment runs on a Raspberry Pi under pm2, with the compiled backend (`npm run build` → `dist/server.js`) and a nightly `sqlite3 .backup` snapshot. The backend also serves the built frontend, so the whole dashboard is reachable LAN-wide at `http://<pi-host>:3000/Spotify-Wrapped/` — private by default as long as the router forwards no ports. See `backend/README.md` for the update sequence.
