<script setup lang="ts">
import { ref } from "vue";
import { apiGet } from "../api";

const q = ref("");
const types = ref("songs,artists,albums");
const limit = ref("5");
const result = ref<unknown>(null);
const loading = ref(false);

async function run() {
  loading.value = true;
  result.value = await apiGet("/api/search", {
    q: q.value,
    types: types.value,
    limit: limit.value,
  });
  loading.value = false;
}
</script>

<template>
  <section class="test-section">
    <h2>Search</h2>
    <form @submit.prevent="run">
      <label>q <input v-model="q" placeholder="search term" /></label>
      <label>types <input v-model="types" /></label>
      <label>limit <input v-model="limit" type="number" /></label>
      <button type="submit" :disabled="loading">GET /api/search</button>
    </form>
    <pre v-if="result" class="test-output">{{ JSON.stringify(result, null, 2) }}</pre>
  </section>
</template>
