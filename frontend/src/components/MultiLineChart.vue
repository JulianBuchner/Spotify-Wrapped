<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatNumber, niceTicks } from "../lib/format";

export interface LineSeries {
  name: string;
  color: string;
  values: number[]; // one per x label
}

/**
 * 2–4 lines over shared x labels, TimeSeriesChart's chrome (margins, nice
 * ticks, crosshair) with a legend row and a tooltip listing every series.
 */
const props = withDefaults(
  defineProps<{
    labels: string[];
    series: LineSeries[];
    height?: number;
    formatValue?: (n: number) => string;
    /** Pin the y axis to this maximum (e.g. 100 for percentages). */
    maxValue?: number;
    ariaLabel?: string;
  }>(),
  { height: 260, formatValue: undefined, maxValue: undefined, ariaLabel: undefined }
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

const maxValue = computed(() =>
  Math.max(1, props.maxValue ?? 0, ...props.series.flatMap((s) => s.values))
);
const ticks = computed(() => niceTicks(maxValue.value));
const yMax = computed(() => Math.max(maxValue.value, ticks.value[ticks.value.length - 1] ?? 1));

function x(i: number) {
  const n = props.labels.length;
  if (n <= 1) return M.left + plotW.value / 2;
  return M.left + (i / (n - 1)) * plotW.value;
}
function y(v: number) {
  return M.top + plotH.value * (1 - v / yMax.value);
}

const lines = computed(() =>
  props.series.map((s) => ({
    name: s.name,
    color: s.color,
    d: props.labels
      .map((_, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s.values[i] ?? 0).toFixed(1)}`)
      .join(" "),
    dots: props.labels.length <= 24 ? props.labels.map((_, i) => ({ x: x(i), y: y(s.values[i] ?? 0) })) : [],
  }))
);

/** ~6 x-axis labels, evenly sampled */
const xLabels = computed(() => {
  const n = props.labels.length;
  if (!n) return [];
  const count = Math.min(6, n);
  const idxs = new Set<number>();
  for (let k = 0; k < count; k++) idxs.add(Math.round((k / (count - 1 || 1)) * (n - 1)));
  return [...idxs].map((i) => ({ x: x(i), label: props.labels[i] ?? "" }));
});

// --- hover / crosshair ---
const hoverIndex = ref<number | null>(null);
function onPointerMove(e: PointerEvent) {
  const rect = container.value!.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const n = props.labels.length;
  if (!n) return;
  const t = (px - M.left) / plotW.value;
  hoverIndex.value = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
}
function onPointerLeave() {
  hoverIndex.value = null;
}
const hover = computed(() => {
  if (hoverIndex.value === null) return null;
  const i = hoverIndex.value;
  const label = props.labels[i];
  if (label === undefined) return null;
  const hx = x(i);
  return {
    x: hx,
    label,
    rows: props.series.map((s) => ({
      name: s.name,
      color: s.color,
      y: y(s.values[i] ?? 0),
      text: fmt.value(s.values[i] ?? 0),
    })),
    flip: hx > width.value - 200,
  };
});
</script>

<template>
  <div ref="container" class="multi-line">
    <div class="plot" :style="{ height: height + 'px' }" @pointermove="onPointerMove" @pointerleave="onPointerLeave">
      <svg :width="width" :height="height" :aria-label="ariaLabel" role="img">
        <!-- gridlines + y ticks -->
        <g>
          <template v-for="t in ticks" :key="t">
            <line :x1="M.left" :x2="width - M.right" :y1="y(t)" :y2="y(t)" class="gridline" />
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

        <!-- lines + point markers -->
        <g v-for="l in lines" :key="l.name">
          <path :d="l.d" class="line" :stroke="l.color" />
          <circle v-for="(p, i) in l.dots" :key="i" :cx="p.x" :cy="p.y" r="3" class="dot" :fill="l.color" />
        </g>

        <!-- crosshair -->
        <g v-if="hover">
          <line :x1="hover.x" :x2="hover.x" :y1="M.top" :y2="height - M.bottom" class="crosshair" />
          <circle v-for="r in hover.rows" :key="r.name" :cx="hover.x" :cy="r.y" r="5" class="hover-dot" :fill="r.color" />
        </g>
      </svg>

      <div
        v-if="hover"
        class="chart-tooltip"
        :style="{
          left: hover.x + (hover.flip ? -12 : 12) + 'px',
          top: M.top + 4 + 'px',
          transform: hover.flip ? 'translateX(-100%)' : 'none',
        }"
      >
        <span class="tooltip-label">{{ hover.label }}</span>
        <span v-for="r in hover.rows" :key="r.name" class="tooltip-row">
          <span class="swatch" :style="{ background: r.color }" />
          <span class="tooltip-name">{{ r.name }}</span>
          <span class="tooltip-num">{{ r.text }}</span>
        </span>
      </div>
    </div>

    <ul class="legend" aria-hidden="true">
      <li v-for="s in series" :key="s.name" class="legend-item">
        <span class="swatch" :style="{ background: s.color }" />
        <span class="legend-name">{{ s.name }}</span>
      </li>
    </ul>

    <!-- wrapped in a div: a bare table ignores the 1px width and would widen the page -->
    <div class="sr-only">
      <table>
        <caption>{{ ariaLabel }}</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th v-for="s in series" :key="s.name" scope="col">{{ s.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(label, i) in labels" :key="label">
            <th scope="row">{{ label }}</th>
            <td v-for="s in series" :key="s.name">{{ fmt(s.values[i] ?? 0) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.multi-line {
  width: 100%;
}
.plot {
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
.line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.dot {
  stroke: var(--bg-surface);
  stroke-width: 1.5;
}
.crosshair {
  stroke: var(--axis);
  stroke-width: 1;
}
.hover-dot {
  stroke: var(--bg-surface);
  stroke-width: 2;
}

.legend {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-2);
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.chart-tooltip {
  position: absolute;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  padding: 6px 10px;
  border-radius: 8px;
  white-space: nowrap;
  z-index: 3;
  font-size: 12px;
}
.tooltip-label {
  font-size: 11px;
  opacity: 0.75;
  margin-bottom: 2px;
}
.tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tooltip-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tooltip-num {
  margin-left: auto;
  padding-left: 10px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
</style>
