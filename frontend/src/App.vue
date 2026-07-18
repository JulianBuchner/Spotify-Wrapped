<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getHealth, getPlayCount, getArtistStats, getUniqueTracks, getListenTime } from "./api";
import SearchTest from "./components/SearchTest.vue";
import TopTest from "./components/TopTest.vue";
import OverviewTest from "./components/OverviewTest.vue";
import StatsTest from "./components/StatsTest.vue";
import WrappedTest from "./components/WrappedTest.vue";
import HistoryTest from "./components/HistoryTest.vue";
import DetailTest from "./components/DetailTest.vue";

type ArtistStats = {
  artist: string;
  playCount: number;
  uniqueTracks: number;
  totalMs: number;
};

const status = ref("loading...");
const count = ref<number | null>(null);

const artistName = ref("");
const fromDate = ref("");
const toDate = ref("");

const uniqueTracks = ref<number | null>(null);
const totalMs = ref<number | null>(null);
const artistStats = ref<ArtistStats | null>(null);
const statsError = ref<string | null>(null);
const loadingStats = ref(false);

function formatMs(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function loadStats() {
  statsError.value = null;
  loadingStats.value = true;
  try {
    const [uniqueRes, listenRes] = await Promise.all([
      getUniqueTracks(fromDate.value, toDate.value),
      getListenTime(fromDate.value, toDate.value),
    ]);
    uniqueTracks.value = uniqueRes.count;
    totalMs.value = listenRes.totalMs;

    const artist = artistName.value.trim();
    if (artist) {
      artistStats.value = await getArtistStats(artist, fromDate.value, toDate.value);
    } else {
      artistStats.value = null;
    }
  } catch (err) {
    console.error(err);
    statsError.value = "Failed to load stats.";
  } finally {
    loadingStats.value = false;
  }
}

onMounted(async () => {
  const h = await getHealth();
  status.value = h.status;

  const c = await getPlayCount();
  count.value = c.count;

  await loadStats();
});
</script>

<template>
  <main style="padding: 2rem">
    <h1>Anytime Wrapped</h1>
    <p>Backend: {{ status }}</p>
    <p v-if="count !== null">Plays stored: {{ count }}</p>

    <section style="margin-top: 2rem">
      <h2>Stats</h2>
      <form @submit.prevent="loadStats" style="display: grid; gap: 0.5rem; max-width: 420px;">
        <label>
          Artist
          <input v-model="artistName" placeholder="Artist name" />
        </label>
        <label>
          From
          <input v-model="fromDate" type="date" />
        </label>
        <label>
          To
          <input v-model="toDate" type="date" />
        </label>
        <button type="submit" :disabled="loadingStats">Load stats</button>
      </form>

      <p v-if="statsError">{{ statsError }}</p>
      <p v-if="uniqueTracks !== null">Unique tracks: {{ uniqueTracks }}</p>
      <p v-if="totalMs !== null">Total listening time: {{ formatMs(totalMs) }}</p>

      <div v-if="artistStats">
        <p>Artist: {{ artistStats.artist }}</p>
        <p>Artist plays: {{ artistStats.playCount }}</p>
        <p>Artist unique tracks: {{ artistStats.uniqueTracks }}</p>
        <p>Artist listen time: {{ formatMs(artistStats.totalMs) }}</p>
      </div>
    </section>

    <SearchTest />
    <TopTest />
    <OverviewTest />
    <StatsTest />
    <WrappedTest />
    <HistoryTest />
    <DetailTest />
  </main>
</template>
