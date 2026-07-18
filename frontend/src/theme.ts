import { ref, readonly } from "vue";

export type Theme = "light" | "dark";

const STORAGE_KEY = "anytime-wrapped-theme";

function initialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const theme = ref<Theme>(initialTheme());

function apply(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}

apply(theme.value);

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, theme.value);
    apply(theme.value);
  }
  return { theme: readonly(theme), toggleTheme };
}
