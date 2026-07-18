<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { getHistoryPoints } from "../api";
import DateRangeFilter from "../components/DateRangeFilter.vue";
import ListeningCloud from "../components/ListeningCloud.vue";
import { formatNumber } from "../lib/format";
import type { DateWindow, PlayPoint } from "../types";

const window_ = ref<DateWindow>({ range: "all_time", from: "", to: "" });
const highlight = ref("");

const points = ref<PlayPoint[]>([]);
const loading = ref(false);
const errorMsg = ref<string | null>(null);

const cloud = ref<InstanceType<typeof ListeningCloud> | null>(null);

async function load() {
  loading.value = true;
  errorMsg.value = null;
  try {
    const res = await getHistoryPoints(window_.value);
    points.value = res.data.map((r) => {
      const ts = new Date(r.playedAt).getTime();
      const d = new Date(ts);
      const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      return { ts, hour, artist: r.artistName, track: r.trackName, ms: r.durationMs };
    });
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "Failed to load points.";
    points.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(window_, load, { deep: true });
</script>

<template>
  <div class="cloud-page">
    <div class="cloud-toolbar">
      <DateRangeFilter v-model="window_" />
      <div class="toolbar-right">
        <input
          v-model="highlight"
          class="input highlight-input"
          type="search"
          placeholder="Highlight artist or track…"
          aria-label="Highlight artist or track"
        />
        <button type="button" class="btn" :disabled="!points.length" @click="cloud?.resetView()">
          Reset view
        </button>
      </div>
    </div>

    <section class="card cloud-card" :class="{ dimmed: loading }">
      <header class="cloud-header">
        <div>
          <h3 class="cloud-title">Listening cloud</h3>
          <p class="cloud-subtitle">
            Each dot is one play — x is the date, y the time of day. Drag to pan, scroll to zoom,
            hover for details.
          </p>
        </div>
        <span v-if="points.length" class="count-chip">
          {{ formatNumber(points.length) }} plays
        </span>
      </header>

      <p v-if="errorMsg" class="cloud-error">{{ errorMsg }}</p>
      <p v-else-if="!loading && points.length === 0" class="cloud-empty">No plays in this range.</p>

      <div v-else class="cloud-plot">
        <ListeningCloud ref="cloud" :points="points" :highlight="highlight" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.cloud-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.cloud-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.highlight-input {
  width: 260px;
}

.cloud-card {
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
  gap: 12px;
  transition: opacity 0.2s;
}
.dimmed {
  opacity: 0.55;
}

.cloud-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.cloud-title {
  font-size: 14px;
  font-weight: 600;
}
.cloud-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
.count-chip {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  padding: 3px 10px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}

.cloud-plot {
  height: calc(100vh - 280px);
  min-height: 380px;
}

.cloud-error {
  margin: 8px 0;
  font-size: 13px;
  color: var(--danger);
}
.cloud-empty {
  margin: 8px 0;
  font-size: 13px;
  color: var(--text-3);
}
</style>
