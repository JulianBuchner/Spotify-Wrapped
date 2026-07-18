<script setup lang="ts">
defineProps<{
  label: string;
  value: string | null;
  sub?: string;
  loading?: boolean;
}>();
</script>

<template>
  <div class="card stat-card" :class="{ dimmed: loading }">
    <span class="stat-label">{{ label }}</span>
    <span class="stat-value">{{ value ?? "—" }}</span>
    <span v-if="sub" class="stat-sub">{{ sub }}</span>
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
.stat-sub {
  font-size: 12px;
  color: var(--text-3);
}
</style>
