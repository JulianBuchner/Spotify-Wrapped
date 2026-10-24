<script setup lang="ts">
import Skeleton from "./Skeleton.vue";

defineProps<{
  label: string;
  value: string | null;
  sub?: string;
  loading?: boolean;
}>();
</script>

<template>
  <div class="card stat-card" :class="{ dimmed: loading && value !== null }" :aria-busy="loading || undefined">
    <span class="stat-label">{{ label }}</span>
    <Skeleton v-if="loading && value === null" kind="value" class="stat-skeleton" />
    <span v-else class="stat-value">{{ value ?? "—" }}</span>
    <span v-if="sub && !(loading && value === null)" class="stat-sub">{{ sub }}</span>
    <span v-else-if="loading && value === null" class="stat-sub stat-sub-placeholder">&nbsp;</span>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 18px;
  min-width: 0;
  transition: opacity 0.2s;
}
.dimmed {
  opacity: 0.55;
}
.stat-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat-value {
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-1);
  line-height: 1.2;
}
/* same box as .stat-value so the tile keeps its height while the number loads */
.stat-skeleton {
  display: flex;
  align-items: center;
  height: calc(26px * 1.2);
}
.stat-sub {
  font-size: 12px;
  color: var(--text-3);
}
</style>
