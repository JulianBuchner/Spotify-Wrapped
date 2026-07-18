<script setup lang="ts">
import { ref } from "vue";
import { apiGet } from "../api";
import DateFilter from "./DateFilter.vue";

const q = ref("");
const limit = ref("50");
const offset = ref("0");

const range = ref("");
const date = ref("");
const from = ref("");
const to = ref("");

const result = ref<unknown>(null);
const loading = ref(false);

async function run() {
  loading.value = true;
  result.value = await apiGet("/api/history", {
    q: q.value,
    limit: limit.value,
    offset: offset.value,
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
    <h2>History</h2>
    <form @submit.prevent="run">
      <label>q <input v-model="q" placeholder="title / artist / album" /></label>
      <label>limit <input v-model="limit" type="number" /></label>
      <label>offset <input v-model="offset" type="number" /></label>
      <DateFilter v-model:range="range" v-model:date="date" v-model:from="from" v-model:to="to" />
      <button type="submit" :disabled="loading">GET /api/history</button>
    </form>
    <pre v-if="result" class="test-output">{{ JSON.stringify(result, null, 2) }}</pre>
  </section>
</template>
