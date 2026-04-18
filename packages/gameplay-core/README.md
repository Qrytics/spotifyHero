# @spotifyhero/gameplay-core

Scoring engine, hit windows, combo tracking, and autoplay/manual toggle logic.

## Purpose
Pure TypeScript logic – no I/O. Drives all scoring and note-judgement decisions.

## Key exports
- `ScoringEngine` – stateful per-session scoring. Call `onNoteHit` / `onNoteMissed` / `finalize`.
- `PlayModeController` – manages autoplay ↔ manual toggle.
- `NoteWindowManager` – returns notes in the visible/hittable range for a given position.
- `DEFAULT_HIT_WINDOWS` – default ±ms hit windows.

## Commands
```bash
pnpm lint    # tsc type-check
pnpm build   # compile to dist/
pnpm test    # vitest
```
