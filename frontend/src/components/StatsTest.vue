<script setup lang="ts">
import { ref } from "vue";
import { apiGet } from "../api";
import DateFilter from "./DateFilter.vue";

const endpoint = ref("summary");

// endpoint-specific extras (ignored by endpoints that don't use them)
const granularity = ref("");
const metric = ref("streams");
const bucketSize = ref("15");
const weight = ref("streams");

const range = ref("");
const date = ref("");
const from = ref("");
const to = ref("");

const result = ref<unknown>(null);
const loading = ref(false);

async function run() {
  loading.value = true;
  result.value = await apiGet(`/api/stats/${endpoint.value}`, {
    granularity: granularity.value,
    metric: metric.value,
    bucketSize: bucketSize.value,
    weight: weight.value,
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
    <h2>Stats</h2>
    <form @submit.prevent="run">
      <label>
        endpoint
        <select v-model="endpoint">
          <option value="summary">summary</option>
          <option value="listening-clock">listening-clock</option>
          <option value="listening-by-weekday">listening-by-weekday</option>
          <option value="streams-over-time">streams-over-time</option>
          <option value="discovery">discovery</option>
          <option value="new-share">new-share</option>
          <option value="duration-distribution">duration-distribution</option>
        </select>
      </label>
      <label>
        granularity (time series)
        <select v-model="granularity">
          <option value="">(default: month)</option>
          <option value="day">day</option>
          <option value="week">week</option>
          <option value="month">month</option>
          <option value="year">year</option>
        </select>
      </label>
      <label>
        metric (streams-over-time)
        <select v-model="metric">
          <option value="streams">streams</option>
          <option value="playtime">playtime</option>
        </select>
      </label>
      <label>bucketSize sec (duration-distribution) <input v-model="bucketSize" type="number" /></label>
      <label>
        weight (duration-distribution)
        <select v-model="weight">
          <option value="streams">streams</option>
          <option value="distinct">distinct</option>
        </select>
      </label>
      <DateFilter v-model:range="range" v-model:date="date" v-model:from="from" v-model:to="to" />
      <button type="submit" :disabled="loading">GET /api/stats/{{ endpoint }}</button>
    </form>
    <pre v-if="result" class="test-output">{{ JSON.stringify(result, null, 2) }}</pre>
  </section>
</template>
