<script setup lang="ts">
import { computed, ref } from "vue";
import { formatNumber } from "../lib/format";

export interface BarItem {
  name: string;
  hours: number;
  streams: number;
}

/**
 * Horizontal bars, one per item (given in rank order), hours label on the
 * right. The "leaders" are highlighted in --series, everyone else in
 * --series-dim: walking from the top, the first item that is ≥ 1.25× the next
 * one closes the leader group (so #1 alone when it towers over #2; #1 and #2
 * when they are close and #3 falls off). No break within the top three →
 * nobody stands out and all bars are dim.
 */
const props = withDefaults(
  defineProps<{
    items: BarItem[];
    ariaLabel?: string;
  }>(),
  { ariaLabel: undefined }
);

const LEADER_RATIO = 1.25;
const MAX_LEADERS = 3;

const leaderCount = computed(() => {
  const it = props.items;
  for (let i = 0; i < Math.min(MAX_LEADERS, it.length); i++) {
    const next = it[i + 1];
    if (!next) return i + 1; // no one after → everyone shown is a leader
    if (it[i]!.hours >= LEADER_RATIO * next.hours) return i + 1;
  }
  return 0;
});

const max = computed(() => Math.max(1, ...props.items.map((i) => i.hours)));

function hoursText(h: number) {
  return `${formatNumber(Math.round(h))} h`;
}

const hover = ref<{ index: number; x: number; y: number } | null>(null);
const listEl = ref<HTMLElement | null>(null);

function onPointerMove(e: PointerEvent, index: number) {
  const rect = listEl.value!.getBoundingClientRect();
  hover.value = { index, x: e.clientX - rect.left, y: e.clientY - rect.top };
}
const tooltip = computed(() => {
  if (!hover.value) return null;
  const it = props.items[hover.value.index];
  if (!it) return null;
  const w = listEl.value?.clientWidth ?? 600;
  return {
    x: hover.value.x,
    y: hover.value.y,
    name: it.name,
    text: `${formatNumber(it.streams)} plays · ${hoursText(it.hours)}`,
    flip: hover.value.x > w - 200,
  };
});
</script>

<template>
  <div ref="listEl" class="bar-list" :aria-label="ariaLabel" role="img">
    <div
      v-for="(it, i) in items"
      :key="it.name"
      class="row"
      :class="{ leader: i < leaderCount }"
      tabindex="0"
      :aria-label="`${i + 1}. ${it.name}: ${hoursText(it.hours)}, ${formatNumber(it.streams)} plays`"
      @pointermove="onPointerMove($event, i)"
      @pointerleave="hover = null"
      @focus="hover = { index: i, x: 160, y: 0 }"
      @blur="hover = null"
    >
      <span class="rank">{{ i + 1 }}</span>
      <span class="name" :title="it.name">{{ it.name }}</span>
      <span class="track">
        <span class="bar" :style="{ width: `${(it.hours / max) * 100}%` }" />
      </span>
      <span class="value">{{ hoursText(it.hours) }}</span>
    </div>

    <div
      v-if="tooltip"
      class="chart-tooltip"
      :style="{
        left: tooltip.x + (tooltip.flip ? -12 : 12) + 'px',
        top: Math.max(tooltip.y - 30, 0) + 'px',
        transform: tooltip.flip ? 'translateX(-100%)' : 'none',
      }"
    >
      <span class="tooltip-value">{{ tooltip.text }}</span>
      <span class="tooltip-label">{{ tooltip.name }}</span>
    </div>

    <!-- wrapped in a div: a bare table ignores the 1px width and would widen the page -->
    <div class="sr-only">
      <table>
        <caption>{{ ariaLabel }}</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Artist</th>
            <th scope="col">Hours</th>
            <th scope="col">Plays</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, i) in items" :key="it.name">
            <td>{{ i + 1 }}</td>
            <th scope="row">{{ it.name }}</th>
            <td>{{ hoursText(it.hours) }}</td>
            <td>{{ formatNumber(it.streams) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.bar-list {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}
.row {
  display: grid;
  grid-template-columns: 18px minmax(90px, 150px) 1fr 56px;
  align-items: center;
  gap: 10px;
  min-width: 0;
  border-radius: 6px;
  outline: none;
}
.row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.rank {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.name {
  font-size: 12.5px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.leader .name {
  color: var(--text-1);
  font-weight: 600;
}
.track {
  display: block;
  height: 14px;
  min-width: 0;
}
.bar {
  display: block;
  height: 100%;
  border-radius: 0 4px 4px 0;
  background: var(--series-dim);
  transition: width 0.2s;
}
.leader .bar {
  background: var(--series);
}
.value {
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.leader .value {
  color: var(--text-1);
  font-weight: 600;
}

.chart-tooltip {
  position: absolute;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  padding: 6px 10px;
  border-radius: 8px;
  white-space: nowrap;
  z-index: 3;
}
.tooltip-value {
  font-size: 13px;
  font-weight: 650;
}
.tooltip-label {
  font-size: 11px;
  opacity: 0.75;
}

/* phone ≤ 640 px: a narrower name column so the bars keep some length */
@media (max-width: 640px) {
  .row {
    grid-template-columns: 18px minmax(72px, 112px) minmax(0, 1fr) 52px;
    gap: 8px;
  }
}
</style>
