<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import {
  getHistoryPoints,
  getRecordHighlights,
  getStreamsByArtist,
  getSummary,
  getTopArtistPerYear,
  getWearOut,
  getWeekHourGrid,
  isFetching,
  type Metric,
} from "../api";
import ChartCard from "../components/ChartCard.vue";
import DateRangeFilter from "../components/DateRangeFilter.vue";
import HeatmapGrid from "../components/HeatmapGrid.vue";
import PlaylistFilter from "../components/PlaylistFilter.vue";
import RecordChart, { type RecordPoint } from "../components/RecordChart.vue";
import StackedColumnChart, { type StackedSeries } from "../components/StackedColumnChart.vue";
import StatCard from "../components/StatCard.vue";
import TimeSeriesChart, { type SeriesPoint } from "../components/TimeSeriesChart.vue";
import YearStrip from "../components/YearStrip.vue";
import {
  formatBucket,
  formatCompact,
  formatDate,
  formatMs,
  formatNumber,
  ordinal,
} from "../lib/format";
import { granularityFor } from "../lib/granularity";
import { latestGuard } from "../lib/latest";
import { artistColor, otherColor } from "../lib/palette";
import { useTheme } from "../theme";
import type {
  ArtistSeries,
  DateWindow,
  RecordHighlights,
  StatsSummary,
  WearOut,
  WeekHourCell,
  YearTopArtist,
} from "../types";

// The record is a long-term story: default to all time (the points endpoint
// is prewarmed for it on the server).
const window_ = ref<DateWindow>({ range: "all_time", from: "", to: "" });
const playlist = ref("");
const { theme } = useTheme();

const granularity = computed(() => granularityFor(window_.value));
const TOP_N = 10;
// The one ranking behind the disc colours, the legend, the stacked chart and
// the year strip. Hours by default (the poster's choice); the dashboard's Top 10
// ranks by streams, so the toggle makes the difference explicit.
const rankMetric = ref<Metric>("playtime");
const record = ref<InstanceType<typeof RecordChart> | null>(null);

// --- summary (title / subtitle numbers) ---
const summary = ref<StatsSummary | null>(null);

// --- highlights ---
const highlights = ref<RecordHighlights | null>(null);
const highlightsLoading = ref(false);

// --- record disc (history points) ---
const points = shallowRef<RecordPoint[]>([]);
const pointsLoading = ref(false);
const pointsError = ref<string | null>(null);
const pointsSpan = ref<{ first: number; last: number } | null>(null);

// --- heatmap ---
const heatMetric = ref<Metric>("streams");
const heatCells = ref<WeekHourCell[]>([]);
const heatLoading = ref(false);
const heatError = ref<string | null>(null);

// --- stacked by artist (hours) ---
const artistSeries = ref<ArtistSeries | null>(null);
const artistLoading = ref(false);
const artistError = ref<string | null>(null);

// --- wear-out ---
const wearOut = ref<WearOut | null>(null);
const wearLoading = ref(false);
const wearError = ref<string | null>(null);

// --- #1 per year ---
const years = ref<YearTopArtist[]>([]);
const yearsLoading = ref(false);
const yearsError = ref<string | null>(null);

const summaryGuard = latestGuard();
async function loadSummary() {
  const isLatest = summaryGuard();
  try {
    const res = await getSummary(window_.value, playlist.value);
    if (isLatest()) summary.value = res.data;
  } catch {
    if (isLatest()) summary.value = null;
  }
}

const highlightsGuard = latestGuard();
async function loadHighlights() {
  const isLatest = highlightsGuard();
  highlightsLoading.value = true;
  try {
    const res = await getRecordHighlights(window_.value, playlist.value);
    if (!isLatest()) return;
    highlights.value = res.data;
  } catch {
    if (isLatest()) highlights.value = null;
  } finally {
    if (isLatest()) highlightsLoading.value = false;
  }
}

const pointsGuard = latestGuard();
async function loadPoints() {
  const isLatest = pointsGuard();
  pointsLoading.value = true;
  pointsError.value = null;
  try {
    const res = await getHistoryPoints(window_.value, playlist.value);
    if (!isLatest()) return;
    const { t, d, artist } = res.data;
    const n = t.length;
    const pts: RecordPoint[] = new Array(n);
    for (let i = 0; i < n; i++) pts[i] = { t: t[i]!, d: d?.[i] ?? 0, artist: artist[i]! };
    points.value = pts;
    pointsSpan.value = n ? { first: t[0]!, last: t[n - 1]! } : null;
  } catch (e) {
    if (isLatest()) {
      pointsError.value = e instanceof Error ? e.message : "Failed to load.";
      points.value = [];
      pointsSpan.value = null;
    }
  } finally {
    if (isLatest()) pointsLoading.value = false;
  }
}

const heatGuard = latestGuard();
async function loadHeat() {
  const isLatest = heatGuard();
  heatLoading.value = true;
  heatError.value = null;
  try {
    const res = await getWeekHourGrid(window_.value, playlist.value, heatMetric.value);
    if (!isLatest()) return;
    heatCells.value = res.data;
  } catch (e) {
    if (isLatest()) heatError.value = e instanceof Error ? e.message : "Failed to load.";
  } finally {
    if (isLatest()) heatLoading.value = false;
  }
}

const artistGuard = latestGuard();
async function loadArtists() {
  const isLatest = artistGuard();
  artistLoading.value = true;
  artistError.value = null;
  try {
    const res = await getStreamsByArtist(window_.value, granularity.value, TOP_N, rankMetric.value, playlist.value);
    if (!isLatest()) return;
    artistSeries.value = res.data;
  } catch (e) {
    if (isLatest()) artistError.value = e instanceof Error ? e.message : "Failed to load.";
  } finally {
    if (isLatest()) artistLoading.value = false;
  }
}

const wearGuard = latestGuard();
async function loadWearOut() {
  const isLatest = wearGuard();
  wearLoading.value = true;
  wearError.value = null;
  try {
    const res = await getWearOut(window_.value, playlist.value);
    if (!isLatest()) return;
    wearOut.value = res.data;
  } catch (e) {
    if (isLatest()) wearError.value = e instanceof Error ? e.message : "Failed to load.";
  } finally {
    if (isLatest()) wearLoading.value = false;
  }
}

const yearsGuard = latestGuard();
async function loadYears() {
  const isLatest = yearsGuard();
  yearsLoading.value = true;
  yearsError.value = null;
  try {
    const res = await getTopArtistPerYear(window_.value, playlist.value, rankMetric.value);
    if (!isLatest()) return;
    years.value = res.data;
  } catch (e) {
    if (isLatest()) yearsError.value = e instanceof Error ? e.message : "Failed to load.";
  } finally {
    if (isLatest()) yearsLoading.value = false;
  }
}

function loadAll() {
  loadSummary();
  loadHighlights();
  loadPoints();
  loadHeat();
  loadArtists();
  loadWearOut();
  loadYears();
}

watch([window_, playlist], loadAll, { immediate: true, deep: true });
watch(heatMetric, loadHeat);
watch(rankMetric, () => {
  loadArtists();
  loadYears();
});

// --- derived: the one top-10 ranking shared by disc, stacked chart, year strip ---
const topArtists = computed(() => artistSeries.value?.artists ?? []);
/** "Everyone else" on the vinyl (RecordChart draws the disc with fixed dark colors). */
const RECORD_OTHER = "#8a969c";

const legendArtists = computed(() => {
  const s = artistSeries.value;
  if (!s) return [];
  const byHours = rankMetric.value === "playtime";
  // the disc is always dark vinyl, so its legend uses the dark palette in both themes
  return s.artists.map((name, i) => {
    const total = (s.values[i] ?? []).reduce((a, b) => a + b, 0);
    return {
      name,
      color: artistColor(i, "dark"),
      amount: byHours ? `${formatNumber(Math.round(total / 3_600_000))} h` : `${formatNumber(total)} plays`,
    };
  });
});
const legendNote = computed(() =>
  rankMetric.value === "playtime" ? "Top 10 by hours listened" : "Top 10 by streams"
);

const toHours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
const stackedBuckets = computed(() =>
  (artistSeries.value?.buckets ?? []).map((b) => formatBucket(b, granularity.value))
);
const stackedSeries = computed<StackedSeries[]>(() => {
  const s = artistSeries.value;
  if (!s) return [];
  const conv = rankMetric.value === "playtime" ? toHours : (v: number) => v;
  const out: StackedSeries[] = s.artists.map((name, i) => ({
    name,
    color: artistColor(i, theme.value),
    values: (s.values[i] ?? []).map(conv),
  }));
  out.push({ name: "Other", color: otherColor(theme.value), values: s.other.map(conv) });
  return out;
});
const stackedLabelEvery = computed(() => Math.max(1, Math.ceil(stackedBuckets.value.length / 12)));
const hoursLabel = (n: number) => `${formatNumber(Math.round(n * 10) / 10)}h`;
const stackedLabel = computed(() => (rankMetric.value === "playtime" ? hoursLabel : formatNumber));

// --- derived: wear-out series ---
const wearSeries = computed<SeriesPoint[]>(() => {
  const w = wearOut.value;
  if (!w) return [];
  const last = w.steps[w.steps.length - 1]?.n;
  return w.steps.map((s) => ({
    label: s.n === last && w.steps.length > 1 ? `${ordinal(s.n)}+` : ordinal(s.n),
    value: Math.round(s.skipRate * 1000) / 10,
  }));
});
const wearReference = computed(() => {
  const w = wearOut.value;
  if (!w) return undefined;
  return { value: Math.round(w.average * 1000) / 10, label: `average ${(w.average * 100).toFixed(0)}%` };
});
const wearMarker = computed(() => {
  const w = wearOut.value;
  if (!w || w.tiredAt === null) return undefined;
  const index = w.steps.findIndex((s) => s.n === w.tiredAt);
  if (index < 0) return undefined;
  return { index, label: `wears out around the ${ordinal(w.tiredAt)} play` };
});
const percentLabel = (n: number) => `${n.toFixed(1)}% skipped`;

// --- derived: title / subtitle for the disc card ---
const recordTitle = computed(() => {
  const span = pointsSpan.value;
  if (!span) return "My music, one groove per day";
  const days = (span.last - span.first) / 86_400_000;
  if (days >= 365 * 1.5) return `${Math.round(days / 365.25)} years of my music, one groove per day`;
  if (days >= 60) return `${Math.round(days / 30.44)} months of my music, one groove per day`;
  return `${Math.max(1, Math.round(days) + 1)} days of my music, one groove per day`;
});
const recordSubtitle = computed(() => {
  const s = summary.value;
  const span = pointsSpan.value;
  const parts: string[] = [];
  if (s) {
    parts.push(
      `${formatNumber(Math.round(s.totalPlaytimeMs / 3_600_000))} h, ${formatNumber(s.totalStreams)} plays, ${formatNumber(s.distinctArtists)} artists.`
    );
  }
  if (span) {
    parts.push(
      `Each ring is one day, from the centre (${formatDate(new Date(span.first).toISOString())}) to the edge (${formatDate(new Date(span.last).toISOString())}); each coloured mark is a play, placed at the time of day it happened, midnight at the top.`
    );
  }
  return parts.join(" ");
});

const bucketNoun = computed(() => granularity.value);
</script>

<template>
  <div class="record-page">
    <div class="filter-row">
      <DateRangeFilter v-model="window_" :busy="isFetching" />
      <PlaylistFilter v-model="playlist" :window="window_" />
    </div>

    <div class="kpi-row">
      <StatCard
        label="Longest streak"
        :value="highlights?.longestStreak ? `${formatNumber(highlights.longestStreak.days)} days` : highlights ? '—' : null"
        :sub="highlights?.longestStreak ? `${formatDate(highlights.longestStreak.from)} – ${formatDate(highlights.longestStreak.to)}` : undefined"
        :loading="highlightsLoading"
      />
      <StatCard
        label="Longest session"
        :value="highlights?.longestSession ? formatMs(highlights.longestSession.ms) : highlights ? '—' : null"
        :sub="highlights?.longestSession ? `${formatNumber(highlights.longestSession.plays)} plays · ${formatDate(highlights.longestSession.start)}` : undefined"
        :loading="highlightsLoading"
      />
      <StatCard
        label="Biggest day"
        :value="highlights?.biggestDay ? formatMs(highlights.biggestDay.ms) : highlights ? '—' : null"
        :sub="highlights?.biggestDay ? `${formatNumber(highlights.biggestDay.plays)} plays · ${formatDate(highlights.biggestDay.date)}` : undefined"
        :loading="highlightsLoading"
      />
      <StatCard
        label="First play"
        :value="highlights?.firstPlay ? highlights.firstPlay.trackName : highlights ? '—' : null"
        :sub="highlights?.firstPlay ? `${highlights.firstPlay.artistName} · ${formatDate(highlights.firstPlay.playedAt)}` : undefined"
        :loading="highlightsLoading"
      />
      <StatCard
        label="Worst earworm"
        :value="highlights?.earworm ? `${formatNumber(highlights.earworm.plays)}×` : highlights ? '—' : null"
        :sub="highlights?.earworm ? `in 7 days: ${highlights.earworm.trackName} – ${highlights.earworm.artistName} · week of ${formatDate(highlights.earworm.weekStart)}` : undefined"
        :loading="highlightsLoading"
      />
    </div>

    <div class="grid">
      <div class="span-12">
        <ChartCard
          :title="recordTitle"
          :subtitle="recordSubtitle"
          :loading="pointsLoading || artistLoading"
          :error="pointsError"
          :empty="!points.length"
          skeleton="block"
          :skeleton-height="560"
        >
          <template #actions>
            <span v-if="points.length" class="count-chip">{{ formatCompact(points.length) }} plays drawn</span>
            <div class="mini-tabs" role="tablist" aria-label="Rank artists by">
              <button
                type="button"
                role="tab"
                class="mini-tab"
                :class="{ active: rankMetric === 'playtime' }"
                :aria-selected="rankMetric === 'playtime'"
                @click="rankMetric = 'playtime'"
              >
                Hours
              </button>
              <button
                type="button"
                role="tab"
                class="mini-tab"
                :class="{ active: rankMetric === 'streams' }"
                :aria-selected="rankMetric === 'streams'"
                @click="rankMetric = 'streams'"
              >
                Streams
              </button>
            </div>
            <button type="button" class="btn" :disabled="!points.length" @click="record?.resetView()">
              Reset view
            </button>
          </template>
          <RecordChart
            ref="record"
            :points="points"
            :top-artists="topArtists"
            :highlights="highlights"
            :height="560"
          />
          <ul v-if="legendArtists.length" class="artist-legend" aria-label="Top artists">
            <li class="artist-item legend-note">{{ legendNote }} · scroll to zoom, drag to pan</li>
            <li v-for="(a, i) in legendArtists" :key="a.name" class="artist-item">
              <span class="swatch" :style="{ background: a.color }" aria-hidden="true" />
              <span class="artist-rank">{{ i + 1 }}</span>
              <span class="artist-name" :title="a.name">{{ a.name }}</span>
              <span class="artist-hours">{{ a.amount }}</span>
            </li>
            <li class="artist-item">
              <span class="swatch" :style="{ background: RECORD_OTHER }" aria-hidden="true" />
              <span class="artist-name">Everyone else</span>
            </li>
          </ul>
        </ChartCard>
      </div>

      <div class="span-5">
        <ChartCard
          title="When I listen"
          subtitle="By hour of the week"
          :loading="heatLoading"
          :error="heatError"
          :empty="!heatCells.length"
          skeleton="block"
          :skeleton-height="200"
        >
          <template #actions>
            <div class="mini-tabs" role="tablist" aria-label="Metric">
              <button
                type="button"
                role="tab"
                class="mini-tab"
                :class="{ active: heatMetric === 'streams' }"
                :aria-selected="heatMetric === 'streams'"
                @click="heatMetric = 'streams'"
              >
                Streams
              </button>
              <button
                type="button"
                role="tab"
                class="mini-tab"
                :class="{ active: heatMetric === 'playtime' }"
                :aria-selected="heatMetric === 'playtime'"
                @click="heatMetric = 'playtime'"
              >
                Playtime
              </button>
            </div>
          </template>
          <HeatmapGrid :cells="heatCells" :metric="heatMetric" aria-label="Listening by weekday and hour" />
        </ChartCard>
      </div>
      <div class="span-7">
        <ChartCard
          title="Who I listened to"
          :subtitle="`${rankMetric === 'playtime' ? 'Hours' : 'Streams'} per ${bucketNoun}, by artist`"
          :loading="artistLoading"
          :error="artistError"
          :empty="!stackedBuckets.length"
          skeleton="bars"
          :skeleton-height="260"
        >
          <StackedColumnChart
            :buckets="stackedBuckets"
            :series="stackedSeries"
            :height="260"
            :label-every="stackedLabelEvery"
            :format-value="stackedLabel"
            aria-label="Listening per bucket, by artist"
          />
        </ChartCard>
      </div>

      <div class="span-5">
        <ChartCard
          title="How songs wear out"
          subtitle="Skip rate by times heard"
          :loading="wearLoading"
          :error="wearError"
          :empty="!wearSeries.length"
          skeleton="line"
          :skeleton-height="240"
        >
          <TimeSeriesChart
            :data="wearSeries"
            :height="240"
            :format-value="percentLabel"
            :reference-line="wearReference"
            :marker="wearMarker"
            aria-label="Skip rate by nth play of a song"
          />
        </ChartCard>
      </div>
      <div class="span-7">
        <ChartCard
          title="My #1 artist, year by year"
          :subtitle="rankMetric === 'playtime' ? 'Most-listened artist per calendar year, by hours' : 'Most-streamed artist per calendar year'"
          :loading="yearsLoading"
          :error="yearsError"
          :empty="!years.length"
          skeleton="rows"
        >
          <YearStrip :years="years" :top-artists="topArtists" :metric="rankMetric" aria-label="Number one artist per year" />
        </ChartCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.record-page {
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
  grid-template-columns: repeat(5, 1fr);
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
  min-width: 0;
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

.count-chip {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  padding: 3px 10px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.artist-legend {
  list-style: none;
  margin: 14px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--border);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 6px 18px;
}
.artist-item {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
  color: var(--text-2);
}
.legend-note {
  grid-column: 1 / -1;
  color: var(--text-3);
  font-size: 11.5px;
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
.artist-rank {
  width: 16px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.artist-name {
  color: var(--text-1);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist-hours {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
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
