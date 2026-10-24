<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatMs, formatNumber } from "../lib/format";
import type { WeekHourCell } from "../types";

/**
 * Weekday × hour heatmap: 7 rows (Monday first) × 24 columns. Cell color is the
 * series color at an opacity scaled by value / max (non-zero cells never drop
 * below 0.06 so a single play still shows); empty cells use the surface tint.
 */
const props = withDefaults(
  defineProps<{
    /** Cells with value > 0; weekday 0 = Sunday … 6 = Saturday (SQLite %w). */
    cells: WeekHourCell[];
    metric?: "streams" | "playtime";
    ariaLabel?: string;
  }>(),
  { metric: "streams" }
);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, like the dashboard
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const M = { left: 34, right: 4, top: 4, bottom: 22 };
const GAP = 2;
const MIN_ALPHA = 0.06;

const container = ref<HTMLDivElement | null>(null);
const width = ref(500);
let ro: ResizeObserver | null = null;

onMounted(() => {
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w) width.value = w;
  });
  if (container.value) {
    width.value = container.value.clientWidth || 500;
    ro.observe(container.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

const cell = computed(() => Math.max(6, (width.value - M.left - M.right - GAP * 23) / 24));
const height = computed(() => M.top + cell.value * 7 + GAP * 6 + M.bottom);

/** value[weekday][hour] */
const grid = computed(() => {
  const g: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const c of props.cells) {
    if (c.weekday >= 0 && c.weekday < 7 && c.hour >= 0 && c.hour < 24) g[c.weekday]![c.hour] = c.value;
  }
  return g;
});
const max = computed(() => Math.max(1, ...props.cells.map((c) => c.value)));

function x(hour: number) {
  return M.left + hour * (cell.value + GAP);
}
function y(row: number) {
  return M.top + row * (cell.value + GAP);
}
function alpha(v: number) {
  if (v <= 0) return 0;
  return Math.max(MIN_ALPHA, v / max.value);
}

const fmt = computed(() =>
  props.metric === "playtime" ? formatMs : (n: number) => `${formatNumber(n)} plays`
);
function hourRange(h: number) {
  const hh = String(h).padStart(2, "0");
  return `${hh}:00–${hh}:59`;
}

const hoverCell = ref<{ row: number; hour: number } | null>(null);
const hover = computed(() => {
  if (!hoverCell.value) return null;
  const { row, hour } = hoverCell.value;
  const weekday = WEEKDAY_ORDER[row]!;
  const v = grid.value[weekday]![hour]!;
  const hx = x(hour) + cell.value / 2;
  return {
    x: hx,
    y: y(row),
    label: `${WEEKDAYS[weekday]} · ${hourRange(hour)}`,
    value: v > 0 ? fmt.value(v) : "—",
    flip: hx > width.value - 150,
  };
});

const LEGEND_STEPS = [0.06, 0.3, 0.55, 0.8, 1];
</script>

<template>
  <div ref="container" class="heatmap">
    <svg :width="width" :height="height" :aria-label="ariaLabel" role="img">
      <!-- weekday labels -->
      <text
        v-for="(wd, row) in WEEKDAY_ORDER"
        :key="'w' + wd"
        :x="M.left - 8"
        :y="y(row) + cell / 2"
        class="tick-label"
        text-anchor="end"
        dominant-baseline="middle"
      >
        {{ WEEKDAYS[wd] }}
      </text>

      <!-- cells -->
      <g v-for="(wd, row) in WEEKDAY_ORDER" :key="'r' + wd">
        <rect
          v-for="h in HOURS"
          :key="h"
          :x="x(h)"
          :y="y(row)"
          :width="cell"
          :height="cell"
          rx="2"
          class="cell"
          :class="{ empty: grid[wd]![h] === 0, lifted: hoverCell?.row === row && hoverCell?.hour === h }"
          :fill-opacity="grid[wd]![h]! > 0 ? alpha(grid[wd]![h]!) : undefined"
          tabindex="0"
          :aria-label="`${WEEKDAYS[wd]} ${hourRange(h)}: ${grid[wd]![h]! > 0 ? fmt(grid[wd]![h]!) : 'none'}`"
          @pointerenter="hoverCell = { row, hour: h }"
          @pointerleave="hoverCell = null"
          @focus="hoverCell = { row, hour: h }"
          @blur="hoverCell = null"
        />
      </g>

      <!-- hour labels every 3 h (the in-between ones are hidden on phones) -->
      <template v-for="h in HOURS" :key="'h' + h">
        <text
          v-if="h % 3 === 0"
          :x="x(h)"
          :y="height - 6"
          class="tick-label"
          :class="{ minor: h % 6 !== 0 }"
          text-anchor="start"
        >
          {{ h }}
        </text>
      </template>
    </svg>

    <div class="legend" aria-hidden="true">
      <span class="legend-label">less</span>
      <span v-for="a in LEGEND_STEPS" :key="a" class="legend-swatch" :style="{ opacity: a }" />
      <span class="legend-label">more</span>
    </div>

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

    <!-- wrapped in a div: a bare table ignores the 1px width and would widen the page -->
    <div class="sr-only">
      <table>
        <caption>{{ ariaLabel }}</caption>
        <thead>
          <tr>
            <th scope="col">Weekday</th>
            <th v-for="h in HOURS" :key="h" scope="col">{{ hourRange(h) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="wd in WEEKDAY_ORDER" :key="wd">
            <th scope="row">{{ WEEKDAYS[wd] }}</th>
            <td v-for="h in HOURS" :key="h">{{ grid[wd]![h]! > 0 ? fmt(grid[wd]![h]!) : "0" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.heatmap {
  position: relative;
  width: 100%;
}
svg {
  display: block;
}
.tick-label {
  fill: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.cell {
  fill: var(--series);
  outline: none;
  transition: opacity 0.1s;
}
.cell.empty {
  fill: var(--bg-surface-2);
}
.cell.lifted {
  stroke: var(--text-1);
  stroke-width: 1;
}
.cell:focus-visible {
  stroke: var(--accent);
  stroke-width: 1.5;
}
.legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 4px;
}
.legend-label {
  font-size: 11px;
  color: var(--text-3);
  margin: 0 3px;
}
.legend-swatch {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: var(--series);
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

/* phone ≤ 640 px: hour labels every 6 h (24 columns in ~300 px), legend left under the grid */
@media (max-width: 640px) {
  .tick-label.minor {
    display: none;
  }
  .legend {
    justify-content: flex-start;
    margin-top: 6px;
  }
}
</style>
