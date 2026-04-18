# spotifyHero – Gameplay Specification

## Lanes
- 4 lanes by default (Easy → Expert all use 4).
- Default key bindings: **D F J K** (index 0-3).
- Lane colours: Purple / Green / Orange / Blue.

## Hit windows (default, ±ms)
| Judgement | Window |
|-----------|--------|
| Perfect   | ±22 ms |
| Great     | ±45 ms |
| Good      | ±90 ms |
| Bad       | ±135 ms |
| Miss      | > 135 ms |

## Scoring
```
points = JUDGEMENT_POINTS[judgement] × COMBO_MULTIPLIER
```

| Judgement | Base points |
|-----------|-------------|
| Perfect   | 1000        |
| Great     | 750         |
| Good      | 400         |
| Bad       | 100         |
| Miss      | 0           |

### Combo multipliers
| Combo | Multiplier |
|-------|-----------|
| 0-9   | ×1        |
| 10-49 | ×2        |
| 50-99 | ×4        |
| 100+  | ×8        |

## Accuracy
```
accuracy = (perfects × 1 + greats × 0.75) / totalNotes
```
Clamped to [0, 1].

## Difficulty presets (density multiplier)
| Difficulty | Notes shown (fraction of detected onsets) |
|------------|------------------------------------------|
| Easy       | 30%                                      |
| Medium     | 60%                                      |
| Hard       | 85%                                      |
| Expert     | 100%                                     |

## Autoplay → Manual toggle
- Press **Space** (configurable) to instantly switch modes.
- In autoplay, notes are hit at exactly their `timeMs` with a Perfect judgement.
- In manual, the player must press the correct lane key within the hit window.
- Switching to manual mid-song does not reset score or combo.

## Session lifecycle
1. Spotify starts playing → `phase: loading` → chart generated → `phase: autoplay`.
2. All notes judged + 3 s buffer → `phase: results` → GameSession finalized.
3. Player presses "Back" → `phase: idle`.
