<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getForgotten } from "../api";
import { formatNumber } from "../lib/format";
import type { ForgottenTrack } from "../types";
import ChartCard from "./ChartCard.vue";

const rows = ref<ForgottenTrack[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  loading.value = true;
  try {
    const res = await getForgotten(10);
    rows.value = res.data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load forgotten tracks.";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <ChartCard
    title="Forgotten favorites"
    subtitle="Heavily played before, silent for 30+ days"
    :loading="loading"
    :error="error"
  >
    <ul class="forgotten-list">
      <li v-for="r in rows" :key="r.spotifyUri" class="forgotten-row">
        <span class="names">
          <span class="track" :title="r.trackName">{{ r.trackName }}</span>
          <span class="meta" :title="r.artistName">{{ r.artistName }}</span>
        </span>
        <span class="numbers">
          <span class="streams">{{ formatNumber(r.historicStreams) }} plays</span>
          <span class="last">{{ r.daysSinceLast }}d ago</span>
        </span>
      </li>
      <li v-if="!rows.length && !loading" class="empty">Nothing forgotten yet.</li>
    </ul>
  </ChartCard>
</template>

<style scoped>
.forgotten-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.forgotten-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--grid);
}
.forgotten-row:last-of-type {
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
.numbers {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  flex-shrink: 0;
}
.streams {
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.last {
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
