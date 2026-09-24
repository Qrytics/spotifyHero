# Highway visual overhaul — progress

Live progress log for the "kill the road, go dark void + glow" overhaul. **Written for
resumption after a context reset**: if you are picking this up cold, read this file, then
the "Resume here" section, then the risk list at the bottom.

Status legend: ✅ done and type-checks · 🚧 in progress · ⬜ not started

Last updated 2026-09-24, at a deliberate session stop. **The new renderer is now the one the
game draws** — but still in the classic look, so nothing a user sees has changed.

---

## State of the tree right now

- `pnpm type-check` — **passes repo-wide** (all 8 packages + `overlay-ui` + the web app).
- `pnpm -r --filter './packages/*' build` — **passes**; every `dist/` is fresh.
- `pnpm test` — **392 tests pass**, 0 fail. That is the previous 278 plus **114 new** in
  `packages/note-highway/src/__tests__/` (step 2, now paid).
- `pnpm build` at the repo root fails at `apps/desktop` only, because `cargo` is not on the
  Bash tool's `PATH`. **Pre-existing and unrelated** to this work.
- **Nothing is committed.** Everything is untracked except a single tracked edit to
  `packages/shared-types/src/index.ts` and the two rewritten tracked files
  `packages/note-highway/src/NoteHighway.tsx` (1315 → 429 lines) and
  `packages/note-highway/src/index.ts`.
- The rollback tag `visuals/classic-2026-09-24` exists and is verified.
- **Nothing has been run on real hardware or even in a browser yet.** Type-check and unit
  tests cannot see a single pixel; see the risk list.

A complete revert is now:
`git checkout -- packages/shared-types/src/index.ts packages/note-highway/src/NoteHighway.tsx packages/note-highway/src/index.ts`
plus deleting the untracked files listed below.

---

## Resume here

The refactor is **structurally complete**: the new shell drives the themes, both looks exist,
and the scan is pinned by tests. What remains is all user-facing.

1. **Run it.** Nothing has been looked at yet. `pnpm dev:ui` with
   `pnpm --filter @spotifyhero/note-highway exec tsc -w -p tsconfig.json` alongside it, or the
   browser serves stale `dist/`. First job is to confirm **classic still looks like classic** —
   that is the whole point of having kept it bug-for-bug, and it is the only check that the
   draw-list refactor did not change the picture. Use the README's `simulatePlay` snippet.
2. **Finish step 4's plumbing** — the SettingsPanel "Highway look" segmented control (clone the
   `musicSource` block at `SettingsPanel.tsx:187`, insert above the Note scroll speed slider).
   The schema half and the reduced-motion half are both done now; this control is the last
   piece, and until it exists void is only reachable by hand-editing `localStorage`.
3. **Step 5 — eyeball void in five layers** (a) backdrop/rails/strike/receptors,
   (b) gems + horizon fade, (c) sustain tubes + flow, (d) beat rungs, (e) impact fx + shake +
   combo rails + HUD multiplier.
4. **Steps 6 and 7** as written in the plan.

Commit discipline from the plan, unchanged: steps 1, 3, 4 land as **separate commits in that
order**. Step 3 (the draw-list refactor + the shell rewrite) is the dangerous one and must be
revertable alone — and its tests are in place now, so it is safe to commit as soon as item 1
above confirms classic is unchanged.

---

## Ordering (from the approved plan)

| Step | What | Status |
|---|---|---|
| 0 | Git tag `visuals/classic-2026-09-24` as the hard floor | ✅ verified present |
| 1 | Mechanical extraction — constants / geometry / color / visibility / fx / beatClock | ✅ |
| 2 | Unit tests on the extracted pure modules (pin **before** the risky step) | ✅ 114 tests, 5 files |
| 3 | Draw-list refactor — `buildDrawList` takes the scan; classic reads from the list | ✅ written **and wired to the loop** |
| 4 | Theme seam — `HighwayTheme`, `THEMES`, schema field, SettingsPanel control | 🚧 all but the SettingsPanel control |
| 5 | Void in layers (a–e) | ⬜ never yet rendered |
| 6 | Flip default to `"void"`, update READMEs + sustain troubleshooting doc | ⬜ |
| 7 | Cross-package cleanups — `global.css` vars, calibrator imports + radius fix | ⬜ |

---

## Files (all in `packages/note-highway/src/`)

| File | Contains | State |
|---|---|---|
| `highwayConstants.ts` | `LANE_COUNT`, `LOOK_AHEAD/BACK_MS`, `SCROLL_IN_*`, `TIME_EPSILON_MS`, `HIT_FX_MS`, `SUSTAIN_MIN_HEIGHT_PX` | ✅ |
| `highwayGeometry.ts` | `noteRadiusFromViewport`, `hitLineYFromHeight`, `yFromTime`, `isSustainTailPastCanvasBottom`, `HighwayFrame` | ✅ |
| `color.ts` | `LANE_HEX` (new palette) + `LANE_HEX_CLASSIC`, `hexToRgba`/`mixHex`/`shadeHex`, judgement palettes, `easeOutCubic` | ✅ |
| `noteVisibility.ts` | `NoteVisibility`, `occludedInsideSustain`, `applyScoreEventToVisibility`, `buildSortedNotes` — **canvas-free** | ✅ |
| `noteDrawList.ts` | pooled `DrawItem` + `buildDrawList` — **canvas-free** | ✅ |
| `fxState.ts` | fx arrays, `spawnHitEffect`, `pruneHighwayFx`, `ShakeState` + `updateShake` | ✅ |
| `beatClock.ts` | `beatPeriodMs`, `beatAnchorMs`, `beatPhase01`, `beatPulse01`, `beatTimeAt`, `beatIndexAtOrAfter` | ✅ |
| `themes/types.ts` | `HighwayTheme` vtable, `ClassicSurface` / `VoidSurface` discriminated union, `HighwayFeel` | ✅ |
| `themes/primitives.ts` | `pillPath` (verbatim), `ringStroke`, gem body/bloom/flash sprite builders, judgement font fit | ✅ |
| `themes/classic.ts` | today's look, bug-for-bug | ✅ |
| `themes/void.ts` | the new look | ✅ |
| `themes/index.ts` | `THEMES` + total `resolveTheme` | ✅ |
| `__tests__/geometry.test.ts` | I1 locks: radius / hit line / `yFromTime` / tail-off-screen | ✅ 14 |
| `__tests__/beatClock.test.ts` | period / anchor / phase / pulse, + rungs-can't-drift proof | ✅ 16 |
| `__tests__/shake.test.ts` | shake envelope + clamp, per-feel spawn, prune, clear | ✅ 17 |
| `__tests__/occlusion.test.ts` | occlusion rules + the whole visibility state machine | ✅ 25 |
| `__tests__/drawList.test.ts` | the scan: emit order, sustains, misses, pooling | ✅ 42 |
| `NoteHighway.tsx` | **rewritten**: React shell + rAF loop, 1315 → 429 lines | ✅ |
| `index.ts` | **rewritten** as the barrel | ✅ |

`index.ts` now also exports `LANE_HEX` / `LANE_HEX_CLASSIC` / `laneHex`, `LANE_COUNT`,
`LOOK_AHEAD_MS`, `HIT_LINE_BOTTOM_PAD`, the four geometry functions, and `THEMES` /
`resolveTheme` — the geometry exports exist for `OffsetCalibrator` in step 7.

One other tracked file is modified: **`packages/shared-types/src/index.ts`** — added
`HighwayThemeSchema` / `HighwayThemeId` next to `MusicSourceSchema`, and the
`highwayTheme` field to `AppSettingsSchema` after `visualNoteOffsetMs`, with a comment
recording that it is deliberately **not** mirrored into Tauri's `settings.json`.

Its default is **`"classic"` for now**, not `"void"`. Step 6 flips it, once the new look has
been seen on real hardware. So at this moment nothing a user sees has changed.

---

## Decisions taken while implementing (not all in the original plan)

1. **`DrawKind` is plain numeric consts, not a `const enum`.** `const enum` across a
   package boundary consumed through `dist/` needs `preserveConstEnums` discipline; not
   worth it for five values.

2. **The surface type is a discriminated union (`kind: "classic" | "void"`), not one wide
   record.** Classic needs no gem atlas and no cached gradients; a shared record would
   have forced every field to exist for both themes, which `exactOptionalPropertyTypes`
   makes genuinely painful. Each theme narrows with one cheap `if (s.kind !== …) return`.

3. **`approachFade` / `anticipationScale` defaults stay at the *classic* values (0.6 floor,
   0.08 pop) in `noteDrawList.ts`, and are parameterised.** This deviates from the plan,
   which put void's 0.45/0.14 straight into the scan. The reason: `radius` (popped) feeds
   `cyHeadBar`, the sustain body's head end — so baking void's larger pop into the scan
   would make the two themes disagree about *where a hold starts*, and therefore about the
   occlusion maths. Instead the scan is geometry-neutral, and void recomputes the fade and
   its gem scale from `item.timeUntilMs` + `frame.lookAheadMs` and applies them to **what it
   draws only**. This is a stricter reading of invariant I1, not a weaker one.

4. **Classic iterates the draw list in a single pass, in order; void uses multiple passes.**
   Items are emitted in exactly the old paint order, so single-pass classic reproduces the
   original z-order byte-for-byte. Void's multi-pass batching is what makes its glow cheap.

5. **`JudgementTextFx` stores the `Judgement`, not a resolved colour string** — otherwise a
   mid-round theme switch leaves up to 520ms of text in the old palette.

6. **The two duplicated sustain paint blocks collapse into one emit path.** The old second
   copy (former lines 956–973) used the un-popped radius where the first used the popped
   one. That difference is provably unobservable: the second pass only ever handles holds
   whose head is outside the scan window, where `timeUntilMs < -60` forces
   `anticipationScale === 1`. Noted here because it is the one place the collapse is not
   literally textual.

7. **`painted` (was a per-frame `new Set()`) now lives on the `DrawList`** and is cleared
   per frame — one allocation per frame removed on the way past.

8. **Shake and the spark cone are passed in as a `HighwayFeel` / `SpawnFeel` record, not
   hardcoded in `fxState.ts`.** `spawnHitEffect` is shared by both looks, so hardcoding
   void's shake and upward cone there would have changed the look classic exists to
   preserve. Classic's feel is `{ screenShake: false, particleCount: 10, particleUpwardCone:
   false }`. The record lives in `fxState.ts` rather than being vtable methods because
   `fxState` must not import a theme (themes import it).

9. **`PARTICLE_CAP` stays at classic's 180**, not the 120 the plan named for void. Lowering it
   would also lower classic's. Void spawns 8 per hit with a 220ms life, so it peaks around 30
   alive and never reaches either number.

10. **`buildSurface` takes the live `ctx` as its first parameter.** A `CanvasGradient` is
    portable between contexts in every engine, but there is no reason to rely on that when the
    live context is right there. Classic ignores it (`_ctx`).

11. **No `ctx.clip()` in void either.** Undoing a clip needs a `save`/`restore` pair, so the
    ban on `ctx.save()` implies a ban on clipping. Where the sustain energy bands would have
    been clipped to the pill, the band's height is clamped into the pill's straight section
    instead.

12. **The edge pulse is mapped from its colour string back to a lane index**
    (`laneIndexForHex` in `void.ts`). The pulse fx predates themes and carries a colour, not a
    lane; mapping it back lets void use its cached per-lane vignette gradient instead of
    building one per frame. Falls back to lane 0.

13. **The edge pulse still fires on `perfectStreak % 10`, not on the store's
    `comboMilestoneSeq`.** The store already tracks combo milestones (every 25) and combo
    breaks, and reaching for them looked like the tidier wiring — but classic paints the edge
    pulse too, so changing the trigger would have changed the look classic exists to preserve.
    The streak counter therefore stayed in the shell. `comboMilestoneSeq` is still unused by
    the highway.

14. **`fx.comboBreakAt` is driven off the store's `comboBreakSeq`, checked in the same
    subscriber.** Safe to add because *only void reads it* — classic's `drawImpactFx` never
    touches `comboBreakAt`, `combo`, `hitFlash` or `beatPulse01`, so all four are new signals
    that cannot affect the old look. Verified by grep, per theme file.

15. **The surface cache key is `${theme.id}|${w}x${h}|${dpr}`; `trackId` was dropped.** The old
    `rebuildStatic` key included `trackId`, but `paintStatic` never took it — the backdrop does
    not depend on the track, so the track id only ever forced a needless rebuild on every song
    change. Adding `theme.id` is what lets a look switch take effect on the next frame with no
    remount (and a remount is exactly what must not happen — see the risk list).

16. **Reduced motion is read once per mount via `matchMedia`, kept current by a `change`
    listener**, not sampled per frame: `matchMedia` is a layout-adjacent read and this
    preference changes approximately never. It feeds `updateShake` and the particle spawn.

17. **Shake is applied as the two translate terms of the existing `setTransform`, scaled by
    dpr** (`setTransform(dpr, 0, 0, dpr, dpr * ox, dpr * oy)`) — so it costs nothing, and the
    backdrop blit, which happens before it at identity, does not move. Lanes stay put; only
    the notes and fx kick. That reads as impact rather than as the overlay jittering.

18. **`EMPTY_SORTED` is a module-level constant.** The quiet-playback branch used to return a
    fresh `[]` literal every frame.

---

## What writing the tests turned up

Three facts about the geometry that were not obvious from reading it, and that cost four wrong
test expectations before they were understood. None is a bug; all three are worth knowing
before touching the scan.

1. **`anticipationScale`'s window is exclusive at the early edge and inclusive at the late
   one.** It returns 1 at exactly `+100ms` but is still swollen at exactly `-60ms`, going flat
   only at `-61`. So the pop dies abruptly on approach and lingers a frame past the judge.

2. **An unheld sustain's strip can never collapse.** Its height works out to
   `durationMs * pxPerMs + radius`, so it is always at least one radius tall no matter how
   short the hold. The `h <= SUSTAIN_MIN_HEIGHT_PX` branch is reachable **only for a held
   strip**, whose head is pinned at `hitLineY + radius` — it collapses when the tail has
   scrolled exactly one radius past the strike line, i.e. ~66ms after the hold ends at default
   scroll speed. Both cases are now pinned by name in `drawList.test.ts`.

3. **A missed note's slide lasts only ~250ms.** There are just `radius + 5 + 4` ≈ 45px of
   canvas below the strike line, so at the default rate a miss gem clears the bottom edge about
   a quarter-second after it is judged. Anything that wants to animate a miss for longer has to
   move it, not wait for it.

---

## Bugs this fixes as a side effect (all confirmed in the pre-split code)

- `bodyW = noteR * 2.35` used the **popped** radius → sustain bodies widened ~8% inside the
  ±100ms anticipation window, and at 180px were 28px wide in a 45px lane, wider than the
  24px gems. Now `baseRadius`, and 1.9× in void (22.8px at 180px, narrower than the gem, with
  dark gutters either side). Classic keeps the bug on purpose, with a comment saying so.
- Static receptor ring (old `paintStatic`) and dynamic receptor ring (old
  `paintDynamicReceptors`) stroked the **identical** circle (`noteRadius + 2`) every frame →
  doubled, muddied resting target. Void uses +6 static / +3.5 dynamic.
- `OffsetCalibrator` hardcodes `NOTE_RADIUS = 15` where the game computes 12 at 180px → you
  calibrate against gems 25% larger than the ones you hit. Step 7.
- Speed lines scrolled off `performance.now()`, unscaled by `noteScrollSpeed` → drifted
  against the notes. Replaced by chart-anchored beat rungs using the same `yFromTime` the
  notes use, so drift is impossible by construction.
- The sustain shimmer was `sin(nowMs * 0.012 + chartIndex)` — a per-note sine on the wall
  clock, unrelated to the music, which kept animating while the song was paused. Void's flow
  bands derive from `beatPhase01`, so they freeze when the music does.

---

## Flagged, not fixed (deliberately out of scope)

`--font: 'Inter'` in `apps/overlay-ui/src/styles/global.css:25` is never loaded — there is no
`@font-face` and no `.woff2` anywhere in the repo — so the entire UI silently falls back to
system-ui. Self-hosting one woff2 is a one-line win, but it is a typography change, not a
highway change, and the plan scoped it out. Worth raising separately.

---

## Risks / invariants to re-read before touching anything

- **I1 — geometry is frozen.** `noteRadiusFromViewport`, `hitLineYFromHeight`,
  `HIT_LINE_BOTTOM_PAD`, `LOOK_AHEAD_MS = 2200`, `pxPerMs`. `hitLineY` is where every user's
  `playbackTimingOffsetMs` was calibrated. No theme may move it. "Bigger gems" is a sprite
  scale, never a radius change.

- **I2 — no per-frame gradient / `shadowBlur` / `ctx.save()`.** The plan's greppable check was
  **wrong as written**: a bare grep over `void.ts` returns 15 legitimate hits, because
  `buildSurface` and `paintVoidBackdrop` build every cached gradient and they live in the same
  file. Scope the check to the per-frame section instead:

  ```sh
  cd packages/note-highway
  n=$(grep -n '^// Per-frame' src/themes/void.ts | cut -d: -f1)
  awk -v n="$n" 'NR>n' src/themes/void.ts \
    | grep -nE 'createLinearGradient|createRadialGradient|shadowBlur|ctx\.save|ctx\.clip' \
    && echo VIOLATION || echo clean
  ```

  Re-verified **clean** below the `// Per-frame` divider (currently `void.ts:349`). Keep that
  divider comment in place — the check depends on it. `primitives.ts` is exempt only inside its
  sprite builders, which run once per size.

- **Sustain occlusion has broken four times** (`docs/sustain-visual-troubleshooting.md`).
  Both themes share it now, so theme-switching is *not* a rollback for a step-3 bug. That is
  why step 3 is its own commit and why the tag exists. The 67 tests in `occlusion.test.ts` and
  `drawList.test.ts` are the pin, and they are now in place — but they pin the *scan*, not the
  pixels. Nothing yet proves classic draws the same picture it used to; only looking at it can.

- Do **not** add `theme` or any setting to the highway `useEffect` dep array — a remount
  clears visibility, which re-shows already-hit notes mid-song. Read via `getState()` in the
  loop. The implemented shell obeys this: its deps are still `[chart]` alone, and the theme,
  the scroll speed, the offsets, the combo and the quiet-playback gate are all read from
  `useGameStore.getState()` inside the loop.

- **Untested by anything automated:** the `buildSurface` bodies, all ten theme draw methods,
  and the shell's own loop. `jsdom` has no Canvas 2D context, so none of this is reachable from
  vitest without a real browser. The tests cover the canvas-free modules only — which was the
  deliberate split, but it means "392 tests pass" says nothing at all about how void looks.

- **Honest caveat on the beat grid:** `chart.bpm` is Spotify's *average* tempo, so on a
  tempo-varying song the rungs drift from the audio even though they never drift from the
  notes. Kept subtle (≤0.20 alpha) for exactly this reason. Classic has no beat grid at all.

## Rollback

1. Per user: Settings → Highway look → Classic (localStorage only, no restart, no rebuild) —
   once the control from resume item 2 exists.
2. Per build: flip the Zod default back to `"classic"` — which is where it still sits today.
3. Hard: `git revert` the flip commit, or
   `git checkout visuals/classic-2026-09-24 -- packages/note-highway apps/overlay-ui/src/components/OffsetCalibrator.tsx apps/overlay-ui/src/styles/global.css`
4. Right now, before any commit:
   `git checkout -- packages/shared-types/src/index.ts packages/note-highway/src/NoteHighway.tsx packages/note-highway/src/index.ts`
   and delete the untracked files in the table above. Note this is no longer a purely additive
   revert — two tracked files in `note-highway` are now rewritten, so a partial revert that
   drops the new modules but keeps the new `NoteHighway.tsx` will not compile.
