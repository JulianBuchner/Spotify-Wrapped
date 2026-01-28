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

export type CurrentlyPlaying = {
  timestampMs: number;
  isPlaying: boolean;
  progressMs: number | null;
  type: string; // "track" | "episode" | "ad" | ...
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

  return {
    timestampMs: typeof data?.timestamp === "number" ? data.timestamp : Date.now(),
    isPlaying: Boolean(data?.is_playing),
    progressMs: typeof data?.progress_ms === "number" ? data.progress_ms : null,
    type: typeof data?.currently_playing_type === "string" ? data.currently_playing_type : "unknown",
    item: data?.item ?? null,
  };
}

export async function fetchMe(accessToken: string) {
  const res = await axios.get("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data as { id: string; display_name?: string };
}
