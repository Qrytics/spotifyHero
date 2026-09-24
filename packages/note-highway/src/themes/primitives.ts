import { hexToRgba, mixHex, shadeHex } from "../color.js";

/**
 * Drawing primitives shared by the themes. Nothing here allocates a gradient or
 * touches `shadowBlur` **except** `buildGemSprite`, which runs once per size.
 */

/**
 * Sustain body: stadium / pill — rounded caps at both ends.
 * `cyHead` should be the **outer** head end (past gem center) so the cap overlaps the head gem ring.
 *
 * Verbatim from the pre-split renderer. The sustain occlusion logic is written
 * against this exact head/tail maths; do not change it in either theme.
 */
export function pillPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cyHead: number,
  cyTail: number,
  bodyW: number,
  radii: readonly [number, number, number, number]
): void {
  const top = Math.min(cyHead, cyTail);
  const bot = Math.max(cyHead, cyTail);
  const h = bot - top;
  if (h <= 0.5) return;
  const x = cx - bodyW / 2;
  ctx.beginPath();
  ctx.roundRect(x, top, bodyW, h, radii);
}

/** Reused so pill paths do not allocate a radii tuple per note per frame. */
const RADII_SCRATCH: [number, number, number, number] = [0, 0, 0, 0];

export function pillRadii(bodyW: number, h: number): readonly [number, number, number, number] {
  const r = Math.min(bodyW * 0.5, h * 0.5);
  RADII_SCRATCH[0] = r;
  RADII_SCRATCH[1] = r;
  RADII_SCRATCH[2] = r;
  RADII_SCRATCH[3] = r;
  return RADII_SCRATCH;
}

export function ringStroke(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  lineWidth: number
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * `700 12px system-ui` overflows a 45px lane badly at the 180px default window
 * width, so the size tracks the lane and the labels abbreviate below 200px.
 */
export function judgementFontPx(laneWidth: number): number {
  return Math.max(8, Math.min(12, laneWidth * 0.24));
}

/** Keep the label inside the canvas so lanes 0 and 3 do not clip. */
export function clampTextX(x: number, width: number): number {
  return Math.max(4, Math.min(width - 4, x));
}

/**
 * Sprite side length in CSS px for a given gem radius. Generous enough to hold
 * the bloom halo without clipping.
 */
export function gemSpriteSizeCss(radius: number): number {
  return Math.ceil(radius * 3.2);
}

function newSpriteCanvas(radius: number, dpr: number): {
  off: HTMLCanvasElement;
  g: CanvasRenderingContext2D | null;
  sizeCss: number;
} {
  const sizeCss = gemSpriteSizeCss(radius);
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.ceil(sizeCss * dpr));
  off.height = off.width;
  const g = off.getContext("2d");
  if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { off, g, sizeCss };
}

/**
 * Bloom halo only, kept as its own sprite so the theme can blit **all** bloom in
 * one additive pass and all bodies in one normal pass — two
 * `globalCompositeOperation` switches per frame instead of two per note.
 */
export function buildGemBloomSprite(
  hex: string,
  radius: number,
  dpr: number
): HTMLCanvasElement {
  const { off, g, sizeCss } = newSpriteCanvas(radius, dpr);
  if (!g) return off;
  const c = sizeCss / 2;
  const R = radius;
  const halo = g.createRadialGradient(c, c, R * 0.42, c, c, R * 1.55);
  halo.addColorStop(0, hexToRgba(hex, 0.62));
  halo.addColorStop(0.45, hexToRgba(hex, 0.24));
  halo.addColorStop(1, hexToRgba(hex, 0));
  g.fillStyle = halo;
  g.beginPath();
  g.arc(c, c, R * 1.55, 0, Math.PI * 2);
  g.fill();
  return off;
}

/**
 * Pre-render one flat gem body.
 *
 * Deliberately 2D. Three cues made the old gem read as a sphere — an offset radial
 * body gradient, a bottom inner shadow, and an upper-left specular hotspot — and
 * all three are gone. What is left is direction-free and concentric: a flat fill,
 * an inner ring, an even rim. Nothing here implies a light source, which is what
 * makes it read as a graphic rather than an object.
 *
 * Still pre-rendered rather than drawn per frame: one `drawImage` beats three
 * `arc` + `fill`/`stroke` calls per gem per frame, and keeping the build here is
 * what lets `void.ts` stay free of per-frame gradients.
 */
export function buildGemBodySprite(
  hex: string,
  radius: number,
  dpr: number
): HTMLCanvasElement {
  const { off, g, sizeCss } = newSpriteCanvas(radius, dpr);
  if (!g) return off;

  const c = sizeCss / 2;
  const R = radius;

  // Flat body, lightened a touch: a bare lane hex with no highlight anywhere on it
  // loses too much presence against the void's near-black floor.
  g.fillStyle = mixHex(hex, "#ffffff", 0.12);
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.fill();

  // Concentric inner ring — structure at the 180px default window without picking
  // a light direction. Scales with R so it never closes up at small sizes.
  g.strokeStyle = hexToRgba(mixHex(hex, "#ffffff", 0.55), 0.5);
  g.lineWidth = Math.max(1, R * 0.1);
  g.beginPath();
  g.arc(c, c, R * 0.58, 0, Math.PI * 2);
  g.stroke();

  // Rim at even weight the whole way round: the silhouette, not a highlight.
  g.strokeStyle = hexToRgba(mixHex(hex, "#ffffff", 0.7), 0.85);
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(c, c, R - 0.7, 0, Math.PI * 2);
  g.stroke();

  return off;
}

/**
 * Hueless white flash. Blitted over a gem at the instant it crosses the line, and
 * reused additively for the press glow and the hold contact flare — which is how
 * `void.ts` gets soft light with no per-frame gradient anywhere.
 */
export function buildImpactFlashSprite(radius: number, dpr: number): HTMLCanvasElement {
  const { off, g, sizeCss } = newSpriteCanvas(radius, dpr);
  if (!g) return off;
  const c = sizeCss / 2;
  const r = radius * 1.55;
  const grad = g.createRadialGradient(c, c, 0, c, c, r);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.38, "rgba(226,238,255,0.42)");
  grad.addColorStop(1, "rgba(200,220,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fill();
  return off;
}
