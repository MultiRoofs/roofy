# Render on demand, 2026-10-16

The baseline's camera path (`../2026-10-16-baseline/`) run again after the
viewer stopped drawing every tick: Navara 0.2.1 with `animation: false`, a
frame requested by the engine's own events, by the city meshes when their
colours, visibility, height or textures change, and by the viewport after
each of its commits. It renders continuously only while the sun animates or
the clouds are shown.

- App `develop` after the render-on-demand commits, plugins `3d5f3ad`,
  Navara 0.2.1, three 0.183.2.
- Same machine, browser and harness as the baseline. Counts compare; timings
  do not.

## Per phase

`seq` is `delft.city.jsonl` (static layer), `fcb` is `delft.fcb` (streamed).

| Phase                  | Ticks (seq / fcb) | Frames  | Draw calls  | Uploaded MB | Readbacks | Long tasks (s) |
| ---------------------- | ----------------- | ------- | ----------- | ----------- | --------- | -------------- |
| still, 10 s            | 16 / 19           | 15 / 18 | 1039 / 1575 | 1.5 / 1.2   | 0 / 0     | 0 / 0          |
| orbit                  | 26 / 27           | 25 / 26 | 2530 / 3168 | 4.9 / 4.7   | 0 / 0     | 0 / 0          |
| hover sweep, 121 moves | 456 / 458         | 49 / 44 | 8643 / 8639 | 32.1 / 31.6 | 29 / 26   | 8.5 / 4.7      |
| still after, 10 s      | 601 / 600         | 0 / 0   | 0 / 0       | 0 / 0       | 0 / 0     | 0 / 0          |

## What it shows

- **A still camera draws nothing.** Ten seconds with no input: 600 ticks and
  no frame, on both sources, against 12 to 22 frames in the baseline. The
  ticks rise because an idle tick is now cheap, not because more is drawn.
- **The first still phase is the end of the load.** It follows the load
  directly, and the imagery and terrain tiles of the opening view are still
  arriving (1.2 to 1.5 MB uploaded); each arrival asks for a frame.
- **Hover draws once per change, not once per tick.** 44 to 49 frames for
  121 pointer moves, against 130 to 138, and 26 to 29 depth readbacks against 48. The readbacks left are the cursor readout's, throttled per 66 ms of a
  slow SwiftShader frame.
- **Gestures still render every tick**, as they must: orbit, zoom and pan
  are within a frame of the baseline.

## Limits of the comparison

- The baseline's `fcb` column measured the globe without the layer: in a
  development build, StrictMode's simulated remount rejected the engine gate
  a share link's streamed layer was waiting on, and the layer was dropped.
  That is fixed alongside these runs, so the `fcb` column here is the first
  one with the layer loaded.
- Camera inertia advances per frame, so the camera ends each gesture
  somewhere slightly different from the baseline's, and the hover sweep
  crosses a different part of the tile. The hover uploads are therefore not
  comparable with the baseline's; they are the imagery of the zoomed-out view
  and the highlight colour buffers together.
- The opening view of the harness shows terrain at close range rather than
  the buildings, so these numbers say more about the globe than about the
  city layer. The camera path is to be re-aimed at the tile before the
  Phase 2 measurements.
