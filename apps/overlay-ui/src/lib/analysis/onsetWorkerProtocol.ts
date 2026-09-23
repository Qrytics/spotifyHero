/**
 * Message types shared by `onsetWorker.ts` and `analyzeAudioBuffer.ts`.
 *
 * In their own module so the main thread can talk to the worker with
 * `import type` only, never `import`.
 *
 * That keeps the worker module out of the main graph, but the DSP itself is in
 * the main chunk anyway: `chartCache.ts` and `serverDiagnostics.ts` import
 * `ONSET_ANALYSIS_VERSION` from the package index, and a module that is both
 * statically and dynamically imported (see `analyzeAudioBuffer`'s main-thread
 * fallback) is not split out. Costs bundle size, not frame time — the analysis
 * still runs in the worker. Splitting it would mean a `./version` subpath export
 * with no DSP behind it.
 */
import type { OnsetAnalysisResult } from "@spotifyhero/onset-analysis";

export interface OnsetAnalysisWorkerRequest {
  type: "analyze";
  /** Echoed back on every response; a worker instance only ever sees one. */
  requestId: number;
  /**
   * Mono samples, **transferred** (`postMessage(req, [mono.buffer])`). The
   * sender's view is detached afterwards — a 4-minute track is ~42 MB and
   * copying it would double that for the duration of the send.
   */
  mono: Float32Array;
  sampleRate: number;
  options?: {
    estimatePitch?: boolean;
    progressEveryFrames?: number;
  };
}

export type OnsetAnalysisWorkerResponse =
  | { type: "progress"; requestId: number; progress: number }
  | { type: "done"; requestId: number; result: OnsetAnalysisResult }
  | { type: "error"; requestId: number; message: string };
