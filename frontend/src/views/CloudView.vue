<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, watch } from "vue";
import { getHistoryPoints, isFetching } from "../api";
import DateRangeFilter from "../components/DateRangeFilter.vue";
import ListeningCloud from "../components/ListeningCloud.vue";
import PlaylistFilter from "../components/PlaylistFilter.vue";
import Skeleton from "../components/Skeleton.vue";
import { formatNumber } from "../lib/format";
import { latestGuard } from "../lib/latest";
import type { DateWindow, PlayPoint } from "../types";

const window_ = ref<DateWindow>({ range: "this_week", from: "", to: "" });
const playlist = ref(""); // contextUri; "" = all — note: only new plays carry context

// The typed text debounces into `highlight` so the canvas doesn't recompute
// its match mask and repaint 190k dots on every keystroke.
const highlightInput = ref("");
const highlight = ref("");
let highlightTimer = 0;
watch(highlightInput, (v) => {
  window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => {
    highlight.value = v;
  }, 150);
});
onBeforeUnmount(() => window.clearTimeout(highlightTimer));

// shallowRef: the array is huge and immutable once loaded — deep reactivity
// would wrap every point in a proxy for no benefit.
const points = shallowRef<PlayPoint[]>([]);
const loading = ref(false);
const errorMsg = ref<string | null>(null);

const cloud = ref<InstanceType<typeof ListeningCloud> | null>(null);

const guard = latestGuard();
async function load() {
  const isLatest = guard();
  loading.value = true;
  errorMsg.value = null;
  try {
    const res = await getHistoryPoints(window_.value, playlist.value);
    if (!isLatest()) return;
    // columnar payload -> point objects (hour in local time, like before)
    const { t, track, artist, playlist: pl } = res.data;
    const n = t.length;
    const pts: PlayPoint[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const ts = t[i]!;
      const d = new Date(ts);
      const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      pts[i] = { ts, hour, artist: artist[i]!, track: track[i]!, playlist: pl[i] ?? null };
    }
    points.value = pts;
  } catch (e) {
    if (isLatest()) {
      errorMsg.value = e instanceof Error ? e.message : "Failed to load points.";
      points.value = [];
    }
  } finally {
    if (isLatest()) loading.value = false;
  }
}

onMounted(load);
watch([window_, playlist], load, { deep: true });
</script>

<template>
  <div class="cloud-page">
    <div class="cloud-toolbar">
      <div class="toolbar-left">
        <DateRangeFilter v-model="window_" :busy="isFetching" />
        <PlaylistFilter v-model="playlist" :window="window_" />
      </div>
      <div class="toolbar-right">
        <input
          v-model="highlightInput"
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

    <section
      class="card cloud-card"
      :class="{ dimmed: loading && points.length > 0 }"
      :aria-busy="loading || undefined"
    >
      <span v-if="loading && points.length" class="loading-bar" aria-hidden="true" />
      <header class="cloud-header">
        <div>
          <h3 class="cloud-title">Listening cloud</h3>
          <p class="cloud-subtitle">
            <span class="hint-long">
              Each dot is one play — x is the date, y the time of day. Drag to pan, scroll to zoom,
              hover for details.
            </span>
            <span class="hint-short">One dot per play: x date, y time of day. Drag to pan, tap for details.</span>
          </p>
        </div>
        <div class="header-right">
          <span v-if="loading && points.length" class="loading-chip" role="status">Loading…</span>
          <span v-if="points.length" class="count-chip">
            {{ formatNumber(points.length) }} plays
          </span>
        </div>
      </header>

      <p v-if="errorMsg" class="cloud-error">{{ errorMsg }}</p>
      <p v-else-if="!loading && points.length === 0" class="cloud-empty">No plays in this range.</p>

      <div v-else-if="loading && points.length === 0" class="cloud-plot cloud-plot-loading">
        <Skeleton kind="block" />
        <p class="cloud-loading-text" role="status">Loading plays…</p>
      </div>

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
.toolbar-left {
  display: flex;
  align-items: center;
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
  position: relative;
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
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
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
  height: calc(100svh - 280px); /* small viewport height: ignores the mobile browser chrome */
  min-height: 380px;
}
.hint-short {
  display: none;
}

.cloud-plot-loading {
  position: relative;
}
.cloud-loading-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  font-size: 13px;
  color: var(--text-3);
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

/* narrow ≤ 900px: toolbar halves stack (breakpoints: 640 phone, 900 narrow, 1024 tablet) */
@media (max-width: 900px) {
  .cloud-plot {
    height: calc(100svh - 340px);
    min-height: 340px;
  }
}

/* phone ≤ 640px: search + Reset share one full-width row, shorter hint, taller plot floor */
@media (max-width: 640px) {
  .cloud-page {
    gap: 12px;
  }
  .cloud-toolbar,
  .toolbar-left {
    gap: 10px;
  }
  .toolbar-left,
  .toolbar-right {
    width: 100%;
  }
  .toolbar-right {
    flex-wrap: wrap;
  }
  .highlight-input {
    flex: 1 1 160px;
    width: auto;
    min-width: 0;
  }
  .cloud-card {
    padding: 12px;
    gap: 10px;
  }
  .cloud-header > div:first-child {
    min-width: 0; /* the hint wraps; the plays chip keeps its place on the title row */
  }
  .hint-long {
    display: none;
  }
  .hint-short {
    display: inline;
  }
  .cloud-plot {
    height: calc(100svh - 400px);
    min-height: 320px;
  }
}
</style>
