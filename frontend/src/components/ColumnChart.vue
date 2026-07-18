<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatNumber, niceTicks } from "../lib/format";

export interface ColumnPoint {
  label: string; // axis label
  tooltipLabel?: string; // longer label for the tooltip (defaults to label)
  value: number;
}

const props = withDefaults(
  defineProps<{
    data: ColumnPoint[];
    height?: number;
    formatValue?: (n: number) => string;
    ariaLabel?: string;
    /** show every n-th x label (1 = all) */
    labelEvery?: number;
  }>(),
  { height: 220, labelEvery: 1 }
);

const M = { left: 44, right: 8, top: 10, bottom: 26 };
const MAX_BAR = 24;
const GAP = 2;

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

const band = computed(() => plotW.value / Math.max(1, props.data.length));
const barW = computed(() => Math.min(MAX_BAR, Math.max(2, band.value - GAP * 2)));

function xCenter(i: number) {
  return M.left + band.value * (i + 0.5);
}
function y(v: number) {
  return M.top + plotH.value * (1 - v / yMax.value);
}
const baseline = computed(() => M.top + plotH.value);

/** Bar path: 4px rounded top corners, square at the baseline. */
function barPath(i: number, v: number) {
  const w = barW.value;
  const xL = xCenter(i) - w / 2;
  const yT = y(v);
  const h = baseline.value - yT;
  const r = Math.min(4, w / 2, h);
  return [
    `M${xL},${baseline.value}`,
    `V${yT + r}`,
    `Q${xL},${yT} ${xL + r},${yT}`,
    `H${xL + w - r}`,
    `Q${xL + w},${yT} ${xL + w},${yT + r}`,
    `V${baseline.value}`,
    "Z",
  ].join(" ");
}

const hoverIndex = ref<number | null>(null);

const hover = computed(() => {
  if (hoverIndex.value === null) return null;
  const i = hoverIndex.value;
  const d = props.data[i];
  if (!d) return null;
  const hx = xCenter(i);
  return {
    x: hx,
    y: y(d.value),
    label: d.tooltipLabel ?? d.label,
    value: fmt.value(d.value),
    flip: hx > width.value - 140,
  };
});
</script>

<template>
  <div ref="container" class="col-chart" :style="{ height: height + 'px' }">
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

      <!-- bars -->
      <g>
        <path
          v-for="(d, i) in data"
          :key="i"
          :d="barPath(i, d.value)"
          class="bar"
          :class="{ lifted: hoverIndex === i }"
        />
      </g>

      <!-- x labels -->
      <g>
        <template v-for="(d, i) in data" :key="'l' + i">
          <text
            v-if="i % labelEvery === 0"
            :x="xCenter(i)"
            :y="height - 8"
            class="tick-label"
            text-anchor="middle"
          >
            {{ d.label }}
          </text>
        </template>
      </g>

      <!-- hit targets (band-wide, focusable) -->
      <g>
        <rect
          v-for="(d, i) in data"
          :key="'h' + i"
          :x="M.left + band * i"
          :y="M.top"
          :width="band"
          :height="plotH"
          class="hit"
          tabindex="0"
          :aria-label="`${d.tooltipLabel ?? d.label}: ${fmt(d.value)}`"
          @pointerenter="hoverIndex = i"
          @pointerleave="hoverIndex = null"
          @focus="hoverIndex = i"
          @blur="hoverIndex = null"
        />
      </g>
    </svg>

    <div
      v-if="hover"
      class="chart-tooltip"
      :style="{
        left: hover.x + (hover.flip ? -10 : 10) + 'px',
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
          <th scope="row">{{ d.tooltipLabel ?? d.label }}</th>
          <td>{{ fmt(d.value) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.col-chart {
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
.bar {
  fill: var(--series);
  transition: opacity 0.1s;
}
.bar.lifted {
  opacity: 0.8;
}
.hit {
  fill: transparent;
  outline: none;
}
.hit:focus-visible {
  stroke: var(--accent);
  stroke-width: 1.5;
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
