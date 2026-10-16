# Browser baseline, 2026-10-16

What the GPU is asked to do on one fixed camera path over the 3DBAG Delft tile,
before the render-on-demand, hover and styling work of
`docs/plans/2026-10-16-review-phases-0-2.md`. The later phases are measured
against these files.

- App `5aa8716`, plugins `eaef5bf`, Navara 0.1.1, three 0.183.2.
- Headless Chromium 1194 on SwiftShader (no GPU), 1280 x 800, device pixel ratio 1.
- Harness: `scripts/performance/browser-harness.mjs`; probe:
  `src/features/debug/perfProbe.ts` (installed by `?perf`).

On SwiftShader the animation clock ticks about once a second, so **counts and
bytes compare across runs and timings do not**. A tick is a
`requestAnimationFrame` callback; a frame is a tick in which something was
drawn.

## Per phase

`seq` is `delft.city.jsonl` and `json` is `delft.city.json`, both static layers;
`fcb` is `delft.fcb`, streamed.

| Phase                  | Ticks (seq / json / fcb) | Frames          | Draw calls           | Uploaded MB    | Readbacks    | Long tasks (s)     |
| ---------------------- | ------------------------ | --------------- | -------------------- | -------------- | ------------ | ------------------ |
| still, 10 s            | 12 / 12 / 21             | 11 / 11 / 20    | 1160 / 1176 / 1155   | 1.9 / 1.9 / 0  | 0 / 0 / 0    | 0 / 0 / 0          |
| orbit                  | 27 / 28 / 31             | 26 / 27 / 30    | 4594 / 4472 / 1706   | 13.7 / 8.2 / 0 | 10 / 10 / 1  | 12.2 / 11.0 / 0.9  |
| hover sweep, 121 moves | 131 / 132 / 139          | 130 / 131 / 138 | 58474 / 58920 / 7660 | 0 / 0 / 0      | 48 / 48 / 15 | 38.5 / 40.7 / 11.1 |
| still after, 10 s      | 13 / 15 / 22             | 12 / 14 / 21    | 5798 / 6690 / 1210   | 0 / 0 / 0      | 0 / 0 / 0    | 0 / 0 / 0          |

The JSONL files carry every phase, including load, zoom-in, pan and zoom-out.

## What it shows

- **Every tick draws.** A still camera renders a full frame on each tick, for
  every source. That is the review's first finding, and the "still" rows are the
  ones render on demand must bring to zero frames.
- **A still static layer uploads.** 1.9 MB in ten seconds with no input on
  either static format, none on the streamed one.
- **Hover is the expensive interaction.** On a static layer the 121-move sweep
  costs 48 synchronous depth readbacks and about 40 s of long tasks, against 15
  readbacks and 11 s streamed. Draw calls per frame on a static layer are
  about 105 at the start and about 480 from the zoom phases on, still or not:
  that is the view the camera ends in, not the sweep.
- **Orbit and pan read back too.** 10 readbacks in the orbit, 6 in the pan, from
  the cursor readout during a drag.
