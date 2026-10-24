import axios from "axios";
import dotenv from "dotenv";
import { prisma } from "./db";
import type { SpotifyAccount } from "@prisma/client";

dotenv.config();

const clientId = process.env.SPOTIFY_CLIENT_ID!;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

if (!clientId || !clientSecret) {
  throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env");
}

export async function ensureAccessToken(account: SpotifyAccount): Promise<string> {
  const now = Date.now();
  const expiresAt = account.tokenExpiresAt.getTime();

  // keep a 60s buffer
  if (expiresAt - now > 60_000) return account.accessToken;

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    {
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const { access_token, expires_in, refresh_token } = res.data as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

  const updated = await prisma.spotifyAccount.update({
    where: { id: account.id },
    data: {
      accessToken: access_token,
      tokenExpiresAt,
      ...(refresh_token ? { refreshToken: refresh_token } : {}),
    },
  });

  return updated.accessToken;
}

export type PlayingContext = {
  type: string; // "playlist" | "album" | "artist" | "show"
  href: string | null;
  uri: string; // e.g. "spotify:playlist:3cEYpjA9oz9GiPac4AsH4n"
};

export type CurrentlyPlaying = {
  timestampMs: number;
  isPlaying: boolean;
  progressMs: number | null;
  type: string; // "track" | "episode" | "ad" | ...
  context: PlayingContext | null;
  item:
    | {
        id?: string | null;
        uri: string;
        name: string;
        artists: { name: string }[];
        album?: { name: string };
        duration_ms: number;
      }
    | null;
};

export async function fetchCurrentlyPlaying(accessToken: string): Promise<CurrentlyPlaying | null> {
  const res = await axios.get("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${accessToken}` },
    // Prevent axios from throwing on 204; treat it as "nothing playing"
    validateStatus: (s) => (s >= 200 && s < 300) || s === 204,
  });

  if (res.status === 204) return null;

  const data = res.data as any;

  const rawContext = data?.context;
  const context: PlayingContext | null =
    rawContext && typeof rawContext.uri === "string" && typeof rawContext.type === "string"
      ? {
          type: rawContext.type,
          href: typeof rawContext.href === "string" ? rawContext.href : null,
          uri: rawContext.uri,
        }
      : null;

  return {
    timestampMs: typeof data?.timestamp === "number" ? data.timestamp : Date.now(),
    isPlaying: Boolean(data?.is_playing),
    progressMs: typeof data?.progress_ms === "number" ? data.progress_ms : null,
    type: typeof data?.currently_playing_type === "string" ? data.currently_playing_type : "unknown",
    context,
    item: data?.item ?? null,
  };
}

/**
 * No-auth fallback: resolve a playlist name via Spotify's public oEmbed
 * endpoint. Still works for Spotify-owned algorithmic/editorial playlists,
 * which /playlists/{id} has answered with 404 since Spotify's Nov 2024 API
 * change. Returns null on 404 (playlist gone/unresolvable).
 */
export async function fetchPlaylistNameOembed(playlistId: string): Promise<string | null> {
  const res = await axios.get("https://open.spotify.com/oembed", {
    params: { url: `https://open.spotify.com/playlist/${playlistId}` },
    timeout: 5000,
    validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
  });

  if (res.status === 404) return null;
  const title = (res.data as any)?.title;
  return typeof title === "string" && title.length > 0 ? title : null;
}

/**
 * Resolve a playlist's display name via GET /playlists/{id}?fields=name.
 * When the Web API answers 403 (private without the playlist-read-private
 * scope) or 404 (deleted, or Spotify-owned algorithmic/editorial playlists),
 * falls back to the public oEmbed endpoint before giving up.
 */
export async function fetchPlaylistName(
  accessToken: string,
  playlistId: string
): Promise<string | null> {
  const res = await axios.get(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { fields: "name" },
      validateStatus: (s) => (s >= 200 && s < 300) || s === 403 || s === 404,
    }
  );

  if (res.status === 403 || res.status === 404) {
    return fetchPlaylistNameOembed(playlistId);
  }
  const name = (res.data as any)?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

export async function fetchMe(accessToken: string) {
  const res = await axios.get("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data as { id: string; display_name?: string };
}

// ---------------------------------------------------------------------------
// Catalog lookups (bulk tracks/artists) for the genre enrichment. Both honour
// Spotify's 429 + Retry-After (development-mode apps get a rolling 30 s
// window) and skip ids Spotify answers null for (unknown/removed ids).
// ---------------------------------------------------------------------------

export type SpotifyTrackMeta = {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  albumName: string | null;
  releaseDate: string | null; // YYYY, YYYY-MM or YYYY-MM-DD as Spotify gives it
  durationMs: number | null;
  imageUrl: string | null; // album image, the 300px one if present
};

export type SpotifyArtistMeta = {
  id: string;
  name: string;
  genres: string[]; // deprecated field: may be [] even for well-known artists
  imageUrl: string | null;
  popularity: number | null;
};

/** Counters for the enrichment report (how often Spotify throttled us). */
export const spotifyStats = { rateLimited: 0 };

const MAX_TRIES = 5;
const DEFAULT_RETRY_AFTER_S = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with bearer auth; on 429 waits Retry-After seconds (default 5) and retries up to MAX_TRIES. */
async function getWithRetry(url: string, accessToken: string, params: Record<string, string>): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
      timeout: 15_000,
      validateStatus: (s) => s === 200 || s === 429,
    });
    if (res.status === 200) return res.data;
    spotifyStats.rateLimited++;
    if (attempt >= MAX_TRIES) throw new Error(`Spotify rate limit: still 429 after ${MAX_TRIES} tries (${url})`);
    const retryAfter = Number(res.headers["retry-after"]);
    const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_S;
    await sleep(waitS * 1000 + 250);
  }
}

/** Album/artist image: the 300px one if present, else the first (largest). */
function pickImage(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const mid = images.find((i: any) => i?.width === 300) ?? images[0];
  return typeof mid?.url === "string" ? mid.url : null;
}

/** GET /v1/tracks?ids= (≤ 50 ids). Unknown ids (null in Spotify's array) are left out of the result. */
export async function fetchTracks(accessToken: string, ids: string[]): Promise<SpotifyTrackMeta[]> {
  if (ids.length === 0) return [];
  if (ids.length > 50) throw new Error("fetchTracks: at most 50 ids per call");
  const data = await getWithRetry("https://api.spotify.com/v1/tracks", accessToken, { ids: ids.join(",") });
  const out: SpotifyTrackMeta[] = [];
  for (const t of (data?.tracks ?? []) as any[]) {
    if (!t || typeof t.id !== "string") continue;
    out.push({
      id: t.id,
      name: typeof t.name === "string" ? t.name : "",
      artists: (Array.isArray(t.artists) ? t.artists : [])
        .filter((a: any) => a && typeof a.id === "string")
        .map((a: any) => ({ id: a.id, name: typeof a.name === "string" ? a.name : "" })),
      albumName: typeof t.album?.name === "string" ? t.album.name : null,
      releaseDate: typeof t.album?.release_date === "string" ? t.album.release_date : null,
      durationMs: typeof t.duration_ms === "number" ? t.duration_ms : null,
      imageUrl: pickImage(t.album?.images),
    });
  }
  return out;
}

/** GET /v1/artists?ids= (≤ 50 ids). Unknown ids are left out of the result. */
export async function fetchArtists(accessToken: string, ids: string[]): Promise<SpotifyArtistMeta[]> {
  if (ids.length === 0) return [];
  if (ids.length > 50) throw new Error("fetchArtists: at most 50 ids per call");
  const data = await getWithRetry("https://api.spotify.com/v1/artists", accessToken, { ids: ids.join(",") });
  const out: SpotifyArtistMeta[] = [];
  for (const a of (data?.artists ?? []) as any[]) {
    if (!a || typeof a.id !== "string") continue;
    out.push({
      id: a.id,
      name: typeof a.name === "string" ? a.name : "",
      genres: Array.isArray(a.genres) ? a.genres.filter((g: unknown) => typeof g === "string") : [],
      imageUrl: pickImage(a.images),
      popularity: typeof a.popularity === "number" ? a.popularity : null,
    });
  }
  return out;
}
