<script setup lang="ts">
import { ref } from "vue";
import { apiGet } from "../api";
import DateFilter from "./DateFilter.vue";

const entity = ref("songs");
const sort = ref("streams");
const order = ref("desc");
const q = ref("");
const limit = ref("10");
const offset = ref("0");

const range = ref("");
const date = ref("");
const from = ref("");
const to = ref("");

const result = ref<unknown>(null);
const loading = ref(false);

async function run() {
  loading.value = true;
  result.value = await apiGet(`/api/top/${entity.value}`, {
    sort: sort.value,
    order: order.value,
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
    <h2>Top (songs / artists / albums)</h2>
    <form @submit.prevent="run">
      <label>
        entity
        <select v-model="entity">
          <option value="songs">songs</option>
          <option value="artists">artists</option>
          <option value="albums">albums</option>
        </select>
      </label>
      <label>
        sort
        <select v-model="sort">
          <option value="streams">streams</option>
          <option value="playtime">playtime</option>
        </select>
      </label>
      <label>
        order
        <select v-model="order">
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
      </label>
      <label>q <input v-model="q" placeholder="optional filter" /></label>
      <label>limit <input v-model="limit" type="number" /></label>
      <label>offset <input v-model="offset" type="number" /></label>
      <DateFilter v-model:range="range" v-model:date="date" v-model:from="from" v-model:to="to" />
      <button type="submit" :disabled="loading">GET /api/top/{{ entity }}</button>
    </form>
    <pre v-if="result" class="test-output">{{ JSON.stringify(result, null, 2) }}</pre>
  </section>
</template>
