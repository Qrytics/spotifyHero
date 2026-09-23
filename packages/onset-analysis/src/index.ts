/**
 * `@spotifyhero/onset-analysis` — pure DSP: mono `Float32Array` in,
 * `BeatEvent[]` + tempo out.
 *
 * Compiled with `lib: ["ES2022"]` (no DOM), so the compiler itself enforces that
 * nothing here reaches for `AudioBuffer`, `OfflineAudioContext` or a worker
 * global. Decoding and downmixing happen in `apps/overlay-ui`; this package only
 * ever sees samples.
 *
 * Layering: depends on `shared-types` and nothing else.
 */

export { analyzeOnsets, ONSET_ANALYSIS_VERSION } from "./analyzeOnsets.js";
export type {
  NormalizationProfile,
  OnsetAnalysisOptions,
  OnsetAnalysisResult,
  OnsetAnalysisStats,
} from "./analyzeOnsets.js";

export { Fft, binToHz, hzToBin } from "./fft.js";
export { hannWindow, frameGeometry, frameTimeMs, frameAtTimeMs } from "./window.js";
export type { FrameGeometry } from "./window.js";
export { computeOnsetEnvelope, LOG_COMPRESSION_GAMMA } from "./spectralFlux.js";
export type { OnsetEnvelope, OnsetEnvelopeOptions } from "./spectralFlux.js";
export { pickPeaks, percentileOf, parabolicShift } from "./peakPicking.js";
export type { OnsetPeak, PeakPickingOptions, PeakPickingResult } from "./peakPicking.js";
export { estimateTempo, refineBeatPhaseMs } from "./tempo.js";
export type { TempoEstimate, TempoOptions } from "./tempo.js";
export { PitchEstimator } from "./pitch.js";
export type { PitchEstimatorOptions } from "./pitch.js";
