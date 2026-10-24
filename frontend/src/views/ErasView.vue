<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  getEarworms,
  getExploreObsess,
  getGenreEras,
  getGenreGroups,
  getGenreOverTime,
  getGenreSummary,
  getRecordHighlights,
  getSkipRateByYear,
  getSummary,
  getTopArtists,
  getTopSongs,
  getWeekHourGrid,
  isFetching,
  type Metric,
} from "../api";
import BarList, { type BarItem } from "../components/BarList.vue";
import ChartCard from "../components/ChartCard.vue";
import DateRangeFilter from "../components/DateRangeFilter.vue";
import EarwormList from "../components/EarwormList.vue";
import GenreStreamgraph, { type StreamRow } from "../components/GenreStreamgraph.vue";
import HeatmapGrid from "../components/HeatmapGrid.vue";
import MultiLineChart, { type LineSeries } from "../components/MultiLineChart.vue";
import PlaylistFilter from "../components/PlaylistFilter.vue";
import StatCard from "../components/StatCard.vue";
import { formatBucket, formatDate, formatNumber, localDate } from "../lib/format";
import { granularityFor } from "../lib/granularity";
import { latestGuard } from "../lib/latest";
import { artistColor, groupColor } from "../lib/palette";
import { useTheme } from "../theme";
import type {
  DateWindow,
  Earworm,
  ExploreObsessYear,
  GenreEras,
  GenreGroupInfo,
  GenreLevel,
  GenreOverTime,
  GenreSummary,
  RecordHighlights,
  SkipRateYear,
  StatsSummary,
  TopArtist,
  TopSong,
  WeekHourCell,
} from "../types";

// Eras are a long-term story: default to all time.
const window_ = ref<DateWindow>({ range: "all_time", from: "", to: "" });
const playlist = ref("");
const { theme } = useTheme();
const granularity = computed(() => granularityFor(window_.value));

/** Hours | Streams — feeds the streamgraph, the eras and "Explore, then obsess". */
const metric = ref<Metric>("playtime");
/** Groups | Broad — the ~18 detailed groups or their 8 coarse parents; feeds the streamgraph + eras. */
const level = ref<GenreLevel>("group");

// phone ≤ 640 px: the streamgraph gets a lower plot (its labels are hidden there anyway)
const phone = ref(false);
let mq: MediaQueryList | null = null;
function onMedia() {
  phone.value = mq?.matches ?? false;
}
onMounted(() => {
  mq = window.matchMedia("(max-width: 640px)");
  mq.addEventListener("change", onMedia);
  onMedia();
});
onBeforeUnmount(() => mq?.removeEventListener("change", onMedia));
const streamHeight = computed(() => (phone.value ? 280 : 360));

function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Failed to load.";
}

// --- genre summary (coverage note) ---
const genreSummary = ref<GenreSummary | null>(null);
const summaryGuard = latestGuard();
async function loadGenreSummary() {
  const isLatest = summaryGuard();
  try {
    const res = await getGenreSummary(window_.value, playlist.value);
    if (isLatest()) genreSummary.value = res.data;
  } catch {
    if (isLatest()) genreSummary.value = null;
  }
}

// --- group order (stable colour index) ---
const groups = ref<GenreGroupInfo | null>(null);
const groupsGuard = latestGuard();
async function loadGroups() {
  const isLatest = groupsGuard();
  try {
    const res = await getGenreGroups(window_.value, playlist.value);
    if (isLatest()) groups.value = res.data;
  } catch {
    if (isLatest()) groups.value = null;
  }
}

// --- streamgraph: over-time by group + eras ---
const overTime = ref<GenreOverTime | null>(null);
const overTimeLoading = ref(false);
const overTimeError = ref<string | null>(null);
const overTimeGuard = latestGuard();
async function loadOverTime() {
  const isLatest = overTimeGuard();
  overTimeLoading.value = true;
  overTimeError.value = null;
  try {
    const res = await getGenreOverTime(
      window_.value,
      granularity.value,
      "group",
      level.value,
      30,
      metric.value,
      playlist.value
    );
    if (!isLatest()) return;
    overTime.value = res.data;
  } catch (e) {
    if (isLatest()) {
      overTimeError.value = errorText(e);
      overTime.value = null;
    }
  } finally {
    if (isLatest()) overTimeLoading.value = false;
  }
}

const eras = ref<GenreEras | null>(null);
const erasGuard = latestGuard();
async function loadEras() {
  const isLatest = erasGuard();
  try {
    const res = await getGenreEras(window_.value, metric.value, level.value, playlist.value);
    if (isLatest()) eras.value = res.data;
  } catch {
    if (isLatest()) eras.value = null;
  }
}

// --- stat strip ---
const topSong = ref<TopSong | null>(null);
const topSongLoading = ref(false);
const topSongGuard = latestGuard();
async function loadTopSong() {
  const isLatest = topSongGuard();
  topSongLoading.value = true;
  try {
    const res = await getTopSongs(window_.value, 1, playlist.value, "streams");
    if (isLatest()) topSong.value = res.data[0] ?? null;
  } catch {
    if (isLatest()) topSong.value = null;
  } finally {
    if (isLatest()) topSongLoading.value = false;
  }
}

const earworms = ref<Earworm[]>([]);
const earwormsLoading = ref(false);
const earwormsError = ref<string | null>(null);
const earwormsGuard = latestGuard();
async function loadEarworms() {
  const isLatest = earwormsGuard();
  earwormsLoading.value = true;
  earwormsError.value = null;
  try {
    const res = await getEarworms(window_.value, 6, playlist.value);
    if (isLatest()) earworms.value = res.data;
  } catch (e) {
    if (isLatest()) {
      earwormsError.value = errorText(e);
      earworms.value = [];
    }
  } finally {
    if (isLatest()) earwormsLoading.value = false;
  }
}

const highlights = ref<RecordHighlights | null>(null);
const highlightsLoading = ref(false);
const highlightsGuard = latestGuard();
async function loadHighlights() {
  const isLatest = highlightsGuard();
  highlightsLoading.value = true;
  try {
    const res = await getRecordHighlights(window_.value, playlist.value);
    if (isLatest()) highlights.value = res.data;
  } catch {
    if (isLatest()) highlights.value = null;
  } finally {
    if (isLatest()) highlightsLoading.value = false;
  }
}

const skipRates = ref<SkipRateYear[] | null>(null);
const skipLoading = ref(false);
const skipGuard = latestGuard();
async function loadSkipRates() {
  const isLatest = skipGuard();
  skipLoading.value = true;
  try {
    const res = await getSkipRateByYear(window_.value, playlist.value);
    if (isLatest()) skipRates.value = res.data;
  } catch {
    if (isLatest()) skipRates.value = null;
  } finally {
    if (isLatest()) skipLoading.value = false;
  }
}

// --- explore, then obsess ---
const explore = ref<ExploreObsessYear[]>([]);
const exploreLoading = ref(false);
const exploreError = ref<string | null>(null);
const exploreGuard = latestGuard();
async function loadExplore() {
  const isLatest = exploreGuard();
  exploreLoading.value = true;
  exploreError.value = null;
  try {
    const res = await getExploreObsess(window_.value, metric.value, playlist.value);
    if (isLatest()) explore.value = res.data;
  } catch (e) {
    if (isLatest()) {
      exploreError.value = errorText(e);
      explore.value = [];
    }
  } finally {
    if (isLatest()) exploreLoading.value = false;
  }
}

// --- two artists, then everyone else ---
const topArtists = ref<TopArtist[]>([]);
const artistsLoading = ref(false);
const artistsError = ref<string | null>(null);
const artistsGuard = latestGuard();
async function loadTopArtists() {
  const isLatest = artistsGuard();
  artistsLoading.value = true;
  artistsError.value = null;
  try {
    const res = await getTopArtists(window_.value, 8, playlist.value, "playtime");
    if (isLatest()) topArtists.value = res.data;
  } catch (e) {
    if (isLatest()) {
      artistsError.value = errorText(e);
      topArtists.value = [];
    }
  } finally {
    if (isLatest()) artistsLoading.value = false;
  }
}

const dashSummary = ref<StatsSummary | null>(null);
const dashGuard = latestGuard();
async function loadDashSummary() {
  const isLatest = dashGuard();
  try {
    const res = await getSummary(window_.value, playlist.value);
    if (isLatest()) dashSummary.value = res.data;
  } catch {
    if (isLatest()) dashSummary.value = null;
  }
}

// --- heatmap ---
const heatMetric = ref<Metric>("streams");
const heatCells = ref<WeekHourCell[]>([]);
const heatLoading = ref(false);
const heatError = ref<string | null>(null);
const heatGuard = latestGuard();
async function loadHeat() {
  const isLatest = heatGuard();
  heatLoading.value = true;
  heatError.value = null;
  try {
    const res = await getWeekHourGrid(window_.value, playlist.value, heatMetric.value);
    if (isLatest()) heatCells.value = res.data;
  } catch (e) {
    if (isLatest()) heatError.value = errorText(e);
  } finally {
    if (isLatest()) heatLoading.value = false;
  }
}

function loadAll() {
  loadGenreSummary();
  loadGroups();
  loadOverTime();
  loadEras();
  loadTopSong();
  loadEarworms();
  loadHighlights();
  loadSkipRates();
  loadExplore();
  loadTopArtists();
  loadDashSummary();
  loadHeat();
}

watch([window_, playlist], loadAll, { immediate: true, deep: true });
watch(metric, () => {
  loadOverTime();
  loadEras();
  loadExplore();
});
watch(level, () => {
  // keys differ per level (and a few overlap, e.g. "techno"): drop the old eras so
  // the header and the in-band labels never mix levels while the new ones load
  eras.value = null;
  loadOverTime();
  loadEras();
});
watch(heatMetric, loadHeat);

// --- derived: streamgraph ---
/**
 * key → index in rule order on the current level (`groups` or `broad` from
 * /api/genres/groups, stable across windows); falls back to the row order.
 */
const groupIndex = computed(() => {
  const map = new Map<string, number>();
  const order = level.value === "broad" ? (groups.value?.broad ?? []) : (groups.value?.groups ?? []);
  order.forEach((g, i) => map.set(g.key, i));
  return map;
});
const levelNoun = computed(() => (level.value === "broad" ? "broad genre group" : "genre group"));
const streamRows = computed<StreamRow[]>(() =>
  (overTime.value?.rows ?? []).map((r, i) => ({
    key: r.key,
    label: r.label,
    color: groupColor(groupIndex.value.get(r.key) ?? i, theme.value),
  }))
);
const streamValues = computed(() => overTime.value?.values ?? []);
const streamBuckets = computed(() => overTime.value?.buckets ?? []);
const bucketLabel = computed(() => (b: string) => formatBucket(b, granularity.value));

const coverageNote = computed(() => {
  const s = genreSummary.value;
  const unit = metric.value === "playtime" ? "listened time" : "plays";
  if (!s) return `Shares of ${unit} per ${granularity.value}, by ${levelNoun.value}.`;
  return `Genres cover ${Math.round(s.coverage.share * 100)}% of listened time; shares of covered ${unit} by ${levelNoun.value}.`;
});

// --- derived: stat strip ---
const earwormMonth = computed(() => {
  const e = earworms.value[0];
  if (!e) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(localDate(e.weekStart));
});

/**
 * First vs. last FULL year: years with fewer than 500 plays are ignored, and so
 * is the current calendar year (it isn't over yet) unless it is the only one.
 */
const skipStat = computed(() => {
  const rows = skipRates.value;
  if (!rows) return null;
  const thisYear = new Date().getFullYear();
  let full = rows.filter((r) => r.plays >= 500 && r.year !== thisYear);
  if (!full.length) full = rows.filter((r) => r.plays >= 500);
  if (!full.length) return { value: "—", sub: "not enough plays per year" };
  const first = full[0]!;
  const last = full[full.length - 1]!;
  const pct = (r: SkipRateYear) => `${(r.skipRate * 100).toFixed(1)}%`;
  if (first.year === last.year) return { value: pct(first), sub: `${first.year}` };
  return { value: `${pct(first)} → ${pct(last)}`, sub: `${first.year} vs ${last.year}` };
});

// --- derived: explore, then obsess ---
const exploreLabels = computed(() => explore.value.map((r) => String(r.year)));
const exploreSeries = computed<LineSeries[]>(() => [
  {
    name: "New artists",
    color: artistColor(0, theme.value),
    values: explore.value.map((r) => Math.round(r.newArtistShare * 1000) / 10),
  },
  {
    name: "Top 10 artists",
    color: artistColor(1, theme.value),
    values: explore.value.map((r) => Math.round(r.top10Share * 1000) / 10),
  },
]);
const percentLabel = (n: number) => `${n.toFixed(1)}%`;

// --- derived: bars ---
const barItems = computed<BarItem[]>(() =>
  topArtists.value.map((a) => ({ name: a.artistName, hours: a.playtimeMs / 3_600_000, streams: a.streams }))
);
const barsSubtitle = computed(() =>
  dashSummary.value
    ? `Total hours, ${formatNumber(dashSummary.value.distinctArtists)} artists in total`
    : "Total hours per artist"
);
</script>

<template>
  <div class="eras-page">
    <div class="filter-row">
      <DateRangeFilter v-model="window_" :busy="isFetching" />
      <PlaylistFilter v-model="playlist" :window="window_" />
      <div class="toggles">
        <div class="toggle-group">
          <span id="eras-detail-label" class="toggle-label">Detail</span>
          <div class="mini-tabs" role="tablist" aria-labelledby="eras-detail-label">
            <button
              type="button"
              role="tab"
              class="mini-tab"
              :class="{ active: level === 'group' }"
              :aria-selected="level === 'group'"
              @click="level = 'group'"
            >
              Groups
            </button>
            <button
              type="button"
              role="tab"
              class="mini-tab"
              :class="{ active: level === 'broad' }"
              :aria-selected="level === 'broad'"
              @click="level = 'broad'"
            >
              Broad
            </button>
          </div>
        </div>
        <div class="mini-tabs" role="tablist" aria-label="Measure listening by">
          <button
            type="button"
            role="tab"
            class="mini-tab"
            :class="{ active: metric === 'playtime' }"
            :aria-selected="metric === 'playtime'"
            @click="metric = 'playtime'"
          >
            Hours
          </button>
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
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="span-12">
        <ChartCard
          :title="metric === 'playtime' ? 'What I listened to, share of music time by genre' : 'What I listened to, share of plays by genre'"
          :subtitle="coverageNote"
          :loading="overTimeLoading"
          :error="overTimeError"
          :empty="!streamBuckets.length"
          skeleton="line"
          :skeleton-height="streamHeight"
        >
          <GenreStreamgraph
            :buckets="streamBuckets"
            :rows="streamRows"
            :values="streamValues"
            :eras="eras?.eras ?? []"
            :years="eras?.years ?? []"
            :height="streamHeight"
            :format-bucket="bucketLabel"
            :aria-label="`Share of listening per bucket, by ${levelNoun}`"
          />
        </ChartCard>
      </div>
    </div>

    <div class="kpi-row">
      <StatCard
        label="Plays of one song"
        :value="topSong ? `${formatNumber(topSong.streams)} plays` : topSongLoading ? null : '—'"
        :sub="topSong ? `${topSong.trackName} · ${topSong.artistName}` : undefined"
        :loading="topSongLoading"
      />
      <StatCard
        label="Worst earworm (7 days)"
        :value="earworms[0] ? `${formatNumber(earworms[0].plays)} plays` : earwormsLoading ? null : '—'"
        :sub="earworms[0] ? `${earworms[0].trackName} · ${earworms[0].artistName} · ${earwormMonth}` : undefined"
        :loading="earwormsLoading"
      />
      <StatCard
        label="Days in a row with a stream"
        :value="highlights?.longestStreak ? `${formatNumber(highlights.longestStreak.days)} days` : highlights ? '—' : null"
        :sub="highlights?.longestStreak ? `${formatDate(highlights.longestStreak.from)} to ${formatDate(highlights.longestStreak.to)}` : undefined"
        :loading="highlightsLoading"
      />
      <StatCard
        label="Skipped within 30 seconds"
        :value="skipStat ? skipStat.value : skipLoading ? null : '—'"
        :sub="skipStat?.sub"
        :loading="skipLoading"
      />
    </div>

    <div class="grid">
      <div class="span-6">
        <ChartCard
          title="Explore, then obsess"
          subtitle="Share of listening on artists new that year vs. on my top 10"
          :loading="exploreLoading"
          :error="exploreError"
          :empty="!explore.length"
          skeleton="line"
          :skeleton-height="260"
        >
          <MultiLineChart
            :labels="exploreLabels"
            :series="exploreSeries"
            :height="260"
            :max-value="100"
            :format-value="percentLabel"
            aria-label="Share of listening on new artists and on the top 10 artists, per year"
          />
        </ChartCard>
      </div>
      <div class="span-6">
        <ChartCard
          title="Two artists, then everyone else"
          :subtitle="barsSubtitle"
          :loading="artistsLoading"
          :error="artistsError"
          :empty="!barItems.length"
          skeleton="rows"
        >
          <BarList :items="barItems" aria-label="Top 8 artists by hours listened" />
        </ChartCard>
      </div>

      <div class="span-6">
        <ChartCard
          title="Worst earworms"
          subtitle="Most plays of one song within any 7 days"
          :loading="earwormsLoading"
          :error="earwormsError"
          :empty="!earworms.length"
          skeleton="rows"
        >
          <EarwormList :items="earworms" aria-label="Worst earworms" />
        </ChartCard>
      </div>
      <div class="span-6">
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
    </div>
  </div>
</template>

<style scoped>
.eras-page {
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
.toggles {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.toggle-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.toggle-label {
  font-size: 11.5px;
  color: var(--text-3);
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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
.span-6 {
  grid-column: span 6;
  min-width: 0;
}
.span-6 > * {
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

/* tablet ≤ 1024 px: 4 KPI tiles in 3 columns; long values get two lines, then an ellipsis */
@media (max-width: 1024px) {
  .kpi-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .kpi-row :deep(.stat-value) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
}
/* narrow ≤ 900 px: the half-width cards stack */
@media (max-width: 900px) {
  .span-6 {
    grid-column: span 12;
  }
}
/* phone ≤ 640 px: 2 KPI columns, the toggle row wraps under the filters, 36 px tap targets */
@media (max-width: 640px) {
  .kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .grid {
    gap: 12px;
  }
  .toggles {
    margin-left: 0;
    width: 100%;
    flex-wrap: wrap;
    gap: 8px;
  }
  .mini-tab {
    min-height: 36px;
    padding: 6px 12px;
  }
}
</style>
