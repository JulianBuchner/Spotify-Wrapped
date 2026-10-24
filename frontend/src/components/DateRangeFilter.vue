<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { DateWindow } from "../types";

const model = defineModel<DateWindow>({ required: true });

/** True while the page is still fetching for the selected window. */
defineProps<{ busy?: boolean }>();

// On phones the segment strip scrolls horizontally: keep the active preset in
// view (centered when possible) without scrolling the page.
const segmentsEl = ref<HTMLElement | null>(null);
function revealActive() {
  const strip = segmentsEl.value;
  const active = strip?.querySelector<HTMLElement>(".segment.active");
  if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
  const target = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
  strip.scrollLeft = Math.max(0, Math.min(target, strip.scrollWidth - strip.clientWidth));
}
onMounted(async () => {
  await nextTick();
  revealActive();
});

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
  <div class="range-filter" role="group" aria-label="Date range" :aria-busy="busy || undefined">
    <div ref="segmentsEl" class="segments hscroll">
      <button
        v-for="p in PRESETS"
        :key="p.value"
        type="button"
        class="segment"
        :class="{ active: !isCustom && model.range === p.value }"
        @click="pickPreset(p.value)"
      >
        {{ p.label }}
        <span v-if="busy && !isCustom && model.range === p.value" class="spinner" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="segment"
        :class="{ active: isCustom }"
        @click="openCustom"
      >
        Custom
        <span v-if="busy && isCustom" class="spinner" aria-hidden="true" />
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
.segment .spinner {
  border-color: var(--accent-soft);
  border-top-color: var(--accent-text);
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

/* phone ≤ 640px: the preset strip scrolls sideways, the custom dates take their own line */
@media (max-width: 640px) {
  .range-filter {
    width: 100%;
    max-width: 100%;
    gap: 10px;
  }
  .segments {
    display: flex;
    flex: 0 1 auto;
    max-width: 100%;
    min-width: 0;
  }
  .segment {
    flex-shrink: 0;
    min-height: 36px;
    padding: 6px 12px;
  }
  .custom-range {
    flex: 1 0 100%;
    display: flex;
  }
  .custom-range .input {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
