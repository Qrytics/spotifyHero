/**
 * Worker entry point for onset analysis. Everything here is one call into
 * `@spotifyhero/onset-analysis`; all the DSP lives in that package, where it is
 * node-testable.
 *
 * Why a worker at all: analysis is ~0.6–1.5 s of tight FFT work for a 4-minute
 * track. On the main thread that is 50–90 dropped frames in an overlay whose
 * whole job is smooth scrolling — and the window is visible during it, showing
 * progress.
 *
 * Why not `OfflineAudioContext` or an `AudioWorklet`: there is no spectral-flux
 * node, and an `AudioWorklet` would put the DSP somewhere node cannot test it.
 *
 * Decoding stays on the main thread: `decodeAudioData` is not reliably available
 * in a Chromium worker and does not block anyway, so only the downmixed
 * `Float32Array` crosses — transferred, not copied.
 */
import { analyzeOnsets } from "@spotifyhero/onset-analysis";
import type {
  OnsetAnalysisWorkerRequest,
  OnsetAnalysisWorkerResponse,
} from "./onsetWorkerProtocol.js";

/**
 * `DedicatedWorkerGlobalScope` lives in TypeScript's `WebWorker` lib, which
 * cannot be added to this app's `lib` alongside `DOM` without duplicate global
 * declarations. Declaring the two members actually used is cheaper than
 * splitting the app's tsconfig.
 */
interface WorkerScope {
  postMessage(message: OnsetAnalysisWorkerResponse): void;
  addEventListener(
    type: "message",
    listener: (ev: MessageEvent<OnsetAnalysisWorkerRequest>) => void
  ): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener("message", (ev) => {
  const req = ev.data;
  if (req?.type !== "analyze") return;
  const { requestId, mono, sampleRate, options } = req;

  try {
    const result = analyzeOnsets(mono, sampleRate, {
      ...(options?.estimatePitch !== undefined
        ? { estimatePitch: options.estimatePitch }
        : {}),
      ...(options?.progressEveryFrames !== undefined
        ? { progressEveryFrames: options.progressEveryFrames }
        : {}),
      onProgress: (progress) => {
        scope.postMessage({ type: "progress", requestId, progress });
      },
    });
    scope.postMessage({ type: "done", requestId, result });
  } catch (e) {
    scope.postMessage({
      type: "error",
      requestId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
});
