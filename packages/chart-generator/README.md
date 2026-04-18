# @spotifyhero/chart-generator

Hybrid note chart generation: deterministic beat/onset extraction + optional ML refinement.

## Purpose
Converts raw beat events from the audio engine into a playable `Chart` for a given difficulty.

## Algorithm
1. **Deterministic** – density filter (confidence-first when strengths differ; uniform confidence keeps even time stepping). Stable-hash lane placement. Tap notes merged into holds per lane (greedy chains + `minHoldDurationMs`).
2. **ML refinement** – calls `MLChartRefiner` (ONNX via Rust IPC). Falls back to deterministic if confidence < threshold.

## Key exports
- `HybridChartGenerator` – main entry point. `generator.generate(trackId, beats, bpm, opts)`.
- `generateDeterministicChart` – standalone deterministic generator.
- `PassthroughMLRefiner` – stub refiner (always falls back).
- `estimateBpm` – BPM estimation from beat events.

## Commands
```bash
pnpm lint    # tsc type-check
pnpm build   # compile to dist/
pnpm test    # vitest
```
