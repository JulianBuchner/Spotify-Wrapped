<script setup lang="ts">
import Skeleton from "./Skeleton.vue";

/**
 * Card chrome around a chart or list. Two loading looks:
 * - nothing to show yet (`empty`): a skeleton in the chart's shape takes the body's place;
 * - stale data on screen: the body dims and a progress bar + "Loading…" chip say why.
 */
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    loading?: boolean;
    error?: string | null;
    /** True while the slot has no data to draw (first load, or after a reset). */
    empty?: boolean;
    skeleton?: "bars" | "line" | "rows" | "block";
    skeletonHeight?: number;
  }>(),
  { empty: false, skeleton: "bars", skeletonHeight: undefined }
);
</script>

<template>
  <section class="card chart-card" :aria-busy="loading || undefined">
    <span v-if="loading && !empty" class="loading-bar" aria-hidden="true" />
    <header class="chart-card-header">
      <div class="titles">
        <h3 class="chart-title">{{ title }}</h3>
        <p v-if="subtitle" class="chart-subtitle">{{ subtitle }}</p>
      </div>
      <div class="actions">
        <span v-if="loading && !empty" class="loading-chip" role="status">Loading…</span>
        <slot name="actions" />
      </div>
    </header>
    <div class="chart-card-body" :class="{ dimmed: loading && !empty }">
      <p v-if="error" class="chart-error">{{ error }}</p>
      <slot v-else-if="loading && empty" name="skeleton">
        <Skeleton :kind="skeleton" :height="skeletonHeight" />
      </slot>
      <slot v-else />
    </div>
  </section>
</template>

<style scoped>
.chart-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chart-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 8px;
}
.chart-title {
  font-size: 14px;
  font-weight: 600;
}
.chart-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.chart-card-body {
  padding: 4px 18px 16px;
  flex: 1;
  min-height: 0;
  transition: opacity 0.2s;
}
.dimmed {
  opacity: 0.55;
}
.chart-error {
  margin: 8px 0;
  font-size: 13px;
  color: var(--danger);
}

/* phone ≤ 640px: actions wrap under the title instead of squeezing it, tighter body padding */
@media (max-width: 640px) {
  .chart-card-header {
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 14px 12px 6px;
  }
  .titles {
    flex: 1 1 auto;
    min-width: 0;
  }
  .actions {
    flex: 0 1 auto;
    flex-wrap: wrap;
    max-width: 100%;
  }
  .chart-card-body {
    padding: 4px 12px 12px;
  }
}
</style>
