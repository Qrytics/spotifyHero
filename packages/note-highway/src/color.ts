import type { Judgement } from "@spotifyhero/shared-types";

/**
 * Lane palette — the single source of truth. `apps/overlay-ui` must import this
 * rather than keep its own copy (the calibrator used to, and drifted).
 *
 * Pulled slightly off maximum-saturation neon so gems read as *lit objects*
 * rather than raw sRGB primaries, while keeping hue separation wide enough to
 * stay legible in a 45px lane at the 180px default window width.
 */
export const LANE_HEX = ["#C86BFF", "#3FD8F0", "#FF8A4C", "#5BE86B"] as const;

/** The pre-overhaul palette. Only `themes/classic.ts` may use it. */
export const LANE_HEX_CLASSIC = ["#BF5FFF", "#00E5FF", "#FF6B35", "#39FF14"] as const;

export function laneHex(lane: number): string {
  return LANE_HEX[lane] ?? "#ffffff";
}

/** #rrggbb + alpha → rgba() */
export function hexToRgba(hex: string, a: number): string {
  const n = hex.replace("#", "");
  const full =
    n.length === 3 ? n.split("").map((c) => c + c).join("") : n.padEnd(6, "0").slice(0, 6);
  const v = parseInt(full, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function parseHex(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  const full =
    n.length === 3 ? n.split("").map((c) => c + c).join("") : n.padEnd(6, "0").slice(0, 6);
  const v = parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

/** Linear blend `a` → `b` by `t` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

/** Multiply brightness — `f < 1` darkens. */
export function shadeHex(hex: string, f: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * f, g * f, b * f);
}

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/**
 * Judgement colours, shared with the DOM HUD (`PlayBottomBar`).
 *
 * Ring and text deliberately differ: the ring reads as light at the strike line
 * (near-white for a perfect), the word reads as a rank (gold for a perfect).
 * They are two different signals, not one colour applied inconsistently.
 */
export const JUDGEMENT_RING_COLOR: Record<Judgement, string> = {
  perfect: "#f5fff9",
  great: "#1ed760",
  good: "#ffb74d",
  bad: "#ff6e8b",
  miss: "#ff5252",
};

export const JUDGEMENT_TEXT_COLOR: Record<Judgement, string> = {
  perfect: "#FFD54F",
  great: "#FFFFFF",
  good: "#FFFFFF",
  bad: "#FF5252",
  miss: "#FF5252",
};

export function judgementLabel(j: Judgement): string {
  switch (j) {
    case "perfect":
      return "PERFECT";
    case "great":
      return "GREAT";
    case "good":
      return "GOOD";
    case "bad":
      return "BAD";
    case "miss":
      return "MISS";
    default:
      return "HIT";
  }
}

/** Short forms for narrow windows — "PERFECT" does not fit a 45px lane. */
export function judgementLabelShort(j: Judgement): string {
  switch (j) {
    case "perfect":
      return "PERF";
    case "great":
      return "GRT";
    case "good":
      return "GOOD";
    case "bad":
      return "BAD";
    case "miss":
      return "MISS";
    default:
      return "HIT";
  }
}
