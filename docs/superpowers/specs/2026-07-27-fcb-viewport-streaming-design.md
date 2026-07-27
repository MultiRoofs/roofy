# Viewport-streamed FlatCityBuf

**Date:** 2026-07-27
**Status:** Approved design, ready for planning
**Branch:** `develop`

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
- Keep the main thread free: all reading, parsing, triangulation, and
  colorization happen in a worker.
- Refetch rarely — camera movement must not translate into constant querying.
- Degrade honestly. When the view is too wide to serve, say so rather than
  hanging or silently truncating.

## Non-goals

- Whole-dataset analytics. Analysis covers loaded features only (see §10).
- Writing or editing `.fcb`.
- Attribute-filter queries (`where`). The reader supports them; the UI for them
  is out of scope.
- Streaming for CityJSON / CityJSONSeq / CityGML. Those stay whole-file.

## Decisions

| #   | Decision                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Depend on `@cityjson/flatcitybuf@^0.3.0` — the pure-TS reader, published to npm.                                       |
| 2   | Streaming is the **only** `.fcb` mode. `loadFlatCityBuf.ts` is deleted.                                                |
| 3   | A streaming layer holds a **chunk cache**, LRU-evicted — not a swapped model.                                          |
| 4   | Chunks are **quadtree cells in the source CRS**; level is chosen by a **feature-count probe**, not a distance formula. |
| 5   | Quadtree level drives geometry LoD in `auto` mode; `manual` pins one LoD.                                              |
| 6   | Analysis reads **loaded features only**, labelled as such.                                                             |
| 7   | The worker does read → parse → triangulate → rule colors → roof metrics.                                               |
| 8   | **One worker per streaming layer**, one `FcbReader`, ≤4 concurrent range reads.                                        |

---

## 1. Coordinate frames — no reprojection in the hot path

The reference implementation (`../flatcitybuf/examples/web`) calls proj4 on every
query because deck.gl works in lng/lat. We do not need to.

Our local scene frame is a rigid transform of the source CRS. `buildCityMesh`
subtracts an origin (`buildCityMesh.ts:105-113`) and the mesh carries
`rotation.x = -π/2` (`CitySceneR3F.tsx:467`):

```
local  = (srcX - ox, srcY - oy, srcZ - oz)
world  = (X, Z, -Y)                          # rotation about X by -π/2

⇒  srcX = worldX + ox
   srcY = oy - worldZ
   srcZ = worldY + oz
```

Viewport → tile bbox is therefore a translation and a sign flip. **proj4 is not
called anywhere in the streaming path.** It remains only in `solarStore` for the
atmosphere's lat/lon.

Consequence worth stating: streaming works on datasets whose CRS is not in the
proj4 allowlist. Only sky, sun, and Google tiles degrade — geometry, picking, and
rules are unaffected. This is strictly better than the reference, which refuses to
render unsupported CRS at all.

## 2. Module layout

```
src/features/streaming/
  fcb.worker.ts         owns FcbReader; open / probe / fetchTile / recolor / cancel
  workerProtocol.ts     message types, shared by worker and client
  workerClient.ts       promise-per-message wrapper, sequence guard
  tileGrid.ts           quadtree math + ownership rule         (pure)
  viewportFootprint.ts  perspective frustum → ground AABB      (pure)
  tileCache.ts          LRU, pinning                           (pure)
  levelPolicy.ts        count-gated level + LoD ladder         (pure)
  streamStore.ts        per-layer stream state (zustand)
  useTileStreaming.ts   camera-idle driver, throttle gates

src/domain/citymodel/flatcitybuf/
  fcbSource.ts          open from URL | Blob, build header model
```

`tileGrid`, `viewportFootprint`, `tileCache`, and `levelPolicy` are pure — no
Three.js, no worker, no I/O. They carry the logic most likely to be wrong and are
unit-testable in isolation.

## 3. Tile grid

Cells are axis-aligned squares in the source CRS, anchored at the header
extent's min corner.

```ts
type TileKey = `${level}/${col}/${row}`

ROOT_CELL = smallest power-of-two multiple of 100 m covering
            max(extentSpanX, extentSpanY)
cellSize(level) = ROOT_CELL / 2 ** level
MAX_LEVEL       = largest level with cellSize >= MIN_CELL_M (50)
```

Level 0 is a single cell over the whole dataset. `tileGrid` exposes `bboxOf`,
`keysCovering(bbox, level)`, `children`, `parent`.

**Ownership.** The R-tree returns every feature _intersecting_ a query bbox, so a
building straddling a boundary comes back from both neighbouring cells. A tile
renders only features whose **bbox centre** falls inside its cell. Deterministic,
requires no cross-tile bookkeeping, and stays correct under eviction.

The rule itself is grid math and lives in `tileGrid` as
`ownerKey(featureBbox, level) → TileKey`; the worker applies it when filtering a
cursor's results into a tile. `tileCache` does not participate — it never sees a
duplicate.

## 4. Level selection — the count gate

Camera distance cannot determine level honestly: feature density varies by an
order of magnitude between a rural cell and a city centre at identical zoom. A
coarser cell in FlatCityBuf returns _more_ features at full geometry, not fewer —
there is no coarse representation stored in the file.

So distance seeds a guess and a feature-count probe decides:

```
candidate ← level from camera height above ground
loop:
  n ← probe(bboxOf(key))
  n ≤ BUDGET_PER_TILE  → commit; iterate the cursor
  n >  BUDGET_PER_TILE → refine to 4 children, re-probe each
  level > MAX_LEVEL    → give up; surface "zoom in to load features"
```

The probe is nearly free. In `reader.ts`, `select()` computes
`featuresCount: all.length` from the `searchRtree` hit list and returns
`readHits(...)` as a **lazy** async iterator. Reading the count and not iterating
costs one R-tree index traversal and reads no feature bodies. (Verified against
source; true for the spatial branch, which is the only branch we use.)

## 5. Viewport footprint

For a perspective camera, the visible ground area is a trapezoid running toward
the horizon, not the flat rectangle a 2D map would use.

```
for each of the 4 far-plane NDC corners:
    ray  ← unproject → direction from camera.position
    t    ← (groundY - camera.position.y) / ray.y
    clamp if:  ray.y >= -EPS      (at or above the horizon)
               t < 0              (behind the camera)
               t > T_MAX          (beyond the fetch radius)
    → substitute the point at T_MAX along the ray
footprint ← AABB of the 4 clamped points, + one tile of margin
```

`T_MAX` is its own constant (default **5000 m**). `camera.far` is 50 km, or 200 km
with Google tiles enabled (`CitySceneR3F.tsx:346`), and is useless as a fetch
radius.

`groundY` already exists (`CitySceneR3F.tsx:835-840`).

## 6. Throttling

A debounce alone is not enough — it still fires a full query every time the
camera is nudged and pauses. Five gates, mirroring the reference's
`useCameraFollow.ts` but expressed in metres rather than zoom levels:

| Gate             | Constant                       | Behaviour                                                |
| ---------------- | ------------------------------ | -------------------------------------------------------- |
| Settle           | `SETTLE_MS = 350`              | camera must be still; timer resets on every camera frame |
| Span cap         | `MAX_FOOTPRINT_SPAN_M = 20000` | cheap short-circuit before probing at continental scale  |
| Move hysteresis  | `MOVE_FRAC = 0.2`              | skip unless the footprint centre moved >20% of its span  |
| Scale hysteresis | `SCALE_FACTOR = 1.3`           | skip unless the span changed by ≥1.3×                    |
| Horizon clamp    | `T_MAX_M = 5000`               | §5                                                       |

Both hysteresis gates are relative to the _current_ span, so they track zoom
automatically: a small absolute pan matters when zoomed in and not when zoomed
out. This is what prevents ordinary orbiting from becoming a query storm.

On top of the gates: every superseded query is cancelled via `AbortSignal`
(supported by `select()` in 0.3.0), and a monotonic `requestSeq` drops results
that arrive out of order.

## 7. Worker

One worker per streaming layer, owning one `FcbReader` — so one header fetch and
one shared `BufferedRangeReader` cache. Tile reads are I/O-bound and issued
concurrently inside it, capped at `MAX_INFLIGHT_READS = 4`. Triangulation
serializes behind them at roughly 40 ms/tile, which is fine: it is off the main
thread.

```ts
// → worker
{ type:'open',      id, url } | { type:'open', id, buffer }
{ type:'probe',     id, bbox }
{ type:'fetchTile', id, key, bbox, lod, rules, rulesEnabled }
{ type:'recolor',   id, keys, rules, rulesEnabled }
{ type:'cancel',    id }

// ← worker
{ type:'opened',    id, header }        // version, featuresCount, extent,
                                        // referenceSystem, availableLods, columns
{ type:'probed',    id, count }
{ type:'tile',      id, key, positions, colors, ruleColors,   // transferable
                    objects, objectKeys, triangleCount, lodsSeen }
{ type:'recolored', id, key, ruleColors }                     // transferable
{ type:'error',     id, message, code, aborted }
```

**What crosses the boundary.** Geometry goes as transferable `Float32Array`s
(zero-copy). Per object we send a compact record — never raw surface rings by
default:

```ts
interface ObjectRecord {
  id: string
  objectType: string
  attributes: Record<string, unknown>
  bbox: BBox3
  lod: string | null
  surfaceCount: number             // duckdb.ts:198, TablePanel.tsx:390
  roofMetrics: RoofMetrics[]       // one per RoofSurface — computeStats needs
                                   // only type + metrics, never the rings
}
// per tile, alongside the records:
surfaceAttrKeys: string[]          // RuleBuilderTab.tsx:407 needs keys, not values
```

An audit of every consumer (not an assumption — `grep -rn '\.surfaces'`) shows
two that genuinely need raw ring geometry:

| Consumer                                  | Needs                                | Resolution        |
| ----------------------------------------- | ------------------------------------ | ----------------- |
| `AnalysisTab.tsx:31,89,149`               | `surface.rings[0]` for solar scoring | on-demand         |
| `InspectorPanel.tsx:188,363`              | Surfaces tab iterates rings          | on-demand         |
| `computeStats.ts:74,123`                  | surface `type` + `RoofMetrics`       | `roofMetrics[]`   |
| `duckdb.ts:198`, `TablePanel.tsx:390,420` | `surfaces.length`                    | `surfaceCount`    |
| `RuleBuilderTab.tsx:407`                  | surface attribute _keys_             | `surfaceAttrKeys` |
| `layerStore.ts:65` `computeAvailableLods` | LoD strings                          | `lodsSeen`        |
| `derived.ts:14,26,37`                     | rings, via the two tabs above        | on-demand         |

Both ring consumers operate on **one selected object**, so rings are fetched
on demand rather than shipped for every feature:

```ts
{ type:'objectSurfaces', id, objectId }  →  { type:'surfaces', id, surfaces }
```

That keeps the bulk payload compact while leaving the inspector fully functional.
The worker retains the parsed `CityModel` per resident tile to serve these.

Rule edits do not refetch. The client posts `recolor` with the resident keys; the
worker recomputes and returns colour arrays.

## 8. Cache and eviction

```ts
interface TileEntry {
  key: TileKey;
  mesh: Mesh; // tile-local vertices
  objects: ObjectRecord[];
  lastSeen: number;
  pinned: boolean;
}
```

LRU beyond `RESIDENT_TILE_BUDGET = 48` tiles.

**Pinning.** A tile holding an active selection is pinned against eviction. If a
pinned tile must nevertheless go, the selection is cleared **visibly** — never
silently.

**Level transitions are atomic.** A refine or coarsen builds the entire new-level
tile set off-scene and splices into `cityGroup` in one operation. Partial arrival
never touches the old level, so no building is ever resident at two levels
simultaneously. A `LEVEL_SWAP_TIMEOUT_MS = 1500` guard commits whatever is ready
and leaves the rest at the old level rather than freezing the view mid-zoom.

## 9. LoD

`Layer` gains `lodMode: 'auto' | 'manual'`, defaulting to `auto`.

In `auto`, LoD is chosen by tile ground size against the LoDs the dataset
actually offers:

```
ladder = observed LoDs, sorted ascending by numeric value

cellSize > 2000 m   → ladder[0]                    (coarsest)
200 m … 2000 m      → ladder[floor((n-1)/2)]       (lower-middle when n is even)
cellSize < 200 m    → ladder[n-1]                  (finest)
```

Indexing is defined for every ladder length: `n = 1` maps all three bands to the
same LoD, `n = 2` gives coarsest/coarsest/finest, `n = 3` gives one per band.

The ladder is built from observed LoDs, seeded by sampling a few features at open
and unioned as tiles arrive (the reference's `mergeLods` pattern). A single-LoD
dataset collapses the ladder to identity — auto mode then buys nothing, and only
the count gate protects a wide view. This is stated plainly in the UI.

In `manual`, one LoD applies to every tile, as today. `LodSelector` gains the
mode toggle; in `auto` the dropdown becomes a read-out ("near 2.2 / far 1.2").

## 10. Origin and precision

The origin is pinned once from the **header extent centre** — never from loaded
features, which change constantly.

Streaming tiles use **tile-local vertices** plus a per-mesh position offset, so a
rebase is an O(tiles) position update rather than O(vertices) re-triangulation.

**The offset must be rotated.** Three.js composes `matrixWorld = T(P)·R`, and the
city mesh already carries `rotation.x = -π/2` (`CitySceneR3F.tsx:467`). So the
position is applied in _world_ space, after the rotation — a raw source-CRS
difference would place every tile wrong:

```
world = P + R·v ,  where  R·v = (v.x, v.z, −v.y)

want:  world = (srcX−ox, srcZ−oz, −(srcY−oy))
with:  v     = (srcX−tcx, srcY−tcy, srcZ−tcz)

⇒  P = R·(tileCentre − sceneOrigin)
     = (dx, dz, −dy)   for d = tileCentre − sceneOrigin in source CRS
```

So `mesh.position = (d.x, d.z, −d.y)`, **not** `d` componentwise. `tileGrid`
exposes this as `meshOffset(tileCentre, sceneOrigin)` so the sign convention lives
in one tested place rather than at each call site.

Float32 carries ~7 significant digits, so beyond roughly 50–100 km from the origin
the ULP grows into visible jitter and z-fighting; a rebase triggers only on
crossing that threshold.

`buildCityMeshArrays` serves both paths unchanged — static layers pass the scene
origin and leave `mesh.position` at zero, tiles pass the tile centre. No
special-casing inside the function.

## 11. Analysis semantics

Analysis covers **loaded features only**. Every readout is labelled accordingly
("visible area only") and recomputed on cache change. Feature counts show
`n of <total> loaded`, using the header's `featuresCount` as the denominator.

Percentile-based rules are the sharp edge: their answer shifts as tiles load and
evict. The legend says so rather than implying a global statistic.

`residentModel` is a **lazy, memoised** merge of resident chunks into one
`CityModel`-shaped view, keyed on a cache-version counter. It materialises only
when a consumer reads it — Stats tab open, inspector open. With both closed, a
cache commit costs nothing. This keeps roughly eight existing consumers untouched
while removing the per-commit rebuild.

## 12. Changes to existing code

| File                                              | Change                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                    | `@cityjson/flatcitybuf` `^0.2.0` → `^0.3.0`                                                                                      |
| `domain/citymodel/flatcitybuf/loadFlatCityBuf.ts` | **deleted** — with `mapToObject`, `HttpFcbReader`, `cjseqToCj`                                                                   |
| `scene/buildCityMesh.ts`                          | split into pure `buildCityMeshArrays()` (worker-safe, no Three.js) + thin `buildCityMesh()` wrapper; static path unchanged       |
| `scene/CitySceneR3F.tsx`                          | `layerSceneMapRef` keyed `${layerId}:${tileKey}`; one `Mesh` per tile; triangle count sums tiles; `fitCamera` uses header extent |
| `scene/applyRuleColors.ts`                        | `buildRuleColors` made worker-safe (drop the `three` `Color` import in favour of plain rgb triples)                              |
| `domain/roofMetrics/metrics.ts`                   | verified worker-safe; no change expected                                                                                         |
| `features/layers/layerStore.ts`                   | `Layer.stream?: StreamState`, `Layer.lodMode`                                                                                    |
| `features/layers/useLayerFileLoader.ts`           | `.fcb` routes to the streaming path for both file and URL                                                                        |
| `ui/sidebar/LodSelector.tsx`                      | auto/manual toggle, read-out in auto                                                                                             |
| `ui/layers/LayerPanel.tsx`                        | streaming badge, resident tiles, loaded/total, "visible area only"                                                               |
| `ui/StatusBar.tsx`                                | streaming status, "zoom in to load features"                                                                                     |

## 13. Error handling

- **CORS / range failures** on a remote URL → explicit message derived from
  `FcbError` codes. This is the most likely first-run failure for a remote file
  and deserves a message that names CORS specifically.
- **Aborted queries** → silent. Never surfaced as errors; they are the normal
  result of moving the camera.
- **Over budget at `MAX_LEVEL`** → "zoom in to load features" overlay, not an
  error.
- **Unsupported CRS** → renders normally; only atmosphere and Google tiles
  degrade (§1).
- **Local file revoked / moved** → streaming holds the `Blob`, so a local layer
  keeps working for the session but cannot be restored from a persisted snapshot.
  The layer restores as an error state prompting re-selection.

## 14. Testing

Unit tests against the pure modules — this is where the logic that can be wrong
lives:

- `tileGrid` — key/bbox round-trip, `keysCovering` at level boundaries,
  `children`/`parent` inverses, ownership by bbox centre including the straddling
  case, and `meshOffset` sign convention (§10): a tile built with tile-local
  vertices plus its offset must land on exactly the same world coordinates as the
  same features built through the static whole-model path. This is the regression
  test for the rotation bug and is worth writing first.
- `viewportFootprint` — top-down camera gives the expected rectangle; tilted
  camera clamps at `T_MAX`; camera aimed at or above the horizon does not produce
  an infinite or NaN footprint; camera below `groundY`.
- `levelPolicy` — refinement under the count gate; give-up at `MAX_LEVEL`; LoD
  ladder for multi-LoD and single-LoD datasets.
- `tileCache` — LRU order, pinning prevents eviction, eviction of a pinned tile
  clears selection.
- Throttle gates — move and scale hysteresis fire and suppress correctly.

Integration: a vendored `delft.fcb` (from `../flatcitybuf/examples/data/`) driven
through worker → tiles → resident model.

Per CLAUDE.md, all test imports come from `"vitest"`, never `"vite-plus/test"` —
the vite-plus runner bug breaks `describe`.

## 15. Risks

1. **Main-thread cost hides somewhere we did not look.** The design routes
   geometry, colours, and metrics through the worker, but any consumer needing
   per-surface rings would force either a payload increase or another move into
   the worker. _Mitigation:_ audit consumers during planning, before writing the
   protocol.
2. **Atomic level swaps stall on a slow tile,** freezing the view mid-zoom.
   _Mitigation:_ the 1.5 s timeout commits partial results.
3. **Auto-LoD buys nothing on single-LoD datasets,** leaving the count gate as the
   only protection on a wide view — users may hit "zoom in to load" more often
   than expected. _Mitigation:_ state it in the UI; tune `BUDGET_PER_TILE` against
   a real single-LoD file.

## 16. Constants

| Constant                | Default       |
| ----------------------- | ------------- |
| `SETTLE_MS`             | 350           |
| `MOVE_FRAC`             | 0.2           |
| `SCALE_FACTOR`          | 1.3           |
| `T_MAX_M`               | 5000          |
| `MAX_FOOTPRINT_SPAN_M`  | 20000         |
| `BUDGET_PER_TILE`       | 2000 features |
| `RESIDENT_TILE_BUDGET`  | 48 tiles      |
| `MAX_INFLIGHT_READS`    | 4             |
| `LEVEL_SWAP_TIMEOUT_MS` | 1500          |
| `MIN_CELL_M`            | 50            |
| `REBASE_THRESHOLD_M`    | 50000         |
