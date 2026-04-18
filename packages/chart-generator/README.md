# @spotifyhero/chart-generator

Hybrid note chart generation: deterministic beat/onset extraction + optional ML refinement.

## Purpose
Converts raw beat events from the audio engine into a playable `Chart` for a given difficulty.

## Algorithm
1. **Deterministic** – density filter (confidence-first when strengths differ; uniform confidence keeps even time stepping). Stable-hash lane placement. Sustain assignment respects per-difficulty gaps and `maxConsecutiveSustains`, then **contiguous sustains on the same lane** (tail meets next head) are merged into **one** long hold so the chart does not show several short holds in a row where one press is intended. (`mergeContiguousSustainSeries`.) Separate: `mergeAdjacentHoldNotes` merges tap chains into holds when used by callers.
2. **ML refinement** – calls `MLChartRefiner` (ONNX via Rust IPC). Falls back to deterministic if confidence < threshold. ML output is passed through the same sustain merge.

## Key exports
- `HybridChartGenerator` – main entry point. `generator.generate(trackId, beats, bpm, opts)`.
- `generateDeterministicChart` – standalone deterministic generator.
- `mergeContiguousSustainSeries` – post-process holds per lane (back-to-back sustains → single hold).
- `PassthroughMLRefiner` – stub refiner (always falls back).
- `estimateBpm` – BPM estimation from beat events.

## Commands
```bash
pnpm lint    # tsc type-check
pnpm build   # compile to dist/
pnpm test    # vitest
```
