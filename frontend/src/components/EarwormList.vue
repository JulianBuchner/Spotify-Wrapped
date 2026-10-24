<script setup lang="ts">
import { formatDate, formatNumber } from "../lib/format";
import type { Earworm } from "../types";

/** Ranked list of the worst earworms: plays (big), track, artist, "week of …". */
defineProps<{
  items: Earworm[];
  ariaLabel?: string;
}>();
</script>

<template>
  <ol class="earworms" :aria-label="ariaLabel">
    <li v-for="(e, i) in items" :key="`${e.spotifyUri}-${e.weekStart}`" class="row">
      <span class="rank">{{ i + 1 }}</span>
      <span class="plays">
        <span class="plays-num">{{ formatNumber(e.plays) }}</span>
        <span class="plays-unit">plays</span>
      </span>
      <span class="who">
        <span class="track" :title="e.trackName">{{ e.trackName }}</span>
        <span class="artist" :title="e.artistName">{{ e.artistName }}</span>
      </span>
      <span class="when">week of {{ formatDate(e.weekStart) }}</span>
    </li>
  </ol>
</template>

<style scoped>
.earworms {
  list-style: none;
  margin: 0;
  padding: 2px 0 0;
  display: flex;
  flex-direction: column;
}
.row {
  display: grid;
  grid-template-columns: 18px 74px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-top: 1px solid var(--border);
  min-width: 0;
}
.row:first-child {
  border-top: none;
  padding-top: 2px;
}
.rank {
  font-size: 11.5px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.plays {
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}
.plays-num {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-1);
  line-height: 1.1;
}
.plays-unit {
  font-size: 11px;
  color: var(--text-3);
}
.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.track {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artist {
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.when {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
}

/* phone ≤ 640 px: "week of …" moves under the track instead of a fourth column */
@media (max-width: 640px) {
  .row {
    grid-template-columns: 18px 64px minmax(0, 1fr);
    row-gap: 0;
    column-gap: 10px;
  }
  .rank,
  .plays {
    grid-row: 1 / 3;
  }
  .when {
    grid-column: 3;
    margin-top: 1px;
  }
}
</style>
