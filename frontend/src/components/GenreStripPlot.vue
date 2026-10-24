<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatNumber } from "../lib/format";

export interface StripRow {
  key: string;
  label: string;
  total: number;
}

/**
 * Strip plot like the "listen frequency by genre" poster: one row per genre
 * (or group), one cell per bucket, the row's colour at an opacity that follows
 * value / rowMax (^0.7 so weak buckets still show), nothing drawn where there
 * was no listening. The panel is ALWAYS dark (the vinyl colour), on both
 * themes — the card around it follows the theme. Hovering a label highlights
 * its row, hovering a cell shows its value, clicking a row emits `select`.
 */
const props = withDefaults(
  defineProps<{
    buckets: string[];
    rows: StripRow[];
    values: number[][]; // [row][bucket]
    rowColors: string[];
    height?: number;
    metric?: "streams" | "playtime";
    formatBucket?: (bucket: string) => string;
    ariaLabel?: string;
  }>(),
  { height: undefined, metric: "streams", formatBucket: undefined, ariaLabel: undefined }
);

const emit = defineEmits<{ select: [row: StripRow] }>();

const PANEL = "#121618"; // the record's vinyl colour
const LABEL_W = 190;
/** below this container width (phones) the label column shrinks to 110 px */
const NARROW_W = 560;
const LABEL_W_NARROW = 110;
const M = { right: 10, top: 8, bottom: 22 };
const ROW_H = 22;
const MIN_H = 240;

const container = ref<HTMLDivElement | null>(null);
const width = ref(900);
let ro: ResizeObserver | null = null;

onMounted(() => {
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w) width.value = w;
  });
  if (container.value) {
    width.value = container.value.clientWidth || 900;
    ro.observe(container.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

const labelW = computed(() => (width.value < NARROW_W ? LABEL_W_NARROW : LABEL_W));
const left = computed(() => labelW.value + 10);
const height = computed(() => props.height ?? Math.max(MIN_H, M.top + M.bottom + ROW_H * props.rows.length));
const plotW = computed(() => Math.max(1, width.value - left.value - M.right));
const plotH = computed(() => Math.max(1, height.value - M.top - M.bottom));
const rowH = computed(() => plotH.value / Math.max(1, props.rows.length));
const cellW = computed(() => plotW.value / Math.max(1, props.buckets.length));
/** 1 px gap once cells are wide enough, rounded corners once they are roomy */
const gap = computed(() => (cellW.value >= 4 ? 1 : 0));
const rowGap = computed(() => (rowH.value >= 8 ? 2 : 0));
const radius = computed(() => (cellW.value >= 7 && rowH.value >= 10 ? 2 : 0));

function x(b: number) {
  return left.value + b * cellW.value;
}
function y(r: number) {
  return M.top + r * rowH.value;
}

const rowMax = computed(() => props.rows.map((_, r) => Math.max(1, ...(props.values[r] ?? []))));

function alpha(v: number, r: number) {
  return 0.08 + 0.92 * Math.pow(v / rowMax.value[r]!, 0.7);
}

interface Cell {
  b: number;
  x: number;
  w: number;
  a: number;
}
const cellsByRow = computed<Cell[][]>(() =>
  props.rows.map((_, r) => {
    const out: Cell[] = [];
    const vals = props.values[r] ?? [];
    const w = Math.max(1, cellW.value - gap.value);
    for (let b = 0; b < props.buckets.length; b++) {
      const v = vals[b] ?? 0;
      if (v <= 0) continue;
      out.push({ b, x: x(b), w, a: alpha(v, r) });
    }
    return out;
  })
);

/** Row labels, ellipsised to the label column (SVG text can't do it on its own). */
const maxChars = computed(() => Math.floor(labelW.value / 6.4));
function shortLabel(label: string) {
  const max = maxChars.value;
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// --- x axis: year labels at the first bucket of each year (thinned when crowded) ---
const xTicks = computed(() => {
  const n = props.buckets.length;
  if (!n) return [];
  const dated = props.buckets.every((b) => /^\d{4}(-\d{2})?(-\d{2})?$/.test(b));
  if (dated) {
    const idx: number[] = [];
    let prev = "";
    props.buckets.forEach((b, i) => {
      const yr = b.slice(0, 4);
      if (yr !== prev) {
        idx.push(i);
        prev = yr;
      }
    });
    if (idx.length > 1) {
      // sparse buckets (or a narrow plot) can put several years within a few px:
      // keep a tick only ≥ 40 px after the last, so phones get every 2nd year
      const out: Array<{ x: number; label: string; end: boolean }> = [];
      let lastX = -Infinity;
      for (const i of idx) {
        const tx = x(i);
        if (tx - lastX < 40) continue;
        // a year that starts within ~30 px of the right edge (narrow plots) reads right-to-left of its line
        out.push({ x: tx, label: props.buckets[i]!.slice(0, 4), end: tx + 32 > width.value - M.right });
        lastX = tx;
      }
      return out;
    }
  }
  const count = Math.min(6, n);
  const idxs = new Set<number>();
  for (let k = 0; k < count; k++) idxs.add(Math.round((k / (count - 1 || 1)) * (n - 1)));
  return [...idxs].map((i) => ({ x: x(i), label: fmtBucket.value(props.buckets[i]!), end: false }));
});

const fmtBucket = computed(() => props.formatBucket ?? ((b: string) => b));
const fmtValue = computed(() =>
  props.metric === "playtime"
    ? (v: number) => `${formatNumber(Math.round((v / 3_600_000) * 10) / 10)} hours`
    : (v: number) => `${formatNumber(v)} plays`
);

// --- hover: labels highlight their row, cells show their value ---
const hoverRow = ref<number | null>(null);
const hoverCell = ref<{ r: number; b: number } | null>(null);

function cellAt(e: { clientX: number; clientY: number }) {
  const rect = container.value!.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const r = Math.floor((py - M.top) / rowH.value);
  const b = Math.floor((px - left.value) / cellW.value);
  if (r < 0 || r >= props.rows.length || b < 0 || b >= props.buckets.length) return null;
  return { r, b };
}
function onPlotMove(e: PointerEvent) {
  hoverCell.value = cellAt(e);
}
function onPlotLeave() {
  hoverCell.value = null;
}
/** A tap fires no pointermove first, so the row comes from the click position, not the hover. */
function onPlotClick(e: MouseEvent) {
  const c = cellAt(e);
  if (c) select(c.r);
}

const tooltip = computed(() => {
  const c = hoverCell.value;
  if (!c) return null;
  const v = props.values[c.r]?.[c.b] ?? 0;
  if (v <= 0) return null;
  const hx = x(c.b) + cellW.value / 2;
  return {
    x: hx,
    y: y(c.r),
    text: `${props.rows[c.r]!.label} · ${fmtBucket.value(props.buckets[c.b]!)}`,
    value: fmtValue.value(v),
    flip: hx > width.value - 220,
  };
});

function select(r: number) {
  const row = props.rows[r];
  if (row) emit("select", row);
}

// --- screen-reader table: rows × years (buckets summed per year) ---
const years = computed(() => {
  const set = new Set<string>();
  for (const b of props.buckets) set.add(b.slice(0, 4));
  return [...set];
});
const yearTotals = computed(() =>
  props.rows.map((_, r) => {
    const acc = new Map<string, number>();
    props.buckets.forEach((b, i) => {
      const yr = b.slice(0, 4);
      acc.set(yr, (acc.get(yr) ?? 0) + (props.values[r]?.[i] ?? 0));
    });
    return years.value.map((yr) => acc.get(yr) ?? 0);
  })
);
</script>

<template>
  <div ref="container" class="strip-plot">
    <svg :width="width" :height="height" :aria-label="ariaLabel" role="img">
      <!-- the always-dark panel -->
      <rect x="0" y="0" :width="width" :height="height" :fill="PANEL" rx="8" />

      <!-- year ticks -->
      <g>
        <template v-for="(t, i) in xTicks" :key="'t' + i">
          <line :x1="t.x" :x2="t.x" :y1="M.top" :y2="M.top + plotH" class="tick-line" />
          <text :x="t.x + (t.end ? -3 : 3)" :y="height - 7" class="tick-label" :text-anchor="t.end ? 'end' : 'start'">
            {{ t.label }}
          </text>
        </template>
      </g>

      <!-- rows: label + cells -->
      <g
        v-for="(row, r) in rows"
        :key="row.key"
        class="row"
        :class="{ dimmed: hoverRow !== null && hoverRow !== r }"
        @click="select(r)"
      >
        <rect
          :x="0"
          :y="y(r)"
          :width="left"
          :height="rowH"
          class="label-hit"
          tabindex="0"
          role="button"
          :aria-label="`${row.label}: show top artists`"
          @pointerenter="hoverRow = r"
          @pointerleave="hoverRow = null"
          @focus="hoverRow = r"
          @blur="hoverRow = null"
          @keydown.enter.prevent="select(r)"
          @keydown.space.prevent="select(r)"
        />
        <text :x="labelW" :y="y(r) + rowH / 2" class="row-label" text-anchor="end" dominant-baseline="middle">
          <title>{{ row.label }}</title>
          {{ shortLabel(row.label) }}
        </text>
        <rect
          v-for="c in cellsByRow[r]"
          :key="c.b"
          :x="c.x"
          :y="y(r) + rowGap / 2"
          :width="c.w"
          :height="Math.max(1, rowH - rowGap)"
          :rx="radius"
          :fill="rowColors[r]"
          :fill-opacity="c.a"
          class="cell"
        />
      </g>

      <!-- one hit area over the cells: hover → tooltip, click → select -->
      <rect
        :x="left"
        :y="M.top"
        :width="plotW"
        :height="plotH"
        class="plot-hit"
        @pointermove="onPlotMove"
        @pointerleave="onPlotLeave"
        @click="onPlotClick"
      />
      <rect
        v-if="hoverCell"
        :x="x(hoverCell.b)"
        :y="y(hoverCell.r)"
        :width="cellW"
        :height="rowH"
        class="cell-outline"
      />
    </svg>

    <div
      v-if="tooltip"
      class="chart-tooltip"
      :style="{
        left: tooltip.x + (tooltip.flip ? -10 : 10) + 'px',
        top: Math.max(tooltip.y - 14, 4) + 'px',
        transform: tooltip.flip ? 'translateX(-100%)' : 'none',
      }"
    >
      <span class="tooltip-value">{{ tooltip.value }}</span>
      <span class="tooltip-label">{{ tooltip.text }}</span>
    </div>

    <!-- wrapped in a div: a bare table ignores the 1px width and would widen the page -->
    <div class="sr-only">
      <table>
        <caption>{{ ariaLabel }}</caption>
        <thead>
          <tr>
            <th scope="col">Row</th>
            <th v-for="yr in years" :key="yr" scope="col">{{ yr }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in rows" :key="row.key">
            <th scope="row">{{ row.label }}</th>
            <td v-for="(v, i) in yearTotals[r]" :key="i">{{ v > 0 ? fmtValue(v) : "0" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.strip-plot {
  position: relative;
  width: 100%;
}
svg {
  display: block;
}
.tick-line {
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 1;
}
.tick-label {
  fill: #a3b3b9;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.row {
  cursor: pointer;
  transition: opacity 0.12s;
}
.row.dimmed {
  opacity: 0.35;
}
.row-label {
  fill: #dfe7ea;
  font-size: 11.5px;
  pointer-events: none;
}
.label-hit {
  fill: transparent;
  outline: none;
}
.label-hit:hover {
  fill: rgba(255, 255, 255, 0.06);
}
.label-hit:focus-visible {
  stroke: var(--accent);
  stroke-width: 1.5;
}
.cell {
  pointer-events: none;
}
.plot-hit {
  fill: transparent;
  cursor: pointer;
}
.cell-outline {
  fill: none;
  stroke: rgba(255, 255, 255, 0.7);
  stroke-width: 1;
  pointer-events: none;
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
