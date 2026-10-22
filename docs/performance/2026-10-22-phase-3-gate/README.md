# Phase 3 gate, 2026-10-22

Phase 3 of `docs/plans/2026-10-16-review-phases-0-2.md` moves static files
onto the stream worker and deletes the static mesh path. The review made it
conditional: only if LoD and style changes on a large static file stay fast
through the worker. This is that measurement.

## Verdict

**Against phase 3 for now; keep the static path behind the handle, and make
both paths project vertices once.**

- **Restyles pass.** Through the worker, colours are on screen about as soon
  as on the static path (0.2 to 0.5 s after the change), and the main thread
  never blocks for more than about 100 ms, where the static path freezes it
  for 0.2 to 0.7 s.
- **LoD switches do not.** The worker never blocks the main thread for more
  than about 240 ms, where the static path freezes it for 1.7 to 3.8 s. But
  the new LoD arrives 0.5 to 3 s later than on the static path, so "stays
  fast" holds only if it means "does not freeze", not "arrives as soon".
- **Most of the static freeze is one fixable cost both paths share.** Each LoD
  bake re-projects every triangle vertex through proj4: 2.2 of the static
  path's 3.3 s for LoD 2.2 and 0.8 of its 1.4 s for LoD 1.2, and 2.1 s of the
  worker's bake. Projected once per file, the static freeze should drop to
  about 1.2 s for LoD 2.2 and 0.6 s for LoD 1.2 on 20,079 objects (estimated
  from the profiles), and the worker's switch loses the same 2.1 s.
- **Files large enough for a 1 s freeze to matter belong in a streamed format
  anyway.** FlatCityBuf and CityParquet already take the worker path, with
  residency limits; a whole-file worker would hold the full parsed file as
  the static path does now, in a heap nobody has measured yet.

Phase 3 would still remove the second render path, which is the review's
other argument for it, but that is a code-health case, not a performance
one, and it carries the cost of porting every static-only feature.

**Revisit when** a static file people actually load freezes for over a second
after the projection fix. The re-gate then needs a whole-file worker adapter
behind a flag, measured with this harness on the same commit as the static
path, at least three runs each, with: time to the first frame showing the new
LoD or colours (not the last counter change), the longest main-thread task,
load time and coverage at load, and peak heap of the main thread and every
worker; on a real GPU and on Nishitokyo as well as this grid.

## Setup

- Data: the 3DBAG Delft tile repeated on a 3x3 grid
  (`scripts/performance/replicate-grid.py`), 10,035 features and 20,079
  objects, 60 MB as CityJSONSeq. The static layer reads `delft9.city.jsonl`;
  the streamed one reads `delft9.fcb`, made from it by `fcb ser`.
- Harness: `scripts/performance/gate-harness.mjs`, a camera straight down over
  the grid's centre at 5,000 m. After load it switches LoD 1.2, 2.2, 1.2,
  2.2, then colours by a rule, a single colour, an expression (roofs by
  pitch), surface type, the rule again and surface type again. Both paths
  draw the same picture (`static-expression.png`, `worker-expression.png`).
- App `0ab800a`, plugins `e961333`. SwiftShader on a GPU-less host, so the
  timings compare within this host only.
- The streamed layer's first commit held 16,829 objects (`worker-loaded.png`:
  part of the bottom row); from the first LoD switch on it held all 20,079,
  so every operation below compares the same objects.

## Results

Main-thread long tasks are what freezes the page. "Settled" is the time to
the last change any counter saw, which on the streamed path includes a
trailing frame up to 2 s after the work is done (see the profiles below).
Raw lines: `static-seq.jsonl`, `worker-fcb.jsonl`, and profiled runs of each,
`static-seq-profiled.jsonl` and `worker-fcb-profiled.jsonl`.

| Operation      | Static: longest task | Static: settled | Worker: longest task | Worker: settled |
| -------------- | -------------------- | --------------- | -------------------- | --------------- |
| Load           | 5.3 s (6.6 s in all) | 23 s            | 1.5 s (5.1 s in all) | 28 s            |
| LoD 1.2        | 1.72 / 1.74 s        | 1.9 / 1.9 s     | 0.13 / 0.12 s        | 4.9 / 4.8 s     |
| LoD 2.2        | 3.78 / 3.48 s        | 4.0 / 3.7 s     | 0.23 / 0.23 s        | 6.5 / 6.6 s     |
| Colour by rule | 0.51 / 0.51 s        | 0.6 / 0.6 s     | 0.10 / 0.09 s        | 2.3 / 2.2 s     |
| Single colour  | 0.41 s               | 0.5 s           | 0.08 s               | 2.4 s           |
| Expression     | 0.70 s               | 0.9 s           | 0.07 s               | 2.7 s           |
| Surface type   | 0.23 / 0.19 s        | 0.4 / 0.3 s     | 0.06 / 0.07 s        | 2.1 / 2.1 s     |

Pairs are the first and the repeated operation. The profiled runs agree on
the longest tasks (worker LoD 1.2 at 0.24 / 0.13 s, LoD 2.2 at 0.19 / 0.14 s;
static LoD 2.2 at 3.82 / 3.73 s), with worker LoD switches settling at 5.1 to
7.1 s. Static load varied from 23 to 37 s over four runs, so load time does
not separate the paths here; the streamed layer also held only 16,829
objects at load. Both paths then took about four minutes before the counters
went quiet for 8 s ahead of the first operation; that churn is common to both
and not from either layer (most likely basemap and terrain tiles; not
checked).

Main-thread heap after each operation: static 430 to 830 MB, streamed 300 to
370 MB. The worker's own heap is not counted, and a whole-file worker will
hold the file the static path holds on the main thread today, so this is not
a memory saving to count on.

## Where the time goes

CPU profiles of the main thread and every worker over one operation, with a
busy timeline per 100 ms from the profiler's start (`*.profile.txt`). The
store write lands 0.8 to 1.2 s after that start (the harness's own calls come
first); the times below are measured from the write, one profiled sample
each.

- **Static LoD 2.2** (`static-lod-2.2.profile.txt`): `setLod` takes 3.3 s on
  the main thread, 2.2 s of it in `projectPositionsToEnu` (proj4, once per
  triangle vertex), the rest triangulation, mesh arrays and cell
  partitioning. LoD 1.2: 1.4 s, 0.8 s of it projection.
- **Worker LoD 2.2** (`worker-lod-2.2.profile.txt`): about 5.9 s of worker
  CPU (the profile's span minus idle), of which 2.1 s is the same projection,
  1.5 s re-reading and decoding the FCB features (`fcbSourceAdapter`
  `select`), 0.8 s mesh arrays and triangulation, 0.6 s garbage collection.
  A whole-file worker would skip the re-read; with projection done once,
  about 2.3 s of worker time remains, against about 1.2 s on the main thread
  for the static path.
- **Worker restyle** (`worker-style-*.profile.txt`): the worker recolours
  every resident cell in about 300 ms (`buildSlotStyleColors`,
  `inheritedAttributes`, roof metrics), and the main thread writes the
  colours in 60 to 100 ms; colours are on screen about 0.5 s after the store
  write (0.2 s for surface type, which needs no evaluation). The rest of the
  2 s "settled" is a later frame that changes nothing.

## What this does not measure

- The cost of the rest of phase 3: porting the static-only features (map
  filter, multi-LoD, computed attributes, and the table, summary and export
  that read `Layer.model`) to the handle. That is most of its work and risk.
- A real GPU, and datasets beyond this grid (Nishitokyo was not at hand).
  20,079 objects is about nine times the Delft tile; the static path's
  freezes grow with object count, the streamed path's main-thread tasks do
  not.
- The worker's heap: `performance.memory` covers the main thread only.
- The whole-file worker itself: today's FCB stream stands in for it. The
  uploaded bytes match (21.4 and 57.7 MB against 21.9 and 58.1 MB per
  switch), so the transfer to the main thread is measured; parsing a whole
  CityJSONSeq file in the worker and holding it there are not.
- Variance: one run per path (two for the worker, and one profiled run each).
- Bytes fetched by the worker: the in-page probe sees only the main thread's
  requests.

## Fixed while measuring

Phase 2's ranged style-texture uploads made every stream restyle block the
main thread for 1.3 to 2.8 s on this grid: three's ranged `texSubImage2D` path calls
`getParameter` three times per range, and a cell texture had a range per
row. Fixed in plugins `e961333` (app `0ab800a`): a commit uploads the whole
texture unless it is large and few rows changed.
