<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatNumber, niceTicks } from "../lib/format";

export interface StackedSeries {
  name: string;
  color: string;
  values: number[]; // one per bucket, 0 where absent
}

/**
 * Stacked columns, one stack per bucket. Series stack bottom-up in the given
 * order — put "other" last so it sits on top in grey. Same chrome as
 * ColumnChart (margins, ResizeObserver, nice ticks, labelEvery).
 */
const props = withDefaults(
  defineProps<{
    buckets: string[]; // axis labels, one per stack
    series: StackedSeries[];
    height?: number;
    formatValue?: (n: number) => string;
    ariaLabel?: string;
    /** show every n-th x label (1 = all) */
    labelEvery?: number;
  }>(),
  { height: 220, labelEvery: 1 }
);

const M = { left: 44, right: 8, top: 10, bottom: 26 };
const MAX_BAR = 28;
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

/** per bucket: total of all series */
const totals = computed(() =>
  props.buckets.map((_, b) => props.series.reduce((sum, s) => sum + (s.values[b] ?? 0), 0))
);
const maxValue = computed(() => Math.max(1, ...totals.value));
const ticks = computed(() => niceTicks(maxValue.value));
const yMax = computed(() => Math.max(maxValue.value, ticks.value[ticks.value.length - 1] ?? 1));

const band = computed(() => plotW.value / Math.max(1, props.buckets.length));
const barW = computed(() => Math.min(MAX_BAR, Math.max(2, band.value - GAP * 2)));

function xCenter(i: number) {
  return M.left + band.value * (i + 0.5);
}
function y(v: number) {
  return M.top + plotH.value * (1 - v / yMax.value);
}

/** Segment rects, bottom-up per bucket. Zero-height segments are skipped. */
const segments = computed(() => {
  const out: Array<{ key: string; x: number; y: number; w: number; h: number; color: string; bucket: number }> = [];
  const w = barW.value;
  for (let b = 0; b < props.buckets.length; b++) {
    let acc = 0;
    const xL = xCenter(b) - w / 2;
    props.series.forEach((s, si) => {
      const v = s.values[b] ?? 0;
      if (v <= 0) return;
      const yTop = y(acc + v);
      const yBot = y(acc);
      out.push({ key: `${b}-${si}`, x: xL, y: yTop, w, h: Math.max(0, yBot - yTop), color: s.color, bucket: b });
      acc += v;
    });
  }
  return out;
});

const hoverIndex = ref<number | null>(null);

const hover = computed(() => {
  if (hoverIndex.value === null) return null;
  const b = hoverIndex.value;
  const label = props.buckets[b];
  if (label === undefined) return null;
  const rows = props.series
    .map((s) => ({ name: s.name, color: s.color, value: s.values[b] ?? 0 }))
    .filter((r) => r.value > 0)
    .reverse(); // top of the stack first, like the visual order
  const hx = xCenter(b);
  return {
    x: hx,
    y: y(totals.value[b] ?? 0),
    label,
    total: fmt.value(totals.value[b] ?? 0),
    rows: rows.map((r) => ({ ...r, text: fmt.value(r.value) })),
    flip: hx > width.value - 220,
  };
});
</script>

<template>
  <div ref="container" class="stacked-chart">
    <div class="plot" :style="{ height: height + 'px' }">
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

        <!-- stacks -->
        <g>
          <rect
            v-for="s in segments"
            :key="s.key"
            :x="s.x"
            :y="s.y"
            :width="s.w"
            :height="s.h"
            :fill="s.color"
            class="segment"
            :class="{ lifted: hoverIndex === s.bucket }"
          />
        </g>

        <!-- x labels -->
        <g>
          <template v-for="(label, i) in buckets" :key="'l' + i">
            <text v-if="i % labelEvery === 0" :x="xCenter(i)" :y="height - 8" class="tick-label" text-anchor="middle">
              {{ label }}
            </text>
          </template>
        </g>

        <!-- hit targets (band-wide, focusable) -->
        <g>
          <rect
            v-for="(label, i) in buckets"
            :key="'h' + i"
            :x="M.left + band * i"
            :y="M.top"
            :width="band"
            :height="plotH"
            class="hit"
            tabindex="0"
            :aria-label="`${label}: ${fmt(totals[i] ?? 0)}`"
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
        <span class="tooltip-label">{{ hover.label }}</span>
        <span v-for="r in hover.rows" :key="r.name" class="tooltip-row">
          <span class="swatch" :style="{ background: r.color }" />
          <span class="tooltip-name">{{ r.name }}</span>
          <span class="tooltip-num">{{ r.text }}</span>
        </span>
        <span class="tooltip-row tooltip-total">
          <span class="swatch swatch-none" />
          <span class="tooltip-name">Total</span>
          <span class="tooltip-num">{{ hover.total }}</span>
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
            <th scope="col">Bucket</th>
            <th v-for="s in series" :key="s.name" scope="col">{{ s.name }}</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(label, b) in buckets" :key="label">
            <th scope="row">{{ label }}</th>
            <td v-for="s in series" :key="s.name">{{ fmt(s.values[b] ?? 0) }}</td>
            <td>{{ fmt(totals[b] ?? 0) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.stacked-chart {
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
.segment {
  /* a surface-colored hairline separates stacked segments */
  stroke: var(--bg-surface);
  stroke-width: 1;
  transition: opacity 0.1s;
}
.segment.lifted {
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
  max-width: 180px;
}
.legend-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
.swatch-none {
  background: transparent;
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
.tooltip-total {
  margin-top: 2px;
  padding-top: 3px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  font-weight: 650;
}
</style>
