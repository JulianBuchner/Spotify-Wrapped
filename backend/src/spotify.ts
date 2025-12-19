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

export async function fetchRecentlyPlayed(accessToken: string, afterMs?: bigint) {
  const params: Record<string, any> = { limit: 50 };
  if (afterMs) params.after = afterMs.toString();

  const res = await axios.get("https://api.spotify.com/v1/me/player/recently-played", {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
  });

  return res.data.items as Array<{
    played_at: string;
    track: {
      id?: string | null;
      uri: string;
      name: string;
      artists: { name: string }[];
      album?: { name: string };
      duration_ms: number;
    };
  }>;
}

export async function fetchMe(accessToken: string) {
  const res = await axios.get("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data as { id: string; display_name?: string };
}
