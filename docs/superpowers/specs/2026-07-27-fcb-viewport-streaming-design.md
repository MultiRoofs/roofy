# Viewport-streamed FlatCityBuf

**Date:** 2026-07-27
**Status:** Approved design, ready for planning
**Branch:** `develop`
**Revision:** 2 — restructured after an adversarial review (30 findings, 9 critical)

## Context

`loadFlatCityBuf.ts` loads an entire `.fcb` file through the WASM `HttpFcbReader`
via `select_all()`. Every feature is parsed, normalized, and triangulated up
front. That works for the small fixtures we test with and fails for the files the
format exists to serve — FlatCityBuf is designed for HTTP range access against
datasets too large to hold in memory.

This design replaces whole-file loading with viewport-driven streaming: the
viewer fetches only the features the camera can see, at a detail level matched to
how close it is, and discards what drifts out of range.

A separate spec covers the basemap. It is not addressed here.

## Goals

- Read `.fcb` from a remote URL and from a local file, through one code path.
- Render only features within the camera viewport.
- Keep the main thread free: reading, parsing, triangulation, and colorization
  all happen in a worker.
- Refetch rarely — camera movement must not translate into constant querying.
- Degrade honestly. When the view is too wide to serve, say so rather than
  hanging or silently truncating.

## Non-goals

- Whole-dataset analytics. Analysis covers resident features only (§11).
- Writing or editing `.fcb`.
- Attribute-filter queries (`where`). The reader supports them; the UI does not.
- Streaming for CityJSON / CityJSONSeq / CityGML. Those stay whole-file.
- **Origin rebasing.** Dropped in v1 — see §10.
- **Adaptive per-cell levels.** The viewport uses one uniform level — see §4.

## Decisions

| #   | Decision                                                                                      |
| --- | --------------------------------------------------------------------------------------------- |
| 1   | Depend on `@cityjson/flatcitybuf@^0.3.0` — the pure-TS reader, published to npm.              |
| 2   | Streaming is the **only** `.fcb` mode. `loadFlatCityBuf.ts` is deleted.                       |
| 3   | A streaming layer holds a **cell cache**, LRU-evicted — not a swapped model.                  |
| 4   | The viewport uses **one uniform level**, chosen by **a single probe** of the whole footprint. |
| 5   | One level ⇒ one LoD for the whole viewport in `auto` mode; `manual` pins one LoD.             |
| 6   | Analysis reads **resident features only**, labelled as such.                                  |
| 7   | The worker does read → parse → triangulate → rule colors → roof metrics.                      |
| 8   | **One worker per streaming layer**, one `FcbReader`, **one traversal per commit**.            |

---

## 1. Coordinate frames

Our local scene frame is a rigid transform of the source CRS, so the streaming
path needs no reprojection. `buildCityMesh` subtracts an origin
(`buildCityMesh.ts:105-113`) and each mesh carries `rotation.x = -π/2`
(`CitySceneR3F.tsx:467`; the parent `cityGroup` has no transform).

```
v      = (srcX-ox, srcY-oy, srcZ-oz)      # vertex data, source-CRS minus origin
world  = P + R·v ,  R·v = (v.x, v.z, −v.y)
```

For a static layer `P = 0`, giving `world = (X, Z, −Y)` and the inverse

```
srcX = worldX + ox     srcY = oy − worldZ     srcZ = worldY + oz
```

**One authoritative transform.** These equations hold only while `P = 0`, which
stops being true for tiles (§10). So the pair lives in exactly one module,
`sceneTransform.ts`, as `sceneToSource()` / `sourceToScene()` taking the layer's
origin and the mesh offset. Every consumer uses it — viewport projection
(§5), cursor readout (`CitySceneR3F.tsx:597`), box selection, `fitCamera`
(`CitySceneR3F.tsx:1099-1114`), and measurements. Duplicating the sign convention
at a call site is the defect this module exists to prevent.

proj4 remains only in `solarStore` for the atmosphere's lat/lon.

**Units, not just axes (review F23).** Every constant below is in metres. A file
in degrees or feet is still a rigid transform geometrically, but a "50 m cell" and
a "5 km horizon" become nonsense. Streaming therefore **requires a projected,
metre-based CRS**. At open we read the CRS axis units; anything else is refused
with an explicit message. The earlier claim that "all unsupported CRS render
normally" was wrong and is withdrawn.

## 2. Module layout

```
src/features/streaming/
  fcb.worker.ts         owns FcbReader + per-cell worker cache
  workerProtocol.ts     message types + array invariants, shared both ways
  workerClient.ts       promise-per-message wrapper, epoch guard
  tileGrid.ts           cell math, ownership, mesh offset       (pure)
  viewportFootprint.ts  perspective frustum → ground AABB       (pure)
  levelPolicy.ts        uniform level + LoD ladder              (pure)
  cellCache.ts          LRU, pinning, budgets                   (pure)
  sceneTransform.ts     source ↔ scene, the only sign convention (pure)
  streamStore.ts        per-layer stream state (zustand)
  useTileStreaming.ts   controls-driven trigger + throttle gates

src/domain/citymodel/flatcitybuf/
  fcbSource.ts          open from URL | Blob, header model, admission checks
```

The pure modules carry the logic most likely to be wrong and are unit-testable
without Three.js, a worker, or I/O.

## 3. Cell grid

Axis-aligned squares in the source CRS, anchored at the header extent's min
corner.

```ts
type CellKey = `${level}/${col}/${row}`

ROOT_CELL       = smallest power-of-two multiple of 100 m covering
                  max(extentSpanX, extentSpanY)
cellSize(level) = ROOT_CELL / 2 ** level
MAX_LEVEL       = largest level with cellSize >= MIN_CELL_M (50)
```

**Boundaries are half-open** `[min, max)` on each axis, with the dataset's outer
maximum assigned to the final row/column so no feature falls through. Centres
outside the declared extent clamp to the edge cell; non-finite bboxes are dropped
with a counter surfaced in diagnostics.

**Ownership.** The R-tree returns every feature _intersecting_ a query bbox, so a
building straddling a boundary is returned more than once. A cell owns only
features whose **bbox centre** falls inside it — `ownerKey(featureBbox, level)`,
defined in `tileGrid` and applied in the worker. Deterministic, needs no
cross-cell bookkeeping, and stays correct under eviction. This same rule is what
makes §4's single-traversal fetch possible.

## 4. Level selection and fetching — one traversal per commit

An earlier revision probed each cell and refined over-budget cells to their
children. Review finding F8 showed that costs `21N` probes plus `16N` refetches —
about **1,776 R-tree traversals** for a 48-cell viewport — because every
`select()` re-traverses from the root and `BufferedRangeReader` keeps only a
single replace-on-miss window (`range-reader.ts:113-171`). At 50 ms RTT that is
roughly 22 seconds before a single feature body is read. It is not viable.

The viewport therefore uses **one uniform level**, and a commit costs **one
traversal**:

```
1. footprint     ← viewportFootprint(camera)                     (§5)
2. n             ← probe(footprint)          # ONE select, limit 0
   n > VIEWPORT_FEATURE_BUDGET → "zoom in to load features"; stop
3. level         ← coarsest level splitting the footprint into
                   >= MIN_COVER_CELLS cells, capped at MAX_LEVEL
4. desired       ← cells covering footprint at that level
   missing       ← desired − resident
   missing empty → nothing to do; stop
5. one select over AABB(missing), then bucket each feature into its
   ownerKey cell locally; features owned by a resident cell are skipped
6. commit the newly built cells
```

Step 5 is the important one: **cells are a bucketing of one query result, not
separate queries.** The ownership rule from §3 makes the split exact and
duplicate-free. Cost is one traversal per commit regardless of cell count.

The probe itself is genuinely index-only — `select()` computes
`featuresCount: all.length` from the `searchRtree` hit list and returns
`readHits(...)` as a lazy iterator, and `limit: 0` yields an empty page while
preserving the count (both verified in `reader.ts`, and confirmed by review).

**But it is not free (review F7).** `searchRtree` visits roughly `(16/15)·F`
40-byte nodes and allocates and sorts every hit: about `42.7·F` bytes of index,
so ~41 MiB for a one-million-feature footprint. The honest cost is
`O(nodes visited + hits·log hits)` plus range requests. `MAX_FOOTPRINT_SPAN_M`
short-circuits before probing at continental scale, and probes carry an abort
signal so a superseded one stops mid-traversal.

**Level changes are all-or-nothing.** Because the level is uniform, a change
rebuilds the entire cover. The new cover is built off-scene and spliced in one
operation, or — if the user starts another gesture first — discarded entirely by
`abortInFlight()`'s epoch bump, leaving the old cover untouched. (This
originally also had a `LEVEL_SWAP_TIMEOUT_MS` deadline; it was removed
2026-08-05 because it livelocked the layer — uxfix report § Wave 3.) This is what the previous revision could not guarantee: review
finding F9 showed that with _adaptive_ levels, a partial swap must either keep a
parent and a child simultaneously or blank three quadrants. A uniform cover has
no such case.

## 5. Viewport footprint

For a perspective camera the visible ground area is a trapezoid running to the
horizon, not the flat rectangle a 2D map would use.

```
for each of the 4 far-plane NDC corners:
    ray  ← unproject → direction from camera.position
    t    ← (groundY - camera.position.y) / ray.y
    clamp if:  ray.y >= -EPS   (at or above the horizon)
               t < 0           (behind the camera)
               t > T_MAX       (beyond the fetch radius)
    → substitute the point at T_MAX along the ray
footprint ← AABB of the 4 clamped points, + one cell of margin
```

`T_MAX` is its own constant (5000 m). `camera.far` is 50 km, or 200 km with
Google tiles (`CitySceneR3F.tsx:346`), and is useless as a fetch radius. `groundY`
already exists (`CitySceneR3F.tsx:835-840`).

## 6. Triggering and throttling

**The trigger is `OrbitControls`' `change` event, not the render loop** (review
F16). R3F's frame loop runs continuously, so a `useFrame`-based settle timer never
fires. `enableDamping` with `dampingFactor: 0.1` (`CitySceneR3F.tsx:939-944`)
means `change` keeps firing while damping decays, which is exactly the signal we
want.

On the **first** `change`, abort any in-flight probe, fetch, and worker decode
immediately — stale work must not compete with the interaction. Then:

| Gate             | Constant                      | Behaviour                             |
| ---------------- | ----------------------------- | ------------------------------------- |
| Settle           | `SETTLE_MS = 350`             | fire 350 ms after the last `change`   |
| Span cap         | `MAX_FOOTPRINT_SPAN_M = 8000` | short-circuit before probing          |
| Move hysteresis  | `MOVE_FRAC = 0.2`             | skip unless centre moved >20% of span |
| Scale hysteresis | `SCALE_FACTOR = 1.3`          | skip unless span changed ≥1.3×        |
| Horizon clamp    | `T_MAX_M = 5000`              | §5                                    |

Both hysteresis gates are relative to the current span, so they track zoom
automatically. **Both are bypassed** when the desired cover has holes or the
computed level or LoD changed — otherwise a hysteresis skip could leave the view
permanently incomplete.

A monotonic epoch drops out-of-order results even though abort is supported.

## 7. Worker

One worker per streaming layer owning one `FcbReader` — one header fetch, one
shared range cache. Since a commit is a single traversal (§4), the previous
"4 concurrent reads" cap is gone; review finding F28 showed concurrent traversals
on a one-window buffered reader thrash rather than parallelise.

**Local files ship as a `Blob`, never an `ArrayBuffer`** (review F17).
`FcbReader.fromBlob` does range access through non-materialising `Blob.slice()`,
whereas `fromBytes` copies its input — so an `ArrayBuffer` protocol would force
`file.arrayBuffer()` on a multi-gigabyte file and OOM before opening. `Blob` is
structured-cloneable; the worker holds it for its lifetime and releases it on
layer removal.

```ts
// → worker
{ type:'open',    id, url }  |  { type:'open', id, blob }
{ type:'probe',   id, bbox }
{ type:'fetch',   id, bbox, level, cells, lod, rules, rulesEnabled }
{ type:'recolor', id, cells, rules, rulesEnabled }
{ type:'surfaces',id, objectId }        // on-demand rings, §11
{ type:'evict',   id, cells }           // release worker-side cache
{ type:'cancel',  id }
{ type:'close',   id }

// ← worker
{ type:'opened',    id, header }
{ type:'probed',    id, count }
{ type:'cell',      id, key, geometry, objects, surfaceAttrKeys, lodsSeen }
{ type:'recolored', id, key, ruleColors }
{ type:'surfaceData', id, objectId, surfaces }
{ type:'error',     id, message, code, aborted }
```

### 7.1 Geometry payload

The previous revision omitted three things the renderer cannot work without
(review F3) — picking and highlighting would have been silently dead:

```ts
interface CellGeometry {
  // all transferable, all length 3·triangleCount
  positions: Float32Array; // 3 per vertex, cell-local (§10)
  normals: Float32Array; // 3 per vertex — NOT recomputed on main thread
  baseColors: Float32Array; // 3 per vertex
  ruleColors: Float32Array | null;
  objectIndices: Uint32Array; // 1 per vertex  — CitySceneR3F.tsx:1030
  surfaceIndices: Uint32Array; // 1 per vertex  — highlightMesh.ts:41
  objectKeys: string[]; // index → CityObject id
  triangleCount: number;
}
```

Invariant, asserted on receipt: every typed array's length is exactly
`triangleCount · 3 · components`. `computeVertexNormals()` must **not** run on the
main thread — that is the cost we moved off it.

### 7.2 Object payload

```ts
interface ObjectRecord {
  id: string;
  objectType: string;
  attributes: Record<string, unknown>;
  bbox: BBox3;
  lod: string | null;
  surfaceCount: number; // duckdb.ts:198, TablePanel.tsx:390,420
  roofMetrics: RoofMetrics[]; // one per RoofSurface
  footprintAreaSqM: number; // InspectorPanel.tsx:212
  volumeCuM: number | null; // InspectorPanel.tsx:283
}
```

An audit of every `.surfaces` consumer — not an assumption — gives:

| Consumer                                  | Needs                     | Resolution        |
| ----------------------------------------- | ------------------------- | ----------------- |
| `AnalysisTab.tsx:31,79,145`               | `rings[0]`, solar scoring | on-demand         |
| `InspectorPanel.tsx:353` Surfaces tab     | iterates rings            | on-demand         |
| `InspectorPanel.tsx:212,283`              | footprint, volume         | aggregates above  |
| `computeStats.ts:56,108`                  | surface type + metrics    | `roofMetrics[]`   |
| `duckdb.ts:198`, `TablePanel.tsx:390,420` | `surfaces.length`         | `surfaceCount`    |
| `RuleBuilderTab.tsx:400`                  | surface attribute _keys_  | `surfaceAttrKeys` |
| `layerStore.ts:65`                        | LoD strings               | `lodsSeen`        |
| `AttributePanel`                          | object attributes only    | already covered   |

Both ring consumers act on **one selected object**, so rings are fetched on
demand via `surfaces`. A streaming layer's objects are therefore
`ResidentObjectRecord`, **not** `CityObject` — `CityObject.surfaces` is
non-optional (`types.ts:57`), so pretending otherwise would be a lie the type
system would eventually catch. Consumers are migrated to the narrower type.

### 7.3 Worker cache lifecycle

The worker keeps, per resident cell, the compact records plus a
`surface → vertex-range` map — enough to recolor and to answer `surfaces`
without refetching. Transferred buffers are detached, so it retains its own
copies; that memory is **counted in the same budget** as the main thread's
(§8). Main-thread eviction sends `evict`; `close` drops everything and terminates.
Without this the previous revision's `recolor` had no state to work from and the
worker would have grown without bound (review F6).

Rule edits never refetch: the client posts `recolor` for resident cells.

### 7.4 Cancellation must be cooperative

`AbortSignal` reaches the range reads but not the synchronous decode and
triangulation loops that follow (review F27). Those process features in chunks,
checking the epoch between features and yielding to the worker event loop
periodically, so a superseded commit stops promptly instead of blocking the next
one behind 2,000 features of triangulation.

## 8. Cache, eviction, and budgets

Feature count alone does not bound memory (review F11): one FCB feature can hold
several CityObjects and multiple complete LoDs. So budgets are enforced on what
actually costs — bytes and triangles — and **post-decode**, not predicted:

| Budget                     | Applies to                                            |
| -------------------------- | ----------------------------------------------------- |
| `VIEWPORT_FEATURE_BUDGET`  | probe gate, before any fetch (§4)                     |
| `RESIDENT_TRIANGLE_BUDGET` | sum over resident cells, GPU                          |
| `RESIDENT_BYTE_BUDGET`     | main-thread records + worker cache                    |
| `MAX_COVER_CELLS`          | refuse a desired cover larger than the cache can hold |

`MAX_COVER_CELLS` closes the failure the previous revision had: a cover larger
than the cache makes LRU evict cells that are still required, producing permanent
holes or a refetch loop. If the desired cover exceeds it, coarsen the level; if
that is impossible, stop and prompt.

**Pinning.** Cells holding an active selection are pinned. If pinned cells alone
exceed budget, the selection is trimmed **visibly** — never silently.

## 9. LoD

`Layer` gains `lodMode: 'auto' | 'manual'`, defaulting to `auto`.

Because the viewport has one uniform level (§4), it has **one LoD** — there are no
mixed-LoD seams, and no case where one building renders at two LoDs. Auto maps
cell size to the LoDs the dataset actually offers:

```
ladder = observed LoD labels, sorted ascending by numeric value

cellSize > 2000 m   → ladder[0]
200 m … 2000 m      → ladder[floor((n-1)/2)]
cellSize < 200 m    → ladder[n-1]
```

Defined for every ladder length: `n = 1` maps all bands to the same LoD.

Review findings F20 forced three clarifications:

- **Exact string matching.** Labels are `"0"`, `"1.2"`, `"1.3"`, `"2.2"`;
  `buildCityMesh.ts:67,92` compares by string equality and that stays.
- **`null` is not a LoD.** `Surface.lod` is `string | null`, and `selectedLod =
null` currently means _do not filter_, which would render mixed geometry.
  The ladder therefore distinguishes three states explicitly: `all` (no filter),
  an exact label, and `unlabelled` (LoD-less geometry only). A dataset whose
  geometry carries no labels has ladder length zero and renders as `all`.
- **Discovery is bounded then frozen.** Sampling a few features can miss the
  extremes. The ladder is built during a bounded discovery phase at open, then
  frozen and versioned; a later-discovered label bumps the version and rebuilds
  resident cells rather than silently changing meaning.

Parent/part identity is specified in §14.

## 10. Origin and precision

The origin is pinned once from the **header extent centre**.

**Multi-layer policy (review F24).** The scene already shares the first layer's
origin so adjacent layers align (`CitySceneR3F.tsx:306-308`). That stays: the
first layer to load establishes the **scene anchor** (origin + CRS), and later
layers are placed relative to it. A layer whose CRS differs from the anchor's is
refused with an explicit message — translation cannot align different CRSs, and
silently overlapping two datasets at the origin is worse than refusing.

**The mesh offset must be rotated.** Three.js composes `matrixWorld = T(P)·R`, so
`P` is applied in world space, _after_ the rotation:

```
world = P + R·v ,  R·v = (v.x, v.z, −v.y)
want   world = (srcX−ox, srcZ−oz, −(srcY−oy))
with   v     = (srcX−ccx, srcY−ccy, srcZ−ccz)

⇒  P = (d.x, d.z, −d.y)      for d = cellCentre − sceneOrigin
```

So `mesh.position = (d.x, d.z, −d.y)`, **not** `d` componentwise. Exposed as
`meshOffset(cellCentre, sceneOrigin)` in `tileGrid` so the convention lives in one
tested place (§15).

**Rebasing is out of scope for v1** (review F26). Changing the origin would have
to move camera, controls target, measurements, ground plane, atmosphere
transform, persisted view state, and every static layer's baked vertices in one
transaction. Instead: float32 holds ~7 significant digits, so we document the
~50 km usable radius from the anchor and surface a diagnostic when a layer's
extent exceeds it. Large-area roaming is a follow-up.

## 11. Analysis semantics

Analysis covers **resident features only**.

**"Resident" is not "visible"** (review F13). The cover includes a one-cell margin
and the LRU retains cells after they leave view, so two users at the same camera
can see different numbers depending on cache history. Readouts are therefore
labelled _"resident cache"_ with the cell count, not _"visible area"_. Calling it
visible area would be false.

**Counts are features, not buildings** (review F14). `featuresCount` counts FCB
features; one feature may hold a Building plus several BuildingParts. Showing
`n of <total> buildings` would be arithmetically false. Feature counts are
labelled as features; a building denominator is not available from the header and
is omitted.

**DuckDB must be constrained** (review F12). `App.tsx:133-141` currently routes URL
layers to `loadModelIntoDuckDB(url)`, which builds a whole-dataset `city_objects`
table from the remote source — flatly contradicting resident-only analysis and
silently opening a second full read of the file. For streaming layers that path is
**disabled**; the DuckDB table is maintained transactionally from cell
insert/evict instead. Table-row selection is restricted to resident objects.

**`residentModel` is imperative, not a lazy selector** (review F15). Zustand
evaluates selectors on every store notification to compare results, so
`s => s.residentModel` would materialise on every commit — the opposite of lazy.
Instead: cell commits do **not** change the `layers` array identity, and mounted
consumers call `getResidentModel(version)`, a memoised imperative getter. The
earlier claim that eight consumers stay untouched is withdrawn — consumers move to
`ResidentObjectRecord` (§7.2) and to this getter.

## 12. Changes to existing code

| File                                    | Change                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                          | `@cityjson/flatcitybuf` `^0.2.0` → `^0.3.0`                                                                                                       |
| `flatcitybuf/loadFlatCityBuf.ts`        | **deleted** — with `mapToObject`, `HttpFcbReader`, `cjseqToCj`                                                                                    |
| `domain/citymodel/loadCityModel.ts`     | drop the `loadFlatCityBuf` import (`:13`) and `.fcb` branch (`:81-82`); split "create a layer source" from "load a complete CityModel"            |
| `app/App.tsx`                           | snapshot restore (`:245`) and share restore (`:367`) must create streaming layers for `.fcb`; DuckDB URL path (`:133-141`) disabled for streaming |
| `scene/buildCityMesh.ts`                | see §13 — a triangulation migration, not a wrapper split                                                                                          |
| `scene/CitySceneR3F.tsx`                | see below                                                                                                                                         |
| `scene/applyRuleColors.ts`              | rewritten against typed arrays; see §13                                                                                                           |
| `features/layers/layerStore.ts`         | `Layer.stream?`, `Layer.lodMode`                                                                                                                  |
| `features/layers/useLayerFileLoader.ts` | `.fcb` → streaming layer, passing the `Blob`                                                                                                      |
| `persistence/types.ts`                  | versioned snapshot; see §14                                                                                                                       |
| `ui/sidebar/LodSelector.tsx`            | auto/manual toggle, read-out in auto                                                                                                              |
| `ui/layers/LayerPanel.tsx`              | streaming badge, resident cells, feature count                                                                                                    |
| `ui/StatusBar.tsx`                      | streaming status, "zoom in to load features"                                                                                                      |

**Scene map is two-level, not a compound key** (review F22). A flat
`${layerId}:${cellKey}` key breaks the cleanup loop at `CitySceneR3F.tsx:409`
(which compares map keys to layer ids, so every cell would be deleted) and every
`map.get(layerId)` at `:495`, `:571`, `:597`, `:687`, `:1017`. Instead:

```ts
Map<layerId, {
  ...LayerSceneState,
  cells: Map<CellKey, CellSceneState>   // empty for static layers
}>
```

Both `layerId` and `cellKey` go in each mesh's `userData`. Every operation —
visibility, rules, picking, cursor conversion, box selection, highlighting — is
rewritten explicitly against the two-level structure.

## 13. Triangulation and colour migration

Review findings F21 and F5 showed the previous revision understated this badly.

`buildCityMesh.ts` imports `BufferGeometry`, `BufferAttribute`, `ShapeUtils`, and
`Vector2` from Three.js (`:9`), and triangulates with `ShapeUtils`/`Vector2`
(`:154-202`). A "thin wrapper split" leaves Three.js inside the worker algorithm.
This is a **behaviour-sensitive migration**, budgeted as its own task, with parity
tests against the current output for: holes, non-planar surfaces, degenerate
rings, winding order, semantic indices, and triangle normals.

`applyRuleColors.ts` is worse than "drop the `Color` import": it takes a
`BufferGeometry`, calls `geometry.getAttribute()` (`:34`), and dereferences
`object.surfaces[surfIdx]` (`:89`). It is rewritten around typed arrays and
compact records. **Colour-space parity matters** — `new Color(hex)` performs
sRGB-to-working-space conversion and is _not_ `hexChannel / 255`; the worker must
reproduce that conversion, with a test asserting parity against Three.js.

`computeRoofMetrics` is already worker-safe — pure domain types and `Math`, no DOM
or Three.js (confirmed by review).

## 14. Open-time admission, identity, and persistence

**Admission checks** (review F25). `geographicalExtent`, transform, and reference
system are all optional in the header, `featuresCount === 0` means _unknown_ not
_empty_, and `select()` throws `NoIndex` when `rtreeSize === 0`. Streaming cannot
work without an extent and an R-tree. At open we refuse, with a distinct message
each, on: missing or degenerate extent, missing spatial index, invalid transform,
non-finite coordinates, unknown feature count used as a denominator, and
non-metric CRS units (§1).

**Feature vs CityObject identity.** One FCB feature may contain a Building parent
plus BuildingParts, with attributes on the parent and geometry on the parts. The
spec's unit of ownership and caching is the **feature**; the unit of selection and
inspection is the **CityObject**. `ObjectRecord` carries parent/child links so the
inspector can resolve attributes from a parent whose geometry lives on a part.

**Persistence** (review F19). `LayerSnapshot` has only an optional `selectedLod`
(`persistence/types.ts:32`) and save omits even that (`App.tsx:189-197`). A
versioned v2 schema adds `lodMode`, the manual LoD, streaming source metadata, and
a restorable _unavailable local source_ state — a local `Blob` cannot survive a
reload, so the layer restores as an explicit error state prompting re-selection
rather than vanishing with a toast.

## 15. Testing

Unit tests against the pure modules, where the wrongable logic lives:

- `sceneTransform` — round-trip source↔scene for a static layer and for a cell
  with a non-zero offset, with distinct non-zero X, Y, and Z. **A cell built from
  cell-local vertices plus its `meshOffset` must land on exactly the same world
  coordinates as the same features built through the static path.** This is the
  regression test for the rotation bug and is worth writing first.
- `tileGrid` — key/bbox round-trip, half-open boundary behaviour, a centre exactly
  on a boundary belongs to exactly one cell, outer maximum lands in the last
  row/column, ownership for a straddling feature.
- `viewportFootprint` — top-down gives the expected rectangle; tilted clamps at
  `T_MAX`; at or above the horizon yields neither infinity nor NaN; camera below
  `groundY`.
- `levelPolicy` — uniform level from footprint and probe count; `MAX_COVER_CELLS`
  forces coarsening; give-up path; LoD ladder for multi-LoD, single-LoD, and
  unlabelled datasets.
- `cellCache` — LRU order, pinning, triangle and byte budgets, refusal when a
  desired cover exceeds capacity.
- Throttle gates — hysteresis suppresses a small nudge, and is bypassed when the
  cover has holes or the level changed.
- Colour parity — worker colours equal Three.js `Color` for a range of hexes.
- Triangulation parity — §13's list.

Integration: a vendored `delft.fcb` (from `../flatcitybuf/examples/data/`) through
worker → cells → resident records. **HTTP-level tests assert request count and
bytes**, not merely final geometry — the whole design is about request economy, so
a regression that quietly restores N-traversal behaviour must fail a test.

Per CLAUDE.md, all test imports come from `"vitest"`, never `"vite-plus/test"`.

## 16. Error handling

- **CORS / range failure** → explicit message naming CORS, distinguished from a
  transient failure. Transient range errors retry with backoff; CORS does not.
- **Aborted** → silent. Aborts are the normal result of moving the camera.
- **Over budget** → "zoom in to load features" overlay, not an error.
- **Admission failures** → §14, one distinct message each.
- **React StrictMode** — worker creation, open, and teardown must tolerate
  double-invoked effects.
- **Teardown** — on layer removal: terminate the worker, abort controllers, release
  the `Blob`, dispose geometries and materials, and reject pending promises.

## 17. Constants

| Constant                    | Default                 |
| --------------------------- | ----------------------- |
| `SETTLE_MS`                 | 350                     |
| `MOVE_FRAC`                 | 0.2                     |
| `SCALE_FACTOR`              | 1.3                     |
| `T_MAX_M`                   | 5000                    |
| `MAX_FOOTPRINT_SPAN_M`      | 8000                    |
| `VIEWPORT_FEATURE_BUDGET`   | 20000 features          |
| `RESIDENT_TRIANGLE_BUDGET`  | 4,000,000               |
| `RESIDENT_BYTE_BUDGET`      | 512 MiB (main + worker) |
| `MIN_COVER_CELLS`           | 9                       |
| `MAX_COVER_CELLS`           | 64                      |
| ~~`LEVEL_SWAP_TIMEOUT_MS`~~ | removed 2026-08-05      |
| `MIN_CELL_M`                | 50                      |

All are provisional and must be tuned against `delft.fcb` and one large real
dataset before they are treated as settled.

**Constraint discovered during implementation:** `MAX_FOOTPRINT_SPAN_M` must stay
**below `2 × T_MAX_M`**, or it can never fire. Every corner ray is clamped to
`T_MAX_M`, so no two footprint points can be more than `2 × T_MAX_M` apart — a
50,000-pose randomized probe measured a maximum span of 9999.869 m against
`T_MAX_M = 5000`. The original 20000 was therefore dead code, and the "zoom in"
refusal it was supposed to provide never existed. Retuning `T_MAX_M` requires
revisiting this pairing.

Note also that the span cap is only a cheap pre-filter. The honest "too far"
decision is the feature-count probe in §4 — a 10 km² viewport over a dense city
can hold millions of features while passing any span check.

## 18. Review history

Revision 2 restructured this document after an adversarial review by
`gpt-5.6-sol` (30 findings: 9 critical, 19 major, 2 minor) and an architecture
consultation. The substantive changes:

- Adaptive per-cell refinement replaced by a uniform level with one traversal per
  commit (F8, F10), which also made the atomic level swap coherent (F9).
- Geometry protocol gained normals and object/surface indices (F3).
- Object payload replaced by `ResidentObjectRecord` with on-demand rings (F4).
- Worker cache lifecycle, `evict`, and cooperative cancellation specified (F6, F27).
- Local files ship as `Blob`, not `ArrayBuffer` (F17).
- Two-level scene map replacing a compound key (F22).
- Budgets moved to bytes and triangles, post-decode (F11).
- DuckDB whole-dataset path disabled for streaming layers (F12).
- Metre-based CRS now required rather than claimed universal (F23).
- Origin rebasing dropped from v1; multi-layer anchor policy defined (F24, F26).
- Deletion fallout in `loadCityModel` and restore paths tracked (F18).
- Persistence schema versioned (F19); LoD `null`/unlabelled defined (F20).
- Triangulation and colour work recognised as a migration, not a split (F21, F5).
- Labels corrected to "resident cache" and "features" (F13, F14).
- `residentModel` made imperative after Zustand semantics review (F15).
- Trigger moved to `OrbitControls` `change` (F16).
- Fictional percentile-rule discussion removed (F29); half-open cells (F30).
