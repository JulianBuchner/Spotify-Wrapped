import { prisma } from "../db";

export interface SongEntry {
  spotifyUri: string;
  trackName: string;
  artistName: string;
  albumName: string | null;
}

interface IndexCache {
  builtAt: number;
  songs: SongEntry[];
  artists: string[];
  albums: { albumName: string; artistName: string }[];
}

let cache: IndexCache | null = null;
const TTL_MS = 5 * 60 * 1000; // rebuild at most every 5 min so new plays show up

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics: "Mötley" -> "motley"
}

/** Iterative two-row Levenshtein distance. */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = new Array(b.length + 1);
  let curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/**
 * Match score in [0,1]. Substring hits rank highest; below that a normalized
 * edit-distance similarity provides typo tolerance. Returns 0 for weak matches.
 */
export function scoreMatch(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  if (!q || !t) return 0;
  if (t === q) return 1;
  if (t.includes(q)) {
    const posBonus = 1 - t.indexOf(q) / (t.length + 1);
    const lenBonus = q.length / t.length;
    return 0.7 + 0.3 * (posBonus * 0.5 + lenBonus * 0.5);
  }
  const distance = lev(q, t);
  const sim = 1 - distance / Math.max(q.length, t.length);
  return sim >= 0.6 ? sim * 0.7 : 0;
}

async function build(): Promise<IndexCache> {
  const rows = await prisma.play.findMany({
    distinct: ["spotifyUri"],
    select: {
      spotifyUri: true,
      trackName: true,
      artistName: true,
      albumName: true,
    },
  });

  const artistSet = new Set<string>();
  const albumMap = new Map<string, string>();
  for (const r of rows) {
    artistSet.add(r.artistName);
    if (r.albumName) albumMap.set(r.albumName, r.artistName);
  }

  cache = {
    builtAt: Date.now(),
    songs: rows.map((r) => ({
      spotifyUri: r.spotifyUri,
      trackName: r.trackName,
      artistName: r.artistName,
      albumName: r.albumName,
    })),
    artists: [...artistSet],
    albums: [...albumMap.entries()].map(([albumName, artistName]) => ({
      albumName,
      artistName,
    })),
  };
  return cache;
}

async function getIndex(): Promise<IndexCache> {
  if (!cache || Date.now() - cache.builtAt > TTL_MS) return build();
  return cache;
}

export interface SearchResults {
  songs: Array<SongEntry & { score: number }>;
  artists: Array<{ artistName: string; score: number }>;
  albums: Array<{ albumName: string; artistName: string; score: number }>;
}

export async function search(
  q: string,
  types: Set<string>,
  limit: number
): Promise<SearchResults> {
  const idx = await getIndex();
  const out: SearchResults = { songs: [], artists: [], albums: [] };

  if (types.has("songs")) {
    out.songs = idx.songs
      .map((s) => ({
        ...s,
        score: Math.max(scoreMatch(q, s.trackName), scoreMatch(q, s.artistName) * 0.6),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  if (types.has("artists")) {
    out.artists = idx.artists
      .map((a) => ({ artistName: a, score: scoreMatch(q, a) }))
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  if (types.has("albums")) {
    out.albums = idx.albums
      .map((a) => ({
        ...a,
        score: Math.max(scoreMatch(q, a.albumName), scoreMatch(q, a.artistName) * 0.5),
      }))
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  return out;
}
