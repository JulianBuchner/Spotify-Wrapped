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

/**
 * Categorical colours for the genre GROUPS (Eras route): the 10 artist slots
 * followed by 6 more (plum, lime, slate blue, salmon, teal, gold). Validated as
 * a 16-slot set with the dataviz checker (adjacent pairs):
 *   light on #ffffff — all gates pass (worst adjacent CVD ΔE 8.3, normal 19.4);
 *                      six slots sit below 3:1 contrast — covered by the legend,
 *                      the in-band labels and the screen-reader table;
 *   dark  on #151a1d — all gates pass (worst adjacent CVD ΔE 8.4, normal 19.3).
 * Index = the group's position in /api/genres/groups (rule order), never its
 * rank in the current window, so a group keeps its colour across windows.
 * As with the artist palette: never shuffle, never generate a 17th hue.
 */
export const GROUP_PALETTE: Record<Theme, readonly string[]> = {
  // 18 slots: the rule table has 18 groups (slots 16/17 = a muted brown and a fuchsia, for the two
  // smallest groups, so nothing falls to the "other" grey).
  light: [...ARTIST_PALETTE.light, "#a8309f", "#7fa800", "#5b7fbf", "#f07c5c", "#0e9c98", "#b58a00", "#8a6a45", "#d12bb0"],
  dark: [...ARTIST_PALETTE.dark, "#c04fb6", "#759a00", "#6f93d3", "#e06a4e", "#1aa3a3", "#b88a0e", "#a9865c", "#e34ac4"],
};

/** Colour for the genre group at `index` (rule order). Out of range → the "other" grey. */
export function groupColor(index: number, theme: Theme = currentTheme()): string {
  return GROUP_PALETTE[theme][index] ?? OTHER_COLOR[theme];
}

// --- rainbow rows (Genres strip plot) ---------------------------------------

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** OKLCH → sRGB hex, or null when the colour falls outside the sRGB gamut. */
function oklchToHex(L: number, C: number, hDeg: number): string | null {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (lin.some((c) => c < -0.002 || c > 1.002)) return null;
  const hex = lin
    .map((c) => {
      const v = clamp01(c);
      const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return Math.round(srgb * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("");
  return `#${hex}`;
}

/**
 * Row colour `i` of `n` along a rainbow (hues evenly spaced 0..300°, so the
 * last row is violet, not red again) at a fixed OKLCH lightness — 0.72 on the
 * dark panel, 0.55 on light — so every row reads on its background. Chroma
 * starts at 0.17 and backs off per hue until the colour is inside sRGB.
 * Identity only: the rows are a ranked list, the hue just keeps neighbours
 * apart; intensity (opacity) carries the value.
 */
export function rainbowColor(i: number, n: number, theme: Theme = currentTheme()): string {
  const hue = n <= 1 ? 0 : (i / (n - 1)) * 300;
  const L = theme === "dark" ? 0.72 : 0.55;
  for (let C = 0.17; C >= 0.04; C -= 0.01) {
    const hex = oklchToHex(L, C, hue);
    if (hex) return hex;
  }
  return oklchToHex(L, 0, hue) ?? OTHER_COLOR[theme];
}
