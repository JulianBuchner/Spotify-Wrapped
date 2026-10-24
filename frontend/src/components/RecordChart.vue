<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { formatDate, formatMs, formatNumber, localDate } from "../lib/format";
import { ARTIST_PALETTE } from "../lib/palette";
import { useTheme } from "../theme";
import type { RecordHighlights } from "../types";

export interface RecordPoint {
  t: number; // play start, epoch ms
  d: number; // ms listened
  artist: string;
}

/**
 * "One groove per day": a disc with one ring per local calendar day, innermost
 * = first day, rim = last day. Every play is an arc on its day's ring from its
 * start minute to start + listened time (midnight at the top, clockwise).
 * Top-10 artists get their palette color, everything else a faint grey.
 *
 * Two canvases: `base` holds the 200k arcs (drawn in rAF chunks so the page
 * stays responsive, cancelled when props change), `overlay` holds the cheap
 * stuff that must redraw on hover — guides, the "usual time of day" line,
 * highlight markers and the hovered ring. Theme colors are read from the CSS
 * custom properties at draw time, like ListeningCloud.
 *
 * Zoom + pan: the mouse wheel zooms around the cursor (k = 1 … 60), a left
 * drag pans. The view is `screen = k · disc + t` (css px). The base canvas
 * draws under that transform (arcs outside the visible annulus are culled),
 * the overlay draws in screen space via `toScreen()` so labels, badges and
 * line widths keep their size. While a gesture is in progress the base is not
 * redrawn — a CSS transform moves the existing bitmap — and the redraw that
 * follows paints the old bitmap back as a backdrop, so the disc never blanks.
 * `resetView()` and a `zoomed` flag are exposed to the parent.
 */
const props = withDefaults(
  defineProps<{
    points: RecordPoint[];
    /** Top artists in rank order (#1 first) — palette index = rank. */
    topArtists: string[];
    highlights: RecordHighlights | null;
    height?: number;
  }>(),
  { height: 560 }
);

const { theme } = useTheme();

const container = ref<HTMLDivElement | null>(null);
const baseCanvas = ref<HTMLCanvasElement | null>(null);
const overlayCanvas = ref<HTMLCanvasElement | null>(null);
const tooltip = ref<{ x: number; y: number; title: string; lines: string[] } | null>(null);

const DAY_MS = 86_400_000;
const TWO_PI = Math.PI * 2;
const MIN_IN_DAY = 1440;
const CHUNK = 4000; // arcs per stroke()
const FRAME_BUDGET_MS = 12; // keep each rAF well under 16 ms
const PAD = 36; // room outside the disc for hour ticks + labels
const INNER_RATIO = 0.22;
const OTHER_ALPHA = 0.4;
const TOP_ALPHA = 0.9;
const MIN_MONTH_PLAYS = 20;
const ZOOM_MIN = 1;
const ZOOM_MAX = 60;
const WHEEL_ZOOM_RATE = 0.0015;
const WHEEL_END_MS = 180; // wheel gesture counts as over this long after the last event
const VIEW_MARGIN = 48; // css px of the disc's bounding box that must stay in view
const DRAG_THRESHOLD = 3; // px before a pointerdown counts as a drag, not a click

// The disc is always a dark vinyl, whatever the page theme: the colored arcs
// need a dark ground to read, and a black record on a light page is the poster
// look. Everything drawn ON the disc uses these fixed colors (and the dark
// palette); the ticks and labels outside it follow the theme.
const VINYL = "#121618";
const VINYL_INK = "#eef4f5";
const VINYL_LABEL = "#aeb9be";
const VINYL_GUIDE = "rgba(255, 255, 255, 0.14)";
const VINYL_OTHER = "#8a969c";

// --- canvas state -----------------------------------------------------------
let cssW = 1;
let cssH = 1;
let dpr = 1;
let base: CanvasRenderingContext2D | null = null;
let over: CanvasRenderingContext2D | null = null;
let ro: ResizeObserver | null = null;
/** Previous base bitmap, painted back as a backdrop while the arcs redraw. */
let snapshot: HTMLCanvasElement | null = null;
/** Offscreen target for the arcs while a backdrop is on screen (see below). */
let work: HTMLCanvasElement | null = null;
let workCtx: CanvasRenderingContext2D | null = null;
let baseHasBitmap = false; // false after a resize or data change (stale/empty)

// --- view: screen = k · disc + t (css px) -------------------------------------
let vk = 1;
let vtx = 0;
let vty = 0;
// view the base bitmap was last rendered with (CSS preview + backdrop use it)
let bk = 1;
let btx = 0;
let bty = 0;
const zoomed = ref(false);
const dragging = ref(false);

function toScreen(x: number, y: number): [number, number] {
  return [x * vk + vtx, y * vk + vty];
}
function toDisc(sx: number, sy: number): [number, number] {
  return [(sx - vtx) / vk, (sy - vty) / vk];
}
/** k within range; at k = 1 no offset; otherwise keep the disc reachable. */
function clampView() {
  vk = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, vk));
  if (vk <= 1) {
    vk = 1;
    vtx = 0;
    vty = 0;
    return;
  }
  const m = Math.min(VIEW_MARGIN, cssW / 2, cssH / 2);
  const [left, top] = toScreen(cx - R, cy - R);
  const [right, bottom] = toScreen(cx + R, cy + R);
  if (right < m) vtx += m - right;
  else if (left > cssW - m) vtx -= left - (cssW - m);
  if (bottom < m) vty += m - bottom;
  else if (top > cssH - m) vty -= top - (cssH - m);
}
/**
 * Ring radii that can be on screen: the viewport in disc coordinates, then
 * the nearest/farthest distance from the disc center to that rectangle.
 */
function visibleAnnulus(): [number, number] {
  const [x0, y0] = toDisc(0, 0);
  const [x1, y1] = toDisc(cssW, cssH);
  const ddx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
  const ddy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
  const far = Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx));
  const fary = Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy));
  return [Math.hypot(ddx, ddy), Math.hypot(far, fary)];
}

// --- geometry (css px), recomputed on resize --------------------------------
let cx = 0;
let cy = 0;
let R = 1;
let r0 = 0;
let ringT = 1;

function layout() {
  cx = cssW / 2;
  cy = cssH / 2;
  R = Math.max(10, Math.min(cssW, cssH) / 2 - PAD);
  r0 = R * INNER_RATIO;
  ringT = (R - r0) / Math.max(1, days);
}
function ringRadius(dayIdx: number) {
  return r0 + (dayIdx + 0.5) * ringT;
}
/** minute of day -> canvas angle; midnight at the top, clockwise */
function angle(minute: number) {
  return (minute / MIN_IN_DAY) * TWO_PI - Math.PI / 2;
}

// ---------------------------------------------------------------------------
// Flat buffers — rebuilt once per points/topArtists change, never touched by
// Vue's reactivity. An arc is (day, startMinute, endMinute, colorGroup).
// ---------------------------------------------------------------------------
let firstDay = 0; // local midnight of the first day, epoch ms
let days = 0;
let arcCount = 0;
let arcDay = new Int32Array(0);
let arcA0 = new Float32Array(0);
let arcA1 = new Float32Array(0);
let order = new Uint32Array(0); // arc indices sorted by draw group
let groupEnd: number[] = []; // order[] is group g for i in [groupEnd[g-1], groupEnd[g])
let groupRank: number[] = []; // group -> artist rank, -1 = other
let dayPlays = new Int32Array(0);
let dayMs = new Float64Array(0);

interface MonthStat {
  key: number; // year * 12 + month
  label: string;
  plays: number;
  ms: number;
  /** listened ms per half hour of the day (48 bins) */
  bins: Float64Array;
  sumDay: number;
}
const BINS = 48;
let months: MonthStat[] = [];
let guides: Array<{ day: number; label: string }> = [];

const monthRows = shallowRef<Array<{ label: string; plays: number; ms: number }>>([]);
const hasData = ref(false);

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** Local day index for a timestamp (−1 when outside the disc). */
function dayIndexOf(ms: number) {
  const idx = Math.round((startOfDay(ms) - firstDay) / DAY_MS);
  return idx >= 0 && idx < days ? idx : -1;
}
function minuteOf(ms: number) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function rebuildBuffers() {
  const pts = props.points;
  const n = pts.length;
  months = [];
  guides = [];
  if (!n) {
    days = 0;
    arcCount = 0;
    dayPlays = new Int32Array(0);
    dayMs = new Float64Array(0);
    monthRows.value = [];
    hasData.value = false;
    return;
  }

  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = pts[i]!.t;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  firstDay = startOfDay(tMin);
  days = Math.round((startOfDay(tMax) - firstDay) / DAY_MS) + 1;

  const rankOf = new Map<string, number>();
  props.topArtists.forEach((a, i) => rankOf.set(a, i));
  const topN = props.topArtists.length;
  // draw order: other first, then #10 … #1 so the biggest artist ends on top
  groupRank = [-1];
  for (let r = topN - 1; r >= 0; r--) groupRank.push(r);
  const groupOfRank = (r: number) => (r < 0 ? 0 : topN - r);

  const cap = n * 2; // a play can split into two arcs at midnight
  arcDay = new Int32Array(cap);
  arcA0 = new Float32Array(cap);
  arcA1 = new Float32Array(cap);
  const arcGroup = new Uint8Array(cap);
  dayPlays = new Int32Array(days);
  dayMs = new Float64Array(days);
  const monthByKey = new Map<number, MonthStat>();

  // Local-day lookup is cached per day: points arrive sorted by time, so a
  // `new Date` is only needed when a play falls outside the current day.
  let curStart = NaN;
  let curEnd = NaN;
  let curIdx = 0;
  let curMonth: MonthStat | null = null;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const t = p.t;
    if (!(t >= curStart && t < curEnd)) {
      const dt = new Date(t);
      dt.setHours(0, 0, 0, 0);
      curStart = dt.getTime();
      const next = new Date(curStart);
      next.setDate(next.getDate() + 1);
      curEnd = next.getTime();
      curIdx = Math.round((curStart - firstDay) / DAY_MS);
      const key = dt.getFullYear() * 12 + dt.getMonth();
      curMonth = monthByKey.get(key) ?? null;
      if (!curMonth) {
        curMonth = {
          key,
          label: `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`,
          plays: 0,
          ms: 0,
          bins: new Float64Array(BINS),
          sumDay: 0,
        };
        monthByKey.set(key, curMonth);
      }
    }
    if (curIdx < 0 || curIdx >= days) continue;
    const d = Math.max(0, Math.min(p.d, DAY_MS));
    const m0 = Math.min(MIN_IN_DAY, (t - curStart) / 60_000);
    const m1 = m0 + d / 60_000;
    const g = groupOfRank(rankOf.get(p.artist) ?? -1);

    dayPlays[curIdx]!++;
    dayMs[curIdx]! += d;
    curMonth!.plays++;
    curMonth!.ms += d;
    curMonth!.bins[Math.min(BINS - 1, Math.floor((m0 / MIN_IN_DAY) * BINS))]! += d > 0 ? d : 1;
    curMonth!.sumDay += curIdx;

    if (m1 > MIN_IN_DAY && curIdx + 1 < days) {
      arcDay[k] = curIdx;
      arcA0[k] = m0;
      arcA1[k] = MIN_IN_DAY;
      arcGroup[k] = g;
      k++;
      arcDay[k] = curIdx + 1;
      arcA0[k] = 0;
      arcA1[k] = m1 - MIN_IN_DAY;
      arcGroup[k] = g;
      k++;
    } else {
      arcDay[k] = curIdx;
      arcA0[k] = m0;
      arcA1[k] = Math.min(m1, MIN_IN_DAY);
      arcGroup[k] = g;
      k++;
    }
  }
  arcCount = k;

  // counting sort by group → order[]
  const groups = groupRank.length;
  const counts = new Array<number>(groups).fill(0);
  for (let i = 0; i < k; i++) counts[arcGroup[i]!]!++;
  groupEnd = [];
  const pos = new Array<number>(groups);
  let acc = 0;
  for (let g = 0; g < groups; g++) {
    pos[g] = acc;
    acc += counts[g]!;
    groupEnd.push(acc);
  }
  order = new Uint32Array(k);
  for (let i = 0; i < k; i++) {
    const g = arcGroup[i]!;
    order[pos[g]!] = i;
    pos[g]!++;
  }

  months = [...monthByKey.values()].sort((a, b) => a.key - b.key);
  monthRows.value = months.map((m) => ({ label: m.label, plays: m.plays, ms: m.ms }));

  // guide rings: every January 1st, or every month start on a short span
  const byMonth = days < 400;
  const first = new Date(firstDay);
  const cursor = byMonth
    ? new Date(first.getFullYear(), first.getMonth() + 1, 1)
    : new Date(first.getFullYear() + 1, 0, 1);
  while (true) {
    const idx = Math.round((cursor.getTime() - firstDay) / DAY_MS);
    if (idx >= days) break;
    guides.push({
      day: idx,
      label: byMonth ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}` : String(cursor.getFullYear()),
    });
    if (byMonth) cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setFullYear(cursor.getFullYear() + 1);
  }

  hasData.value = true;
}

// --- theme colors, read at draw time ----------------------------------------
function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    // outside the disc (on the card): theme colors
    axis: v("--axis", "#cdd6d9"),
    label: v("--text-3", "#7d8d93"),
    // on the disc: fixed vinyl colors
    disc: VINYL,
    guide: VINYL_GUIDE,
    onLabel: VINYL_LABEL,
    onInk: VINYL_INK,
    palette: ARTIST_PALETTE.dark,
    other: VINYL_OTHER,
  };
}

// --- base layer: disc + guide rings + chunked arcs ----------------------------
let drawToken = 0;
let rafId = 0;
let cursor = 0;
let curGroup = 0;
const drawing = ref(false);

function cancelDraw() {
  drawToken++;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  drawing.value = false;
}

/** Copy the current base bitmap to the offscreen `snapshot` canvas. */
function snapshotBase(): HTMLCanvasElement | null {
  const src = baseCanvas.value;
  if (!src || !baseHasBitmap || src.width === 0 || src.height === 0) return null;
  if (!snapshot) snapshot = document.createElement("canvas");
  if (snapshot.width !== src.width || snapshot.height !== src.height) {
    snapshot.width = src.width;
    snapshot.height = src.height;
  }
  const ctx = snapshot.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, snapshot.width, snapshot.height);
  ctx.drawImage(src, 0, 0);
  return snapshot;
}

/** Day index range whose rings can be on screen in the current view. */
function visibleDayRange(): [number, number] {
  const [near, far] = visibleAnnulus();
  const pad = ringT + 2 / vk;
  const lo = Math.max(0, Math.floor((near - pad - r0) / ringT - 0.5));
  const hi = Math.min(days - 1, Math.ceil((far + pad - r0) / ringT - 0.5));
  return [lo, hi];
}

/** Offscreen, transparent canvas the size of the base; cleared. */
function ensureWork(): CanvasRenderingContext2D | null {
  const src = baseCanvas.value;
  if (!src) return null;
  if (!work) {
    work = document.createElement("canvas");
    workCtx = work.getContext("2d");
  }
  if (work.width !== src.width || work.height !== src.height) {
    work.width = src.width;
    work.height = src.height;
  }
  workCtx?.setTransform(1, 0, 0, 1, 0, 0);
  workCtx?.clearRect(0, 0, work.width, work.height);
  return workCtx;
}

// Backdrop mode (a redraw after zoom/pan, or a theme change): the previous
// bitmap is kept on screen, transformed to the new view, while the arcs are
// drawn into `work`. Every frame the base is recomposed as disc fill +
// backdrop (clipped to the disc) + work, and the final frame leaves the
// backdrop out — the stale, resampled pixels vanish in one step and the base
// ends up identical to a direct draw. Without a usable bitmap (first draw,
// resize, new data) the arcs go straight onto the base as before.
let useBackdrop = false;
let backS = 1; // composite transform of the snapshot: (view) ∘ (bitmap view)⁻¹
let backX = 0;
let backY = 0;

function discTransform(ctx: CanvasRenderingContext2D) {
  // css px of the disc → device px of the screen
  ctx.setTransform(dpr * vk, 0, 0, dpr * vk, dpr * vtx, dpr * vty);
}

function fillDisc(ctx: CanvasRenderingContext2D, color: string) {
  discTransform(ctx);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TWO_PI);
  ctx.arc(cx, cy, r0, 0, TWO_PI, true);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Backdrop mode: base := disc fill + (backdrop, unless final) + work. */
function composite(final: boolean) {
  if (!base || !work) return;
  base.setTransform(dpr, 0, 0, dpr, 0, 0);
  base.clearRect(0, 0, cssW, cssH);
  fillDisc(base, themeColors().disc);
  if (!final && snapshot) {
    base.save();
    base.clip(); // the annulus path from fillDisc → crisp rim and hole
    base.setTransform(dpr * backS, 0, 0, dpr * backS, dpr * backX, dpr * backY);
    base.imageSmoothingEnabled = true;
    base.drawImage(snapshot, 0, 0, cssW, cssH);
    base.restore();
  }
  base.setTransform(dpr, 0, 0, dpr, 0, 0);
  base.drawImage(work, 0, 0, cssW, cssH); // 1:1 device pixels
}

/**
 * Redraw the base at the current view. If the canvas still shows a usable
 * bitmap it is copied off first and painted back under the new view, so the
 * disc never goes blank while the chunks come in.
 */
function startBaseDraw() {
  cancelDraw();
  if (!base) return;
  const colors = themeColors();
  const backdrop = days ? snapshotBase() : null;
  backS = vk / bk;
  backX = vtx - backS * btx;
  backY = vty - backS * bty;
  bk = vk;
  btx = vtx;
  bty = vty;
  useBackdrop = false;

  if (!days) {
    base.setTransform(dpr, 0, 0, dpr, 0, 0);
    base.clearRect(0, 0, cssW, cssH);
    baseHasBitmap = false;
    return;
  }
  baseHasBitmap = true;

  let target: CanvasRenderingContext2D | null = base;
  if (backdrop) {
    target = ensureWork();
    useBackdrop = target !== null;
  }
  if (!useBackdrop) {
    target = base;
    base.setTransform(dpr, 0, 0, dpr, 0, 0);
    base.clearRect(0, 0, cssW, cssH);
    fillDisc(base, colors.disc);
  }

  // guide rings (under the arcs; their labels go on the overlay)
  const ctx = target!;
  const [dLo, dHi] = visibleDayRange();
  discTransform(ctx);
  ctx.strokeStyle = colors.guide;
  ctx.lineWidth = 1 / vk;
  for (const g of guides) {
    if (g.day < dLo || g.day > dHi + 1) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius(g.day) - ringT / 2, 0, TWO_PI);
    ctx.stroke();
  }
  if (useBackdrop) composite(arcCount === 0);

  cursor = 0;
  curGroup = 0;
  drawing.value = arcCount > 0;
  const token = drawToken;
  rafId = requestAnimationFrame(() => drawChunks(token));
}

function drawChunks(token: number) {
  rafId = 0;
  if (token !== drawToken || !base) return;
  const ctx = useBackdrop ? workCtx : base;
  if (!ctx) return;
  const colors = themeColors();
  const k = vk;
  const lw = Math.max(ringT, 0.6 / k); // ≥ 0.6 screen px
  const [dLo, dHi] = visibleDayRange(); // cull rings outside the viewport
  const started = performance.now();
  discTransform(ctx);
  ctx.lineWidth = lw;
  ctx.lineCap = "butt";

  while (cursor < arcCount) {
    while (curGroup < groupEnd.length && cursor >= groupEnd[curGroup]!) curGroup++;
    if (curGroup >= groupEnd.length) break;
    const rank = groupRank[curGroup]!;
    ctx.strokeStyle = rank < 0 ? colors.other : colors.palette[rank] ?? colors.other;
    ctx.globalAlpha = rank < 0 ? OTHER_ALPHA : TOP_ALPHA;

    const end = Math.min(cursor + CHUNK, groupEnd[curGroup]!);
    ctx.beginPath();
    for (let i = cursor; i < end; i++) {
      const a = order[i]!;
      const day = arcDay[a]!;
      if (day < dLo || day > dHi) continue;
      const r = ringRadius(day);
      const t0 = angle(arcA0[a]!);
      let t1 = angle(arcA1[a]!);
      const minAng = 0.7 / (r * k); // never thinner than ~0.7 screen px along the ring
      if (t1 - t0 < minAng) t1 = t0 + minAng;
      ctx.moveTo(cx + r * Math.cos(t0), cy + r * Math.sin(t0));
      ctx.arc(cx, cy, r, t0, t1);
    }
    ctx.stroke();
    cursor = end;

    if (performance.now() - started > FRAME_BUDGET_MS) break;
  }
  ctx.globalAlpha = 1;

  const done = cursor >= arcCount;
  if (useBackdrop) composite(done);
  if (!done) {
    rafId = requestAnimationFrame(() => drawChunks(token));
  } else {
    drawing.value = false;
  }
}

// --- overlay: ticks, labels, usual-time line, markers, hover ------------------
const hoverDay = ref<number | null>(null);

interface Marker {
  n: number;
  day: number;
  minute: number;
}

const markers = computed<Marker[]>(() => {
  const h = props.highlights;
  if (!h || !days) return [];
  const out: Marker[] = [];
  if (h.longestStreak) {
    const from = localDate(h.longestStreak.from);
    from.setDate(from.getDate() + Math.floor(h.longestStreak.days / 2));
    const day = dayIndexOf(from.getTime());
    if (day >= 0) out.push({ n: 1, day, minute: 720 });
  }
  if (h.longestSession) {
    const ms = new Date(h.longestSession.start).getTime();
    const day = dayIndexOf(ms);
    if (day >= 0) out.push({ n: 2, day, minute: minuteOf(ms) });
  }
  if (h.firstPlay) {
    const ms = new Date(h.firstPlay.playedAt).getTime();
    const day = dayIndexOf(ms);
    if (day >= 0) out.push({ n: 3, day, minute: minuteOf(ms) });
  }
  if (h.biggestDay) {
    const day = dayIndexOf(localDate(h.biggestDay.date).getTime());
    if (day >= 0) out.push({ n: 4, day, minute: 720 });
  }
  return out;
});

/** Legend rows under the disc; the numbers match the markers. */
const legend = computed(() => {
  const h = props.highlights;
  if (!h) return [];
  const rows: Array<{ n: number; label: string; value: string; sub: string }> = [];
  if (h.longestStreak) {
    rows.push({
      n: 1,
      label: "Longest streak",
      value: `${formatNumber(h.longestStreak.days)} days`,
      sub: `${formatDate(h.longestStreak.from)} – ${formatDate(h.longestStreak.to)}`,
    });
  }
  if (h.longestSession) {
    rows.push({
      n: 2,
      label: "Longest session",
      value: formatMs(h.longestSession.ms),
      sub: `${formatNumber(h.longestSession.plays)} plays · ${formatDate(h.longestSession.start)}`,
    });
  }
  if (h.firstPlay) {
    rows.push({
      n: 3,
      label: "First play",
      value: h.firstPlay.trackName,
      sub: `${h.firstPlay.artistName} · ${formatDate(h.firstPlay.playedAt)}`,
    });
  }
  if (h.biggestDay) {
    rows.push({
      n: 4,
      label: "Biggest day",
      value: formatMs(h.biggestDay.ms),
      sub: `${formatNumber(h.biggestDay.plays)} plays · ${formatDate(h.biggestDay.date)}`,
    });
  }
  return rows;
});

function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, halo: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

/**
 * Everything here is drawn in SCREEN space (identity transform): disc
 * positions go through toScreen()/`k`, offsets, fonts and line widths are
 * screen px, so the overlay stays crisp at every zoom level.
 */
function drawOverlay() {
  if (!over) return;
  const colors = themeColors();
  over.setTransform(dpr, 0, 0, dpr, 0, 0);
  over.clearRect(0, 0, cssW, cssH);
  if (!days) return;
  const k = vk;
  const [scx, scy] = toScreen(cx, cy);
  const sR = R * k;
  const sr0 = r0 * k;
  over.font = "11px system-ui, sans-serif";

  // hour ticks outside the disc, labels at the four quarters
  over.strokeStyle = colors.axis;
  over.fillStyle = colors.label;
  over.lineWidth = 1;
  const QUARTER_LABELS: Record<number, string> = { 0: "midnight", 6: "6 am", 12: "noon", 18: "6 pm" };
  for (let h = 0; h < 24; h += 3) {
    const a = angle(h * 60);
    const quarter = h % 6 === 0;
    const rA = sR + 3;
    const rB = sR + (quarter ? 11 : 7);
    over.beginPath();
    over.moveTo(scx + rA * Math.cos(a), scy + rA * Math.sin(a));
    over.lineTo(scx + rB * Math.cos(a), scy + rB * Math.sin(a));
    over.stroke();
    const label = QUARTER_LABELS[h];
    if (label) {
      const rL = sR + 16;
      let lx = scx + rL * Math.cos(a);
      const ly = scy + rL * Math.sin(a);
      over.textAlign = h === 6 ? "left" : h === 18 ? "right" : "center";
      over.textBaseline = h === 0 ? "bottom" : h === 12 ? "top" : "middle";
      // on a width-bound disc (phones) "6 am" / "6 pm" would run past the canvas
      // edge: slide them in so the text stays fully visible
      const tw = over.measureText(label).width;
      if (h === 6) lx = Math.min(lx, cssW - 2 - tw);
      else if (h === 18) lx = Math.max(lx, 2 + tw);
      over.fillText(label, lx, ly);
    }
  }

  // guide labels, sitting just right of midnight on their ring; on a small
  // disc (< 320 px across on screen) only every other one, they'd touch otherwise
  over.font = "10px system-ui, sans-serif";
  over.fillStyle = colors.onLabel;
  over.textAlign = "left";
  over.textBaseline = "bottom";
  const everyOther = sR * 2 < 320;
  let lastLabelY = -Infinity;
  for (let gi = 0; gi < guides.length; gi++) {
    if (everyOther && gi % 2 === 1) continue;
    const g = guides[gi]!;
    const r = (ringRadius(g.day) - ringT / 2) * k;
    const y = scy - r - 1;
    if (Math.abs(y - lastLabelY) < 12) continue; // skip labels that would collide
    lastLabelY = y;
    if (y < -2 || y > cssH + 14) continue;
    haloText(over, g.label, scx + 4, y, colors.disc);
  }

  // "usual time of day": per month, the half hour with the most listening once
  // the neighbouring months (±4) are pooled and the histogram lightly smoothed,
  // so the line follows the dominant hour rather than a mean that lands between
  // a morning and an evening habit. The angles are then averaged circularly
  // over ±4 months with triangular weights: in a dense year consecutive months
  // sit only ~2 px apart on the disc, so anything less reads as a zigzag.
  const eligible = months.filter((m) => m.plays >= MIN_MONTH_PLAYS);
  const peaks: number[] = [];
  for (let i = 0; i < eligible.length; i++) {
    const pooled = new Float64Array(BINS);
    for (let j = Math.max(0, i - 4); j <= Math.min(eligible.length - 1, i + 4); j++) {
      const b = eligible[j]!.bins;
      for (let k = 0; k < BINS; k++) pooled[k]! += b[k]!;
    }
    let bestK = 0;
    let bestV = -1;
    for (let k = 0; k < BINS; k++) {
      const at = (o: number) => pooled[(k + o + BINS) % BINS]!;
      const v = 3 * at(0) + 2 * (at(1) + at(-1)) + at(2) + at(-2); // triangular kernel
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    }
    peaks.push(((bestK + 0.5) / BINS) * TWO_PI);
  }
  const polar: Array<{ r: number; a: number }> = [];
  for (let i = 0; i < eligible.length; i++) {
    let sin = 0;
    let cos = 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(eligible.length - 1, i + 4); j++) {
      const w = 5 - Math.abs(j - i);
      sin += w * Math.sin(peaks[j]!);
      cos += w * Math.cos(peaks[j]!);
    }
    const m = eligible[i]!;
    polar.push({ r: ringRadius(m.sumDay / m.plays), a: Math.atan2(sin, cos) - Math.PI / 2 });
  }
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < polar.length; i++) {
    const p = polar[i]!;
    if (i === 0) {
      pts.push({ x: scx + p.r * k * Math.cos(p.a), y: scy + p.r * k * Math.sin(p.a) });
      continue;
    }
    // walk the shorter way round between two months so the line follows the
    // groove instead of cutting across the disc when it straddles midnight
    const q = polar[i - 1]!;
    let da = p.a - q.a;
    while (da > Math.PI) da -= TWO_PI;
    while (da < -Math.PI) da += TWO_PI;
    const steps = Math.max(1, Math.ceil((Math.abs(da) * Math.max(p.r, q.r) * k) / 6));
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const r = (q.r + (p.r - q.r) * f) * k;
      const a = q.a + da * f;
      pts.push({ x: scx + r * Math.cos(a), y: scy + r * Math.sin(a) });
    }
  }
  if (pts.length > 1) {
    over.lineJoin = "round";
    over.lineCap = "round";
    over.beginPath();
    pts.forEach((p, i) => (i ? over!.lineTo(p.x, p.y) : over!.moveTo(p.x, p.y)));
    over.strokeStyle = colors.disc;
    over.lineWidth = 4;
    over.globalAlpha = 0.55;
    over.stroke();
    over.strokeStyle = colors.onInk;
    over.lineWidth = 2;
    over.globalAlpha = 0.92;
    over.stroke();
    over.globalAlpha = 1;
  }

  // hovered ring (stroke width in screen px)
  if (hoverDay.value !== null) {
    over.beginPath();
    over.arc(scx, scy, ringRadius(hoverDay.value) * k, 0, TWO_PI);
    over.strokeStyle = colors.onInk;
    over.lineWidth = Math.max(ringT * k, 1.5);
    over.globalAlpha = 0.55;
    over.stroke();
    over.globalAlpha = 1;
  }

  // highlight markers: dot on the spot, leader line, numbered badge
  over.font = "600 11px system-ui, sans-serif";
  over.textAlign = "center";
  over.textBaseline = "middle";
  const placed: Array<{ x: number; y: number }> = [];
  for (const m of markers.value) {
    const a = angle(m.minute);
    const r = ringRadius(m.day) * k;
    const px = scx + r * Math.cos(a);
    const py = scy + r * Math.sin(a);
    if (px < -40 || px > cssW + 40 || py < -40 || py > cssH + 40) continue;
    // badge 28 px further out along the radius; inward when that leaves the disc
    const rb = r + 28 <= sR - 10 ? r + 28 : Math.max(sr0 + 10, r - 28);
    let ab = a;
    let bx = scx + rb * Math.cos(ab);
    let by = scy + rb * Math.sin(ab);
    // two highlights on nearly the same day and time (e.g. the streak's middle
    // and the biggest day) would stack their badges — slide along the ring
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.some((p) => Math.hypot(p.x - bx, p.y - by) < 22);
      if (!hit) break;
      ab += 22 / rb;
      bx = scx + rb * Math.cos(ab);
      by = scy + rb * Math.sin(ab);
    }
    placed.push({ x: bx, y: by });

    over.beginPath();
    over.moveTo(px, py);
    over.lineTo(bx, by);
    over.strokeStyle = colors.onInk;
    over.lineWidth = 1.2;
    over.stroke();

    over.beginPath();
    over.arc(px, py, 3.5, 0, TWO_PI);
    over.fillStyle = colors.onInk;
    over.fill();
    over.strokeStyle = colors.disc;
    over.lineWidth = 1.5;
    over.stroke();

    over.beginPath();
    over.arc(bx, by, 9, 0, TWO_PI);
    over.fillStyle = colors.onInk;
    over.fill();
    over.strokeStyle = colors.disc;
    over.lineWidth = 1.5;
    over.stroke();
    over.fillStyle = colors.disc;
    over.fillText(String(m.n), bx, by + 0.5);
  }
}

// --- zoom / pan ---------------------------------------------------------------
let wheelTimer = 0;
let dragId = -1;
let dragMoved = false;
let lastX = 0;
let lastY = 0;

/**
 * Show the current view without redrawing the base: move the existing bitmap
 * (rendered at view b) with a CSS transform equal to view ∘ b⁻¹, and redraw
 * the cheap overlay in place.
 */
function previewView() {
  const el = baseCanvas.value;
  if (el) {
    const s = vk / bk;
    const same = Math.abs(s - 1) < 1e-9 && Math.abs(vtx - btx) < 1e-6 && Math.abs(vty - bty) < 1e-6;
    el.style.transform = same ? "" : `translate(${vtx - s * btx}px, ${vty - s * bty}px) scale(${s})`;
  }
  zoomed.value = vk > 1;
  drawOverlay();
}

/** Gesture over: drop the CSS transform and redraw the base at the view. */
function commitView() {
  if (wheelTimer) {
    clearTimeout(wheelTimer);
    wheelTimer = 0;
  }
  const el = baseCanvas.value;
  if (vk === bk && vtx === btx && vty === bty) {
    if (el) el.style.transform = "";
    return;
  }
  startBaseDraw(); // paints the old bitmap back first, so no blank frame
  if (el) el.style.transform = "";
}

function clearHover() {
  tooltip.value = null;
  if (hoverDay.value !== null) {
    hoverDay.value = null;
    drawOverlay();
  }
}

function pointerPos(e: { clientX: number; clientY: number }): [number, number] {
  const rect = container.value!.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function onWheel(e: WheelEvent) {
  if (!days || !container.value) return;
  e.preventDefault();
  const [mx, my] = pointerPos(e);
  const k1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, vk * Math.exp(-e.deltaY * WHEEL_ZOOM_RATE)));
  if (k1 === vk) return;
  // keep the disc point under the cursor where it is
  const s = k1 / vk;
  vtx = mx - (mx - vtx) * s;
  vty = my - (my - vty) * s;
  vk = k1;
  clampView();
  tooltip.value = null;
  previewView();
  if (wheelTimer) clearTimeout(wheelTimer);
  wheelTimer = window.setTimeout(commitView, WHEEL_END_MS);
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !days || vk <= 1 || !container.value) return;
  dragId = e.pointerId;
  dragMoved = false;
  [lastX, lastY] = pointerPos(e);
  container.value.setPointerCapture(e.pointerId);
}

function endDrag(e: PointerEvent) {
  if (e.pointerId !== dragId) return;
  dragId = -1;
  container.value?.releasePointerCapture(e.pointerId);
  if (dragMoved) {
    dragging.value = false;
    commitView();
  }
}

function resetView() {
  if (wheelTimer) {
    clearTimeout(wheelTimer);
    wheelTimer = 0;
  }
  dragId = -1;
  dragging.value = false;
  vk = 1;
  vtx = 0;
  vty = 0;
  zoomed.value = false;
  hoverDay.value = null;
  tooltip.value = null;
  const el = baseCanvas.value;
  if (el) el.style.transform = "";
  redrawAll();
}

defineExpose({ resetView, zoomed });

// --- hover ------------------------------------------------------------------
function onPointerMove(e: PointerEvent) {
  const c = container.value;
  if (!c || !days) return;
  const [mx, my] = pointerPos(e);

  if (e.pointerId === dragId) {
    const dx = mx - lastX;
    const dy = my - lastY;
    if (!dragMoved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // a click, not a drag
      dragMoved = true;
      dragging.value = true;
      if (hoverDay.value !== null) hoverDay.value = null;
      tooltip.value = null;
    }
    lastX = mx;
    lastY = my;
    vtx += dx;
    vty += dy;
    clampView();
    previewView();
    return;
  }

  const [x, y] = toDisc(mx, my);
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const idx = Math.floor((dist - r0) / ringT);
  if (idx < 0 || idx >= days) {
    clearHover();
    return;
  }
  let a = Math.atan2(dy, dx) + Math.PI / 2;
  if (a < 0) a += TWO_PI;
  const minute = Math.floor((a / TWO_PI) * MIN_IN_DAY);
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  const date = new Date(firstDay + idx * DAY_MS + DAY_MS / 2); // noon-safe across DST
  const plays = dayPlays[idx] ?? 0;
  tooltip.value = {
    x: mx,
    y: my,
    title: `${formatDate(date.toISOString())} · ${hh}:${mm}`,
    lines: plays ? [`${formatNumber(plays)} plays`, `${formatMs(dayMs[idx] ?? 0)} listened`] : ["no plays"],
  };
  if (hoverDay.value !== idx) {
    hoverDay.value = idx;
    drawOverlay();
  }
}
function onPointerLeave(e: PointerEvent) {
  if (e.pointerId === dragId) return; // captured drag continues outside
  clearHover();
}

// --- lifecycle ----------------------------------------------------------------
/** Resize keeps the view; the bitmap is lost (canvas reset), so no backdrop. */
function resizeCanvases() {
  const cont = container.value;
  if (!cont) return;
  cssW = Math.max(1, cont.clientWidth);
  cssH = props.height;
  dpr = window.devicePixelRatio || 1;
  for (const c of [baseCanvas.value, overlayCanvas.value]) {
    if (!c) continue;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    c.style.width = cssW + "px";
    c.style.height = cssH + "px";
  }
  baseHasBitmap = false;
  layout();
  clampView();
}

function redrawAll() {
  if (wheelTimer) {
    clearTimeout(wheelTimer);
    wheelTimer = 0;
  }
  startBaseDraw();
  const el = baseCanvas.value;
  if (el) el.style.transform = "";
  zoomed.value = vk > 1;
  drawOverlay();
}

onMounted(() => {
  base = baseCanvas.value?.getContext("2d") ?? null;
  over = overlayCanvas.value?.getContext("2d") ?? null;
  rebuildBuffers();
  resizeCanvases();
  redrawAll();
  ro = new ResizeObserver(() => {
    resizeCanvases();
    redrawAll();
  });
  if (container.value) ro.observe(container.value);
  container.value?.addEventListener("wheel", onWheel, { passive: false });
});

onBeforeUnmount(() => {
  cancelDraw();
  if (wheelTimer) clearTimeout(wheelTimer);
  ro?.disconnect();
  container.value?.removeEventListener("wheel", onWheel);
});

watch(
  () => [props.points, props.topArtists] as const,
  () => {
    hoverDay.value = null;
    tooltip.value = null;
    rebuildBuffers();
    layout();
    clampView();
    baseHasBitmap = false; // the old bitmap shows other data: no backdrop
    redrawAll();
  }
);
watch(() => props.height, () => {
  resizeCanvases();
  redrawAll();
});
watch(() => props.highlights, drawOverlay);
watch(theme, redrawAll);
</script>

<template>
  <div class="record">
    <div
      ref="container"
      class="disc"
      :class="{ zoomed, dragging }"
      :style="{ height: height + 'px' }"
      role="img"
      aria-label="One ring per day, every play as an arc at its time of day. Mouse wheel zooms, drag (or a finger, once zoomed) pans."
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <div class="layers" aria-hidden="true">
        <canvas ref="baseCanvas" class="layer"></canvas>
        <canvas ref="overlayCanvas" class="layer"></canvas>
      </div>
      <span v-if="drawing" class="loading-chip drawing-chip" role="status">Drawing…</span>
      <div
        v-if="tooltip"
        class="chart-tooltip"
        :style="{
          left: tooltip.x + (tooltip.x > cssW - 180 ? -12 : 12) + 'px',
          top: tooltip.y + 12 + 'px',
          transform: tooltip.x > cssW - 180 ? 'translateX(-100%)' : 'none',
        }"
      >
        <span class="tooltip-label">{{ tooltip.title }}</span>
        <span v-for="l in tooltip.lines" :key="l" class="tooltip-value">{{ l }}</span>
      </div>
    </div>

    <ol v-if="legend.length" class="highlights">
      <li v-for="row in legend" :key="row.n" class="highlight">
        <span class="badge" aria-hidden="true">{{ row.n }}</span>
        <span class="highlight-text">
          <span class="highlight-label">{{ row.label }}</span>
          <span class="highlight-value" :title="row.value">{{ row.value }}</span>
          <span class="highlight-sub">{{ row.sub }}</span>
        </span>
      </li>
    </ol>

    <div class="sr-only">
      <table>
        <caption>Plays and listening time per month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Plays</th>
            <th scope="col">Listened</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in monthRows" :key="m.label">
            <th scope="row">{{ m.label }}</th>
            <td>{{ formatNumber(m.plays) }}</td>
            <td>{{ formatMs(m.ms) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!hasData">No plays to draw.</p>
    </div>
  </div>
</template>

<style scoped>
.record {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}
.disc {
  position: relative;
  width: 100%;
  touch-action: pan-y; /* at k = 1 a touch drag still scrolls the page */
}
.disc.zoomed {
  cursor: grab;
  touch-action: none; /* zoomed: pointer drags pan the disc */
}
.disc.dragging {
  cursor: grabbing;
}
.layers {
  position: absolute;
  inset: 0;
  overflow: hidden; /* the zoomed base canvas (CSS-transformed) stays inside */
}
.layer {
  position: absolute;
  inset: 0;
  display: block;
  transform-origin: 0 0;
}
.drawing-chip {
  position: absolute;
  top: 4px;
  left: 4px;
}

.chart-tooltip {
  position: absolute;
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
.tooltip-value {
  font-size: 13px;
  font-weight: 650;
}
.tooltip-label {
  font-size: 11px;
  opacity: 0.75;
}

.highlights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.highlight {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
.badge {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--text-1);
  color: var(--text-1);
  font-size: 11px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.highlight-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.highlight-label {
  font-size: 11.5px;
  color: var(--text-3);
}
.highlight-value {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.highlight-sub {
  font-size: 11.5px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* phone ≤ 640 px: the four highlight rows in two columns */
@media (max-width: 640px) {
  .highlights {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 12px;
  }
}
</style>
