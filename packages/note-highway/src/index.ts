export { NoteHighway, registerNoteHighwayPlaybackClock } from "./NoteHighway.js";
export {
  isSpotifyPlaybackTooQuietForNotes,
  shouldHideNotesForQuietPlayback,
  MIN_VOLUME_PERCENT_FOR_CHART,
} from "./playbackVolumeGate.js";

/**
 * Geometry and palette are exported because `OffsetCalibrator` draws its own
 * miniature highway and must agree with this one pixel-for-pixel — it currently
 * hardcodes a radius of 15 where the game computes 12 at 180px wide, so you
 * calibrate against gems 25% larger than the ones you hit.
 */
export { LANE_HEX, LANE_HEX_CLASSIC, laneHex, hexToRgba, mixHex, shadeHex } from "./color.js";
export { LANE_COUNT, LOOK_AHEAD_MS, HIT_LINE_BOTTOM_PAD } from "./highwayConstants.js";
export {
  noteRadiusFromViewport,
  hitLineYFromHeight,
  laneCenterX,
  yFromTime,
} from "./highwayGeometry.js";

export { THEMES, resolveTheme } from "./themes/index.js";
export type { HighwayTheme, HighwaySurface, HighwayFeel } from "./themes/types.js";
