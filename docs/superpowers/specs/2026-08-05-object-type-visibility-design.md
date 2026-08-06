# Per-layer city object type visibility — design

**Date:** 2026-08-05
**Status:** approved for implementation (commander/executor split; nothing committed until the user reviews)

## What

Each layer row gains a disclosure listing the **top-level CityGML object types** present in that
layer, each with a visibility toggle. Hiding a type removes its geometry from the scene (and from
picking) for that layer only. Second-level types fold into their first-level parent: hiding
_Building_ hides `BuildingPart` and `BuildingInstallation` too — which is not cosmetic but load-
bearing, because in real data (Delft: 66/66) the `Building` carries no geometry and the
`BuildingPart` carries all of it, so a naive `objectType === "Building"` filter would hide nothing.

Works for static CityJSON/CityJSONSeq layers and FlatCityBuf streaming layers.

## Semantics

- **Grouping is a static name map, not a parent walk.** CityJSON's second-level vocabulary is
  closed (Building×7, Bridge×5, Tunnel×5 second-level names); a runtime map
  `TOPLEVEL_BY_SECOND_LEVEL` plus `toplevelCityObjectType(objectType: string): string` (identity
  for first-level, unknown and `+Extension` types) lives in **navara-core** so the worker and the
  app share one definition. A parent walk would add cross-cell dependence in the streaming path
  for no gain over the spec-defined map.
- **State is a hidden-set, per layer**: `Layer.hiddenTypes: ReadonlyArray<string>` of _group_
  names, default `[]`. Default-empty means a type discovered mid-stream is visible until someone
  hides it — the honest default. The store replaces the array on every edit (identity comparison
  in the sync layer, same convention as `rules`).
- The filter predicate everywhere is `hiddenSet.has(toplevelCityObjectType(obj.objectType))`.
- Hiding shapes **geometry**, not styling: rules, DuckDB, the table, and attribute inspection
  still see every object. Only meshes (and therefore raycast picking) lose the hidden objects.

## Mechanism — static path

There is one merged non-indexed BufferGeometry per layer, rebuilt wholesale on LoD change
(`CityModelMesh.rebuildGeometry`, cityModelMesh.ts:280). Hiding rides the identical seam. A style
evaluator cannot hide anything (RGB-only, opaque material, and painted objects would still occlude
and pick), so rebuild is the only correct mechanism — and it is the one LoD already pays for.

1. `buildCityMeshArrays` (navara-core, buildCityMeshArrays.ts:56) gains a 5th optional param
   `hiddenTypes: ReadonlySet<string> | null = null` (top-level group names). The skip goes at the
   top of the object loop in **both** passes (:70/:95), before triangulation work.
   **Invariant: `objectKeys.push(id)` (:72) and `objectIdx++` (:181) still run for every object,
   hidden or not** — object indices must stay stable or `computeStyleColors`, `paintLayers` and
   `resolveVertexIndices` all shift. Filter triangles, never the key list.
2. Thread through: `CityModelMeshOptions` + `setHiddenTypes(types)` on `CityModelMesh`
   (no-change early return, then `rebuildGeometry()`, exactly like `setLod` :240) →
   `CityModelMeshDesc` config (:31-41) → `cityModelRegistry` config literal (:131-140) and handle
   closure (:147-201) → `AddCityModelOptions` and `CityModelHandle` (types.ts:22-35, :45-82).
   The handle method takes `ReadonlyArray<string>` (like `setRules`) and converts to a Set.

## Mechanism — streaming path

The worker already has `objectType` on every object at bake time and calls the **same**
`buildCityMeshArrays` (fcb.worker.ts:292), so the core filter is shared for free.

1. **Wire:** `fetch` message gains `hiddenTypes: ReadonlyArray<string>` (workerProtocol.ts:48-57),
   passed as the new 5th param at fcb.worker.ts:292. The cell's `CityModel` itself stays
   **unfiltered**, so `toObjectRecords` (:332) still reports hidden objects — type discovery, the
   inspector and the table must not go blind to the very types the user hid.
2. **Handle:** `FcbStreamLayerHandle.setHiddenTypes(types)` follows the **setLod template**
   (streamLayer.ts:770-775), not the setRules one, because geometry changes: record state,
   no-change early return (JSON.stringify, like setRules), fire `options.onCommitNeeded?.()` so
   the registry forces a commit. `commit()` snapshots `_hiddenTypes` into the fetch message
   alongside `rules` (:452-465). Extend `commitPlanner` so a hiddenTypes change is treated as a
   swap the same way a LoD change is; give the in-flight race the identical treatment a mid-flight
   LoD change gets (investigate how that path avoids installing stale cells — `abortInFlight`,
   swap bookkeeping — and mirror it; add `builtWithHiddenTypes` to `CellEntry` (:75-92) with
   `rulesStale`-style detection in cellMeshes.ts only if the LoD path uses the analogous
   mechanism). A toggle refetches affected cells — same cost as a LoD change, rare and acceptable.
3. **Seeding:** `OpenStreamOptions` gains `hiddenTypes?`; `StreamLayerRegistry.openStream` seeds
   it before the first commit next to the existing `setVisible`/`setRules` seeding
   (streamRegistry.ts:428-429), so a restored layer's first fetch is already filtered.
4. **Discovery — mirror the LoD ladder, no wire change.** In `commit`, next to the
   `observedLods` fold (streamLayer.ts:559-568), union
   `toplevelCityObjectType(o.objectType)` over `entry.objects`; keep `_typesSeen`, emit via a new
   `onTypes(cb)` (mirror of `onLadder` :328). App side: subscribe in `openStreamingLayer.ts`
   (:98-100 pattern) into new `streamStore` fields `types: ReadonlyArray<string>` +
   `typesVersion` (mirror of `setLadder`, streamStore.ts:149-163).

## App wiring

- **layerStore.ts:** `Layer.hiddenTypes: ReadonlyArray<string>` and
  `Layer.availableObjectTypes: ReadonlyArray<string>` (top-level groups present, computed at
  `addLayer` by a `computeAvailableObjectTypes(model)` helper modelled on `computeAvailableLods`
  :114-122; empty for streaming layers — theirs comes from the stream store). Action
  `setHiddenTypes(layerId, types)` replacing the array. Test fixtures gain the two fields.
- **handleSync.ts:** `LiveLayer.hiddenTypes` memo + push block in `syncLayers` (:109-116 pattern,
  identity compare); `StreamInteractionHandle.setHiddenTypes` + `StreamSyncMemo.hiddenTypes` +
  push in `syncStreamState` (:277-309).
- **NavaraViewport.tsx:** pass `hiddenTypes: layer.hiddenTypes` in the `addCityModel` options
  (:1377-1382) so a freshly added static layer is built filtered.
- **Persistence:** optional `hiddenTypes?: string[]` on `LayerSnapshot` (types.ts:43-55),
  defaulted to `[]` in `normalizeLayers` (:103-112). Schema stays v3 (optional-field convention).

## UI

A per-layer disclosure in `LayerPanel` (`src/ui/layers/LayerTypeToggles.tsx`, own component per
row like `LayerObjectCount` — Rules-of-Hooks): a small caret button on the row expands a checkbox
list of group names. Static layers list `layer.availableObjectTypes`; streaming layers list
`streams[id].types`. Checked = visible; toggling calls `setHiddenTypes` with a fresh array.
While a streaming layer has discovered nothing yet, the expanded list says
"Types appear as features stream in". No counts in v1 (not asked for; streaming counts churn).

## Testing

- navara-core: `toplevelCityObjectType` mapping table; `buildCityMeshArrays` hides a type's
  triangles while `objectKeys`/object indices stay identical to the unfiltered build (the
  invariant test), and hiding "Building" removes a `BuildingPart`'s triangles.
- navara-cityjson: `setHiddenTypes` rebuilds (triangle count drops), no-change is a no-op,
  styles/highlights survive the rebuild (repaint path).
- navara-flatcitybuf: fetch carries hiddenTypes and the baked cell excludes the group while
  `objects` records still include it; `onTypes` unions groups across commits like `onLadder`.
- App: layerStore action + `computeAvailableObjectTypes`; handleSync pushes on change only;
  LayerTypeToggles renders groups and writes the store; persistence round-trip.
- Browser smoke: two-buildings.city.json (toggle Building off/on), delft.fcb (toggle while
  streaming; verify the inspector still shows attributes for re-shown objects).

## Out of scope

Per-second-level toggles, counts per type, cross-layer global toggles, and any semantic-surface
(RoofSurface/WallSurface) filtering — a different axis entirely.
