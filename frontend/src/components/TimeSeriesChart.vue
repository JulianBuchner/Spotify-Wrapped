<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatNumber, niceTicks } from "../lib/format";

export interface SeriesPoint {
  label: string;
  value: number;
}

const props = withDefaults(
  defineProps<{
    data: SeriesPoint[];
    height?: number;
    formatValue?: (n: number) => string;
    ariaLabel?: string;
  }>(),
  { height: 260 }
);

const M = { left: 48, right: 14, top: 10, bottom: 26 };

const container = ref<HTMLDivElement | null>(null);
const width = ref(600);
let ro: ResizeObserver | null = null;

onMounted(() => {
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w) width.value = w;
  });
  if (container.value) {
    width.value = container.value.clientWidth || 600;
    ro.observe(container.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

const fmt = computed(() => props.formatValue ?? formatNumber);

const plotW = computed(() => Math.max(1, width.value - M.left - M.right));
const plotH = computed(() => Math.max(1, props.height - M.top - M.bottom));

const maxValue = computed(() => Math.max(1, ...props.data.map((d) => d.value)));
const ticks = computed(() => niceTicks(maxValue.value));
const yMax = computed(() => Math.max(maxValue.value, ticks.value[ticks.value.length - 1] ?? 1));

function x(i: number) {
  const n = props.data.length;
  if (n <= 1) return M.left + plotW.value / 2;
  return M.left + (i / (n - 1)) * plotW.value;
}
function y(v: number) {
  return M.top + plotH.value * (1 - v / yMax.value);
}

const linePath = computed(() =>
  props.data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ")
);
const areaPath = computed(() => {
  if (!props.data.length) return "";
  const base = M.top + plotH.value;
  return `${linePath.value} L${x(props.data.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
});

/** ~6 x-axis labels, evenly sampled */
const xLabels = computed(() => {
  const n = props.data.length;
  if (!n) return [];
  const count = Math.min(6, n);
  const idxs = new Set<number>();
  for (let k = 0; k < count; k++) idxs.add(Math.round((k / (count - 1 || 1)) * (n - 1)));
  return [...idxs].map((i) => ({ x: x(i), label: props.data[i]?.label ?? "" }));
});

// --- hover / crosshair ---
const hoverIndex = ref<number | null>(null);

function onPointerMove(e: PointerEvent) {
  const rect = container.value!.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const n = props.data.length;
  if (!n) return;
  const t = (px - M.left) / plotW.value;
  const i = Math.round(t * (n - 1));
  hoverIndex.value = Math.max(0, Math.min(n - 1, i));
}
function onPointerLeave() {
  hoverIndex.value = null;
}

const hover = computed(() => {
  if (hoverIndex.value === null) return null;
  const i = hoverIndex.value;
  const d = props.data[i];
  if (!d) return null;
  const hx = x(i);
  return {
    x: hx,
    y: y(d.value),
    label: d.label,
    value: fmt.value(d.value),
    flip: hx > width.value - 150,
  };
});
</script>

<template>
  <div
    ref="container"
    class="ts-chart"
    :style="{ height: height + 'px' }"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <svg :width="width" :height="height" :aria-label="ariaLabel" role="img">
      <!-- gridlines + y ticks -->
      <g>
        <template v-for="t in ticks" :key="t">
          <line
            :x1="M.left"
            :x2="width - M.right"
            :y1="y(t)"
            :y2="y(t)"
            class="gridline"
          />
          <text :x="M.left - 8" :y="y(t)" class="tick-label" text-anchor="end" dominant-baseline="middle">
            {{ formatNumber(t) }}
          </text>
        </template>
      </g>

      <!-- x labels -->
      <g>
        <text
          v-for="(l, i) in xLabels"
          :key="i"
          :x="l.x"
          :y="height - 8"
          class="tick-label"
          :text-anchor="i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'"
        >
          {{ l.label }}
        </text>
      </g>

      <!-- area wash + line -->
      <path v-if="data.length" :d="areaPath" class="area" />
      <path v-if="data.length" :d="linePath" class="line" />

      <!-- crosshair -->
      <g v-if="hover">
        <line :x1="hover.x" :x2="hover.x" :y1="M.top" :y2="height - M.bottom" class="crosshair" />
        <circle :cx="hover.x" :cy="hover.y" r="5" class="hover-dot" />
      </g>
    </svg>

    <div
      v-if="hover"
      class="chart-tooltip"
      :style="{
        left: hover.x + (hover.flip ? -12 : 12) + 'px',
        top: Math.max(hover.y - 14, 4) + 'px',
        transform: hover.flip ? 'translateX(-100%)' : 'none',
      }"
    >
      <span class="tooltip-value">{{ hover.value }}</span>
      <span class="tooltip-label">{{ hover.label }}</span>
    </div>

    <table class="sr-only">
      <caption>{{ ariaLabel }}</caption>
      <tbody>
        <tr v-for="d in data" :key="d.label">
          <th scope="row">{{ d.label }}</th>
          <td>{{ fmt(d.value) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.ts-chart {
  position: relative;
  width: 100%;
}
svg {
  display: block;
}
.gridline {
  stroke: var(--grid);
  stroke-width: 1;
}
.tick-label {
  fill: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.area {
  fill: var(--series-soft);
}
.line {
  fill: none;
  stroke: var(--series);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.crosshair {
  stroke: var(--axis);
  stroke-width: 1;
}
.hover-dot {
  fill: var(--series);
  stroke: var(--bg-surface);
  stroke-width: 2;
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
</style>
