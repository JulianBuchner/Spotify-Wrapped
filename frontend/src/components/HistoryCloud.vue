<script setup lang="ts">
import { ref, onMounted } from "vue";
import { apiGet } from "../api";
import DateFilter from "./DateFilter.vue";
import ListeningCloud from "./ListeningCloud.vue";
import type { PlayPoint } from "../types";

interface PointRow {
  playedAt: string;
  trackName: string;
  artistName: string;
  durationMs: number;
}

const range = ref("");
const date = ref("");
const from = ref("");
const to = ref("");
const highlight = ref("");

const points = ref<PlayPoint[]>([]);
const loading = ref(false);
const errorMsg = ref<string | null>(null);

const cloud = ref<InstanceType<typeof ListeningCloud> | null>(null);

async function load() {
  loading.value = true;
  errorMsg.value = null;
  try {
    const res = await apiGet("/api/history/points", {
      range: range.value,
      date: date.value,
      from: from.value,
      to: to.value,
    });
    if (res && res.error) {
      errorMsg.value = String(res.error);
      points.value = [];
      return;
    }
    const rows: PointRow[] = res?.data ?? [];
    points.value = rows.map((r) => {
      const ts = new Date(r.playedAt).getTime();
      const d = new Date(ts);
      const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      return { ts, hour, artist: r.artistName, track: r.trackName, ms: r.durationMs };
    });
  } catch {
    errorMsg.value = "Failed to load points.";
    points.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="test-section" style="max-width: 1000px;">
    <h2>Listening cloud</h2>
    <p style="margin: 0.25rem 0; opacity: 0.7; font-size: 0.85rem;">
      Each dot is one play — x = date, y = time of day. Drag to pan, scroll to zoom, hover for details.
    </p>
    <form @submit.prevent="load">
      <DateFilter v-model:range="range" v-model:date="date" v-model:from="from" v-model:to="to" />
      <label>highlight (artist / track) <input v-model="highlight" placeholder="optional" /></label>
      <div class="row">
        <button type="submit" :disabled="loading">{{ loading ? "Loading…" : "Load range" }}</button>
        <button type="button" @click="cloud?.resetView()" :disabled="!points.length">Reset view</button>
      </div>
    </form>

    <p v-if="errorMsg">{{ errorMsg }}</p>
    <p v-else-if="!loading && points.length === 0">No plays in this range.</p>

    <div v-if="points.length" style="position: relative; margin-top: 0.5rem;">
      <ListeningCloud ref="cloud" :points="points" :highlight="highlight" />
      <div
        style="position: absolute; left: 8px; bottom: 8px; font-size: 0.75rem; opacity: 0.6;"
      >
        Displaying {{ points.length.toLocaleString() }} data points
      </div>
    </div>
  </section>
</template>
