/**
 * Onset analysis off the main thread — the desktop app's worker
 * (apps/overlay-ui/src/lib/analysis/onsetWorker.ts), unchanged in substance. All the DSP lives in
 * `@spotifyhero/onset-analysis`; this file is one call into it.
 */
import { analyzeOnsets } from "@spotifyhero/onset-analysis";
import type { OnsetAnalysisWorkerRequest, OnsetAnalysisWorkerResponse } from "./onsetWorkerProtocol";

interface WorkerScope {
  postMessage(message: OnsetAnalysisWorkerResponse): void;
  addEventListener(type: "message", listener: (ev: MessageEvent<OnsetAnalysisWorkerRequest>) => void): void;
}
const scope = globalThis as unknown as WorkerScope;

scope.addEventListener("message", (ev) => {
  const req = ev.data;
  if (req?.type !== "analyze") return;
  const { requestId, mono, sampleRate, options } = req;
  try {
    const result = analyzeOnsets(mono, sampleRate, {
      ...(options?.estimatePitch !== undefined ? { estimatePitch: options.estimatePitch } : {}),
      ...(options?.progressEveryFrames !== undefined ? { progressEveryFrames: options.progressEveryFrames } : {}),
      onProgress: (progress) => scope.postMessage({ type: "progress", requestId, progress }),
    });
    scope.postMessage({ type: "done", requestId, result });
  } catch (e) {
    scope.postMessage({ type: "error", requestId, message: e instanceof Error ? e.message : String(e) });
  }
});
