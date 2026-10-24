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
    /** Dashed horizontal line at `value` with a small label at its right end. */
    referenceLine?: { value: number; label: string };
    /** Dot + label on the series at data index `index`. */
    marker?: { index: number; label: string };
  }>(),
  { height: 260, referenceLine: undefined, marker: undefined }
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
  Math.max(1, props.referenceLine?.value ?? 0, ...props.data.map((d) => d.value))
);
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

/** Labels closer than this (px) are thinned so date labels never overlap on narrow charts. */
const MIN_LABEL_GAP = 64;

/** ~6 x-axis labels, evenly sampled, then thinned to ≥ 64px apart (first and last always kept). */
const xLabels = computed(() => {
  const n = props.data.length;
  if (!n) return [];
  const count = Math.min(6, n);
  const idxs = new Set<number>();
  for (let k = 0; k < count; k++) idxs.add(Math.round((k / (count - 1 || 1)) * (n - 1)));
  const candidates = [...idxs];
  const last = candidates[candidates.length - 1]!;
  const lastX = x(last);
  const kept: number[] = [];
  let prevX = -Infinity;
  for (const i of candidates) {
    if (i === last) break;
    const xi = x(i);
    // the first label is start-anchored and the last end-anchored, so their
    // text reaches further inwards than a centered label: ask for 1.5× the gap there
    const gapToPrev = kept.length === 1 ? MIN_LABEL_GAP * 1.5 : MIN_LABEL_GAP;
    if (xi - prevX < gapToPrev || lastX - xi < MIN_LABEL_GAP * 1.5) continue;
    kept.push(i);
    prevX = xi;
  }
  if (!kept.includes(last)) kept.push(last);
  return kept.map((i) => ({ x: x(i), label: props.data[i]?.label ?? "" }));
});

const reference = computed(() => {
  const r = props.referenceLine;
  if (!r) return null;
  return { y: y(r.value), label: r.label };
});

const markerPoint = computed(() => {
  const m = props.marker;
  if (!m) return null;
  const d = props.data[m.index];
  if (!d) return null;
  const mx = x(m.index);
  return {
    x: mx,
    y: y(d.value),
    label: m.label,
    // keep the label inside the plot: anchor it away from the nearest edge
    anchor: mx > width.value - 90 ? "end" : mx < M.left + 90 ? "start" : "middle",
  };
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
    // flip to the left of the cursor near the right edge so the tooltip stays in view
    flip: hx > width.value - 180,
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

      <!-- reference line (e.g. an average) -->
      <g v-if="reference && data.length">
        <line :x1="M.left" :x2="width - M.right" :y1="reference.y" :y2="reference.y" class="reference" />
        <text :x="width - M.right - 4" :y="reference.y + 12" class="reference-label" text-anchor="end">
          {{ reference.label }}
        </text>
      </g>

      <!-- marker (a called-out point) -->
      <g v-if="markerPoint">
        <circle :cx="markerPoint.x" :cy="markerPoint.y" r="5" class="marker-dot" />
        <text
          :x="markerPoint.x"
          :y="markerPoint.y - 11"
          class="marker-label"
          :text-anchor="markerPoint.anchor"
        >
          {{ markerPoint.label }}
        </text>
      </g>

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

    <div class="sr-only">
    <table>
      <caption>{{ ariaLabel }}</caption>
      <tbody>
        <tr v-for="d in data" :key="d.label">
          <th scope="row">{{ d.label }}</th>
          <td>{{ fmt(d.value) }}</td>
        </tr>
      </tbody>
    </table>
    </div>
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
.reference {
  stroke: var(--text-3);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.reference-label {
  fill: var(--text-3);
  font-size: 11px;
}
.marker-dot {
  fill: var(--text-1);
  stroke: var(--bg-surface);
  stroke-width: 2;
}
.marker-label {
  fill: var(--text-1);
  font-size: 11px;
  font-weight: 600;
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
