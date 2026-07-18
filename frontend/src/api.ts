const API = import.meta.env.VITE_API_BASE_URL;

function buildQuery(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    const trimmed = value.trim();
    if (trimmed) search.set(key, trimmed);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export async function getHealth() {
  const res = await fetch(`${API}/health`);
  return res.json();
}

export async function getPlayCount() {
  const res = await fetch(`${API}/api/plays/count`);
  return res.json();
}

export async function getArtistStats(name: string, from?: string, to?: string) {
  const qs = buildQuery({ name, from, to });
  const res = await fetch(`${API}/api/stats/artist${qs}`);
  return res.json();
}

export async function getUniqueTracks(from?: string, to?: string) {
  const qs = buildQuery({ from, to });
  const res = await fetch(`${API}/api/stats/unique-tracks${qs}`);
  return res.json();
}

export async function getListenTime(from?: string, to?: string) {
  const qs = buildQuery({ from, to });
  const res = await fetch(`${API}/api/stats/listen-time${qs}`);
  return res.json();
}

// --- Generic getter for the new endpoints (used by the test components) ---

export type QueryValue = string | number | undefined;

export async function apiGet(
  path: string,
  params: Record<string, QueryValue> = {}
) {
  const stringParams: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    stringParams[key] = value === undefined ? undefined : String(value);
  }
  const res = await fetch(`${API}${path}${buildQuery(stringParams)}`);
  try {
    return await res.json();
  } catch {
    return { error: `HTTP ${res.status}` };
  }
}
