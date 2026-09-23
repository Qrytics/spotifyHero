# @spotifyhero/onset-analysis

Offline onset, tempo and pitch analysis. Mono `Float32Array` in, `BeatEvent[]` out.

## Purpose
Replaces the synthetic beat grid (`demoBeatEvents`, which needs a BPM from Spotify's
audio-features and biases its phase forward by 2000 ms) with onsets measured from the audio
the player is actually about to hear. Used by music-server mode, where the game holds the
decoded samples itself.

## Key exports
- `analyzeOnsets(mono, sampleRate, opts)` – the entry point: `{ events, bpm, beatPhaseMs,
  normalizationProfile, durationMs, stats }`.
- `computeOnsetEnvelope` – pass 1, the STFT sweep: spectral flux + **absolute** amplitude/RMS
  per frame.
- `pickPeaks` – adaptive median peak picking with parabolic sub-hop refinement.
- `estimateTempo` / `refineBeatPhaseMs` – comb-filtered autocorrelation, then a phase snap
  onto the detected onsets.
- `PitchEstimator` – pass 2, one FFT per onset; harmonic-sum scoring over observed peaks.
- `Fft`, `hannWindow`, `frameTimeMs` – the primitives, exported for tests and diagnostics.

## Design notes
- `lib: ["ES2022"]` — **no DOM**. Not `OfflineAudioContext`: there is no spectral-flux node,
  and an `AudioWorklet` would make every unit here untestable in node. Decode and downmix
  happen in `apps/overlay-ui/src/lib/analysis/`.
- `fftSize = 2048`, `hopSize = 512` → 11.6 ms hop, ~±6 ms localization, inside
  `DEFAULT_HIT_WINDOWS.perfect` (40 ms). A 4-minute track is ~20,700 frames.
- **Framing is centred** (`window.ts`): frame *i* spans `[i·hop − fftSize/2, i·hop + fftSize/2)`,
  so a transient's flux peak lands on its own timestamp with no constant offset to subtract.
  The first and last ~23 ms are excluded from peak picking rather than let the zero-padding
  ramp look like an onset.
- Pass 1 **discards its spectra**: keeping them would cost ~85 MB on top of the ~92 MB
  `AudioBuffer` the player already holds. Pitch re-runs an FFT at the few hundred onset
  frames instead.
- `amplitude` / `rms` are **absolute, never per-track normalized** — `applySilenceGate` in
  `chart-generator` compares them against fixed thresholds.
- The confidence mapping (`analyzeOnsets.ts`) is the known tuning unknown: `DIFFICULTY_PARAMS`
  was tuned against `demoBeatEvents`' three constants (0.94 / 0.71 / 0.34), so grid-aligned
  peaks are floored near 0.9 and everything else spreads up from 0.34.

## Commands
```bash
pnpm lint    # tsc type-check
pnpm build   # compile to dist/
pnpm test    # vitest — synthetic click trains, sine/sawtooth pitch, silence
```
