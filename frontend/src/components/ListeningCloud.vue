<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import type { PlayPoint } from "../types";
import { useTheme } from "../theme";

const props = defineProps<{
  points: PlayPoint[];
  highlight?: string;
}>();

const { theme } = useTheme();

const container = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const tooltip = ref<{ x: number; y: number; text: string } | null>(null);

const DAY_MS = 86_400_000;
const TWO_PI = Math.PI * 2;
const CHUNK = 4000; // dots per fill() — bounds path complexity

// layout (css pixels)
const M_LEFT = 46;
const M_RIGHT = 14;
const M_TOP = 12;
const M_BOTTOM = 26;

// --- view state ------------------------------------------------------------
// x/time: pan + zoom (viewT0 = ts at the left plot edge)
let viewT0 = 0;
let pxPerMs = 1;
let tMin = 0;
let tMax = 1;
let fitPxPerMs = 1;

// y/hours: pan + zoom. yFactor 1 = the full 0–24h day fits the plot;
// higher values stretch the day so plays within one day get breathing room.
// viewH0 = hour at the top plot edge, clamped so the view stays inside 0–24.
let yFactor = 1;
let viewH0 = 0;

const X_MAX_FACTOR = 2000; // matches the old wheel-zoom cap
const Y_MAX_FACTOR = 24; // 24× = one hour spans the whole plot height

// Slider positions 0..100, mapped exponentially to the zoom factors.
const xZoomSlider = ref(0);
const yZoomSlider = ref(0);
let syncingSliders = false; // guard: wheel/reset writes sliders w/o re-applying

let cssW = 1;
let cssH = 1;
let dpr = 1;
let ctx: CanvasRenderingContext2D | null = null;
let ro: ResizeObserver | null = null;
let didFit = false;
let rafId = 0;

let dragging = false;
let lastDragX = 0;
let lastDragY = 0;

// ---------------------------------------------------------------------------
// Flat buffers — the hot loops must never touch Vue's reactive proxies or do
// per-frame string work. Rebuilt once whenever props.points changes.
// points arrive sorted by ts ascending (the API orders by playedAt), which
// lets render/hover binary-search the visible range instead of scanning all.
// ---------------------------------------------------------------------------
let count = 0;
let tsArr = new Float64Array(0);
let hourArr = new Float64Array(0);
let trackRaw: string[] = [];
let artistRaw: string[] = [];
let playlistRaw: (string | null)[] = [];
let trackLower: string[] = [];
let artistLower: string[] = [];

// 1 = matches the current highlight query; null when no query is active.
// Recomputed once per query change — not per frame, not per keystroke render.
let matchMask: Uint8Array | null = null;

// Pixel-dedupe grid: one Int32 per css pixel holding the stamp of the last
// pass that drew there. Zoomed out, most of 190k dots collapse onto the same
// pixels — skipping those cuts the drawn arcs to roughly the visible pixels.
let grid = new Int32Array(0);
let gridW = 0;
let gridH = 0;
let stamp = 0;

function rebuildBuffers() {
  const pts = props.points;
  const n = pts.length;
  count = n;
  tsArr = new Float64Array(n);
  hourArr = new Float64Array(n);
  trackRaw = new Array(n);
  artistRaw = new Array(n);
  playlistRaw = new Array(n);
  trackLower = new Array(n);
  artistLower = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    tsArr[i] = p.ts;
    hourArr[i] = p.hour;
    trackRaw[i] = p.track;
    artistRaw[i] = p.artist;
    playlistRaw[i] = p.playlist;
    trackLower[i] = p.track.toLowerCase();
    artistLower[i] = p.artist.toLowerCase();
  }
  recomputeMask();
}

function recomputeMask() {
  const q = (props.highlight ?? "").trim().toLowerCase();
  if (!q) {
    matchMask = null;
    return;
  }
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (artistLower[i]!.includes(q) || trackLower[i]!.includes(q)) mask[i] = 1;
  }
  matchMask = mask;
}

/** First index with tsArr[i] >= v (tsArr is ascending). */
function lowerBound(v: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tsArr[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function plotW() {
  return Math.max(1, cssW - M_LEFT - M_RIGHT);
}
function plotH() {
  return Math.max(1, cssH - M_TOP - M_BOTTOM);
}

// --- y transform -------------------------------------------------------------
function pxPerHour() {
  return (plotH() / 24) * yFactor;
}
function visibleHours() {
  return 24 / yFactor;
}
function clampViewH0(h: number) {
  return Math.min(Math.max(h, 0), 24 - visibleHours());
}
function yToPx(hour: number) {
  return M_TOP + (hour - viewH0) * pxPerHour();
}
function pxToHour(py: number) {
  return viewH0 + (py - M_TOP) / pxPerHour();
}

function computeDomain() {
  if (!count) {
    tMin = Date.now() - DAY_MS;
    tMax = Date.now();
    return;
  }
  tMin = tsArr[0]!;
  tMax = tsArr[count - 1]!;
  if (tMax <= tMin) tMax = tMin + DAY_MS;
}

function fitView() {
  computeDomain();
  const pad = 0.02;
  const span = (tMax - tMin) * (1 + pad * 2);
  pxPerMs = plotW() / span;
  fitPxPerMs = pxPerMs;
  viewT0 = tMin - (tMax - tMin) * pad;
  didFit = true;
}

function xToPx(ts: number) {
  return M_LEFT + (ts - viewT0) * pxPerMs;
}
function pxToTs(px: number) {
  return viewT0 + (px - M_LEFT) / pxPerMs;
}

// --- slider <-> factor mapping -----------------------------------------------
function xFactorFromSlider(v: number) {
  return Math.pow(X_MAX_FACTOR, v / 100);
}
function yFactorFromSlider(v: number) {
  return Math.pow(Y_MAX_FACTOR, v / 100);
}
function sliderFromXFactor(f: number) {
  return Math.min(100, Math.max(0, (100 * Math.log(f)) / Math.log(X_MAX_FACTOR)));
}
function sliderFromYFactor(f: number) {
  return Math.min(100, Math.max(0, (100 * Math.log(f)) / Math.log(Y_MAX_FACTOR)));
}

/** Reflect the current view factors in the sliders without re-applying them. */
function syncSliders() {
  syncingSliders = true;
  xZoomSlider.value = sliderFromXFactor(pxPerMs / fitPxPerMs);
  yZoomSlider.value = sliderFromYFactor(yFactor);
  nextTick(() => {
    syncingSliders = false;
  });
}

watch(xZoomSlider, (v) => {
  if (syncingSliders) return;
  // zoom around the plot center so the slider feels stable
  const centerTs = pxToTs(M_LEFT + plotW() / 2);
  pxPerMs = fitPxPerMs * xFactorFromSlider(v);
  viewT0 = centerTs - plotW() / 2 / pxPerMs;
  tooltip.value = null;
  scheduleRender();
});

watch(yZoomSlider, (v) => {
  if (syncingSliders) return;
  const centerHour = viewH0 + visibleHours() / 2;
  yFactor = yFactorFromSlider(v);
  viewH0 = clampViewH0(centerHour - visibleHours() / 2);
  tooltip.value = null;
  scheduleRender();
});

function resizeCanvas() {
  const c = canvas.value;
  const cont = container.value;
  if (!c || !cont) return;
  cssW = cont.clientWidth;
  cssH = cont.clientHeight;
  dpr = window.devicePixelRatio || 1;
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = cssW + "px";
  c.style.height = cssH + "px";
}

function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    render();
  });
}

function niceXStep(spanDays: number): "year" | "month" | "week" | "day" {
  const spanYears = spanDays / 365;
  if (spanDays <= 14) return "day";
  if (spanDays <= 120) return "week";
  if (spanYears < 1.5) return "month";
  return "year";
}

function buildXTicks(): { x: number; label: string }[] {
  const visT0 = pxToTs(M_LEFT);
  const visT1 = pxToTs(cssW - M_RIGHT);
  const spanDays = Math.max(1, (visT1 - visT0) / DAY_MS);
  const step = niceXStep(spanDays);
  const ticks: { x: number; label: string }[] = [];

  const fmt = (ts: number) => {
    if (step === "year") return new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(ts);
    if (step === "month") return new Intl.DateTimeFormat(undefined, { year: "2-digit", month: "short" }).format(ts);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(ts);
  };

  const start = new Date(visT0);
  let cur: number;
  if (step === "year") {
    cur = new Date(start.getFullYear(), 0, 1).getTime();
    while (cur <= visT1) {
      ticks.push({ x: xToPx(cur), label: fmt(cur) });
      cur = new Date(new Date(cur).getFullYear() + 1, 0, 1).getTime();
    }
  } else if (step === "month") {
    cur = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
    while (cur <= visT1) {
      ticks.push({ x: xToPx(cur), label: fmt(cur) });
      const d = new Date(cur);
      cur = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    }
  } else if (step === "week") {
    const day = (start.getDay() + 6) % 7; // 0 = Monday
    cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() - day).getTime();
    while (cur <= visT1) {
      ticks.push({ x: xToPx(cur), label: fmt(cur) });
      cur += 7 * DAY_MS;
    }
  } else {
    cur = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    while (cur <= visT1) {
      ticks.push({ x: xToPx(cur), label: fmt(cur) });
      cur += DAY_MS;
    }
  }
  return ticks;
}

/** Hour gridlines adapt to the vertical zoom (6h steps down to 15min). */
function buildYTicks(): { y: number; label: string }[] {
  const visH = visibleHours();
  const h1 = viewH0 + visH;
  const steps = [6, 3, 1, 0.5, 0.25];
  let step = steps[0]!;
  for (const s of steps) {
    step = s;
    if (visH / s >= 4) break;
  }
  const ticks: { y: number; label: string }[] = [];
  const start = Math.ceil(viewH0 / step) * step;
  for (let h = start; h <= h1 + 1e-9; h += step) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    ticks.push({ y: yToPx(h), label: `${hh}:${String(mm).padStart(2, "0")}` });
  }
  return ticks;
}

/** Theme colors, read from the CSS custom properties at render time. */
function themeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    grid: style.getPropertyValue("--axis").trim() || "#888",
    label: style.getPropertyValue("--text-3").trim() || "#888",
    series: style.getPropertyValue("--series").trim() || "#0891b2",
    dim: style.getPropertyValue("--series-dim").trim() || "rgba(120,120,120,0.3)",
  };
}

// Above this many points in the visible range, dots render as squares —
// at that density the shape is indistinguishable and rects rasterize far
// faster than arcs (no bezier curves).
const RECT_THRESHOLD = 30_000;

/**
 * Draw one pass of dots over the visible index range.
 * wantMatch: -1 = all points, 0/1 = only points with that matchMask value.
 * shapeCount: how many dots this pass will roughly draw — decides
 * squares vs circles (defaults to the whole visible range).
 */
function drawPass(
  i0: number,
  i1: number,
  wantMatch: -1 | 0 | 1,
  radius: number,
  shapeCount = i1 - i0
) {
  if (!ctx) return;
  const left = M_LEFT - 3;
  const right = cssW - M_RIGHT + 3;
  const top = M_TOP - 3;
  const bottom = M_TOP + plotH() + 3;
  const hourScale = pxPerHour();
  const mask = matchMask;
  const asRect = shapeCount > RECT_THRESHOLD;
  const size = radius * 2;

  stamp++;
  let inPath = 0;
  ctx.beginPath();
  for (let i = i0; i < i1; i++) {
    if (wantMatch >= 0 && mask![i] !== wantMatch) continue;
    const x = M_LEFT + (tsArr[i]! - viewT0) * pxPerMs;
    if (x < left || x > right) continue;
    const y = M_TOP + (hourArr[i]! - viewH0) * hourScale;
    if (y < top || y > bottom) continue;

    // pixel dedupe — dots that land on an already-drawn pixel add nothing
    const gi = (y | 0) * gridW + (x | 0);
    if (grid[gi] === stamp) continue;
    grid[gi] = stamp;

    if (asRect) {
      ctx.rect(x - radius, y - radius, size, size);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, TWO_PI);
    }
    if (++inPath >= CHUNK) {
      ctx.fill();
      ctx.beginPath();
      inPath = 0;
    }
  }
  if (inPath > 0) ctx.fill();
}

function render() {
  if (!ctx) return;
  const colors = themeColors();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // keep the dedupe grid matched to the canvas size
  const gw = Math.max(1, Math.ceil(cssW));
  const gh = Math.max(1, Math.ceil(cssH));
  if (gw !== gridW || gh !== gridH) {
    gridW = gw;
    gridH = gh;
    grid = new Int32Array(gw * gh);
    stamp = 0;
  }

  // axes
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.label;
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, sans-serif";

  // y-axis (hours)
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of buildYTicks()) {
    if (t.y < M_TOP - 1 || t.y > cssH - M_BOTTOM + 1) continue;
    ctx.beginPath();
    ctx.moveTo(M_LEFT, t.y);
    ctx.lineTo(cssW - M_RIGHT, t.y);
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(t.label, M_LEFT - 6, t.y);
  }

  // x-axis (dates)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const baseY = cssH - M_BOTTOM;
  for (const t of buildXTicks()) {
    if (t.x < M_LEFT - 1 || t.x > cssW - M_RIGHT + 1) continue;
    ctx.beginPath();
    ctx.moveTo(t.x, M_TOP);
    ctx.lineTo(t.x, baseY);
    ctx.globalAlpha = 0.22;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(t.label, t.x, baseY + 4);
  }

  // visible index range (with slack for the dot radius)
  const slackMs = 8 / pxPerMs;
  const i0 = lowerBound(pxToTs(M_LEFT - 3) - slackMs);
  const i1 = lowerBound(pxToTs(cssW - M_RIGHT + 3) + slackMs);
  const r = 2.6;

  // when highlighting: draw non-matches first (dim), matches on top (bright)
  if (matchMask) {
    // Highlighted dots are the subject — draw them as circles unless the
    // *matching* dots alone exceed the threshold (the dim backdrop still
    // takes the cheap square path on its own count).
    let visibleMatches = 0;
    for (let i = i0; i < i1; i++) if (matchMask[i]) visibleMatches++;

    ctx.fillStyle = colors.dim;
    drawPass(i0, i1, 0, r);
    ctx.fillStyle = colors.series;
    ctx.globalAlpha = 0.95;
    drawPass(i0, i1, 1, r * 1.7, visibleMatches);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = colors.series;
    ctx.globalAlpha = 0.62;
    drawPass(i0, i1, -1, r);
    ctx.globalAlpha = 1;
  }
}

function findNearest(mx: number, my: number): number {
  const pickR = 8;
  const hourScale = pxPerHour();
  // only consider points within pickR horizontally of the pointer
  const i0 = lowerBound(pxToTs(mx - pickR));
  const i1 = lowerBound(pxToTs(mx + pickR));
  let best = -1;
  let bestD = pickR * pickR;
  for (let i = i0; i < i1; i++) {
    const x = M_LEFT + (tsArr[i]! - viewT0) * pxPerMs;
    const y = M_TOP + (hourArr[i]! - viewH0) * hourScale;
    const dx = x - mx;
    const dy = y - my;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function onMouseMove(e: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (dragging) {
    const dx = mx - lastDragX;
    const dy = my - lastDragY;
    viewT0 -= dx / pxPerMs;
    viewH0 = clampViewH0(viewH0 - dy / pxPerHour());
    lastDragX = mx;
    lastDragY = my;
    tooltip.value = null;
    scheduleRender();
    return;
  }

  const i = findNearest(mx, my);
  if (i >= 0) {
    const when = new Date(tsArr[i]!).toLocaleString();
    const playlistLine = playlistRaw[i] ? `\nfrom ${playlistRaw[i]}` : "";
    tooltip.value = { x: mx, y: my, text: `${when}\n${artistRaw[i]} — ${trackRaw[i]}${playlistLine}` };
  } else {
    tooltip.value = null;
  }
}

function onMouseDown(e: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  dragging = true;
  lastDragX = e.clientX - rect.left;
  lastDragY = e.clientY - rect.top;
  tooltip.value = null;
}
function onMouseUp() {
  dragging = false;
}
function onMouseLeave() {
  dragging = false;
  tooltip.value = null;
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const rect = canvas.value!.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
  const factor = Math.exp(-delta * 0.0015);

  if (e.shiftKey) {
    // vertical zoom, anchored at the hour under the pointer
    const hourUnder = pxToHour(my);
    yFactor = Math.min(Y_MAX_FACTOR, Math.max(1, yFactor * factor));
    viewH0 = clampViewH0(hourUnder - (my - M_TOP) / pxPerHour());
  } else {
    // horizontal zoom, anchored at the date under the pointer
    const tUnder = pxToTs(mx);
    pxPerMs = Math.min(fitPxPerMs * X_MAX_FACTOR, Math.max(fitPxPerMs * 0.5, pxPerMs * factor));
    viewT0 = tUnder - (mx - M_LEFT) / pxPerMs;
  }
  syncSliders();
  tooltip.value = null;
  scheduleRender();
}

function resetView() {
  yFactor = 1;
  viewH0 = 0;
  fitView();
  syncSliders();
  scheduleRender();
}

defineExpose({ resetView });

onMounted(() => {
  const c = canvas.value;
  if (!c) return;
  ctx = c.getContext("2d");
  rebuildBuffers();
  resizeCanvas();
  fitView();
  render();

  ro = new ResizeObserver(() => {
    const hadFit = didFit;
    resizeCanvas();
    if (!hadFit) fitView();
    viewH0 = clampViewH0(viewH0);
    scheduleRender();
  });
  if (container.value) ro.observe(container.value);

  c.addEventListener("mousemove", onMouseMove);
  c.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  c.addEventListener("mouseleave", onMouseLeave);
  c.addEventListener("wheel", onWheel, { passive: false });
});

onBeforeUnmount(() => {
  ro?.disconnect();
  const c = canvas.value;
  if (c) {
    c.removeEventListener("mousemove", onMouseMove);
    c.removeEventListener("mousedown", onMouseDown);
    c.removeEventListener("mouseleave", onMouseLeave);
    c.removeEventListener("wheel", onWheel);
  }
  window.removeEventListener("mouseup", onMouseUp);
  if (rafId) cancelAnimationFrame(rafId);
});

watch(
  () => props.points,
  () => {
    rebuildBuffers();
    didFit = false;
    resizeCanvas();
    fitView();
    // Paint synchronously: resizeCanvas() just cleared the canvas, and new
    // data deserves an immediate frame rather than waiting on the next rAF.
    render();
  }
);
watch(
  () => props.highlight,
  () => {
    recomputeMask();
    scheduleRender();
  }
);
watch(theme, scheduleRender);
</script>

<template>
  <div class="cloud-container" ref="container">
    <canvas ref="canvas" class="cloud-canvas"></canvas>

    <div class="zoom-controls" @mousedown.stop>
      <label class="zoom-row" title="Horizontal zoom (dates) — also mouse wheel">
        <span class="zoom-icon" aria-hidden="true">↔</span>
        <input
          v-model.number="xZoomSlider"
          type="range"
          min="0"
          max="100"
          step="0.5"
          aria-label="Horizontal zoom"
        />
      </label>
      <label class="zoom-row" title="Vertical zoom (time of day) — also Shift + mouse wheel">
        <span class="zoom-icon" aria-hidden="true">↕</span>
        <input
          v-model.number="yZoomSlider"
          type="range"
          min="0"
          max="100"
          step="0.5"
          aria-label="Vertical zoom"
        />
      </label>
    </div>

    <div
      v-if="tooltip"
      class="cloud-tooltip"
      :style="{ left: tooltip.x + 12 + 'px', top: tooltip.y + 12 + 'px' }"
    >{{ tooltip.text }}</div>
  </div>
</template>

<style scoped>
.cloud-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 340px;
  background-color: var(--bg-page);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.cloud-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}
.cloud-canvas:active {
  cursor: grabbing;
}

.zoom-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  z-index: 2;
}
.zoom-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zoom-icon {
  font-size: 12px;
  color: var(--text-2);
  width: 14px;
  text-align: center;
}
.zoom-controls input[type="range"] {
  width: 130px;
  height: 4px;
  accent-color: var(--accent);
  cursor: pointer;
}

.cloud-tooltip {
  position: absolute;
  pointer-events: none;
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  padding: 5px 9px;
  border-radius: 8px;
  font-size: 0.75rem;
  white-space: pre-line;
  max-width: 260px;
  z-index: 2;
}
</style>
