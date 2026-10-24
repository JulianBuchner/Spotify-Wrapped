<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getGenreArtists, getGenreOverTime, getGenreSummary, isFetching, type Metric } from "../api";
import ChartCard from "../components/ChartCard.vue";
import DateRangeFilter from "../components/DateRangeFilter.vue";
import GenreStripPlot, { type StripRow } from "../components/GenreStripPlot.vue";
import PlaylistFilter from "../components/PlaylistFilter.vue";
import { formatBucket, formatDateTime, formatMs, formatNumber } from "../lib/format";
import { granularityFor } from "../lib/granularity";
import { latestGuard } from "../lib/latest";
import { rainbowColor } from "../lib/palette";
import { useTheme } from "../theme";
import type { DateWindow, GenreArtist, GenreLevel, GenreOverTime, GenreSummary } from "../types";

const window_ = ref<DateWindow>({ range: "all_time", from: "", to: "" });
const playlist = ref("");
const { theme } = useTheme();
const granularity = computed(() => granularityFor(window_.value));

/**
 * What a row is: a genre (top 30), one of the ~18 genre groups, or one of the
 * 8 broad parent groups. The last two are `by=group` on a different `level`.
 */
type RowKind = "genre" | "group" | "broad";
const rowKind = ref<RowKind>("genre");
const by = computed<"genre" | "group">(() => (rowKind.value === "genre" ? "genre" : "group"));
const level = computed<GenreLevel>(() => (rowKind.value === "broad" ? "broad" : "group"));
const metric = ref<Metric>("streams");
const TOP_N = 30;

// phone ≤ 640 px: tighter strip rows (20 px instead of 22)
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

function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Failed to load.";
}

// --- strip plot data ---
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
      by.value,
      level.value,
      TOP_N,
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

// --- coverage ---
const summary = ref<GenreSummary | null>(null);
const summaryLoading = ref(false);
const summaryError = ref<string | null>(null);
const summaryGuard = latestGuard();
async function loadSummary() {
  const isLatest = summaryGuard();
  summaryLoading.value = true;
  summaryError.value = null;
  try {
    const res = await getGenreSummary(window_.value, playlist.value);
    if (isLatest()) summary.value = res.data;
  } catch (e) {
    if (isLatest()) {
      summaryError.value = errorText(e);
      summary.value = null;
    }
  } finally {
    if (isLatest()) summaryLoading.value = false;
  }
}

// --- top artists of the selected row ---
const selected = ref<StripRow | null>(null);
const artists = ref<GenreArtist[]>([]);
const artistsLoading = ref(false);
const artistsError = ref<string | null>(null);
const artistsGuard = latestGuard();
async function loadArtists() {
  const isLatest = artistsGuard();
  const row = selected.value;
  if (!row) {
    artists.value = [];
    return;
  }
  artistsLoading.value = true;
  artistsError.value = null;
  try {
    const what = by.value === "group" ? { group: row.key, level: level.value } : { genre: row.key };
    const res = await getGenreArtists(window_.value, what, 10, metric.value, playlist.value);
    if (isLatest()) artists.value = res.data;
  } catch (e) {
    if (isLatest()) {
      artistsError.value = errorText(e);
      artists.value = [];
    }
  } finally {
    if (isLatest()) artistsLoading.value = false;
  }
}

function onSelect(row: StripRow) {
  selected.value = selected.value?.key === row.key ? null : row;
  loadArtists();
}

watch(
  [window_, playlist],
  () => {
    loadOverTime();
    loadSummary();
    loadArtists();
  },
  { immediate: true, deep: true }
);
watch(metric, () => {
  loadOverTime();
  loadArtists();
});
watch(rowKind, () => {
  // a genre name is not a group key, and a group key is not a broad key (a few
  // overlap, e.g. "techno"): drop the selection whenever the row kind changes
  selected.value = null;
  artists.value = [];
  loadOverTime();
});

// --- derived ---
const rows = computed<StripRow[]>(() => overTime.value?.rows ?? []);
const buckets = computed(() => overTime.value?.buckets ?? []);
const values = computed(() => overTime.value?.values ?? []);
/** the panel is always dark, so the rows take the dark-mode rainbow on both themes */
const rowColors = computed(() => rows.value.map((_, i) => rainbowColor(i, rows.value.length, "dark")));
const plotHeight = computed(() => Math.max(240, (phone.value ? 20 : 22) * rows.value.length + 30));
const bucketLabel = computed(() => (b: string) => formatBucket(b, granularity.value));

const rowNoun = computed(() =>
  rowKind.value === "genre" ? "genre" : rowKind.value === "broad" ? "broad genre group" : "genre group"
);
const stripSubtitle = computed(() =>
  rowKind.value === "genre"
    ? `Listen frequency is proportional to colour intensity · rows are your top ${rows.value.length || TOP_N} genres (a play counts for every genre of its artist)`
    : `Listen frequency is proportional to colour intensity · rows are your ${rowNoun.value}s`
);

const selectedColor = computed(() => {
  const i = rows.value.findIndex((r) => r.key === selected.value?.key);
  return i < 0 ? undefined : rainbowColor(i, rows.value.length, theme.value);
});

const coverageShare = computed(() => (summary.value ? Math.round(summary.value.coverage.share * 100) : null));
const coverageOk = computed(() => summary.value !== null && summary.value.coverage.share >= 0.95);
const lastFetched = computed(() =>
  summary.value?.lastFetchedAt ? formatDateTime(summary.value.lastFetchedAt) : "never"
);
const hours = (ms: number) => `${formatNumber(Math.round(ms / 3_600_000))} h`;
</script>

<template>
  <div class="genres-page">
    <div class="filter-row">
      <DateRangeFilter v-model="window_" :busy="isFetching" />
      <PlaylistFilter v-model="playlist" :window="window_" />
      <div class="toggles">
        <div class="mini-tabs" role="tablist" aria-label="Rows">
          <button
            type="button"
            role="tab"
            class="mini-tab"
            :class="{ active: rowKind === 'genre' }"
            :aria-selected="rowKind === 'genre'"
            @click="rowKind = 'genre'"
          >
            Genres
          </button>
          <button
            type="button"
            role="tab"
            class="mini-tab"
            :class="{ active: rowKind === 'group' }"
            :aria-selected="rowKind === 'group'"
            @click="rowKind = 'group'"
          >
            Groups
          </button>
          <button
            type="button"
            role="tab"
            class="mini-tab"
            :class="{ active: rowKind === 'broad' }"
            :aria-selected="rowKind === 'broad'"
            @click="rowKind = 'broad'"
          >
            Broad
          </button>
        </div>
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
            Hours
          </button>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="span-12">
        <ChartCard
          title="Genre listen frequency"
          :subtitle="stripSubtitle"
          :loading="overTimeLoading"
          :error="overTimeError"
          :empty="!rows.length"
          skeleton="block"
          :skeleton-height="plotHeight"
        >
          <GenreStripPlot
            :buckets="buckets"
            :rows="rows"
            :values="values"
            :row-colors="rowColors"
            :height="plotHeight"
            :metric="metric"
            :format-bucket="bucketLabel"
            :aria-label="`Listening per bucket, by ${rowNoun}`"
            @select="onSelect"
          />
          <p class="hint">Click or tap a row for its top artists.</p>
        </ChartCard>
      </div>

      <div v-if="selected" class="span-6">
        <ChartCard
          :title="`Top artists in ${selected.label}`"
          :subtitle="metric === 'playtime' ? 'By hours listened' : 'By streams'"
          :loading="artistsLoading"
          :error="artistsError"
          :empty="!artists.length"
          skeleton="rows"
        >
          <template #actions>
            <span class="swatch" :style="{ background: selectedColor }" aria-hidden="true" />
            <button type="button" class="btn" @click="onSelect(selected)">Close</button>
          </template>
          <ol class="artist-list">
            <li v-for="(a, i) in artists" :key="a.artistName" class="artist-row">
              <span class="rank">{{ i + 1 }}</span>
              <span class="artist-main">
                <span class="artist-name" :title="a.artistName">{{ a.artistName }}</span>
                <span class="artist-genres" :title="a.genres.join(', ')">{{ a.genres.join(" · ") || "no genres" }}</span>
              </span>
              <span class="artist-nums">
                <span class="num">{{ hours(a.ms) }}</span>
                <span class="num-sub">{{ formatNumber(a.streams) }} plays</span>
              </span>
            </li>
          </ol>
        </ChartCard>
      </div>

      <div :class="selected ? 'span-6' : 'span-12'">
        <ChartCard
          title="Coverage"
          subtitle="How much of the listening the genre catalog explains"
          :loading="summaryLoading"
          :error="summaryError"
          :empty="!summary"
          skeleton="rows"
        >
          <p v-if="summary && coverageOk" class="coverage-line">
            Genres cover {{ coverageShare }}% of your listening ·
            {{ formatNumber(summary.artistsWithGenres) }} of {{ formatNumber(summary.artistsTotal) }} artists have genres ·
            catalog fetched {{ lastFetched }}.
          </p>
          <div v-else-if="summary" class="coverage">
            <div class="coverage-stats">
              <div class="cov-stat">
                <span class="cov-label">Listening covered</span>
                <span class="cov-value">{{ coverageShare }}%</span>
                <span class="cov-sub">{{ formatMs(summary.coverage.mappedMs) }} of {{ formatMs(summary.coverage.ms) }}</span>
              </div>
              <div class="cov-stat">
                <span class="cov-label">Artists with genres</span>
                <span class="cov-value">{{ formatNumber(summary.artistsWithGenres) }}</span>
                <span class="cov-sub">of {{ formatNumber(summary.artistsTotal) }} · {{ formatNumber(summary.artistsWithGroup) }} in a group</span>
              </div>
              <div class="cov-stat">
                <span class="cov-label">Tracks unresolved</span>
                <span class="cov-value">{{ formatNumber(summary.tracksUnresolved) }}</span>
                <span class="cov-sub">of {{ formatNumber(summary.tracksTotal) }}</span>
              </div>
              <div class="cov-stat">
                <span class="cov-label">Catalog fetched</span>
                <span class="cov-value cov-value-small">{{ lastFetched }}</span>
              </div>
            </div>
            <div class="coverage-lists">
              <div class="cov-list">
                <h4 class="cov-list-title">Unmapped artists</h4>
                <p v-if="!summary.unmappedArtists.length" class="cov-empty">none</p>
                <ol v-else>
                  <li v-for="a in summary.unmappedArtists" :key="a.artistName" class="cov-row">
                    <span class="cov-name" :title="a.artistName">{{ a.artistName }}</span>
                    <span class="cov-num">{{ hours(a.ms) }} · {{ formatNumber(a.streams) }} plays</span>
                  </li>
                </ol>
              </div>
              <div class="cov-list">
                <h4 class="cov-list-title">Unmapped genres</h4>
                <p v-if="!summary.unmappedGenres.length" class="cov-empty">none</p>
                <ol v-else>
                  <li v-for="g in summary.unmappedGenres" :key="g.genre" class="cov-row">
                    <span class="cov-name" :title="g.genre">{{ g.genre }}</span>
                    <span class="cov-num">{{ formatMs(g.ms) }}</span>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </ChartCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.genres-page {
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
  gap: 8px;
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

.hint {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.artist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.artist-row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-top: 1px solid var(--border);
  min-width: 0;
}
.artist-row:first-child {
  border-top: none;
  padding-top: 2px;
}
.rank {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.artist-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.artist-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist-genres {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist-nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  white-space: nowrap;
}
.num {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.num-sub {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.coverage-line {
  margin: 4px 0 2px;
  font-size: 13px;
  color: var(--text-2);
}
.coverage {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.coverage-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.cov-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-surface-2);
  min-width: 0;
}
.cov-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cov-value {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-1);
  line-height: 1.2;
}
.cov-value-small {
  font-size: 15px;
}
.cov-sub {
  font-size: 11.5px;
  color: var(--text-3);
}
.coverage-lists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}
.cov-list ol {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cov-list-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
  margin: 0 0 4px;
}
.cov-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
.cov-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 4px 0;
  border-top: 1px solid var(--border);
  font-size: 12.5px;
  min-width: 0;
}
.cov-row:first-child {
  border-top: none;
}
.cov-name {
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cov-num {
  margin-left: auto;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-size: 11.5px;
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

/* narrow ≤ 900 px: the artists card and the coverage card stack */
@media (max-width: 900px) {
  .span-6 {
    grid-column: span 12;
  }
}
/* phone ≤ 640 px: toggles wrap under the filters, 36 px tap targets */
@media (max-width: 640px) {
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
  .btn {
    min-height: 36px;
  }
}
</style>
