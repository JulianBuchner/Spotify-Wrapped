<script setup lang="ts">
// Shared date-filter inputs for the test components.
// Leave everything empty to query without a date filter (all time).
const range = defineModel<string>("range", { default: "" });
const date = defineModel<string>("date", { default: "" });
const from = defineModel<string>("from", { default: "" });
const to = defineModel<string>("to", { default: "" });
</script>

<template>
  <label>
    range
    <select v-model="range">
      <option value="">(none)</option>
      <option value="today">today</option>
      <option value="last_week">last_week</option>
      <option value="last_30_days">last_30_days</option>
      <option value="ytd">ytd</option>
      <option value="last_year">last_year</option>
      <option value="all_time">all_time</option>
    </select>
  </label>
  <label>date (single day) <input v-model="date" type="date" /></label>
  <label>from <input v-model="from" type="date" /></label>
  <label>to <input v-model="to" type="date" /></label>
</template>
