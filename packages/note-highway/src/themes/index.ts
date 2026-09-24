import type { HighwayThemeId } from "@spotifyhero/shared-types";
import type { HighwayTheme } from "./types.js";
import { classicTheme } from "./classic.js";
import { voidTheme } from "./void.js";

export type { HighwayTheme, HighwaySurface, ClassicSurface, VoidSurface, HighwayFeel } from "./types.js";
export { classicTheme } from "./classic.js";
export { voidTheme } from "./void.js";

export const THEMES: Readonly<Record<HighwayThemeId, HighwayTheme>> = Object.freeze({
  classic: classicTheme,
  void: voidTheme,
});

/**
 * The renderer resolves the theme by id on every frame (via `getState()`, never a
 * dep array — see the note in `docs/highway-visual-overhaul-progress.md`), so this
 * must be a total function and must never throw: a `localStorage` blob written by
 * an older or newer build can carry an id this build does not know. Classic is the
 * fallback because it is the look that predates the setting.
 */
export function resolveTheme(id: string | undefined): HighwayTheme {
  const theme = id === undefined ? undefined : THEMES[id as HighwayThemeId];
  return theme ?? classicTheme;
}
