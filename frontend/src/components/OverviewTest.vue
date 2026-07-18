<script setup lang="ts">
import { ref } from "vue";
import { apiGet } from "../api";
import DateFilter from "./DateFilter.vue";

const limit = ref("20");

const range = ref("");
const date = ref("");
const from = ref("");
const to = ref("");

const result = ref<unknown>(null);
const loading = ref(false);

async function recentlyPlayed() {
  loading.value = true;
  result.value = await apiGet("/api/recently-played", { limit: limit.value });
  loading.value = false;
}

async function forgotten() {
  loading.value = true;
  result.value = await apiGet("/api/forgotten", {
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
    <h2>Overview: recently-played / forgotten</h2>
    <form @submit.prevent>
      <label>limit <input v-model="limit" type="number" /></label>
      <p style="margin: 0.25rem 0; opacity: 0.7;">Date filter only applies to "forgotten" (window before which counts as forgotten).</p>
      <DateFilter v-model:range="range" v-model:date="date" v-model:from="from" v-model:to="to" />
      <div class="row">
        <button type="button" :disabled="loading" @click="recentlyPlayed">GET /api/recently-played</button>
        <button type="button" :disabled="loading" @click="forgotten">GET /api/forgotten</button>
      </div>
    </form>
    <pre v-if="result" class="test-output">{{ JSON.stringify(result, null, 2) }}</pre>
  </section>
</template>
