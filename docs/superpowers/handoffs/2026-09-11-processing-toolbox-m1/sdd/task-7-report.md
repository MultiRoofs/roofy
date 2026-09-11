# Task 7 report — Model write-back seam (`mergeAttributes`, `setModel`, `syncLayers` push)

## Implemented

### Submodule (`@cityjson/navara-cityjson`)

- `src/cityModelMesh.ts` — `private readonly model` → `private model`; new `setModel(model: CityModel)`:
  identity guard, assign, `this.repaint()`. Doc comment says explicitly why it is NOT a
  `rebuildGeometry` seam (unlike `setLod`/`setHiddenTypes`/`setAppearance`): the geometry-dependent
  readers (`buildArrays`, `getBoundsGeodetic`'s bbox, the `TextureCache`'s appearance) must not be
  re-derived from a model that differs only in attributes, and a rebuild would drop the texture
  images and re-triangulate the whole layer on every computed column.
- `src/types.ts` — `CityModelHandle.setModel(model: CityModel): void` (with `CityModel` added to the
  `@cityjson/navara-core` type import); doc says ATTRIBUTES only, a repaint not a rebuild, and that a
  caller whose geometry changed must replace the layer.
- `src/cityModelRegistry.ts` — `setModel: (next: CityModel) => mesh.setModel(next)` in the handle literal.
- `tests/cityModelMesh.setModel.test.ts` (new) — file-local `quad`/`model`/`opts` fixture copied from
  the folder's existing pattern (the brief's `buildMeshFixture` helper does not exist).

No other implementer of `CityModelHandle` exists in the submodule — `pnpm typecheck` (all packages,
`tsc -b`) stayed green with no further edits, so `streamLayer.ts`/`CityJSONPlugin.ts`/`plugin.ts`/
`CityModelMeshDesc.ts` are consumers, not implementers.

### App

- `src/features/layers/layerStore.ts` — `mergeAttributes(layerId, byObjectId)` on
  `LayerStoreActions` + implementation. New model, new `CityObject` for each touched id, untouched
  objects kept by identity; `undefined` value deletes the key. Three no-ops that return the SAME
  `state` (so nothing re-renders and `syncLayers` does not push a repaint for nothing): empty map,
  unknown `layerId`, and no id in the map present on that layer (`touched` flag). `CityObject` imported
  from `../../domain/citymodel/types`.
- `src/scene/handleSync.ts` — `LiveLayer.model?: CityModel` (documented as "last pushed, by IDENTITY"),
  seeded on the add path next to `appearance` (`registry.add` builds the mesh from exactly this model,
  so the first pass pushes nothing), and pushed in the per-layer loop before the `hiddenTypes` check:

  ```ts
  if (entry.model !== layer.model) {
    entry.model = layer.model;
    entry.handle.setModel(layer.model);
  }
  ```

  `syncLayers`' contract docblock gained the matching bullet. `CityModel` added to the existing
  `@cityjson/navara-core` import (as `type`, so the module stays engine-free).

- `setModel: vi.fn()` added to the seven STATIC city-model handle fakes that reach `syncLayers` at
  runtime (`handleSyncAppearance`, `handleSyncVisibleIds`, `navaraViewport`, `navaraViewportCamera`,
  `navaraViewportSolar`, `navaraViewportStreaming`, `navaraViewportTheme`). The two STREAM handle
  fakes in `handleSyncAppearance.test.ts` and `navaraViewportStreaming.test.ts` were deliberately left
  alone — `StreamInteractionHandle` has no `setModel`.

## Tests and results

### Plugin — RED then GREEN

New `tests/cityModelMesh.setModel.test.ts`, three cases:

1. "swaps the model rules evaluate against and repaints" — a `SurfaceStyleEvaluator`
   `(surface, object) => { seen = object.object.attributes["computed_x"]; return null; }` reads
   `undefined` after `setStyle` (the brief's `expect(seen).toBeNull()` is wrong: `setStyle` repaints
   synchronously, so the evaluator HAS run and the key is merely missing — asserting `null` there
   would be a false RED that survives GREEN), then `7` after `setModel(next)`.
2. "is a no-op for the model it already holds" — evaluator call count unchanged.
3. "leaves the geometry alone" — same `BufferGeometry` identity and triangle count after
   `setModel({ ...model })`.

RED (before the implementation):

```
FAIL packages/navara-cityjson/tests/cityModelMesh.setModel.test.ts (3 tests)
TypeError: mesh.setModel is not a function
 Test Files  1 failed (1)
      Tests  3 failed (3)
```

GREEN:

```
pnpm vitest run packages/navara-cityjson
 Test Files  12 passed (12)
      Tests  173 passed (173)
pnpm typecheck   # tsc -b, no output
```

### App — RED then GREEN

`tests/unit/features/layers/layerStoreMergeAttributes.test.ts` (new), four cases: the brief's two
(new model + preserved sibling identity + surviving sibling attribute; `undefined` deletes) plus
"touches no other layer's model" and the no-op triple (empty map / unknown layer / unknown object id
⇒ `useLayerStore.getState()` identity unchanged AND the model identity unchanged). Brief scaffolding
corrected: `parseCityJSON` comes from `@cityjson/navara-core` and takes the PARSED root (there is no
`src/domain/citymodel/parsers` module), the fixture path is resolved off `import.meta.dirname` like
`tests/unit/insights/computeStats.test.ts` does, `modelRef` is `{ type: "file", fileName }` (the
real `CityModelReference`, not `{ kind, name }`), `addLayer` also needs `visible`/`rules`, and
`noUncheckedIndexedAccess` needs `!` on every `objects[id]`.

RED:

```
npx vitest run tests/unit/features/layers/layerStoreMergeAttributes.test.ts
TypeError: state.mergeAttributes is not a function
 Test Files  1 failed (1)
      Tests  4 failed (4)
```

GREEN: `Test Files 1 passed (1) / Tests 4 passed (4)`.

`tests/unit/scene/handleSync.test.ts` — one new case in the `syncLayers` describe, "pushes a new
model identity to setModel, and pushes it once": add pass pushes nothing (seeded), a pass with a new
model object pushes exactly once with that object and records it on the entry, a repeat pass with the
same model pushes nothing more.

RED:

```
FAIL tests/unit/scene/handleSync.test.ts > syncLayers > pushes a new model identity to setModel...
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
 Tests  1 failed | 62 passed (63)
```

GREEN, and then the whole covering set after the fake-handle additions:

```
npx tsc -b --noEmit            # clean
npx vitest run tests/unit/features/layers tests/unit/scene
 Test Files  41 passed (41)
      Tests  727 passed (727)
```

Re-verified after the pre-commit hook's `vp check --fix` rewrite: `tsc -b --noEmit` clean, same
41 files / 727 tests passing.

## Submodule commit and push

```
commit a890c6379c1111f5fbcd09a17b78bf37d1f32f4c
  feat(navara-cityjson): CityModelHandle.setModel swaps attributes without rebuilding
  (on branch processing-setmodel, created off the detached pin e681c18)

git fetch origin && git rev-parse origin/main   -> e681c182f00a9b17c6efda0e1e47d28442857bff
git push origin HEAD:main
  To github.com:HideBa/cityjson-navara-plugins.git
     e681c18..a890c63  HEAD -> main
```

Fast-forward, as expected. `pnpm install` was not re-run: no dependency changed. `dist/` and
`dist-types/` are gitignored, so no build churn was staged.

## Files changed

Submodule (commit `a890c63`, pushed to `origin/main`):

- `packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityModelMesh.ts`
- `packages/cityjson-navara-plugins/packages/navara-cityjson/src/types.ts`
- `packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityModelRegistry.ts`
- `packages/cityjson-navara-plugins/packages/navara-cityjson/tests/cityModelMesh.setModel.test.ts` (new)

Parent (commit `a4c1218` on `develop`, NOT pushed):

- `packages/cityjson-navara-plugins` (pointer bump e681c18 → a890c63)
- `src/features/layers/layerStore.ts`
- `src/scene/handleSync.ts`
- `tests/unit/features/layers/layerStoreMergeAttributes.test.ts` (new)
- `tests/unit/scene/handleSync.test.ts`
- `tests/unit/scene/handleSyncAppearance.test.ts`, `handleSyncVisibleIds.test.ts`,
  `navaraViewport.test.tsx`, `navaraViewportCamera.test.tsx`, `navaraViewportSolar.test.tsx`,
  `navaraViewportStreaming.test.tsx`, `navaraViewportTheme.test.tsx` (one `setModel: vi.fn()` line each)

`index.html`'s pre-existing uncommitted edit was never staged; it is still the only modified path in
the parent working tree.

## Self-review

- **`private readonly model` → `private model`** is the only mutability the seam adds; nothing else in
  `CityModelMesh` reassigns it, and every reader other than `repaint`'s `computeStyleColors` lookup
  runs off `this.arrays` / `this.placement`, which `setModel` does not touch. `getBoundsGeodetic()`
  DOES read `this.model.bbox` — harmless for an attribute-only merge (the bbox is copied through by
  `mergeAttributes`), and the contract on both `setModel` doc comments now says a geometry change is a
  layer replacement, not a merge.
- **Identity guard in two places** (`setModel`'s `model === this.model`, and `syncLayers`'
  `entry.model !== layer.model`), same defence-in-depth as the streaming setters. Plus the store's own
  three no-ops, so a merge that changes nothing never reaches the mesh at all.
- **A hand-built `LiveLayer` with `model: undefined`** (a test, or a future resync over an adopted
  handle) pushes on its first pass. That matches the `visibleObjectIds` convention in the same
  function and is the safe direction: the alternative would be to assume a handle we did not create is
  already showing the store's model.
- **`syncStyles` ordering**: `setModel` repaints with the evaluator the mesh already holds, so a merge
  that changes rule colours is correct after `syncLayers` alone; `syncStyles` runs right after it in
  `NavaraViewport` anyway and is memoised on rule identity, so there is no double repaint.
- **Streaming layers** get nothing: `syncLayers` skips them, and `StreamInteractionHandle` has no
  `setModel` — their attributes live in the worker-side resident model. A processing tool writing back
  to a streaming layer is out of scope for this seam.
- `npx vp check` was not run separately; the pre-commit hook's `vp staged` (`vp check --fix` over the
  11 staged files) ran and its rewrite is inside the commit, re-verified green afterwards.

## Concerns

1. **The DuckDB layer table does not learn the new column.** `installLayerTableLifecycle` diffs layer
   IDs (and stream commit versions); nothing watches `layer.model` identity, so `mergeAttributes` does
   NOT rebuild the layer table. A later task in this milestone has to enqueue a rebuild (or add the
   column) for a computed attribute to be queryable/exportable through `src/insights`. Expected at
   this task's scope, but it is the obvious follow-on.
2. **`TablePanel` / `ExportDialog` read `activeLayer.model.objects` directly**, so they DO pick the
   merged attributes up on the next render — which means the grid and the DuckDB table can disagree
   until concern 1 is addressed.
3. **Nothing is persisted.** Snapshot schema v4 is untouched, so computed attributes are lost on
   save/restore (per the milestone's "nothing new is persisted" constraint).
4. **The submodule is left on branch `processing-setmodel`**, whose tip equals `origin/main`. If the
   controller prefers the pin detached or on `main`, `git -C packages/cityjson-navara-plugins switch
main && git reset --hard a890c63` (or a plain detached checkout of `a890c63`) is a no-op for the
   recorded gitlink.
5. **The parent commit was not pushed**, per instructions.

---

## Fix report — post-self-review verification

Two gaps the first pass had not actually verified (both raised in review; neither needed a code change).

### 1. Repo-wide sweep for other static handle fakes — EMPTY

The original `setModel: vi.fn()` additions came from a grep over a hand-typed file list, which is not
proof. A repo-wide sweep for any other static `CityModelHandle` fake:

```
grep -rln "setVisibleObjectIds: vi.fn\|setHiddenTypes: vi.fn\|setThemeStyle: vi.fn\|setLod: vi.fn" \
  tests src --include='*.ts' --include='*.tsx' | grep -v -e handleSync -e navaraViewport
```

returned NOTHING — every static city-model handle fake in the repo lives in the eight `handleSync*` /
`navaraViewport*` files already covered. No amend commit was needed.

### 2. Full app suite and repo-wide `vp check`

Full suite (background run, the same thing the pre-push hook executes):

```
npx vitest run
 Test Files  5 failed | 216 passed | 1 skipped (222)
      Tests  38 failed | 2623 passed | 20 skipped (2681)
```

All 38 failures are in five files — `tests/unit/features/debug/shadowQualityPreference.test.ts`,
`tests/unit/features/theme/useTheme.test.ts`, `tests/unit/persistence/localStorage.test.ts`,
`tests/unit/ui/header/PreferencesMenu.test.tsx`, `tests/unit/ui/workspaces/WorkspacesPage.test.tsx` —
and are a PRE-EXISTING environment failure on this host, not a regression from this task:

- every one of them fails with `TypeError: Cannot read properties of undefined (reading 'clear')` on
  `localStorage`, under Node 24's `ExperimentalWarning: localStorage is not available because
--localstorage-file was not provided` (printed once per worker);
- none of the five imports `layerStore` or `handleSync` (verified by grep), so nothing this task
  touched is reachable from them;
- the failure reproduces under the hook's own command, `npx vp test run
tests/unit/features/debug/shadowQualityPreference.test.ts` → 7 failed, so it is not an artefact of
  invoking `npx vitest run` directly either.

The 41 files / 727 tests that DO cover this task (`tests/unit/features/layers`, `tests/unit/scene`)
all pass, as does the submodule's own 12 files / 173 tests.

`npx vp check` (the other half of pre-push):

```
error: Formatting issues found
index.html (803ms)
Found formatting issues in 1 file
```

**The one failure is `index.html`, which is NOT part of this task** — it carries a pre-existing
uncommitted edit that belongs to someone else and was never staged or touched here. Every file this
task changed passes `vp check`. Note for the controller: `vp check` (and therefore the pre-push hook)
will keep failing on `index.html` until its owner formats or reverts it. Nothing in this task can or
should fix that.

Conclusion: the implementation is unchanged from the first pass; the two verifications above simply
confirm it. Concerns 1-5 above stand as written, with the `index.html` formatting failure added as a
push-time blocker that is not this task's to resolve.
