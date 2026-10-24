import type { Theme } from "../theme";

/**
 * Single source of categorical colors (one slot per top artist, in rank order,
 * plus a grey for "other"). Both sets were run through the dataviz palette
 * validator (OKLab CVD simulation, lightness band, chroma floor, contrast):
 *   light on #ffffff — all gates pass; four slots sit below 3:1 contrast, which
 *                      the legends + screen-reader tables cover (relief rule);
 *   dark  on #151a1d — all gates pass.
 * The ORDER is the color-vision safety mechanism: adjacent slots were checked
 * for separation, so never shuffle or cycle it. An 11th series folds into
 * "other" — never a generated hue.
 */
export const ARTIST_PALETTE: Record<Theme, readonly string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948", "#2f9fd6", "#a0522d"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767", "#2f9fd6", "#b5753e"],
};

/** Neutral for everything outside the top N. */
export const OTHER_COLOR: Record<Theme, string> = {
  light: "#9aa6ab",
  dark: "#5a6870",
};

/** The theme currently applied to the document (theme.ts sets data-theme). */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Color for the artist at `index` (0 = #1). Out of range → the "other" grey. */
export function artistColor(index: number, theme: Theme = currentTheme()): string {
  return ARTIST_PALETTE[theme][index] ?? OTHER_COLOR[theme];
}

export function otherColor(theme: Theme = currentTheme()): string {
  return OTHER_COLOR[theme];
}
