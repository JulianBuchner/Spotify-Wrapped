-- CreateTable
CREATE TABLE "Track" (
    "spotifyId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "primaryArtistId" TEXT,
    "artistIds" TEXT NOT NULL,
    "albumName" TEXT,
    "releaseDate" TEXT,
    "durationMs" INTEGER,
    "imageUrl" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Artist" (
    "spotifyId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "genres" TEXT NOT NULL,
    "group" TEXT,
    "imageUrl" TEXT,
    "popularity" INTEGER,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Track_primaryArtistId_idx" ON "Track"("primaryArtistId");

-- CreateIndex
CREATE INDEX "Artist_group_idx" ON "Artist"("group");
