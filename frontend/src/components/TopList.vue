<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getTopAlbums, getTopArtists, getTopPlaylists, getTopSongs } from "../api";
import { formatMs, formatNumber } from "../lib/format";
import { latestGuard } from "../lib/latest";
import type { DateWindow } from "../types";
import ChartCard from "./ChartCard.vue";

const props = defineProps<{ window: DateWindow; playlist?: string }>();

type Entity = "songs" | "artists" | "albums" | "playlists";

interface Row {
  key: string;
  primary: string;
  secondary: string;
  streams: number;
  playtimeMs: number;
}

const entity = ref<Entity>("songs");
const rows = ref<Row[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const TABS: Array<{ value: Entity; label: string }> = [
  { value: "songs", label: "Songs" },
  { value: "artists", label: "Artists" },
  { value: "albums", label: "Albums" },
  { value: "playlists", label: "Playlists" },
];

const guard = latestGuard();
async function load() {
  const isLatest = guard();
  loading.value = true;
  error.value = null;
  try {
    if (entity.value === "songs") {
      const res = await getTopSongs(props.window, 10, props.playlist);
      if (!isLatest()) return;
      rows.value = res.data.map((s) => ({
        key: s.spotifyUri,
        primary: s.trackName,
        secondary: s.artistName,
        streams: s.streams,
        playtimeMs: s.playtimeMs,
      }));
    } else if (entity.value === "artists") {
      const res = await getTopArtists(props.window, 10, props.playlist);
      if (!isLatest()) return;
      rows.value = res.data.map((a) => ({
        key: a.artistName,
        primary: a.artistName,
        secondary: "",
        streams: a.streams,
        playtimeMs: a.playtimeMs,
      }));
    } else if (entity.value === "albums") {
      const res = await getTopAlbums(props.window, 10, props.playlist);
      if (!isLatest()) return;
      rows.value = res.data.map((a) => ({
        key: a.albumName,
        primary: a.albumName,
        secondary: a.artistName,
        streams: a.streams,
        playtimeMs: a.playtimeMs,
      }));
    } else {
      const res = await getTopPlaylists(props.window);
      if (!isLatest()) return;
      rows.value = res.data.map((p) => ({
        key: p.playlistUri,
        primary: p.playlistName ?? "Unknown playlist",
        secondary: "",
        streams: p.streams,
        playtimeMs: p.playtimeMs,
      }));
    }
  } catch (e) {
    if (isLatest()) error.value = e instanceof Error ? e.message : "Failed to load top list.";
  } finally {
    if (isLatest()) loading.value = false;
  }
}

watch([() => props.window, () => props.playlist, entity], load, { immediate: true, deep: true });

const maxStreams = computed(() => Math.max(1, ...rows.value.map((r) => r.streams)));
</script>

<template>
  <ChartCard title="Top 10" subtitle="Ranked by streams" :loading="loading" :error="error">
    <template #actions>
      <div class="mini-tabs" role="tablist" aria-label="Top list entity">
        <button
          v-for="t in TABS"
          :key="t.value"
          type="button"
          role="tab"
          class="mini-tab"
          :class="{ active: entity === t.value }"
          :aria-selected="entity === t.value"
          @click="entity = t.value"
        >
          {{ t.label }}
        </button>
      </div>
    </template>

    <ol class="top-list">
      <li v-for="(r, i) in rows" :key="r.key" class="top-row">
        <span class="rank">{{ i + 1 }}</span>
        <span class="names">
          <span class="primary" :title="r.primary">{{ r.primary }}</span>
          <span v-if="r.secondary" class="secondary" :title="r.secondary">{{ r.secondary }}</span>
          <span class="meter" aria-hidden="true">
            <span class="meter-fill" :style="{ width: (r.streams / maxStreams) * 100 + '%' }" />
          </span>
        </span>
        <span class="numbers">
          <span class="streams">{{ formatNumber(r.streams) }}</span>
          <span class="playtime">{{ formatMs(r.playtimeMs) }}</span>
        </span>
      </li>
      <li v-if="!rows.length && !loading" class="empty">
        {{
          entity === "playlists"
            ? "No playlist plays recorded yet — tracking starts with new plays."
            : "No plays in this range."
        }}
      </li>
    </ol>
  </ChartCard>
</template>

<style scoped>
.mini-tabs {
  display: inline-flex;
  background: var(--bg-surface-2);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}
.mini-tab {
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.mini-tab:hover {
  color: var(--text-1);
}
.mini-tab.active {
  background: var(--bg-surface);
  color: var(--text-1);
  font-weight: 600;
  box-shadow: var(--shadow-card);
}
.mini-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.top-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.top-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--grid);
}
.top-row:last-of-type {
  border-bottom: none;
}
.rank {
  flex: 0 0 22px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.names {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.primary {
  font-size: 13.5px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.secondary {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meter {
  margin-top: 4px;
  height: 3px;
  border-radius: 2px;
  background: var(--bg-surface-2);
  overflow: hidden;
}
.meter-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--series);
}
.numbers {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  flex-shrink: 0;
}
.streams {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.playtime {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.empty {
  padding: 16px 0;
  color: var(--text-3);
  font-size: 13px;
}
</style>
