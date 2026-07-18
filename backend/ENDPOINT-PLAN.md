# Music-Stats API – implementierter Stand (flaches `Play`-Modell)

Stack: Fastify 5 + TypeScript + Prisma 7 + SQLite (better-sqlite3). Alle Endpunkte laufen
auf dem denormalisierten `Play`-Modell. Enrichment (Cover, Genre, Release-Jahr, Tracklisten,
Tempo/BPM) ist bewusst ausgeklammert und kommt später.

## Dateien

```
src/lib/dateFilter.ts   buildPlayedAtFilter (Presets), playedAtConditions, whereClause
src/lib/query.ts        parseLimit/Offset/Sort/Order, likeCondition, num
src/lib/searchIndex.ts  zero-dep Fuzzy-Suche (normalize + Levenshtein, 5-min-Cache)
src/routes/overview.ts  /api/top/:entity, /api/recently-played, /api/forgotten
src/routes/stats.ts     /api/stats/*
src/routes/wrapped.ts   /api/wrapped/*
src/routes/history.ts   /api/history
src/routes/search.ts    /api/search
src/routes/detail.ts    /api/song/:spotifyUri, /api/artist, /api/album
```
`server.ts` importiert `buildPlayedAtFilter` aus `lib/dateFilter` (die alte lokale Version
wurde ersetzt) und registriert die Route-Plugins. Bestehende Endpunkte (`/health`,
`/api/plays/count`, `/api/stats/artist`, `/api/stats/unique-tracks`,
`/api/stats/listen-time`) sind unverändert.

## Datumsfilter (auf allen Endpunkten)

Priorität: `?date=YYYY-MM-DD`  →  `?range=<preset>`  →  `?from=&to=` (ISO).
Presets: `today`, `last_week`, `last_30_days`, `ytd`, `last_year`, `all_time`.
Hinweis: `today`/`ytd`/`date` sind kalendergebunden und nutzen die **Server-Zeitzone**.

## Sortierung / Pagination

`sort=streams|playtime`, `order=asc|desc`, `limit` (Default 50, max 200), `offset`.
Listen-Antworten: `{ data: [...], meta: { total, limit, offset } }`.

---

## Suche

**`GET /api/search`** — `q` (required), `types=songs,artists,albums`, `limit` (pro Typ, Default 5, max 20).
Fuzzy, case- und diakritik-insensitiv, mit Tippfehler-Toleranz. In-Memory-Index (zero-dep),
alle 5 min neu aufgebaut. Antwort: `{ data: { songs:[...+score], artists:[...+score], albums:[...+score] } }`.

## Overview

**`GET /api/top/:entity`** (`songs|artists|albums`) — Datumsfilter, `sort`, `order`, `q`, `limit`, `offset`.
Antwort `songs`: `{ spotifyUri, trackName, artistName, albumName, streams, playtimeMs }`.

**`GET /api/recently-played`** — `limit` (Default 20). Neueste Plays zuerst.

**`GET /api/forgotten`** — Datumsfilter, `limit` (Default 20). Tracks mit hohen historischen
Streams, aber ohne Play seit Fensterbeginn (ohne `range`: letzte 30 Tage).
Score `historicStreams / (daysSinceLast + 1)`.

## Statistics

**`GET /api/stats/summary`** — totalStreams, totalPlaytimeMs, distinctTracks/Artists/Albums,
avgPlaytimePerDayMs. (Ersetzt inhaltlich unique-tracks + listen-time.)

**`GET /api/stats/listening-clock`** — 24 Buckets (`hour`,`value`). `'localtime'` = Server-TZ.

**`GET /api/stats/listening-by-weekday`** — 7 Buckets, **0 = Sonntag … 6 = Samstag**.

**`GET /api/stats/streams-over-time`** — `granularity=day|week|month|year`, `metric=streams|playtime`.

**`GET /api/stats/discovery`** — kumulierte Erst-Plays über Zeit (`bucket`,`new`,`cumulative`).

**`GET /api/stats/new-share`** — Anteil erstmals gehörter Streams je Periode
(`bucket`,`total`,`newStreams`,`newSharePct`).

**`GET /api/stats/duration-distribution`** — Songlängen-Histogramm. `bucketSize` (Sek., Default 15),
`weight=streams|distinct`. Antwort: `{ bucketStartSec, count }`.

## Wrapped

**`GET /api/wrapped/top-artist-per-month`** — meistgestreamter Artist je Monat (Window-Function).

**`GET /api/wrapped/album-obsessions`** — erster Tag, an dem ein Album ≥2× lief.

**`GET /api/wrapped/top-albums`** — Proxy für „front to back": Alben nach Streams/Playtime +
`distinctTracksPlayed`. Echte Durchläufe brauchen Tracklisten → später.

## History

**`GET /api/history`** — Datumsfilter, `q` (Titel/Artist/Album), `limit`, `offset`. Log neueste zuerst.

## Detail

**`GET /api/song/:spotifyUri`** — Kennzahlen + Monats-Timeline (404 wenn keine Plays).
**`GET /api/artist?name=`** — Kennzahlen, Top-Tracks, Top-Alben. *(Query-Param, da Namen `/` enthalten können.)*
**`GET /api/album?name=`** — Kennzahlen + Track-Rangliste.

---

## Später (mit Enrichment)

Cover-/Artist-Bilder, Genre-Evolution, Release-Jahr-Verteilung + Slider, Tempo-/BPM-Histogramm,
echte front-to-back-Album-Durchläufe. Für exakte IANA-Zeitzonen/DST bei den kalendergebundenen
Presets `luxon` einsetzen.
