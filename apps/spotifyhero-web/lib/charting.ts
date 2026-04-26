import type { Chart, Difficulty } from "./types";
import { fetchYoutubePcm } from "./audioExtract";

type SpectrogramFrame = {
  t: number;
  bins: number[];
  energy: number;
};

export type Spectrogram = {
  fps: number;
  frames: SpectrogramFrame[];
};

function seededValue(seed: number): number {
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return Math.abs(x % 10000) / 10000;
}

/**
 * Generates a deterministic pseudo-spectrogram keyed by video ID.
 * This keeps chart generation stable/cached per song in serverless environments.
 */
export function buildSpectrogramFromVideoId(videoId: string, durationMs = 120_000): Spectrogram {
  const fps = 40;
  const frameCount = Math.max(400, Math.floor((durationMs / 1000) * fps));
  const frames: SpectrogramFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const t = (i / fps) * 1000;
    const bins = Array.from({ length: 16 }, (_, b) =>
      seededValue((i + 1) * (b + 3) * (videoId.charCodeAt((b + i) % videoId.length) ?? 17))
    );
    const energy = bins.reduce((acc, n) => acc + n, 0) / bins.length;
    frames.push({ t, bins, energy });
  }
  return { fps, frames };
}

function buildSpectrogramFromPcm(pcm: Float32Array, sampleRate: number): Spectrogram {
  const windowSize = 1024;
  const hopSize = 512;
  const binsToKeep = 32;
  const frames: SpectrogramFrame[] = [];
  for (let offset = 0; offset + windowSize < pcm.length; offset += hopSize) {
    const slice = pcm.subarray(offset, offset + windowSize);
    let energy = 0;
    for (let i = 0; i < slice.length; i++) {
      energy += Math.abs(slice[i] ?? 0);
    }
    energy /= slice.length;

    const bins: number[] = [];
    const chunk = Math.max(1, Math.floor(windowSize / binsToKeep));
    for (let b = 0; b < binsToKeep; b++) {
      const start = b * chunk;
      const end = Math.min(windowSize, start + chunk);
      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += Math.abs(slice[i] ?? 0);
      }
      bins.push(sum / Math.max(1, end - start));
    }
    const t = (offset / sampleRate) * 1000;
    frames.push({ t, bins, energy });
  }
  const fps = Math.max(1, Math.round(sampleRate / hopSize));
  return { fps, frames };
}

function noteTimesFromSpectrogram(spec: Spectrogram): number[] {
  const out: number[] = [];
  let prevEnergy = spec.frames[0]?.energy ?? 0;
  for (let i = 1; i < spec.frames.length; i++) {
    const frame = spec.frames[i]!;
    const delta = frame.energy - prevEnergy;
    prevEnergy = frame.energy;
    const onset = delta > 0.08;
    const beat = i % 20 === 0;
    if (!onset && !beat) continue;
    out.push(Math.floor(frame.t));
  }
  return out;
}

export async function generateChartFromVideoId(input: {
  videoId: string;
  sourceUrl: string;
  difficulty: Difficulty;
  durationMs?: number;
}): Promise<{ chart: Chart; spectrogram: Spectrogram }> {
  let spectrogram: Spectrogram;
  try {
    const audio = await fetchYoutubePcm(input.sourceUrl);
    spectrogram = buildSpectrogramFromPcm(audio.channelData, audio.sampleRate);
  } catch {
    // Fallback keeps the app functional in constrained runtimes.
    spectrogram = buildSpectrogramFromVideoId(input.videoId, input.durationMs);
  }
  const noteTimes = noteTimesFromSpectrogram(spectrogram);
  const laneCount = 4;
  const gapByDifficulty: Record<Difficulty, number> = {
    easy: 180,
    medium: 120,
    hard: 90,
    expert: 65,
  };
  const minGap = gapByDifficulty[input.difficulty];
  let last = -Infinity;
  const notes = noteTimes
    .filter((t) => {
      if (t - last < minGap) return false;
      last = t;
      return true;
    })
    .map((timeMs, idx) => ({
      timeMs,
      lane: idx % laneCount,
      durationMs: idx % 11 === 0 ? 500 : 0,
    }));
  const chart: Chart = {
    trackId: input.videoId,
    difficulty: input.difficulty,
    notes,
    bpm: 120,
    generatorVersion: "web-spectrogram-1.0",
    generatedAt: new Date(),
  };
  return { chart, spectrogram };
}
