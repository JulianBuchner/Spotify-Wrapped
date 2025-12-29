/*
  Warnings:

  - The primary key for the `Play` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `SpotifyAccount` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Play" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "spotifyUri" TEXT NOT NULL,
    "spotifyId" TEXT,
    "trackName" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "albumName" TEXT,
    "playedAt" DATETIME NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'api',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Play_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Play" ("albumName", "artistName", "createdAt", "durationMs", "id", "playedAt", "source", "spotifyId", "spotifyUri", "trackName", "userId") SELECT "albumName", "artistName", "createdAt", "durationMs", "id", "playedAt", "source", "spotifyId", "spotifyUri", "trackName", "userId" FROM "Play";
DROP TABLE "Play";
ALTER TABLE "new_Play" RENAME TO "Play";
CREATE INDEX "Play_userId_playedAt_idx" ON "Play"("userId", "playedAt");
CREATE UNIQUE INDEX "Play_userId_playedAt_spotifyUri_key" ON "Play"("userId", "playedAt", "spotifyUri");
CREATE TABLE "new_SpotifyAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME NOT NULL,
    "lastAfterMs" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpotifyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SpotifyAccount" ("accessToken", "createdAt", "id", "lastAfterMs", "refreshToken", "tokenExpiresAt", "updatedAt", "userId") SELECT "accessToken", "createdAt", "id", "lastAfterMs", "refreshToken", "tokenExpiresAt", "updatedAt", "userId" FROM "SpotifyAccount";
DROP TABLE "SpotifyAccount";
ALTER TABLE "new_SpotifyAccount" RENAME TO "SpotifyAccount";
CREATE UNIQUE INDEX "SpotifyAccount_userId_key" ON "SpotifyAccount"("userId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spotifyUserId" TEXT,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "displayName", "email", "id", "spotifyUserId") SELECT "createdAt", "displayName", "email", "id", "spotifyUserId" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_spotifyUserId_key" ON "User"("spotifyUserId");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
