# Projecting each vertex once, 2026-10-24

The phase 3 gate (`../2026-10-22-phase-3-gate/`) found that most of a static
LoD switch was proj4 run once per triangle corner, and that the worker's bake
paid the same cost. Plugins `e749adc` and `610e8d2` place each vertex once:
`createVertexPlacer` (navara-core `geo/vertexPlacer.ts`) caches a vertex's
geodetic terms by its `Vec3` object, which the parser shares between every
surface and LoD that uses that vertex. A static layer keeps the cache for its
life, so a LoD switch or a new geoid offset does not re-project; the worker
keeps one per cell bake, because its features are decoded afresh on every
fetch. This is the gate re-run on that code.

## Result

**Static LoD freezes are about 40 % shorter; the streamed path's arrival time
did not change.**

- The longest main-thread task on a static LoD switch fell from 1.7 s to 1.1
  to 1.3 s at LoD 1.2, and from 3.5 to 3.8 s to 2.0 s at LoD 2.2.
- The 2026-10-22 estimate of 0.6 and 1.2 s is not reached. What remains is
  triangulation (0.4 s at LoD 1.2, 0.9 s at LoD 2.2), cell partitioning (0.2
  to 0.3 s) and garbage collection (0.2 to 0.3 s); placing vertices now costs
  0.2 to 0.3 s.
- On the worker, projection fell from 2.1 s to 1.0 s of CPU per LoD 2.2 bake,
  but in the one profiled run garbage collection rose from 0.6 to 1.4 s, and
  the new LoD arrives 4.9 to 6.6 s after the switch, as before (4.8 to 6.6
  s). The main thread still never blocks for more than about 0.3 s.
- Restyles were not touched, and measure 0.1 to 0.3 s slower on the static
  path. Their profile (`static-style-rules.profile.txt`) holds the same
  functions as on 2026-10-22, each 10 to 25 % slower, so this reads as host
  variance rather than a cost of the change.

The phase 3 verdict stands: a 2 s freeze at LoD 2.2 on 20,079 objects is what
a static file this large costs, and files this large belong in a streamed
format.

## Numbers

Same harness, data and camera as the gate. App at `3f320c4` plus the plugin
bump; SwiftShader, one unprofiled run per path (`static-seq.jsonl`,
`worker-fcb.jsonl`) and one profiled (`*-profiled.jsonl`). Pairs are the
first and the repeated operation; the 2026-10-22 columns are the unprofiled
runs there.

| Operation      | Static longest task, before | Static, now   | Worker settled, before | Worker settled, now |
| -------------- | --------------------------- | ------------- | ---------------------- | ------------------- |
| LoD 1.2        | 1.72 / 1.74 s               | 1.25 / 1.11 s | 4.9 / 4.8 s            | 5.7 / 4.9 s         |
| LoD 2.2        | 3.78 / 3.48 s               | 2.05 / 2.01 s | 6.5 / 6.6 s            | 6.6 / 6.3 s         |
| Colour by rule | 0.51 / 0.51 s               | 0.74 / 0.54 s | 2.3 / 2.2 s            | 2.8 / 2.4 s         |
| Single colour  | 0.41 s                      | 0.59 s        | 2.4 s                  | 2.3 s               |
| Expression     | 0.70 s                      | 0.82 s        | 2.7 s                  | 3.3 s               |
| Surface type   | 0.23 / 0.19 s               | 0.24 / 0.22 s | 2.1 / 2.1 s            | 2.1 / 2.6 s         |

The profiled static run is slower throughout (LoD 1.2 at 1.55 / 1.24 s, LoD
2.2 at 2.63 / 2.35 s), as profiled runs were on 2026-10-22.

## What changed besides speed

- Normals are computed from the placed ENU positions, so they include the
  projection's grid convergence (about 0.8° at Delft), as the geographic
  path's already did.
- A source whose decoder makes a new `Vec3` per corner shares nothing with
  the cache and pays a map entry per corner on top of the projection. The
  CityParquet WKB reader is one; it was not measured here.
