<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  getDiscovery,
  getListeningByWeekday,
  getListeningClock,
  getStreamsOverTime,
  getSummary,
} from "../api";
import ChartCard from "../components/ChartCard.vue";
import ColumnChart, { type ColumnPoint } from "../components/ColumnChart.vue";
import DateRangeFilter from "../components/DateRangeFilter.vue";
import ForgottenList from "../components/ForgottenList.vue";
import PlaylistFilter from "../components/PlaylistFilter.vue";
import RecentlyPlayed from "../components/RecentlyPlayed.vue";
import StatCard from "../components/StatCard.vue";
import TimeSeriesChart, { type SeriesPoint } from "../components/TimeSeriesChart.vue";
import TopList from "../components/TopList.vue";
import {
  formatBucket,
  formatCompact,
  formatMs,
  formatMsCompact,
  formatNumber,
} from "../lib/format";
import { latestGuard } from "../lib/latest";
import type { DateWindow, Granularity, StatsSummary } from "../types";

// Default to "today": the cheapest window (index-backed) so the first paint
// is instant; all-time is one click away.
const window_ = ref<DateWindow>({ range: "today", from: "", to: "" });

// Playlist contextUri filter; "" = all. Scopes every chart and list below the
// filter row. Only plays recorded since playlist tracking went live carry
// context, so older plays disappear from view while this filter is active.
const playlist = ref("");

/** Bucket size for the time charts, derived from the active window. */
const granularity = computed<Granularity>(() => {
  const w = window_.value;
  switch (w.range) {
    case "today":
    case "last_week":
    case "last_30_days":
      return "day";
    case "ytd":
      return "week";
    case "last_year":
      return "week";
    case "all_time":
      return "month";
  }
  // custom range: derive from span
  if (w.from && w.to) {
    const days = (new Date(w.to).getTime() - new Date(w.from).getTime()) / 86_400_000;
    if (days <= 31) return "day";
    if (days <= 200) return "week";
  } else if (w.from || w.to) {
    return "month";
  }
  return "month";
});

// --- summary tiles ---
const summary = ref<StatsSummary | null>(null);
const summaryLoading = ref(false);

// --- streams over time ---
const metric = ref<"streams" | "playtime">("streams");
const streamsSeries = ref<SeriesPoint[]>([]);
const streamsLoading = ref(false);
const streamsError = ref<string | null>(null);

// --- listening clock / weekday ---
const clockData = ref<ColumnPoint[]>([]);
const clockLoading = ref(false);
const clockError = ref<string | null>(null);

const weekdayData = ref<ColumnPoint[]>([]);
const weekdayLoading = ref(false);
const weekdayError = ref<string | null>(null);

// --- discovery ---
const discoverySeries = ref<SeriesPoint[]>([]);
const discoveryLoading = ref(false);
const discoveryError = ref<string | null>(null);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

// Loads can overlap (a window change fires immediately, then the playlist
// filter may reset asynchronously and fire again) — each loader only applies
// the response of its latest request.
const summaryGuard = latestGuard();
async function loadSummary() {
  const isLatest = summaryGuard();
  summaryLoading.value = true;
  try {
    const res = await getSummary(window_.value, playlist.value);
    if (!isLatest()) return;
    summary.value = res.data;
  } catch {
    if (isLatest()) summary.value = null;
  } finally {
    if (isLatest()) summaryLoading.value = false;
  }
}

const streamsGuard = latestGuard();
async function loadStreams() {
  const isLatest = streamsGuard();
  streamsLoading.value = true;
  streamsError.value = null;
  try {
    const res = await getStreamsOverTime(
      window_.value,
      granularity.value,
      metric.value,
      playlist.value
    );
    if (!isLatest()) return;
    streamsSeries.value = res.data.map((d) => ({
      label: formatBucket(d.bucket, granularity.value),
      // playtime arrives as ms — plot hours so the axis stays readable
      value: metric.value === "playtime" ? Math.round(d.value / 3_600_000) : d.value,
    }));
  } catch (e) {
    if (isLatest()) streamsError.value = e instanceof Error ? e.message : "Failed to load.";
  } finally {
    if (isLatest()) streamsLoading.value = false;
  }
}

const clockGuard = latestGuard();
async function loadClock() {
  const isLatest = clockGuard();
  clockLoading.value = true;
  clockError.value = null;
  try {
    const res = await getListeningClock(window_.value, playlist.value);
    if (!isLatest()) return;
    clockData.value = res.data.map((d) => ({
      label: `${d.hour}`,
      tooltipLabel: `${String(d.hour).padStart(2, "0")}:00–${String(d.hour).padStart(2, "0")}:59`,
      value: d.value,
    }));
  } catch (e) {
    if (isLatest()) clockError.value = e instanceof Error ? e.message : "Failed to load.";
  } finally {
    if (isLatest()) clockLoading.value = false;
  }
}

const weekdayGuard = latestGuard();
async function loadWeekday() {
  const isLatest = weekdayGuard();
  weekdayLoading.value = true;
  weekdayError.value = null;
  try {
    const res = await getListeningByWeekday(window_.value, playlist.value);
    if (!isLatest()) return;
    const byDay = new Map(res.data.map((d) => [d.weekday, d.value]));
    weekdayData.value = WEEKDAY_ORDER.map((d) => ({
      label: WEEKDAYS[d] ?? "",
      value: byDay.get(d) ?? 0,
    }));
  } catch (e) {
    if (isLatest()) weekdayError.value = e instanceof Error ? e.message : "Failed to load.";
  } finally {
    if (isLatest()) weekdayLoading.value = false;
  }
}

const discoveryGuard = latestGuard();
async function loadDiscovery() {
  const isLatest = discoveryGuard();
  discoveryLoading.value = true;
  discoveryError.value = null;
  try {
    const res = await getDiscovery(window_.value, granularity.value, playlist.value);
    if (!isLatest()) return;
    discoverySeries.value = res.data.map((d) => ({
      label: formatBucket(d.bucket, granularity.value),
      value: d.cumulative,
    }));
  } catch (e) {
    if (isLatest()) discoveryError.value = e instanceof Error ? e.message : "Failed to load.";
  } finally {
    if (isLatest()) discoveryLoading.value = false;
  }
}

function loadAll() {
  loadSummary();
  loadStreams();
  loadClock();
  loadWeekday();
  loadDiscovery();
}

watch([window_, playlist], loadAll, { immediate: true, deep: true });
watch(metric, loadStreams);

const playtimeHoursLabel = computed(() => (n: number) => `${formatNumber(n)}h`);
</script>

<template>
  <div class="dashboard">
    <div class="filter-row">
      <DateRangeFilter v-model="window_" />
      <PlaylistFilter v-model="playlist" :window="window_" />
    </div>

    <div class="kpi-row">
      <StatCard
        label="Streams"
        :value="summary ? formatCompact(summary.totalStreams) : null"
        :sub="summary ? `${formatNumber(summary.totalStreams)} plays` : undefined"
        :loading="summaryLoading"
      />
      <StatCard
        label="Listening time"
        :value="summary ? formatMsCompact(summary.totalPlaytimeMs) : null"
        :sub="summary ? `≈ ${(summary.totalPlaytimeMs / 86_400_000).toFixed(1)} days` : undefined"
        :loading="summaryLoading"
      />
      <StatCard
        label="Per day"
        :value="summary ? formatMs(summary.avgPlaytimePerDayMs) : null"
        sub="average playtime"
        :loading="summaryLoading"
      />
      <StatCard
        label="Tracks"
        :value="summary ? formatCompact(summary.distinctTracks) : null"
        sub="distinct"
        :loading="summaryLoading"
      />
      <StatCard
        label="Artists"
        :value="summary ? formatCompact(summary.distinctArtists) : null"
        sub="distinct"
        :loading="summaryLoading"
      />
      <StatCard
        label="Albums"
        :value="summary ? formatCompact(summary.distinctAlbums) : null"
        sub="distinct"
        :loading="summaryLoading"
      />
    </div>

    <div class="grid">
      <div class="span-12">
        <ChartCard
          title="Listening over time"
          :subtitle="metric === 'streams' ? 'Streams per ' + granularity : 'Hours listened per ' + granularity"
          :loading="streamsLoading"
          :error="streamsError"
        >
          <template #actions>
            <div class="mini-tabs" role="tablist" aria-label="Metric">
              <button
                type="button"
                role="tab"
                class="mini-tab"
                :class="{ active: metric === 'streams' }"
                :aria-selected="metric === 'streams'"
                @click="metric = 'streams'"
              >
                Streams
              </button>
              <button
                type="button"
                role="tab"
                class="mini-tab"
                :class="{ active: metric === 'playtime' }"
                :aria-selected="metric === 'playtime'"
                @click="metric = 'playtime'"
              >
                Playtime
              </button>
            </div>
          </template>
          <TimeSeriesChart
            :data="streamsSeries"
            :height="280"
            :format-value="metric === 'playtime' ? playtimeHoursLabel : undefined"
            aria-label="Listening over time"
          />
        </ChartCard>
      </div>

      <div class="span-7">
        <ChartCard
          title="Listening clock"
          subtitle="Streams by hour of day"
          :loading="clockLoading"
          :error="clockError"
        >
          <ColumnChart :data="clockData" :height="230" :label-every="3" aria-label="Streams by hour of day" />
        </ChartCard>
      </div>
      <div class="span-5">
        <ChartCard
          title="Weekday rhythm"
          subtitle="Streams by day of week"
          :loading="weekdayLoading"
          :error="weekdayError"
        >
          <ColumnChart :data="weekdayData" :height="230" aria-label="Streams by day of week" />
        </ChartCard>
      </div>

      <div class="span-7">
        <TopList :window="window_" :playlist="playlist" />
      </div>
      <div class="span-5">
        <RecentlyPlayed />
      </div>

      <div class="span-7">
        <ChartCard
          title="Discovery"
          subtitle="Cumulative first-time tracks heard"
          :loading="discoveryLoading"
          :error="discoveryError"
        >
          <TimeSeriesChart :data="discoverySeries" :height="240" aria-label="Cumulative discovered tracks" />
        </ChartCard>
      </div>
      <div class="span-5">
        <ForgottenList />
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 14px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 14px;
  align-items: stretch;
}
.span-12 {
  grid-column: span 12;
}
.span-7 {
  grid-column: span 7;
  min-width: 0;
}
.span-5 {
  grid-column: span 5;
  min-width: 0;
}
.span-7 > *,
.span-5 > * {
  height: 100%;
}

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
</style>
