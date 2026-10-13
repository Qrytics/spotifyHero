/**
 * Decoded song → chart, with the desktop "My Library" pipeline: downmix to mono, onset analysis
 * in a worker (`@spotifyhero/onset-analysis`), then `HybridChartGenerator` from
 * `@spotifyhero/chart-generator` with the analysis' tempo and loudness profile — the same call
 * as apps/overlay-ui/src/hooks/useServerChartGeneration.ts.
 */
import type { OnsetAnalysisResult } from "@spotifyhero/onset-analysis";
import { CHART_GENERATOR_VERSION } from "@spotifyhero/chart-generator/version";
import { ONSET_ANALYSIS_VERSION } from "@spotifyhero/onset-analysis/version";
import type { Chart, Difficulty } from "@spotifyhero/shared-types";
import type { OnsetAnalysisWorkerRequest, OnsetAnalysisWorkerResponse } from "./onsetWorkerProtocol";

/** The cache key for stored charts: re-chart when either half of the pipeline changes. */
export const PIPELINE_VERSION = `${ONSET_ANALYSIS_VERSION}+${CHART_GENERATOR_VERSION}`;

/** Average, not sum: the generator's silence gate compares against absolute levels. */
function downmix(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  mono.set(buffer.getChannelData(0));
  if (buffer.numberOfChannels === 1) return mono;
  for (let c = 1; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! + d[i]!;
  }
  const inv = 1 / buffer.numberOfChannels;
  for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! * inv;
  return mono;
}

export async function analyzeBuffer(buffer: AudioBuffer, onProgress: (p: number) => void): Promise<OnsetAnalysisResult> {
  const mono = downmix(buffer);
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./onsetWorker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  if (!worker) {
    const { analyzeOnsets } = await import("@spotifyhero/onset-analysis");
    return analyzeOnsets(mono, buffer.sampleRate, { onProgress });
  }
  const w = worker;
  try {
    return await new Promise<OnsetAnalysisResult>((resolve, reject) => {
      // Whole percents only: every report re-renders the page, and a 4-minute song is ~20k frames.
      let lastPct = -1;
      w.onmessage = (ev: MessageEvent<OnsetAnalysisWorkerResponse>) => {
        const m = ev.data;
        if (m.type === "progress") {
          const pct = Math.floor(m.progress * 100);
          if (pct !== lastPct) {
            lastPct = pct;
            onProgress(pct / 100);
          }
        }
        else if (m.type === "done") resolve(m.result);
        else reject(new Error(m.message));
      };
      w.onerror = (e) => reject(new Error(e.message || "Analysis worker failed"));
      const req: OnsetAnalysisWorkerRequest = {
        type: "analyze",
        requestId: 1,
        mono,
        sampleRate: buffer.sampleRate,
        options: { progressEveryFrames: 500 },
      };
      w.postMessage(req, [mono.buffer]);
    });
  } finally {
    w.terminate();
  }
}

export async function chartFromAnalysis(trackId: string, analysis: OnsetAnalysisResult, difficulty: Difficulty): Promise<Chart> {
  const { HybridChartGenerator } = await import("@spotifyhero/chart-generator");
  return new HybridChartGenerator().generate(trackId, analysis.events, analysis.bpm, {
    difficulty,
    normalizationProfile: analysis.normalizationProfile,
  });
}
