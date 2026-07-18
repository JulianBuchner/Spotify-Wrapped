<script setup lang="ts">
import { ref } from "vue";
import { apiGet } from "../api";
import DateFilter from "./DateFilter.vue";

const endpoint = ref("top-artist-per-month");
const limit = ref("50");

const range = ref("");
const date = ref("");
const from = ref("");
const to = ref("");

const result = ref<unknown>(null);
const loading = ref(false);

async function run() {
  loading.value = true;
  result.value = await apiGet(`/api/wrapped/${endpoint.value}`, {
    limit: limit.value,
    range: range.value,
    date: date.value,
    from: from.value,
    to: to.value,
  });
  loading.value = false;
}
</script>

<template>
  <section class="test-section">
    <h2>Wrapped</h2>
    <form @submit.prevent="run">
      <label>
        endpoint
        <select v-model="endpoint">
          <option value="top-artist-per-month">top-artist-per-month</option>
          <option value="album-obsessions">album-obsessions</option>
          <option value="top-albums">top-albums</option>
        </select>
      </label>
      <label>limit (top-albums) <input v-model="limit" type="number" /></label>
      <DateFilter v-model:range="range" v-model:date="date" v-model:from="from" v-model:to="to" />
      <button type="submit" :disabled="loading">GET /api/wrapped/{{ endpoint }}</button>
    </form>
    <pre v-if="result" class="test-output">{{ JSON.stringify(result, null, 2) }}</pre>
  </section>
</template>
