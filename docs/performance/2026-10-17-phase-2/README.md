# Phase 2, 2026-10-17

Phase 2 of `docs/plans/2026-10-16-review-phases-0-2.md`: a per-slot style
texture, hiding by flag, indexed per-surface geometry, static layers cut into
250 m cells, implicit geometry, and colour expressions on the MapLibre style
spec. Design: `docs/plans/2026-10-16-phase-2-design.md` and
`docs/plans/2026-10-17-phase-2-remainder-design.md`.

- Phase 1 end: app `e2ba1c7`, plugins `b06603b`. Phase 2: app `phase2-wip`
  at `e3039bd`, plugins `9d0354f`. Both runs use the vertex-counting probe
  (`3c206ee`, applied on top of the phase 1 checkout for its run).
- Same harness for both, as committed in `e3039bd`: the opening camera now
  frames the whole tile (`harness-opening-view.png`, taken before the
  welcome dialog closes), and the dialog is closed before the gestures.
- SwiftShader on a GPU-less host. Counts compare; timings do not.

## Per frame

Draws and vertices are per frame (the probe's totals over its frame count);
uploads and long tasks are per phase. `seq` is `delft.city.jsonl` (static),
`fcb` is `delft.fcb` (streamed). Raw lines: `phase1-*.jsonl`, `phase2-*.jsonl`.

### Static (`seq`)

| Phase    | Draws/frame (1 → 2) | Vertices/frame, k (1 → 2) | Uploaded MB (1 → 2) | Long tasks s (1 → 2) |
| -------- | ------------------- | ------------------------- | ------------------- | -------------------- |
| load     | 41 → 138            | 1517 → 1579               | 54.2 → 45.0         | 2.3 → 3.4            |
| still    | 60 → 166            | 1869 → 2015 (+8%)         | 1.8 → 0.0           | 0 → 0                |
| orbit    | 52 → 186            | 2140 → 2232 (+4%)         | 5.8 → 1.9           | 2.7 → 2.7            |
| zoom-in  | 72 → 204            | 2417 → 2181 (−10%)        | 6.8 → 6.9           | 11.6 → 13.3          |
| pan      | 94 → 204            | 2484 → 2066 (−17%)        | 4.2 → 0.1           | 2.5 → 2.2            |
| zoom-out | 102 → 220           | 2586 → 2200 (−15%)        | 1.7 → 1.2           | 12.5 → 12.5          |
| hover    | 330 → 470           | 3298 → 2851 (−14%)        | 44.2 → 22.6         | 68.7 → 83.2          |

### Streamed (`fcb`)

| Phase    | Draws/frame (1 → 2) | Vertices/frame, k (1 → 2) | Uploaded MB (1 → 2) | Long tasks s (1 → 2) |
| -------- | ------------------- | ------------------------- | ------------------- | -------------------- |
| load     | 77 → 68             | 1335 → 1110               | 69.5 → 50.3         | 3.3 → 3.6            |
| still    | 126 → 116           | 2608 → 2580               | 0 → 0               | 0 → 0                |
| orbit    | 140 → 132           | 1154 → 1082               | 8.6 → 6.5           | 4.3 → 4.0            |
| zoom-in  | 172 → 178           | 611 → 628                 | 12.5 → 9.4          | 12.5 → 13.4          |
| pan      | 143 → 145           | 479 → 487                 | 0 → 0               | 1.9 → 1.7            |
| zoom-out | 250 → 169           | 842 → 596                 | 19.7 → 2.8          | 14.3 → 12.9          |
| hover    | 448 → 456           | 1614 → 1561               | 3.5 → 20.8          | 69.0 → 64.1          |

The still phase after the hover sweep draws 10 to 12 frames in both runs on
both sources: the sweep's last frames land after its 4 s settle on this host.

## What it shows

- **Cells cut what a zoomed-in static view draws by 10 to 17%.** Once part
  of the tile is off-screen, whole cells are culled. With the whole tile in
  view (still, orbit) the cells draw 4 to 8% more vertices than one mesh
  did; the cause is not isolated.
- **Cells cost draw calls.** A static layer is 24 cells, so a frame issues
  about three times the draws (60 → 166 at rest, as each visible cell is drawn
  once per render pass, shadow cascades included). At under 250 draws a frame
  this is far from a WebGL limit; SwiftShader cannot show whether it costs
  frame time on a real GPU.
- **Highlighting and restyling no longer rewrite vertex colours.** Static
  uploads over the gestures and the hover sweep drop from 62.7 MB to
  30.7 MB: a hover now writes flag bytes into the cell's style texture.
- **Streams are unchanged in what they draw**, as expected: they were
  already cells. Their uploads at load fall from 69.5 to 50.3 MB (no
  per-vertex colour array). The hover row moves uploads from zoom-out to
  hover (19.7 + 3.5 MB against 2.8 + 20.8 MB): camera inertia ends the zoom
  at a different distance in each run (`10 m` against `20 m` scale bar), so
  the imagery tiles of the final view arrive in a different phase.
- **Static load is slower here**: long tasks 2.3 → 3.4 s. Cutting the tile
  into cells and building the per-cell index takes about 1.35 s in Node on
  this tile (`raycast-cells.log`, "build ms").
- **A ray against cells is 6 to 8 times faster** than against one mesh:
  1.8 to 2.4 ms against 14 to 15 ms over 281 rays on the tile (Node,
  `raycast-cells.log`). The hover's remaining cost is its depth readback,
  not the raycast, so no BVH is added.

## Colour expressions

- Parity on the Delft tile: for each preset rule set, a single colour and an
  attribute rule, the expression from `rulesToStyleExpression` colours all
  68,721 slots exactly as the rule evaluator does
  (`expression-parity-delft.log`). The attribute rule (`year`) matches no
  slot on this tile, so that one line shows nothing; the fixture parity
  tests cover attribute rules that do match.
- The expression evaluator takes 120 to 155 ms for the tile against 40 to
  60 ms for the rule evaluator, which is why the rules stay the evaluator
  for the surface, rules and single modes.
- In the browser, static and streamed Delft roofs shade by pitch, the legend
  shows the gradient, and a share link restores the expression
  (`expression-streamed-pitch.png`).

## Implicit geometry

Fifty synthetic implicit cubes at varying scales (a CityJSON file with
`geometry-templates`) draw as 50 objects and 300 surfaces, with shadows,
pickable like any other object (`implicit-trees.png`).

## Limits of the comparison

- Earlier `fcb` harness columns (`../2026-10-16-baseline/`,
  `../2026-10-16-render-on-demand/`) were taken from a camera north of the
  tile: the stream loaded only empty level-4 cells, so those columns
  measured the globe. The tables above are the first with the streamed tile
  in view.
- `cells-ab-old-camera.txt` is the one-cell against 250 m-cell A/B taken
  with that old camera, so its 8 to 12% fewer vertices measure culling of a
  mostly off-screen tile; the tables above supersede it.
- Camera inertia advances per frame, so each gesture ends somewhere slightly
  different in each run; compare rows, not single numbers.

## Deviations from the plan

- The style texture landed before the cells, and each cell's texture is
  sized to its own slots.
- Per-vertex colour arrays are gone. Hidden objects keep their geometry
  (hiding is a flag), so a stream's resident memory includes them.
- Cells live inside the static mesh; merging the static and stream handles
  (task 2.3) is deferred to the batch that merges static layers into
  streams.
- Quantisation is deferred (see the remainder design): about 12.5 MB to
  7.6 MB on Delft static, with no measurable frame-time effect here.
- The FlatCityBuf and CityParquet columnar builders are deferred; the
  columnar batch exists for CityJSON models only.
- `buildCityMeshArrays`'s `hiddenTypes` and `visibleObjectIds` parameters are
  no longer used by any caller.
- Implicit geometry is baked into each object's surfaces, not instanced.
  The CityParquet stream path does not load templates; FlatCityBuf has none.
  `cityBatchFromModel`'s instance table is not drawn, and would draw trees
  twice if it were.
- No snapshot v6: `styleExpression` is an optional field in v5 and in share
  links v3.
- GeoJSON layers, user 3D Tiles and Google photoreal are not expression
  targets.
- The columnar batch's rule evaluator (`evaluateBlockRules`) lets a
  surface attribute that is explicitly `null` inherit the parent object's
  value, where the object graph keeps the `null`. The Delft tile has no such
  nulls; nothing draws from the batch yet.

## Unchanged and pre-existing

- Missing shadows in some still screenshots and the "Multiple instances of
  Three.js" console warning appear on the phase 1 checkout too.
- "Zoom to layer" frames a small layer and a streamed layer looking at the
  horizon.
