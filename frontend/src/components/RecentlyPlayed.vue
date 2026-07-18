<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getRecentlyPlayed } from "../api";
import { formatAgo } from "../lib/format";
import type { RecentPlay } from "../types";
import ChartCard from "./ChartCard.vue";

const rows = ref<RecentPlay[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let timer = 0;

async function load() {
  loading.value = rows.value.length === 0;
  error.value = null;
  try {
    const res = await getRecentlyPlayed(12);
    rows.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load recent plays.";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  timer = window.setInterval(load, 60_000);
});
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<template>
  <ChartCard
    title="Recently played"
    subtitle="Latest plays, refreshed every minute"
    :loading="loading"
    :error="error"
  >
    <ul class="recent-list">
      <li v-for="r in rows" :key="r.playedAt + r.spotifyUri" class="recent-row">
        <span class="names">
          <span class="track" :title="r.trackName">{{ r.trackName }}</span>
          <span class="meta" :title="`${r.artistName} · ${r.albumName}`">
            {{ r.artistName }} · {{ r.albumName }}
          </span>
        </span>
        <span class="ago">{{ formatAgo(r.playedAt) }}</span>
      </li>
      <li v-if="!rows.length && !loading" class="empty">No plays yet.</li>
    </ul>
  </ChartCard>
</template>

<style scoped>
.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.recent-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--grid);
}
.recent-row:last-of-type {
  border-bottom: none;
}
.names {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.track {
  font-size: 13.5px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ago {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.empty {
  padding: 16px 0;
  color: var(--text-3);
  font-size: 13px;
}
</style>
