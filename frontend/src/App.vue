<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useTheme } from "./theme";
import { getPlayCount } from "./api";
import { formatNumber } from "./lib/format";

const { theme, toggleTheme } = useTheme();

const playCount = ref<number | null>(null);

onMounted(async () => {
  try {
    const res = await getPlayCount();
    playCount.value = res.count;
  } catch {
    playCount.value = null;
  }
});
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 14c2-5 4-5 6 0s4 5 6 0 4-5 6 0"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        />
      </svg>
      <span class="brand-name">Anytime Wrapped</span>
    </div>

    <nav class="tabs" aria-label="Main navigation">
      <RouterLink to="/" class="tab" exact-active-class="tab-active">Dashboard</RouterLink>
      <RouterLink to="/cloud" class="tab" active-class="tab-active">Listening Cloud</RouterLink>
    </nav>

    <div class="header-right">
      <span v-if="playCount !== null" class="plays-chip" title="Total plays stored">
        {{ formatNumber(playCount) }} plays
      </span>
      <button
        class="theme-toggle"
        type="button"
        :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        @click="toggleTheme"
      >
        <svg v-if="theme === 'dark'" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <line x1="12" y1="2.5" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="21.5" />
            <line x1="2.5" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="21.5" y2="12" />
            <line x1="5.3" y1="5.3" x2="7" y2="7" />
            <line x1="17" y1="17" x2="18.7" y2="18.7" />
            <line x1="5.3" y1="18.7" x2="7" y2="17" />
            <line x1="17" y1="7" x2="18.7" y2="5.3" />
          </g>
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  </header>

  <main class="app-main">
    <RouterView />
  </main>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 0 28px;
  height: 58px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-mark {
  width: 26px;
  height: 26px;
  color: var(--accent);
}
.brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.tabs {
  display: flex;
  align-items: stretch;
  gap: 4px;
  height: 100%;
}
.tab {
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-2);
  border-bottom: 2px solid transparent;
  transition: color 0.15s;
}
.tab:hover {
  color: var(--text-1);
}
.tab-active {
  color: var(--text-1);
  border-bottom-color: var(--accent);
}

.header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.plays-chip {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  background: var(--bg-surface-2);
  border: 1px solid var(--border);
  padding: 3px 10px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}

.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-2);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.theme-toggle:hover {
  background: var(--bg-surface-2);
  color: var(--text-1);
}
.theme-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.theme-toggle svg {
  width: 18px;
  height: 18px;
}

.app-main {
  flex: 1;
  width: 100%;
  padding: 24px 28px 40px;
}
</style>
