import dotenv from "dotenv";
import readline from "readline";
import axios from "axios";
import { prisma } from "./db";
import { fetchMe } from "./spotify";

dotenv.config();

const clientId = process.env.SPOTIFY_CLIENT_ID!;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
const redirectUri = process.env.SPOTIFY_REDIRECT_URI!;

if (!clientId || !clientSecret || !redirectUri) {
  throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REDIRECT_URI in .env");
}

const scope = "user-read-recently-played user-read-playback-state user-read-currently-playing";

async function main() {
  const authUrl =
    "https://accounts.spotify.com/authorize?" +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
    }).toString();

  console.log("Open this URL in your browser, approve access:");
  console.log(authUrl);
  console.log("");
  console.log("After approval, you will be redirected to:");
  console.log(`${redirectUri}?code=...`);
  console.log("Copy the code value and paste it here.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Paste "code": ', async (code) => {
    rl.close();

    try {
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      const tokenRes = await axios.post(
        "https://accounts.spotify.com/api/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          code: code.trim(),
          redirect_uri: redirectUri,
        }),
        {
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const { access_token, refresh_token, expires_in } = tokenRes.data as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      const me = await fetchMe(access_token);

      const user = await prisma.user.upsert({
        where: { spotifyUserId: me.id },
        update: { displayName: me.display_name ?? null },
        create: { spotifyUserId: me.id, displayName: me.display_name ?? null },
      });

      await prisma.spotifyAccount.upsert({
        where: { userId: user.id },
        update: {
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        },
        create: {
          userId: user.id,
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        },
      });

      console.log("Saved Spotify tokens for userId=", user.id);
      console.log("Now run: npm run dev  (or deploy to Pi and run pm2)");
    } finally {
      await prisma.$disconnect();
    }
  });
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
