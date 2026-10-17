# Phase 2, 2026-10-17

Phase 2 of `docs/plans/2026-10-16-review-phases-0-2.md`: a per-slot style
texture, hiding by flag, indexed per-surface geometry, static layers cut into
250 m cells, implicit geometry, and colour expressions on the MapLibre style
spec. Design: `docs/plans/2026-10-16-phase-2-design.md` and
`docs/plans/2026-10-17-phase-2-remainder-design.md`.

- Phase 1 end: app `e2ba1c7`, plugins `b06603b`. Phase 2: app `phase2-wip`
  at `4259ed0`, plugins `083a76f` (after the review's fixes, with ranged
  style-texture uploads). Both runs use the probe as of `4ef5ae5`, which
  counts vertices per draw and counts a ranged sub-upload by its range; it
  was copied over the phase 1 checkout for its run.
- Same harness for both, as committed in `e3039bd`: the opening camera
  frames the whole tile (`harness-opening-view.png`, taken before the
  welcome dialog closes), and the dialog is closed before the gestures.
- SwiftShader on a GPU-less host. Counts compare; timings do not.
- An earlier pair of runs, before the review's fixes and with the older
  probe, is kept as `*-run1.jsonl`. Where the two pairs disagree, the text
  below says so.

## Per frame

Draws and vertices are per frame (the probe's totals over its frame count);
uploads and long tasks are per phase. `seq` is `delft.city.jsonl` (static),
`fcb` is `delft.fcb` (streamed). Raw lines: `phase1-*.jsonl`,
`phase2-*.jsonl`.

### Static (`seq`)

| Phase    | Draws/frame (1 → 2) | Vertices/frame, k (1 → 2) | Uploaded MB (1 → 2) | Long tasks s (1 → 2) |
| -------- | ------------------- | ------------------------- | ------------------- | -------------------- |
| load     | 44 → 135            | 1572 → 1484               | 55.1 → 43.6         | 4.3 → 2.0            |
| still    | 75 → 157            | 2117 → 1834 (−13%)        | 0.0 → 1.8           | 0 → 0                |
| orbit    | 65 → 176            | 2376 → 2089 (−12%)        | 6.0 → 0.0           | 2.5 → 2.5            |
| zoom-in  | 86 → 186            | 2654 → 1997 (−25%)        | 6.8 → 7.5           | 14.1 → 13.2          |
| pan      | 107 → 194           | 2708 → 1901 (−30%)        | 4.2 → 0.0           | 2.4 → 1.6            |
| zoom-out | 115 → 226           | 2803 → 2163 (−23%)        | 1.2 → 2.0           | 14.1 → 15.4          |
| hover    | 354 → 509           | 3378 → 3095 (−8%)         | 53.5 → 27.8         | 69.0 → 96.2          |

### Streamed (`fcb`)

| Phase    | Draws/frame (1 → 2) | Vertices/frame, k (1 → 2) | Uploaded MB (1 → 2) | Long tasks s (1 → 2) |
| -------- | ------------------- | ------------------------- | ------------------- | -------------------- |
| load     | 38 → 74             | 20 → 1299                 | 34.4 → 51.1         | 1.3 → 4.1            |
| still    | 117 → 116           | 2574 → 2580               | 1.2 → 0.0           | 0 → 0                |
| orbit    | 123 → 134           | 1042 → 1152               | 8.2 → 6.5           | 5.2 → 5.5            |
| zoom-in  | 149 → 153           | 473 → 645                 | 19.4 → 7.1          | 10.7 → 13.7          |
| pan      | 157 → 145           | 880 → 485                 | 0.0 → 0.0           | 1.3 → 2.2            |
| zoom-out | 178 → 231           | 740 → 765                 | 5.1 → 19.2          | 17.6 → 12.6          |
| hover    | 404 → 527           | 1492 → 1627               | 23.9 → 4.0          | 77.1 → 66.7          |

The phase 1 `fcb` load row closed early (11 s, 13 frames): the harness's
"nothing uploaded for 5 s" gate fired before the stream's cells arrived, so
they arrived during the still phase. The still phase after the hover sweep
draws 10 to 12 frames in every run: the sweep's last frames land after its
4 s settle on this host.

## What it shows

- **Cells cut what a static view draws once part of the tile is
  off-screen**: 23 to 30% fewer vertices per frame while zoomed in, panning
  and zooming out. With the whole tile in view the two pairs of runs
  disagree (−12 to −13% here, +4 to +8% in run 1); camera inertia moves the
  end of each gesture between runs, so that difference is within the noise.
- **Cells cost draw calls.** A static layer is 24 cells, so a frame issues
  about twice to three times the draws (75 → 157 at rest, as each visible
  cell is drawn once per render pass, shadow cascades included). At under
  250 draws a frame this is far from a WebGL limit; SwiftShader cannot show
  whether it costs frame time on a real GPU.
- **Highlighting and restyling no longer rewrite vertex data.** A hover
  writes the flag bytes of the hovered objects' slots into the style
  texture, and after the first upload only the changed span of each touched
  row is sent (unit-tested in `cityStyle.test.ts`). Static uploads over the
  gestures and the hover sweep fall from 71.7 MB to 37.3 MB (orbit, zoom-in,
  pan, zoom-out and hover summed; run 1: 62.7 MB to 32.7 MB). What remains
  is mostly imagery and terrain tiles, which arrive whenever the view
  changes, so per-phase upload rows move with the camera rather than with
  the layer.
- **Streams are unchanged in what they draw**, as expected: they were
  already cells. Their gesture and hover uploads sum to 56.6 MB against
  36.8 MB, but the rows trade places between zoom-out and hover from run to
  run (the imagery of the final view arrives in a different phase), so only
  the sums compare.
- **Static load**: long tasks 4.3 → 2.0 s here, 2.3 → 3.4 s in run 1, so no
  difference shows through the noise. Cutting the tile into cells and
  building the per-cell index takes about 1.35 s in Node on this tile
  (`raycast-cells.log`, "build ms").
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
  different in each run; two pairs of runs are kept so that a difference
  can be checked against the spread between them.
- Textured appearance themes multiply a cell's materials (one per image per
  cell). The Delft tile has no textures, so that cost is not measured here.

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
  The CityParquet stream path does not load templates. A FlatCityBuf
  stream places them from its header (covered by an adapter test; no
  FlatCityBuf file with templates was at hand to try in the browser).
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
