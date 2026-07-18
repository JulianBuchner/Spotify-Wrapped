<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
}>();
</script>

<template>
  <section class="card chart-card">
    <header class="chart-card-header">
      <div class="titles">
        <h3 class="chart-title">{{ title }}</h3>
        <p v-if="subtitle" class="chart-subtitle">{{ subtitle }}</p>
      </div>
      <div class="actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="chart-card-body" :class="{ dimmed: loading }">
      <p v-if="error" class="chart-error">{{ error }}</p>
      <slot v-else />
    </div>
  </section>
</template>

<style scoped>
.chart-card {
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
</style>
