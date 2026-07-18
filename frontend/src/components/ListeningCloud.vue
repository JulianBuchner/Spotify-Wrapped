<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
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

// layout (css pixels)
const M_LEFT = 46;
const M_RIGHT = 14;
const M_TOP = 12;
const M_BOTTOM = 26;

// view state: x/time is pan+zoomable, y (hour 0..24) is fixed to the plot height
let viewT0 = 0; // ts at the left plot edge
let pxPerMs = 1;
let tMin = 0;
let tMax = 1;
let fitPxPerMs = 1;

let cssW = 1;
let cssH = 1;
let dpr = 1;
let ctx: CanvasRenderingContext2D | null = null;
let ro: ResizeObserver | null = null;
let didFit = false;
let rafId = 0;

let dragging = false;
let lastDragX = 0;

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

function plotW() {
  return Math.max(1, cssW - M_LEFT - M_RIGHT);
}
function plotH() {
  return Math.max(1, cssH - M_TOP - M_BOTTOM);
}

function computeDomain() {
  const first = props.points[0];
  if (!first) {
    tMin = Date.now() - DAY_MS;
    tMax = Date.now();
    return;
  }
  tMin = first.ts;
  tMax = first.ts;
  for (const p of props.points) {
    if (p.ts < tMin) tMin = p.ts;
    if (p.ts > tMax) tMax = p.ts;
  }
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
// hour 0 at top, 24 at bottom
function yToPx(hour: number) {
  return M_TOP + (hour / 24) * plotH();
}

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

function matches(p: PlayPoint, q: string) {
  return p.artist.toLowerCase().includes(q) || p.track.toLowerCase().includes(q);
}

function render() {
  if (!ctx) return;
  const colors = themeColors();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // axes
  ctx.strokeStyle = colors.grid;
  ctx.fillStyle = colors.label;
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, sans-serif";

  // y-axis (hours)
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const h of [0, 6, 12, 18, 24]) {
    const y = yToPx(h);
    ctx.beginPath();
    ctx.moveTo(M_LEFT, y);
    ctx.lineTo(cssW - M_RIGHT, y);
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(`${h}:00`, M_LEFT - 6, y);
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

  // points
  const q = (props.highlight ?? "").trim().toLowerCase();
  const left = M_LEFT - 3;
  const right = cssW - M_RIGHT + 3;
  const r = 2.6;

  // when highlighting: draw non-matches first (dim), matches on top (bright)
  if (q) {
    ctx.fillStyle = colors.dim;
    for (const p of props.points) {
      const x = xToPx(p.ts);
      if (x < left || x > right) continue;
      if (matches(p, q)) continue;
      ctx.beginPath();
      ctx.arc(x, yToPx(p.hour), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = colors.series;
    ctx.globalAlpha = 0.95;
    for (const p of props.points) {
      const x = xToPx(p.ts);
      if (x < left || x > right) continue;
      if (!matches(p, q)) continue;
      ctx.beginPath();
      ctx.arc(x, yToPx(p.hour), r * 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = colors.series;
    ctx.globalAlpha = 0.62;
    for (const p of props.points) {
      const x = xToPx(p.ts);
      if (x < left || x > right) continue;
      ctx.beginPath();
      ctx.arc(x, yToPx(p.hour), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function findNearest(mx: number, my: number): PlayPoint | null {
  const left = M_LEFT - 3;
  const right = cssW - M_RIGHT + 3;
  let best: PlayPoint | null = null;
  let bestD = 8 * 8; // 8px pick radius, squared
  for (const p of props.points) {
    const x = xToPx(p.ts);
    if (x < left || x > right) continue;
    const y = yToPx(p.hour);
    const dx = x - mx;
    const dy = y - my;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
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
    viewT0 -= dx / pxPerMs;
    lastDragX = mx;
    tooltip.value = null;
    scheduleRender();
    return;
  }

  const near = findNearest(mx, my);
  if (near) {
    const when = new Date(near.ts).toLocaleString();
    tooltip.value = { x: mx, y: my, text: `${when}\n${near.artist} — ${near.track}` };
  } else {
    tooltip.value = null;
  }
}

function onMouseDown(e: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  dragging = true;
  lastDragX = e.clientX - rect.left;
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
  const tUnder = pxToTs(mx);
  const factor = Math.exp(-e.deltaY * 0.0015);
  const next = Math.min(fitPxPerMs * 2000, Math.max(fitPxPerMs * 0.5, pxPerMs * factor));
  pxPerMs = next;
  viewT0 = tUnder - (mx - M_LEFT) / pxPerMs;
  tooltip.value = null;
  scheduleRender();
}

function resetView() {
  fitView();
  scheduleRender();
}

defineExpose({ resetView });

onMounted(() => {
  const c = canvas.value;
  if (!c) return;
  ctx = c.getContext("2d");
  resizeCanvas();
  fitView();
  render();

  ro = new ResizeObserver(() => {
    const hadFit = didFit;
    resizeCanvas();
    if (!hadFit) fitView();
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
    didFit = false;
    resizeCanvas();
    fitView();
    scheduleRender();
  }
);
watch(() => props.highlight, scheduleRender);
watch(theme, scheduleRender);
</script>

<template>
  <div class="cloud-container" ref="container">
    <canvas ref="canvas" class="cloud-canvas"></canvas>
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
