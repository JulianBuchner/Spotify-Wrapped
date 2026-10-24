<script setup lang="ts">
import { computed } from "vue";

/**
 * Shimmer placeholder shown while a card has nothing to draw yet. Shapes mimic the
 * chart that will replace them so the layout doesn't jump: `bars` (column chart),
 * `line` (area/line chart), `rows` (ranked list), `block` (free canvas), `value`
 * (a KPI number). Purely decorative — hidden from assistive tech; the card itself
 * carries aria-busy.
 */
const props = withDefaults(
  defineProps<{
    kind?: "bars" | "line" | "rows" | "block" | "value";
    /** Pixel height for bars/line/block; without it they fill their container. */
    height?: number;
    rows?: number;
  }>(),
  { kind: "bars", height: undefined, rows: 6 }
);

// Fixed pseudo-random shapes so the placeholder is identical on every render.
const BAR_HEIGHTS = [38, 52, 44, 70, 58, 86, 64, 92, 78, 55, 66, 48, 72, 90, 60, 42, 68, 84, 50, 62, 76, 40, 58, 46];
const WAVE_Y = [100, 74, 82, 66, 72, 54, 60, 42, 48, 32, 40, 26, 30, 20];

const sizeStyle = computed(() => (props.height ? { height: `${props.height}px` } : undefined));

const linePolygon = computed(() => {
  const n = WAVE_Y.length;
  const pts = WAVE_Y.map((y, i) => `${((i / (n - 1)) * 100).toFixed(1)}% ${y}%`);
  return `polygon(0% 100%, ${pts.join(", ")}, 100% 100%)`;
});

const rowShapes = computed(() =>
  Array.from({ length: props.rows }, (_, i) => ({
    title: `${48 + ((i * 37) % 34)}%`,
    sub: `${26 + ((i * 23) % 28)}%`,
  }))
);
</script>

<template>
  <div class="skeleton" :class="`skeleton-${kind}`" :style="sizeStyle" aria-hidden="true">
    <template v-if="kind === 'bars'">
      <span v-for="(h, i) in BAR_HEIGHTS" :key="i" class="skel bar" :style="{ height: `${h}%` }" />
    </template>

    <template v-else-if="kind === 'line'">
      <span v-for="i in 4" :key="i" class="gridline" :style="{ top: `${i * 20}%` }" />
      <span class="skel area" :style="{ clipPath: linePolygon }" />
    </template>

    <template v-else-if="kind === 'rows'">
      <div v-for="(r, i) in rowShapes" :key="i" class="row">
        <span class="skel rank" />
        <span class="lines">
          <span class="skel line-a" :style="{ width: r.title }" />
          <span class="skel line-b" :style="{ width: r.sub }" />
        </span>
        <span class="skel num" />
      </div>
    </template>

    <span v-else-if="kind === 'block'" class="skel block" />

    <span v-else class="skel value" />
  </div>
</template>

<style scoped>
.skeleton {
  min-width: 0;
}

/* bars: bottom-aligned columns with room for an axis row underneath */
.skeleton-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 100%;
  min-height: 120px;
  padding: 8px 0 22px;
  box-sizing: border-box;
}
.bar {
  flex: 1;
  min-width: 2px;
  border-radius: 3px 3px 0 0;
}

/* line: faint gridlines with a shimmering area under a wave */
.skeleton-line {
  position: relative;
  height: 100%;
  min-height: 120px;
}
.gridline {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--grid);
}
.area {
  position: absolute;
  inset: 8px 0 22px;
  border-radius: 0;
}

/* rows: rank, two text lines, a number on the right */
.skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 6px 0 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rank {
  width: 18px;
  height: 12px;
  flex-shrink: 0;
}
.lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.line-a {
  height: 12px;
}
.line-b {
  height: 10px;
}
.num {
  width: 44px;
  height: 12px;
  flex-shrink: 0;
}

/* block: fills whatever box it is given */
.skeleton-block {
  height: 100%;
  min-height: 120px;
}
.block {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 8px;
}

/* value: a KPI number */
.value {
  width: 58%;
  height: 26px;
  border-radius: 6px;
}
</style>
