/**
 * Main-thread side of onset analysis: `AudioBuffer` → mono `Float32Array` →
 * worker → `BeatEvent[]`.
 *
 * The downmix happens here rather than in the worker because an `AudioBuffer`
 * cannot cross a `postMessage` boundary at all. Its samples can, and the copy is
 * unavoidable: `getChannelData()` hands back a live view of memory the
 * `AudioBufferSourceNode` is still playing from, so transferring it would detach
 * the buffer that is making sound.
 *
 * The mono copy *is* transferred, so it exists once, in one thread, at a time.
 */
import type { OnsetAnalysisResult } from "@spotifyhero/onset-analysis";
import type {
  OnsetAnalysisWorkerRequest,
  OnsetAnalysisWorkerResponse,
} from "./onsetWorkerProtocol.js";

export type AnalyzeAudioBufferOptions = {
  /** 0..1 over the whole analysis. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  /** Off in tests and when a chart does not need pitch hints. */
  estimatePitch?: boolean;
};

export class AnalysisAbortedError extends Error {
  constructor() {
    super("Onset analysis was cancelled");
    this.name = "AnalysisAbortedError";
  }
}

/**
 * Average of every channel, in one new `Float32Array`.
 *
 * Averaging (not summing) keeps samples in −1..1, which matters because
 * `amplitude` and `rms` are compared against the chart generator's **absolute**
 * silence-gate thresholds.
 */
export function downmixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(length);
  if (channels === 0) return mono;

  // A live view — copy out of it, never transfer it.
  mono.set(buffer.getChannelData(0));
  if (channels === 1) return mono;

  for (let c = 1; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] = mono[i]! + data[i]!;
  }
  const inv = 1 / channels;
  for (let i = 0; i < length; i++) mono[i] = mono[i]! * inv;
  return mono;
}

/**
 * Runs the analysis in a worker, falling back to the main thread if a worker
 * cannot be constructed (a stalled overlay beats no chart at all).
 *
 * Rejects with {@link AnalysisAbortedError} when `signal` aborts.
 */
export async function analyzeAudioBuffer(
  buffer: AudioBuffer,
  opts: AnalyzeAudioBufferOptions = {}
): Promise<OnsetAnalysisResult> {
  if (opts.signal?.aborted) throw new AnalysisAbortedError();

  const mono = downmixToMono(buffer);
  const sampleRate = buffer.sampleRate;

  const worker = createWorker();
  if (!worker) {
    console.warn(
      "[spotifyHero] onset analysis worker unavailable; analysing on the main thread"
    );
    const { analyzeOnsets } = await import("@spotifyhero/onset-analysis");
    return analyzeOnsets(mono, sampleRate, {
      ...(opts.estimatePitch !== undefined
        ? { estimatePitch: opts.estimatePitch }
        : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
  }

  try {
    return await runInWorker(worker, mono, sampleRate, opts);
  } finally {
    // One worker per analysis: terminating is the simplest way to be sure its
    // scratch arrays and the transferred samples are gone.
    worker.terminate();
  }
}

// ---------------------------------------------------------------------------

function createWorker(): Worker | null {
  try {
    // This exact shape is what Vite's static analysis looks for — do not hoist
    // the URL into a variable.
    return new Worker(new URL("./onsetWorker.ts", import.meta.url), {
      type: "module",
    });
  } catch (e) {
    console.warn("[spotifyHero] could not start the onset analysis worker:", e);
    return null;
  }
}

function runInWorker(
  worker: Worker,
  mono: Float32Array,
  sampleRate: number,
  opts: AnalyzeAudioBufferOptions
): Promise<OnsetAnalysisResult> {
  return new Promise<OnsetAnalysisResult>((resolve, reject) => {
    const requestId = 1;
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = (): void => {
      finish(() => reject(new AnalysisAbortedError()));
    };

    worker.addEventListener(
      "message",
      (ev: MessageEvent<OnsetAnalysisWorkerResponse>) => {
        const msg = ev.data;
        if (msg.requestId !== requestId) return;
        switch (msg.type) {
          case "progress":
            if (!settled) opts.onProgress?.(msg.progress);
            break;
          case "done":
            finish(() => resolve(msg.result));
            break;
          case "error":
            finish(() => reject(new Error(msg.message)));
            break;
        }
      }
    );

    worker.addEventListener("error", (ev: ErrorEvent) => {
      finish(() =>
        reject(new Error(ev.message || "Onset analysis worker failed"))
      );
    });

    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const request: OnsetAnalysisWorkerRequest = {
      type: "analyze",
      requestId,
      mono,
      sampleRate,
      ...(opts.estimatePitch !== undefined
        ? { options: { estimatePitch: opts.estimatePitch } }
        : {}),
    };
    // Zero-copy: `mono` is detached here and belongs to the worker.
    worker.postMessage(request, [mono.buffer]);
  });
}
