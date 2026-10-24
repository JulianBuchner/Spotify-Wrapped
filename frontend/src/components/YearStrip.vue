<script setup lang="ts">
import { computed, ref } from "vue";
import { formatMs, formatNumber } from "../lib/format";
import { artistColor } from "../lib/palette";
import { useTheme } from "../theme";
import type { Metric } from "../api";
import type { YearTopArtist } from "../types";

/**
 * "My #1 artist, year by year": one equal-width block per year. A block is
 * tinted with the artist's palette color when the artist is in `topArtists`
 * (same index → same color as the stacked chart and the record), otherwise a
 * neutral tint.
 */
const props = defineProps<{
  years: YearTopArtist[];
  /** Top artists in rank order — shares the palette index with the other charts. */
  topArtists: string[];
  /** What the year's #1 was ranked by; decides the number shown under the name. */
  metric?: Metric;
  ariaLabel?: string;
}>();

const { theme } = useTheme();

const blocks = computed(() =>
  props.years.map((y) => {
    const idx = props.topArtists.indexOf(y.artistName);
    return {
      ...y,
      color: idx >= 0 ? artistColor(idx, theme.value) : null,
      amount:
        props.metric === "playtime" ? formatMs(y.playtimeMs) : `${formatNumber(y.streams)} plays`,
    };
  })
);

const hoverIndex = ref<number | null>(null);
const hover = computed(() => {
  if (hoverIndex.value === null) return null;
  const b = blocks.value[hoverIndex.value];
  if (!b) return null;
  return {
    index: hoverIndex.value,
    title: `${b.year} · ${b.artistName}`,
    value: `${formatNumber(b.streams)} plays · ${formatMs(b.playtimeMs)}`,
  };
});
</script>

<template>
  <div class="year-strip" role="img" :aria-label="ariaLabel">
    <div class="blocks">
      <div
        v-for="(b, i) in blocks"
        :key="b.year"
        class="block"
        :class="{ neutral: !b.color, lifted: hoverIndex === i }"
        :style="b.color ? { '--block-color': b.color } : undefined"
        tabindex="0"
        :aria-label="`${b.year}: ${b.artistName}, ${formatNumber(b.streams)} plays`"
        @pointerenter="hoverIndex = i"
        @pointerleave="hoverIndex = null"
        @focus="hoverIndex = i"
        @blur="hoverIndex = null"
      >
        <span class="bar" aria-hidden="true" />
        <span class="year">{{ b.year }}</span>
        <span class="artist" :title="b.artistName">{{ b.artistName }}</span>
        <span class="plays">{{ b.amount }}</span>

        <div v-if="hover && hover.index === i" class="chart-tooltip" :class="{ flip: i > blocks.length / 2 }">
          <span class="tooltip-value">{{ hover.value }}</span>
          <span class="tooltip-label">{{ hover.title }}</span>
        </div>
      </div>
    </div>

    <div class="sr-only">
      <table>
        <caption>{{ ariaLabel }}</caption>
        <thead>
          <tr>
            <th scope="col">Year</th>
            <th scope="col">Artist</th>
            <th scope="col">Plays</th>
            <th scope="col">Listened</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="y in years" :key="y.year">
            <th scope="row">{{ y.year }}</th>
            <td>{{ y.artistName }}</td>
            <td>{{ formatNumber(y.streams) }}</td>
            <td>{{ formatMs(y.playtimeMs) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.year-strip {
  width: 100%;
}
/* equal-width blocks; auto-fill keeps the tracks equal when a long history wraps */
.blocks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 6px;
  width: 100%;
}
.block {
  --block-color: var(--text-3);
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--block-color) 14%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--block-color) 30%, var(--border));
  outline: none;
  transition: background-color 0.15s;
}
.block.neutral {
  background: var(--bg-surface-2);
  border-color: var(--border);
}
.block.lifted {
  background: color-mix(in srgb, var(--block-color) 22%, var(--bg-surface));
}
.block.neutral.lifted {
  background: var(--bg-surface-3);
}
.block:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.bar {
  display: block;
  width: 28px;
  height: 4px;
  border-radius: 2px;
  background: var(--block-color);
  margin-bottom: 6px;
}
.year {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.artist {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-1);
  line-height: 1.25;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  min-height: calc(13px * 1.25 * 2);
}
.plays {
  font-size: 11.5px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.chart-tooltip {
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
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
.chart-tooltip.flip {
  left: auto;
  right: 0;
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
