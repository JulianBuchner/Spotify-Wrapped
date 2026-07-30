<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DateWindow } from "../types";

const model = defineModel<DateWindow>({ required: true });

const PRESETS: Array<{ value: string; label: string }> = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "previous_week", label: "Last week" },
  { value: "last_week", label: "7 days" },
  { value: "last_30_days", label: "30 days" },
  { value: "ytd", label: "YTD" },
  { value: "last_year", label: "1 year" },
  { value: "all_time", label: "All time" },
];

const customOpen = ref(!model.value.range && (!!model.value.from || !!model.value.to));
const from = ref(model.value.from);
const to = ref(model.value.to);

const isCustom = computed(() => customOpen.value);

function pickPreset(value: string) {
  customOpen.value = false;
  model.value = { range: value, from: "", to: "" };
}

function openCustom() {
  customOpen.value = true;
  if (from.value || to.value) applyCustom();
}

function applyCustom() {
  model.value = { range: "", from: from.value, to: to.value };
}

watch([from, to], () => {
  if (customOpen.value) applyCustom();
});
</script>

<template>
  <div class="range-filter" role="group" aria-label="Date range">
    <div class="segments">
      <button
        v-for="p in PRESETS"
        :key="p.value"
        type="button"
        class="segment"
        :class="{ active: !isCustom && model.range === p.value }"
        @click="pickPreset(p.value)"
      >
        {{ p.label }}
      </button>
      <button
        type="button"
        class="segment"
        :class="{ active: isCustom }"
        @click="openCustom"
      >
        Custom
      </button>
    </div>
    <div v-if="isCustom" class="custom-range">
      <input v-model="from" class="input" type="date" aria-label="From date" />
      <span class="dash" aria-hidden="true">–</span>
      <input v-model="to" class="input" type="date" aria-label="To date" />
    </div>
  </div>
</template>

<style scoped>
.range-filter {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.segments {
  display: inline-flex;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}

.segment {
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 13px;
  border-radius: 7px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  white-space: nowrap;
}
.segment:hover {
  color: var(--text-1);
  background: var(--bg-surface-2);
}
.segment.active {
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 600;
}
.segment:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.custom-range {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.dash {
  color: var(--text-3);
}
</style>
