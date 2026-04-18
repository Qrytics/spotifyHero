# Sustain Visual Troubleshooting Log

This file tracks sustain-note rendering attempts so we do not repeat failed ideas.

## Goal

When a sustain exists, the lane should visually show:

- sustain **head gem**
- sustain **bar/body**
- sustain **rounded tail cap**

and should **not** show extra notes inside the sustain body.

## Files involved

- `apps/overlay-ui/src/components/NoteHighway.tsx`
- `apps/overlay-ui/src/hooks/useGameLoop.ts` (only for hit/phase behavior, not draw shape)

## What has been tried

### 1) Hide sustain head after successful sustain start

- Existing behavior uses `activeSustains` and `headHidden` to suppress the sustain head once held.
- This only affects the **parent hold head** after hit timing, not other chart notes inside its window.
- Result: did **not** solve "notes inside sustain" during approach phase.

### 2) Increase sustain body opacity

- Sustain strip alpha was increased so overlapping notes are less visible.
- Result: reduced bleed-through visually, but inner notes can still be seen and are still being drawn.

### 3) Occlusion set for inner notes (`occludedInsideSustain`)

- Added logic to mark note indices whose head time is strictly inside another note's sustain window on the same lane.
- Draw loop now skips those indices.
- Miss-slide draw path also skips/removes those occluded indices.
- Result: improved some cases, but user still reports visible inner notes in live play.

### 4) Sustain body end-cap shape update

- Replaced single-radius round rect with directional corner radii.
- Goal: flat near head gem, rounded at tail.
- Result: shape is improved, but this does not itself solve all inner-note visibility cases.

## Why issue can still appear

Likely causes:

1. **Lane/time overlap edge cases** where generated notes are near-equal timestamps and strict comparisons (`>` / `<`) miss occlusion candidates.
2. **Different note order/index assumptions** between sorted draw list and score-event visibility tracking (`goneTap`, `missSlide`, `activeSustains`) can allow a note to render before being suppressed. (Addressed by carrying **chart index** alongside time-sorted draw entries.)
3. **Hold rendering + parallel note rendering** can still show a separate note gem when that note is not classified as "inside" due to boundary math.
4. **Regeneration/state timing** during `dev:desktop` can keep old chart data visible unless track changes/regenerates after code edits.
5. **Tail junction (most common in deterministic charts):** A sustain’s musical end is the **next same-lane onset’s head time**. That note is **not** strictly *between* `head` and `tail` (it lies on the **tail** boundary), so strict `(head, tail)` occlusion never hid it. The highway still draws that note’s **gem** at the same screen position as the sustain’s **rounded tail cap**, which looks like an extra gem on the sustain.

## Current confirmed behavior

- Bottom-bar and leaderboard UI updates are hot-reloadable in `pnpm dev:desktop`.
- Deterministic generation ties each sustain’s duration to the **next** same-lane onset, so there are usually **no** same-lane taps strictly between head and tail; “inner” reports are often the **tail-boundary** gem (see above).

## Fix applied (lane + time order)

Occlusion builds, **per lane**, a list of sustain intervals `(head, tail)` sorted by time, then marks any note (tap or inner sustain) whose head lies **strictly between** `sustain.head` and `sustain.tail` as hidden.

Draw order uses `{ note, chartIndex }` so occlusion and score-event visibility share the same **chart index** (fixes cases where chart file order ≠ time order).

## Fix applied (tail-boundary tap)

For each sustain on a lane, any **tap** (`durationMs === 0`) whose head time matches that sustain’s **tail** time (within a small ms slop) is **not drawn as a gem**. The sustain body already renders the tail; the next note is still judged as before—only the duplicate gem is suppressed. **Hold** heads at that time are still drawn (hold chains).

## Next steps if issues remain

1. Tune `TIME_EPSILON_MS` / tail slop if chart times are floats or quantized oddly.
2. Add a dev-only overlay listing parent intervals vs candidate heads.
3. Optionally strip colliding notes in `chart-generator` if a pipeline ever emits true interior same-lane taps.

## Quick manual test checklist

1. Run `pnpm dev:desktop`.
2. Start a track with obvious holds.
3. Observe a lane with long sustain:
   - expected: only head + bar + rounded tail.
4. If inner gem appears:
   - capture screenshot
   - capture track id and approx playback time
   - confirm whether note is same lane as sustain.
