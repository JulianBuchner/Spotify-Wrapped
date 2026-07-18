<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getPlaylists } from "../api";
import type { PlaylistInfo } from "../types";

// Model value is the playlist contextUri; "" = all playlists.
const model = defineModel<string>({ required: true });

const playlists = ref<PlaylistInfo[]>([]);

onMounted(async () => {
  try {
    const res = await getPlaylists();
    playlists.value = res.data;
  } catch {
    playlists.value = [];
  }
});

function label(p: PlaylistInfo) {
  return p.playlistName ?? "Unknown playlist";
}
</script>

<template>
  <!-- Hidden until at least one play has playlist context recorded. -->
  <label v-if="playlists.length" class="playlist-filter">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <line x1="2.5" y1="4" x2="13.5" y2="4" />
        <line x1="2.5" y1="8" x2="10" y2="8" />
        <line x1="2.5" y1="12" x2="7" y2="12" />
      </g>
      <path d="M11 12.6a1.6 1.6 0 1 0 3.2 0V7.5l1.3.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
    <select v-model="model" class="select" aria-label="Filter by playlist">
      <option value="">All playlists</option>
      <option v-for="p in playlists" :key="p.playlistUri" :value="p.playlistUri">
        {{ label(p) }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.playlist-filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
}
.icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.select {
  max-width: 240px;
  text-overflow: ellipsis;
}
</style>
