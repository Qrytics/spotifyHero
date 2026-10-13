/**
 * Message types shared by `onsetWorker.ts` and `analyzeAudioBuffer.ts`.
 *
 * In their own module so the main thread can talk to the worker with
 * `import type` only, never `import`. Importing the worker module itself would
 * pull the whole DSP package into the main chunk, which is exactly what running
 * it in a worker is meant to avoid.
 *
 * Keeping that true takes one more rule: the version string comes from
 * `@spotifyhero/onset-analysis/version`, never from the package root. Rollup
 * will not split a module that anything imports statically, so a single
 * root-level value import is enough to merge the analyser back into this chunk.
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
