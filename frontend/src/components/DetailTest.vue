<script setup lang="ts">
import { ref } from "vue";
import { apiGet } from "../api";
import DateFilter from "./DateFilter.vue";

const kind = ref("song");
const value = ref("");

const range = ref("");
const date = ref("");
const from = ref("");
const to = ref("");

const result = ref<unknown>(null);
const loading = ref(false);

async function run() {
  loading.value = true;
  const dateParams = {
    range: range.value,
    date: date.value,
    from: from.value,
    to: to.value,
  };
  const v = value.value.trim();
  if (kind.value === "song") {
    result.value = await apiGet(`/api/song/${encodeURIComponent(v)}`, dateParams);
  } else if (kind.value === "artist") {
    result.value = await apiGet("/api/artist", { name: v, ...dateParams });
  } else {
    result.value = await apiGet("/api/album", { name: v, ...dateParams });
  }
  loading.value = false;
}
</script>

<template>
  <section class="test-section">
    <h2>Detail (song / artist / album)</h2>
    <form @submit.prevent="run">
      <label>
        kind
        <select v-model="kind">
          <option value="song">song (by spotifyUri)</option>
          <option value="artist">artist (by name)</option>
          <option value="album">album (by name)</option>
        </select>
      </label>
      <label>
        value
        <input v-model="value" :placeholder="kind === 'song' ? 'spotify:track:...' : 'name'" />
      </label>
      <DateFilter v-model:range="range" v-model:date="date" v-model:from="from" v-model:to="to" />
      <button type="submit" :disabled="loading">GET detail</button>
    </form>
    <pre v-if="result" class="test-output">{{ JSON.stringify(result, null, 2) }}</pre>
  </section>
</template>
