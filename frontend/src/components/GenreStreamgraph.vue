<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { GenreEra, GenreEras } from "../types";

export interface StreamRow {
  key: string;
  label: string;
  color: string;
}

/**
 * Streamgraph of listening shares per bucket. Each row is smoothed with a
 * centred Gaussian window (σ = 2 buckets, window 7), every bucket is then
 * normalised to shares ("expand" stacking) and the rows are stacked with the
 * biggest in the middle. Areas are monotone-cubic curves (no overshoot, so
 * neighbouring bands never cross). An era header sits above the plot, the
 * top 5 rows get an in-band label at their peak bucket.
 */
const props = withDefaults(
  defineProps<{
    buckets: string[]; // bucket keys as the API gives them (YYYY-MM for months)
    rows: StreamRow[];
    values: number[][]; // [row][bucket]
    eras?: GenreEra[];
    /** Year × group shares for the screen-reader table (falls back to buckets × rows). */
    years?: GenreEras["years"];
    height?: number;
    formatBucket?: (bucket: string) => string;
    ariaLabel?: string;
  }>(),
  { eras: () => [], years: () => [], height: 360, formatBucket: undefined, ariaLabel: undefined }
);

const M = { left: 8, right: 8, top: 60, bottom: 24 };
const TOP_LABELS = 5;

const container = ref<HTMLDivElement | null>(null);
const width = ref(800);
let ro: ResizeObserver | null = null;

onMounted(() => {
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w) width.value = w;
  });
  if (container.value) {
    width.value = container.value.clientWidth || 800;
    ro.observe(container.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

const fmtBucket = computed(() => props.formatBucket ?? ((b: string) => b));
const plotW = computed(() => Math.max(1, width.value - M.left - M.right));
const plotH = computed(() => Math.max(1, props.height - M.top - M.bottom));
const plotBottom = computed(() => M.top + plotH.value);

function x(i: number) {
  const n = props.buckets.length;
  if (n <= 1) return M.left + plotW.value / 2;
  return M.left + (i / (n - 1)) * plotW.value;
}
function y(share: number) {
  return M.top + plotH.value * (1 - share);
}

// --- smoothing: centred Gaussian, σ = 2 buckets, window 7 (±3), renormalised at the edges ---
const SIGMA = 2;
const HALF = 3;
const KERNEL = Array.from({ length: 2 * HALF + 1 }, (_, k) => Math.exp(-((k - HALF) ** 2) / (2 * SIGMA * SIGMA)));

const smoothed = computed<number[][]>(() => {
  const n = props.buckets.length;
  return props.rows.map((_, r) => {
    const v = props.values[r] ?? [];
    const out = new Array<number>(n).fill(0);
    for (let b = 0; b < n; b++) {
      let s = 0;
      let w = 0;
      for (let k = -HALF; k <= HALF; k++) {
        const j = b + k;
        if (j < 0 || j >= n) continue;
        const wk = KERNEL[k + HALF]!;
        s += wk * (v[j] ?? 0);
        w += wk;
      }
      out[b] = w > 0 ? s / w : 0;
    }
    return out;
  });
});

/** shares[bucket][row], each bucket normalised to 1 (0 where the bucket is empty) */
const shares = computed<number[][]>(() => {
  const n = props.buckets.length;
  const sm = smoothed.value;
  return Array.from({ length: n }, (_, b) => {
    let sum = 0;
    for (let r = 0; r < sm.length; r++) sum += sm[r]![b]!;
    return sm.map((row) => (sum > 0 ? row[b]! / sum : 0));
  });
});

/** raw shares (unsmoothed) for the peak labels of non-era rows */
const rawShares = computed<number[][]>(() => {
  const n = props.buckets.length;
  return Array.from({ length: n }, (_, b) => {
    let sum = 0;
    for (let r = 0; r < props.rows.length; r++) sum += props.values[r]?.[b] ?? 0;
    return props.rows.map((_, r) => (sum > 0 ? (props.values[r]?.[b] ?? 0) / sum : 0));
  });
});

const totals = computed(() => props.rows.map((_, r) => (props.values[r] ?? []).reduce((a, b) => a + b, 0)));
const rowsByTotal = computed(() =>
  props.rows.map((_, i) => i).sort((a, b) => totals.value[b]! - totals.value[a]!)
);

/**
 * Stack order (bottom → top). Like the poster, the biggest rows sit in the
 * middle: take the rows by total desc, put the largest in the centre, then
 * alternate — 2nd below it, 3rd above, 4th below, 5th above … so the thin
 * rows end up at the edges where they don't bend the big bands.
 */
const stackOrder = computed(() => {
  const deque: number[] = [];
  rowsByTotal.value.forEach((r, i) => {
    if (i % 2 === 0) deque.push(r);
    else deque.unshift(r);
  });
  return deque;
});

interface Band {
  r: number;
  lo: number[];
  hi: number[];
}
const bands = computed<Band[]>(() => {
  const n = props.buckets.length;
  const cum = new Array<number>(n).fill(0);
  return stackOrder.value.map((r) => {
    const lo = cum.slice();
    const hi = cum.map((c, b) => c + (shares.value[b]?.[r] ?? 0));
    for (let b = 0; b < n; b++) cum[b] = hi[b]!;
    return { r, lo, hi };
  });
});

// --- monotone cubic interpolation (d3.curveMonotoneX), no overshoot ---
function sign(v: number) {
  return v < 0 ? -1 : 1;
}
function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}
function slope2(x0: number, y0: number, x1: number, y1: number, t: number) {
  const h = x1 - x0;
  return h ? (3 * (y1 - y0)) / h - t : t;
}
/** Bézier segments from point 0 to the last point (no leading M). */
function curve(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n < 2) return "";
  if (n === 2) return `L${xs[1]!.toFixed(1)},${ys[1]!.toFixed(1)}`;
  const m = new Array<number>(n);
  for (let i = 1; i < n - 1; i++) m[i] = slope3(xs[i - 1]!, ys[i - 1]!, xs[i]!, ys[i]!, xs[i + 1]!, ys[i + 1]!);
  m[0] = slope2(xs[0]!, ys[0]!, xs[1]!, ys[1]!, m[1]!);
  m[n - 1] = slope2(xs[n - 2]!, ys[n - 2]!, xs[n - 1]!, ys[n - 1]!, m[n - 2]!);
  let out = "";
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1]! - xs[i]!) / 3;
    out += `C${(xs[i]! + dx).toFixed(1)},${(ys[i]! + dx * m[i]!).toFixed(1)} ${(xs[i + 1]! - dx).toFixed(1)},${(
      ys[i + 1]! - dx * m[i + 1]!
    ).toFixed(1)} ${xs[i + 1]!.toFixed(1)},${ys[i + 1]!.toFixed(1)}`;
  }
  return out;
}

const xs = computed(() => props.buckets.map((_, i) => x(i)));

const areas = computed(() => {
  const n = props.buckets.length;
  if (n < 2) return [];
  const X = xs.value;
  const Xr = X.slice().reverse();
  return bands.value.map((band) => {
    const top = band.hi.map(y);
    const bottom = band.lo.map(y).reverse();
    const row = props.rows[band.r]!;
    return {
      key: row.key,
      color: row.color,
      d: `M${X[0]!.toFixed(1)},${top[0]!.toFixed(1)} ${curve(X, top)} L${Xr[0]!.toFixed(1)},${bottom[0]!.toFixed(1)} ${curve(Xr, bottom)} Z`,
    };
  });
});

// --- colour → text treatment for in-band labels ---
function relativeLuminance(hex: string) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return 0;
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** First bucket index of an era: by full key prefix, else by its year. */
function bucketIndexOf(start: number | string) {
  const s = String(start);
  let i = props.buckets.findIndex((b) => b.startsWith(s));
  if (i < 0) i = props.buckets.findIndex((b) => b.slice(0, 4) === s.slice(0, 4));
  return i;
}

const eraMarks = computed(() => {
  const n = props.buckets.length;
  if (!n) return [];
  const out: Array<{ key: string; x: number; label: string; range: string; anchor: string; row: number }> = [];
  // Short eras sit close together, so a label that would run into the previous one
  // drops to a second header row. Width is estimated from the text length.
  const rowEnd = [-Infinity, -Infinity];
  for (const era of props.eras) {
    const i = bucketIndexOf(era.start);
    if (i < 0) continue;
    const ex = x(i);
    const range = era.start === era.end ? String(era.start) : `${era.start}–${era.end}`;
    const anchor = ex > width.value - M.right - 90 ? "end" : "start";
    const w = Math.max(era.label.length * 6.4, range.length * 6) + 10;
    const left = anchor === "end" ? ex - w : ex;
    const row = left >= rowEnd[0]! ? 0 : left >= rowEnd[1]! ? 1 : 0;
    rowEnd[row] = left + w;
    out.push({ key: `${era.group}-${era.start}`, x: ex, label: era.label, range, anchor, row });
  }
  return out;
});

const bandLabels = computed(() => {
  const n = props.buckets.length;
  if (!n) return [];
  const out: Array<{
    key: string;
    x: number;
    y: number;
    anchor: string;
    name: string;
    detail: string | null;
    dark: boolean;
  }> = [];
  for (const r of rowsByTotal.value.slice(0, TOP_LABELS)) {
    const band = bands.value.find((b) => b.r === r);
    const row = props.rows[r];
    if (!band || !row) continue;
    // peak = the bucket where the (smoothed) band is thickest
    let peak = 0;
    let best = -1;
    for (let b = 0; b < n; b++) {
      const t = band.hi[b]! - band.lo[b]!;
      if (t > best) {
        best = t;
        peak = b;
      }
    }
    const thickness = plotH.value * best;
    if (thickness < 13) continue;
    // a group can have several eras (it came back): quote its strongest one
    const era = props.eras
      .filter((e) => e.group === row.key)
      .sort((a, b) => b.peakShare - a.peakShare)[0];
    const pct = era ? era.peakShare : best;
    const year = era ? era.peakYear : props.buckets[peak]!.slice(0, 4);
    const px = x(peak);
    out.push({
      key: row.key,
      x: px,
      y: y((band.hi[peak]! + band.lo[peak]!) / 2),
      anchor: px < M.left + 70 ? "start" : px > width.value - M.right - 70 ? "end" : "middle",
      name: row.label,
      detail: thickness >= 28 ? `${Math.round(pct * 100)}% in ${year}` : null,
      dark: relativeLuminance(row.color) < 0.35,
    });
  }
  return out;
});

// --- x ticks: the year at its first bucket for month keys, else ~6 sampled labels ---
const xTicks = computed(() => {
  const n = props.buckets.length;
  if (!n) return [];
  const monthly = props.buckets.every((b) => /^\d{4}-\d{2}$/.test(b));
  if (monthly) {
    const idx: number[] = [];
    let prev = "";
    props.buckets.forEach((b, i) => {
      const yr = b.slice(0, 4);
      if (yr !== prev) {
        idx.push(i);
        prev = yr;
      }
    });
    // sparse buckets (gaps in the history) put several years within a few px: keep a tick
    // only when it sits ≥ 36 px right of the previous one
    const out: Array<{ x: number; label: string; anchor: string }> = [];
    let lastX = -Infinity;
    for (const i of idx) {
      const tx = x(i);
      if (tx - lastX < 36) continue;
      out.push({ x: tx, label: props.buckets[i]!.slice(0, 4), anchor: "start" });
      lastX = tx;
    }
    return out;
  }
  const count = Math.min(6, n);
  const idxs = new Set<number>();
  for (let k = 0; k < count; k++) idxs.add(Math.round((k / (count - 1 || 1)) * (n - 1)));
  const list = [...idxs];
  return list.map((i, k) => ({
    x: x(i),
    label: fmtBucket.value(props.buckets[i]!),
    anchor: k === 0 ? "start" : k === list.length - 1 ? "end" : "middle",
  }));
});

// --- hover / crosshair ---
const hoverIndex = ref<number | null>(null);
function onPointerMove(e: PointerEvent) {
  const rect = container.value!.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const n = props.buckets.length;
  if (!n) return;
  const t = (px - M.left) / plotW.value;
  hoverIndex.value = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
}
function onPointerLeave() {
  hoverIndex.value = null;
}
const hover = computed(() => {
  if (hoverIndex.value === null) return null;
  const b = hoverIndex.value;
  const bucket = props.buckets[b];
  if (bucket === undefined) return null;
  const rows = props.rows
    .map((row, r) => ({ name: row.label, color: row.color, share: shares.value[b]?.[r] ?? 0 }))
    .filter((r) => r.share > 0)
    .sort((a, c) => c.share - a.share)
    .slice(0, 6)
    .map((r) => ({ ...r, text: `${(r.share * 100).toFixed(1)}%` }));
  const hx = x(b);
  return { x: hx, label: fmtBucket.value(bucket), rows, flip: hx > width.value - 220 };
});

// --- screen-reader table: year × group shares when the eras endpoint gave years ---
const tableRows = computed(() => {
  if (props.years.length) {
    return props.years.map((yr) => ({
      label: String(yr.year),
      cells: props.rows.map((row) => `${((yr.shares[row.key] ?? 0) * 100).toFixed(1)}%`),
    }));
  }
  return props.buckets.map((b, i) => ({
    label: fmtBucket.value(b),
    cells: props.rows.map((_, r) => `${((rawShares.value[i]?.[r] ?? 0) * 100).toFixed(1)}%`),
  }));
});
</script>

<template>
  <div ref="container" class="streamgraph">
    <div class="plot" :style="{ height: height + 'px' }" @pointermove="onPointerMove" @pointerleave="onPointerLeave">
      <svg :width="width" :height="height" :aria-label="ariaLabel" role="img">
        <!-- bands -->
        <g>
          <path v-for="a in areas" :key="a.key" :d="a.d" :fill="a.color" class="band" />
        </g>

        <!-- era header: label + range at the era's start, a thin rule down the plot -->
        <g>
          <template v-for="e in eraMarks" :key="e.key">
            <line :x1="e.x" :x2="e.x" :y1="M.top - 12" :y2="plotBottom" class="era-rule" />
            <text :x="e.x + (e.anchor === 'end' ? -5 : 5)" :y="12 + e.row * 26" class="era-label" :text-anchor="e.anchor">
              {{ e.label }}
            </text>
            <text :x="e.x + (e.anchor === 'end' ? -5 : 5)" :y="24 + e.row * 26" class="era-range" :text-anchor="e.anchor">
              {{ e.range }}
            </text>
          </template>
        </g>

        <!-- in-band labels at each top row's peak -->
        <g>
          <template v-for="l in bandLabels" :key="l.key">
            <text
              :x="l.x"
              :y="l.detail ? l.y - 2 : l.y + 4"
              class="band-label"
              :class="l.dark ? 'on-dark' : 'on-light'"
              :text-anchor="l.anchor"
            >
              {{ l.name }}
            </text>
            <text
              v-if="l.detail"
              :x="l.x"
              :y="l.y + 12"
              class="band-detail"
              :class="l.dark ? 'on-dark' : 'on-light'"
              :text-anchor="l.anchor"
            >
              {{ l.detail }}
            </text>
          </template>
        </g>

        <!-- x labels -->
        <g>
          <text
            v-for="(t, i) in xTicks"
            :key="'x' + i"
            :x="t.x"
            :y="height - 8"
            class="tick-label"
            :text-anchor="t.anchor"
          >
            {{ t.label }}
          </text>
        </g>

        <!-- crosshair -->
        <line v-if="hover" :x1="hover.x" :x2="hover.x" :y1="M.top" :y2="plotBottom" class="crosshair" />
      </svg>

      <div
        v-if="hover"
        class="chart-tooltip"
        :style="{
          left: hover.x + (hover.flip ? -12 : 12) + 'px',
          top: M.top + 8 + 'px',
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
      <li v-for="row in rows" :key="row.key" class="legend-item">
        <span class="swatch" :style="{ background: row.color }" />
        <span class="legend-name" :title="row.label">{{ row.label }}</span>
      </li>
    </ul>

    <!-- wrapped in a div: a bare table ignores the 1px width and would widen the page -->
    <div class="sr-only">
      <table>
        <caption>{{ ariaLabel }}</caption>
        <thead>
          <tr>
            <th scope="col">{{ years.length ? "Year" : "Bucket" }}</th>
            <th v-for="row in rows" :key="row.key" scope="col">{{ row.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tr in tableRows" :key="tr.label">
            <th scope="row">{{ tr.label }}</th>
            <td v-for="(c, i) in tr.cells" :key="i">{{ c }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.streamgraph {
  width: 100%;
}
.plot {
  position: relative;
  width: 100%;
}
svg {
  display: block;
}
.band {
  /* a surface-coloured hairline separates the bands */
  stroke: var(--bg-surface);
  stroke-width: 1;
}
.era-rule {
  stroke: var(--axis);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.era-label {
  fill: var(--text-1);
  font-size: 11.5px;
  font-weight: 600;
}
.era-range {
  fill: var(--text-3);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.band-label {
  font-size: 12px;
  font-weight: 650;
  paint-order: stroke fill;
  stroke-linejoin: round;
  stroke-width: 3;
  pointer-events: none;
}
.band-detail {
  font-size: 10.5px;
  font-weight: 500;
  paint-order: stroke fill;
  stroke-linejoin: round;
  stroke-width: 3;
  pointer-events: none;
}
/* ink is fixed per band lightness (not --text-1: in dark mode that is near-white and
   would vanish on a yellow band); the halo lifts it off busy neighbours */
.on-dark {
  fill: #ffffff;
  stroke: rgba(0, 0, 0, 0.5);
}
.on-light {
  fill: #101b1e;
  stroke: rgba(255, 255, 255, 0.55);
}
.tick-label {
  fill: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.crosshair {
  stroke: var(--text-1);
  stroke-width: 1;
  opacity: 0.6;
  pointer-events: none;
}

.legend {
  list-style: none;
  margin: 8px 0 0;
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
  max-width: 200px;
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
