# Frontend — dashboard

Vue 3 single-page app that visualizes the play history recorded by the backend. Three routes:

- **Dashboard** (`/`) — date-range + playlist filters scoping KPI tiles (streams, listening time, per-day average, distinct tracks/artists/albums), listening-over-time (streams ⇄ playtime), listening clock (by hour), weekday rhythm, Top 10 songs/artists/albums/playlists, recently played (auto-refreshes every minute, shows the source playlist), discovery curve, and forgotten favorites.
- **Listening Cloud** (`/cloud`) — every play as a dot on a full-height canvas (x = date, y = time of day). Drag to pan, scroll to zoom, hover for details, highlight by artist/track, filter by date range or playlist.
- **Record** (`/record`, defaults to all time) — the poster view: highlight tiles (longest streak / session, biggest day, first play, worst earworm), the vinyl-style record (one ring per day, every play an arc at its time of day, top-10 artists in color, "usual time of day" line, numbered highlight markers), "When I listen" weekday × hour heatmap, "Who I listened to" hours per bucket stacked by artist, "How songs wear out" skip rate by nth play, and "My #1 artist, year by year".

**Stack:** Vue 3 `<script setup>` + TypeScript · Vite 7 · vue-router 4 · hand-rolled SVG charts and a raw-canvas scatter — no chart or UI library.

## Develop

```bash
npm install
echo VITE_API_BASE_URL="http://127.0.0.1:3000" > .env   # backend URL
npm run dev        # http://localhost:5173/Spotify-Wrapped/
npm run build      # type-checks (vue-tsc) + builds to dist/
```

The app is served under the **`/Spotify-Wrapped/` base path** (`vite.config.ts`); the router derives its base from it, so deep links like `/Spotify-Wrapped/cloud` work in production.

Production builds use `.env.production` (`VITE_API_BASE_URL=""`), which makes all API calls **same-origin relative** — the backend serves `dist/` itself (see `backend/README.md`), so one host serves both app and API. The localhost URL in `.env` only applies to `npm run dev`.

## Structure

```
src/
  main.ts, router.ts        app bootstrap, routes (/, /cloud, /record)
  theme.ts                  dark/light mode: data-theme attr + localStorage,
                            defaults to OS preference
  style.css                 design tokens (CSS custom properties) for both themes
  api.ts, types.ts          typed fetch wrappers for every backend endpoint
  lib/format.ts             number/duration/date/bucket formatting, axis ticks
  lib/latest.ts             stale-response guard: loaders only apply the result
                            of their most recently started request (loads can
                            overlap when the playlist filter resets async)
  lib/granularity.ts        window -> bucket size (day/week/month), shared by
                            Dashboard and Record
  lib/palette.ts            the categorical palette: 10 artist colors + "other"
                            grey per theme, validated for color-vision safety
  views/
    DashboardView.vue       filter state + layout grid, owns all dashboard fetches
    CloudView.vue           listening-cloud page (filters, point loading)
    RecordView.vue          record page: owns the /api/record/* fetches, derives
                            the one top-10 ranking every chart colors by
  components/
    DateRangeFilter.vue     preset segments + custom from/to
    PlaylistFilter.vue      playlist dropdown — lists only playlists played in the selected timeframe; resets to "All" if the selection drops out (hidden until playlist data exists)
    StatCard.vue            KPI tile
    ChartCard.vue           card chrome: title/subtitle/actions/loading/error (skeleton on first load, progress bar + "Loading…" chip while stale data reloads)
    Skeleton.vue            shimmer placeholders shaped like the chart they stand in for (bars / line / rows / block / value)
    TimeSeriesChart.vue     SVG line+area chart, crosshair tooltip; optional
                            dashed reference line + a called-out marker point
    ColumnChart.vue         SVG column chart, per-bar tooltips, keyboard focusable
    StackedColumnChart.vue  SVG stacked columns (series bottom-up, legend row,
                            per-bucket tooltip listing every series + total)
    HeatmapGrid.vue         SVG weekday × hour heatmap (Monday first), opacity
                            scaled by value, less…more legend
    YearStrip.vue           one block per year, tinted with the artist's
                            palette color when the artist is in the top 10
    RecordChart.vue         canvas "record": one ring per day, arcs per play, — wheel zooms around the cursor, drag pans, `resetView()` exposed
                            drawn in rAF chunks (200k plays stay responsive),
                            overlay canvas for guides/markers/hover
    TopList.vue             tabbed Top-10 (songs/artists/albums/playlists)
    RecentlyPlayed.vue      latest plays, 60s auto-refresh
    ForgottenList.vue       "forgotten favorites" list
    ListeningCloud.vue      pan/zoom canvas scatter, theme-aware; independent
                            x/y zoom (sliders + wheel, Shift+wheel = vertical),
                            free 2-axis drag panning; built for 100k+ points
                            (typed-array buffers, binary-searched visible
                            range, pixel dedupe, debounced highlight)
```

## Conventions

- **Theming** — components only use CSS custom properties (`var(--…)`) from `style.css`; the canvas reads them at render time via `getComputedStyle`, so both chart types follow the theme toggle instantly. Chart series colors (`--series`) were validated for contrast and color-vision safety in both modes: `#0891b2` light / `#0aa2c0` dark.
- **Categorical colors** — `lib/palette.ts` is the single source of per-series colors (10 artist slots + an "other" grey, one set per theme, validated with the dataviz palette checker). Components get a color by palette *index*, and the Record view hands every chart the same top-10 ranking, so an artist has one color across the record, the stacked chart and the year strip. Never shuffle the slot order (adjacent slots were checked for color-vision separation) or generate an 11th hue — extra series fold into "other".
- **Data flow** — views own filter state and pass it down; components fetch their own data and re-fetch when props change.
- **Loading states** — a card with nothing to show yet renders a `Skeleton` in the shape of its chart (`empty` + `skeleton` props on `ChartCard`); a card that re-fetches with data on screen keeps the previous render at reduced opacity and adds a top progress bar and a "Loading…" chip (no layout jump). `api.ts` counts requests on the wire (`isFetching`), which the date-range filter shows as a spinner on the active preset. All of it is CSS-only and honors `prefers-reduced-motion`.
- **Charts** — every chart also renders a screen-reader-only table, and tooltips never gate data.
- Desktop-first by design: the layout uses the full width and is not optimized for small screens.
