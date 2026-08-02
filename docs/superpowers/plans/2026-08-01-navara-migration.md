# Navara Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Three.js + React Three Fiber rendering layer of multiroof-viewer with the Navara map engine, with CityJSON/FlatCityBuf support implemented as reusable Navara plugins in the `cityjson-navara-plugins` monorepo (git submodule at `packages/cityjson-navara-plugins`).

**Architecture:** Custom Navara `MeshDesc` plugins carry the existing renderer-agnostic geometry pipeline (`CityMeshArrays` typed arrays) onto Navara's globe via per-layer ENU frames; a thin imperative `NavaraViewport` React component replaces `CitySceneR3F` behind the unchanged `CitySceneHandle` contract; the FCB streaming engine moves into `@cityjson/navara-flatcitybuf` re-driven by Navara camera events.

**Tech Stack:** Navara `@navaramap/three` + `@navaramap/three-default-plugin` 0.0.5 (exact), three 0.183.2 (exact), postprocessing 6.39.0 (exact), React 19, Zustand, pnpm workspaces + tsup + vitest (plugin repo), npm + Vite (app repo), proj4.

**Spec:** `docs/superpowers/specs/2026-08-01-navara-migration-design.md` — the final authority for scope. **Research:** `docs/superpowers/research/2026-08-01-navara-api-report.md`, `docs/superpowers/research/2026-08-01-rendering-surface-inventory.md`.

**Task order:** A1–A14 (M7.1 + M7.2, with A13b inserted before A14), B1–B16 (M7.3 + M7.4, with B11 split into B11a/B11b), C1–C26 (M7.5–M7.7, with C4b inserted before C5 and C10 split into C10a/C10b). Task C2 from the drafted Part C now runs as **Task A13b**; there is no Task C2. **59 tasks total** (15 in Part A, 17 in Part B, 27 in Part C).

## Global Constraints

Every task in this plan obeys these; they are not repeated per task.

**Repos and package managers**

- App repo root: `/data2/hideba/multiroof-viewer`, branch `develop` (never commit to `main`). Package manager **npm**.
- Plugin repo: `git@github.com:HideBa/cityjson-navara-plugins.git` (private, SSH only — `gh` is unavailable), consumed as a git submodule at `packages/cityjson-navara-plugins`. Package manager **pnpm** (`corepack enable pnpm` once).
- Corepack refuses to run `pnpm` when the nearest `package.json` (the app's) pins npm, so **always run pnpm from inside the submodule directory**: `(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm …)` — never `pnpm -C` from the app root.
- Bash cwd resets between tool calls: use absolute paths or `git -C`.

**Verification commands**

- App type check: `npx tsc -b --noEmit` (plain `tsc --noEmit` is a no-op here — the root tsconfig has no files, only project references).
- App tests: `npx vitest run`. Baseline before Task A1: **62 test files, 743 tests, all passing**.
- Plugin type check: `pnpm typecheck` (= `tsc -b`). Plugin build: `pnpm build` (= `pnpm -r build`). Plugin tests: `pnpm vitest run`.
- The plugin repo's root vitest config (Task A5) collects `packages/*/tests/**/*.test.ts` and defines **no** `projects`, so run a subset by path (`pnpm vitest run packages/navara-flatcitybuf/tests/tileGrid.test.ts`), not with `--project`.
- Browser verification uses `agent-browser` against `npm run dev` (http://localhost:5173), per repo convention. Navara needs real WebGL + WASM, so end-to-end checks are browser smokes, not jsdom tests.

**Testing conventions**

- **Every** test file in both repos imports from `"vitest"` — never `"vite-plus/test"` (that runner has a `describe` bug; see CLAUDE.md).
- TDD per task: write the failing test, run it and see the expected failure, implement, re-run.
- Plugin unit tests never import `@navaramap/*` (WASM at module scope); engine seams are injected or faked (Task B2's `FakeThreeView`). This is enforced structurally, not by convention: in every plugin package the `@navaramap/*` imports live only in named **engine-binding modules** — `navara-cityjson/src/CityModelMeshDesc.ts`, `navara-cityjson/src/CityMeshArraysDesc.ts`, `navara-cityjson/src/CityJSONPlugin.ts`, `navara-flatcitybuf/src/engineRays.ts`, `navara-flatcitybuf/src/plugin.ts`. Every other module is engine-free and receives what it needs (descriptor classes, pick-ray function, mesh factory) as a constructor/argument seam. Test files import the engine-free module directly (`../src/cityModelRegistry`), never the package barrel (`../src/index`), which re-exports the binding modules. Task B1 Step 8 records whether a Node import of `@navaramap/three` is actually side-effect-free; the structure above holds either way.
- Float32Array assertions use exactly representable values (0.25, 0.5, 1) with `toEqual`, or `toBeCloseTo` otherwise — values like 0.1/0.2 round on storage.

**Commits**

- Prefixes `feat:` / `fix:` / `docs:` / `refactor:` / `test:`; every commit message ends with the trailing line `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`.
- Small, incremental commits — one feature/fix per commit.
- **Submodule-first protocol:** commit inside `packages/cityjson-navara-plugins` first, push it (`git -C packages/cityjson-navara-plugins push origin main`), then stage the submodule pointer plus any app-side files in the parent repo and commit that. The app's pre-commit hook (`vp check --fix`) runs only on the parent commit and only touches app files; the submodule has no hooks (run `pnpm -r lint` there before committing).
- Run `npx tsc -b --noEmit` before every app commit.
- Run the `feature-dev:code-reviewer` agent (high effort) before committing at each milestone boundary (Tasks A14, B16, C26), per CLAUDE.md.

**Dependency pins (exact, no carets)**

- `three@0.183.2`, `postprocessing@6.39.0`, `@types/three@0.183.1` — chosen to satisfy Navara's `three >= 0.183` / `postprocessing >= 6.38` peer ranges deterministically, and to close the repo's "unpinned three" known issue.
- `@navaramap/three@0.0.5`, `@navaramap/three-default-plugin@0.0.5`, `@navaramap/three-default-descs@0.0.5` — exact, because the engine is alpha with no public changelog. Plugin packages declare them as **peer** dependencies (plus identical exact devDependencies) so the host app supplies a single engine instance; two copies would break `instanceof` checks and descriptor registration.
- Plugin repo tooling: pnpm `10.18.0`, TypeScript `5.9.3`, tsup `8.5.0`, vitest `3.2.4`.

**Risk gate**

- Spec §8 risks (MRT + per-vertex colors; picking granularity; WASM/asset bundling under Vite) are resolved by **Task B1, a decision checkpoint**. If `MRT_VERTEX_COLORS_OK` is false, stop and re-plan against the documented `ShaderMaterial` fallback; if neither pick path resolves a triangle, stop and re-plan against the RTE-aware alternative. `PICK_PATH = "own-raycast"` is a supported outcome, not a failure.
- The B1 verdict is carried forward as a **typed capability**, not prose: `PickStrategy = "pickable-wrapper" | "own-raycast"` is declared in `@cityjson/navara-cityjson/src/pickStrategy.ts` (Task B6) and passed to `new CityJSONPlugin({ pickStrategy })` / `new FlatCityBufPlugin({ pickStrategy })`. Tasks B6/B7/C8 branch on that value; no task reads the findings markdown at runtime.
- Vite worker/WASM packaging for the plugin packages is resolved by **Task C4b**, a second bundling gate that runs before the FCB worker moves (Task C5). If the worker URL form does not survive `npm run build` + `vite preview`, stop and re-plan C5's worker packaging.
- Breaking changes are acceptable (project philosophy): no migration shims, no backward-compatible snapshots.

**Vertical datum (decided)**

- CityJSON z is almost always an **orthometric** height above a local vertical datum (NAP for EPSG:7415), while the ENU frame is built on the WGS84 **ellipsoid**. Placing raw z as an ellipsoidal height puts a Delft model ≈43 m below the photorealistic terrain, so every vertex's geodetic height gets `+ heightOffset` metres during the ENU transform (`projectPositionsToEnu`, Task A13b).
- `heightOffset` is **sampled from a real geoid model**, not a per-CRS constant: `geoidHeightAt(lng, lat)` in `@cityjson/navara-core` reads EGM2008 geoid undulation from the Re:Earth Terrain service (`https://terrain.reearth.land/mapbox/geoid/tilejson.json`), which is global, needs no API key, and serves Terrain-RGB raster tiles. `ellipsoidal = orthometric + undulation`, so the sampled undulation _is_ the offset.
- Both `addCityModel` and `openStream` still take a user-supplied `heightOffset?: number`, which wins outright. When it is omitted the plugin resolves it asynchronously per layer (Tasks B7/C11) and applies it to the layer/cell ENU frame.
- **Attribution is mandatory** wherever the geoid service is used: CC BY 4.0 Mapterhorn and ODbL OpenStreetMap. Task C17 puts it in the app's attribution overlay next to the Google Tiles credit.
- **Best effort, no SLA.** A failed fetch falls back to `0` with a single `console.warn` per layer — the model then renders at its old, ≈43 m-low position rather than not at all (offline/dev case). Residual error when the fetch succeeds is decimetre-level (EGM2008 vs NAP), documented in Task C24.
- _(Not in scope, noted for later:)_ the same Re:Earth Terrain service also publishes quantized-mesh terrain tiles compatible with Navara's native `quantized-mesh` source, which would be a drop-in alternative to the default terrain — a future option, no task in this plan.

## Shared Interface Contract

These shapes are authoritative for every task below. Where a drafted part said
something different, this section wins.

**Per-surface styling (exported by `@cityjson/navara-core`, Task A12):**

```ts
export interface SurfaceInfo {
  readonly surfaceIndex: number;
  readonly surface: Surface;
}
export interface CityObjectInfo {
  readonly objectId: string;
  readonly object: CityObject;
}
/** Returns a linear-sRGB color triple, or null to keep the base surface color. */
export type SurfaceStyleEvaluator = (
  surface: SurfaceInfo,
  object: CityObjectInfo,
) => readonly [number, number, number] | null;
```

There is no third `ctx` argument (both `objectId` and `surfaceIndex` already
live on the first two arguments) and there is no `StyleColor`/`toHex()`
indirection: vertex-color buffers consume the raw linear floats directly, so
no task performs a hex round trip, and core stays engine-free (it can never
reference Navara's `Color`).

**Rules and roof metrics (exported by `@cityjson/navara-core`, Task A12):**

```ts
export type ConditionOperator = ">" | "<" | "=" | ">=" | "<=";
export interface Condition {
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly value: number | string | boolean;
}
export type LogicMode = "AND" | "OR";
export interface Rule {
  readonly id: string;
  readonly name: string;
  /** CSS hex color, e.g. "#4ec84e". */
  readonly color: string;
  readonly conditions: ReadonlyArray<Condition>;
  readonly logic: LogicMode;
  readonly enabled: boolean;
}
export function evaluateCondition(v: unknown, c: Condition): boolean;
export function evaluateRule(
  attributes: Readonly<Record<string, unknown>>,
  metrics: RoofMetrics,
  rule: Rule,
): boolean;
/** First enabled matching rule's color hex, or null. */
export function matchRule(
  attributes: Readonly<Record<string, unknown>>,
  metrics: RoofMetrics,
  rules: ReadonlyArray<Rule>,
): string | null;

export interface RoofMetrics {
  readonly areaSqM: number;
  readonly inclinationDeg: number;
  readonly azimuthDeg: number;
  readonly elevationM: number;
}
export function computeRoofMetrics(surface: Surface): RoofMetrics;
export function computeFootprintArea(obj: CityObject): number | null;
```

The rule **schema** and its **evaluation** live in core because the FCB worker
bakes rule colors off the main thread (`fcb.worker.ts` →
`buildRuleColorsFromArrays`) and `workerProtocol.ts` puts `Rule[]` and
`RoofMetrics[]` on the wire; a worker inside `@cityjson/navara-flatcitybuf`
can never import from the app. The app keeps everything _around_ the schema:
the rule-editing UI (`RuleBuilderTab`), the presets (`src/features/rules/presets.ts`),
the per-layer rule state on `layerStore`, and the app-side
`compileRulesToEvaluator` glue (Task B14). App modules keep importing at their
old paths through re-export shims, exactly like the other Part A moves.

**Interaction registries (Tasks B10/B15/C13):** picking, highlighting,
`fitAll`/`fitLayer` and the triangle readout iterate **both** registries —
static `CityModelHandle`s in `liveRef` and streaming `FcbStreamLayerHandle`s
in `streamsRef`. Both satisfy the same four members (`setHighlight`,
`resolvePick`, `getBoundsGeodetic`, `triangleCount`), declared once as
`InteractionHandle` in `src/scene/handleSync.ts`. Only _styling_ differs
between them (see **Streaming styling** below).

**ENU frames (exported by `@cityjson/navara-core`, Task A13b):**

```ts
export interface EnuFrame {
  readonly lngDeg: number;
  readonly latDeg: number;
  readonly heightM: number;
  readonly originEcef: readonly [number, number, number];
  /** Column-major 4x4, ENU(metres) -> ECEF(metres). */
  readonly matrix: Float64Array;
}
export function makeEnuFrame(
  lngDeg: number,
  latDeg: number,
  heightM: number,
): EnuFrame;
```

`enuFrame.ts` lives in core and is the **only** frame implementation. Static
layers reach it through `placementMatrixFromLle` (Task B4); streaming cells
reach it through `cellFrame` (Task C8). No task calls Navara's
`eastNorthUpToFixedFrame`/`geodeticToVector3` for placement — only the Task B1
spike touches those, and only to probe the engine.

**Per-cell mesh primitive (exported by `@cityjson/navara-cityjson`, Task B7):**

```ts
export interface CityMeshHandle {
  readonly ref: unknown;
  /** The engine-free behaviour object (raycast, colors, visibility). */
  readonly mesh: CityMeshArraysMesh;
  setColors(colors: Float32Array): void;
  setVisible(v: boolean): void;
  triangleCount(): number;
  /** index = engine batch id, entry = (objectIndex, surfaceIndex). */
  batchIdMap(): ReadonlyArray<{
    readonly objectIndex: number;
    readonly surfaceIndex: number;
  }>;
  delete(): void;
}
export function addCityMeshArrays(
  view: ThreeView,
  opts: {
    id: string;
    arrays: CityMeshArrays;
    frame: EnuFrame;
    pickStrategy?: PickStrategy;
  },
): CityMeshHandle;
```

`CityModelHandle` (spec §3) is a composition over the same machinery; the
streaming plugin builds one `CityMeshHandle` per resident cell (Task C8).

**`CityModelHandle` (spec §3, concretized):**

```ts
interface CityModelHandle {
  readonly id: string;
  setVisible(v: boolean): void;
  setLod(lod: string): void;
  setStyle(evaluator: SurfaceStyleEvaluator | null): void;
  setHighlight(sel: readonly Selection[], hovered?: Selection): void;
  resolvePick(pick: PickedFeatureLike | ScreenPoint): Selection | null;
  getBoundsGeodetic(): GeodeticBounds;
  triangleCount(): number;
  delete(): void;
}
```

`resolvePick` always returns a `SurfaceSelection` (`kind: "surface"`); the app
narrows it to an `ObjectSelection` per `PickMode` (Task B12), mirroring
today's pick-mode-agnostic `src/scene/resolvePicking.ts`.

**`CitySceneHandle` (app, Task B11a):**

```ts
interface CitySceneHandle {
  fitAll(): void;
  fitLayer(layerId: string): void;
  alignView(direction: ViewDirection): void;
  getCameraState(): GeographicCameraState | null;
  setCameraState(state: GeographicCameraState): void;
  readonly ready: Promise<void>;
  /** Added in Task C13: resolves after `ready`, so an FCB open requested on
   *  first render queues instead of dereferencing a null plugin ref. */
  getStreamingPlugin(): Promise<FlatCityBufPlugin>;
}
```

`GeographicCameraState = { lng; lat; height; heading; pitch; roll }`.

`ready` is **resolve-or-reject**, never a hang and never a silent `null`:

- it **resolves** once `ThreeView.init()` has settled and every plugin in the
  session's ordered list is registered and live;
- it **rejects** with the underlying error if `view.init()` throws (WASM/asset
  failure, WebGL unavailable). Task B8 records the error and rethrows instead
  of collapsing it to `null`; Task B11a surfaces it as an in-viewport error
  panel and rejects `ready` with the same error;
- a StrictMode dispose-before-init is _not_ a failure: the session rejects it
  with `NavaraSessionDisposedError`, which Task B11a swallows (the remount's
  session resolves the same `ready`).

Every consumer therefore awaits it inside `try`/`catch`. Task C20 awaits it
instead of App.tsx's 100 ms `setTimeout`, and first waits for the viewport ref
to exist (an effect keyed on ref mount) so a share-hash arriving before mount
cannot skip restoration by seeing `sceneRef.current === null`.

Persistence stores the
geographic camera in two 3-tuples only until M7.6, bridged by the temporary
`src/scene/cameraStateBridge.ts` (Task B9), which Task C20 deletes when
snapshot v3 lands.

**Selection types:** `Selection`, `ObjectSelection`, `SurfaceSelection`,
`PickMode`, `ScreenPoint` and `PickedFeatureLike` are declared once, in
`@cityjson/navara-cityjson/src/selection.ts` (Task B5), structurally identical
to the app's `src/domain/selection/types.ts` (which stays unchanged so the
plugin never depends on the app). Every other plugin package — including
`@cityjson/navara-flatcitybuf` — imports them from `@cityjson/navara-cityjson`
rather than redeclaring them.

**Streaming styling:** streaming layers bypass `SurfaceStyleEvaluator`
entirely. Rule colors for streaming cells are baked in the worker from the
`Rule[]` wire payload, so the app branches:
`layer.isStreaming ? handle.setRules(rules, enabled) : handle.setStyle(evaluator)`
(Task C13). `syncLayers`/`syncStyles` (Tasks B10/B15) deliberately skip
streaming layers. This is the **only** capability that differs: streaming
layers are full participants in picking, highlighting, fit and the triangle
readout via the `InteractionHandle` registry above (Tasks C10b/C13).

## File Structure

### M7.1–M7.2 (plugin monorepo scaffold + domain move)

#### Submodule: `packages/cityjson-navara-plugins/`

| Path                                                                                   | Responsibility                                                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `package.json`                                                                         | pnpm workspace root: `packageManager`, `-r` build script, root vitest/tsc scripts        |
| `pnpm-workspace.yaml`                                                                  | Declares `packages/*` as workspace members                                               |
| `.npmrc`                                                                               | `link-workspace-packages=true`, `strict-peer-dependencies=false`                         |
| `tsconfig.base.json`                                                                   | Shared strict compiler options + `paths` mapping `@cityjson/navara-*` → package `src/`   |
| `tsconfig.json`                                                                        | Solution file: `files: []` + project references to all four packages                     |
| `vitest.config.ts`                                                                     | Root vitest config (node env, `packages/*/tests/**`, package-name aliases)               |
| `LICENSE`                                                                              | MIT license text                                                                         |
| `README.md`                                                                            | What the monorepo is, how to build/test, how the app consumes it                         |
| `.gitignore`                                                                           | Adds `dist/`, `dist-types/`, `*.tsbuildinfo` to the pre-existing Node ignore file        |
| `.github/workflows/ci.yml`                                                             | CI: install → build → typecheck → test on push/PR                                        |
| `packages/navara-core/package.json`                                                    | `@cityjson/navara-core` manifest (no navara dep; `three` peer, `proj4` dep)              |
| `packages/navara-core/tsconfig.json`                                                   | Composite project for core                                                               |
| `packages/navara-core/tsup.config.ts`                                                  | ESM + d.ts build of `src/index.ts`                                                       |
| `packages/navara-core/src/index.ts`                                                    | Public barrel of the core package                                                        |
| `packages/navara-core/src/citymodel/types.ts`                                          | Format-agnostic `CityModel`/`CityObject`/`Surface`/`Vec3`/`BBox3` types (moved)          |
| `packages/navara-core/src/citymodel/supportedEncodings.ts`                             | Encoding enum + priority helpers (moved)                                                 |
| `packages/navara-core/src/citymodel/cityjson/types.ts`                                 | Raw CityJSON v2 wire types (moved)                                                       |
| `packages/navara-core/src/citymodel/cityjson/parseHelpers.ts`                          | Dequantize/bbox-merge/object/metadata parse helpers (moved)                              |
| `packages/navara-core/src/citymodel/cityjson/parseCityJSON.ts`                         | CityJSON → `CityModel` parser (moved)                                                    |
| `packages/navara-core/src/citymodel/cityjsonseq/types.ts`                              | `CityJSONFeature` type (moved)                                                           |
| `packages/navara-core/src/citymodel/cityjsonseq/parseCityJSONSeq.ts`                   | CityJSONSeq → `CityModel` parser (moved)                                                 |
| `packages/navara-core/src/citymodel/crsProjDefs.ts`                                    | proj4 EPSG definition registration (`ensureProjDef`, moved)                              |
| `packages/navara-core/src/styling/surfaceColors.ts`                                    | Surface-type color map: hex values, CSS hex, linear-sRGB triples                         |
| `packages/navara-core/src/styling/srgb.ts`                                             | `srgbHexToLinear` (moved) + channel conversion                                           |
| `packages/navara-core/src/styling/buildStyleColors.ts`                                 | `SurfaceStyleEvaluator` hook types + `buildStyleColorsFromArrays` (generalized from app) |
| `packages/navara-core/src/geometry/buildCityMeshArrays.ts`                             | `buildCityMeshArrays`, triangulation, face normals, `computeOriginOffset` (moved)        |
| `packages/navara-core/src/rules/types.ts`                                              | `Rule`/`Condition`/`LogicMode`/`ConditionOperator` schema (moved from the app)           |
| `packages/navara-core/src/rules/evaluate.ts`                                           | `evaluateCondition`/`evaluateRule`/`matchRule` (moved from the app)                      |
| `packages/navara-core/src/roofMetrics/types.ts`                                        | `RoofMetrics` (moved from the app)                                                       |
| `packages/navara-core/src/roofMetrics/metrics.ts`                                      | `computeRoofMetrics` + the Newell primitives (moved from the app)                        |
| `packages/navara-core/src/roofMetrics/footprint.ts`                                    | `computeFootprintArea` (moved out of the app's `domain/geometry/derived.ts`)             |
| `packages/navara-core/src/geo/sourceToEnu.ts`                                          | Exact source-CRS → local-ENU vertex transform (Task A13b)                                |
| `packages/navara-core/src/geo/geoidHeight.ts`                                          | EGM2008 geoid undulation sampling from the Re:Earth Terrain service (Task A13b)          |
| `packages/navara-core/src/picking/types.ts`                                            | `PickingIndex`, `PickResult` picking-index types (moved)                                 |
| `packages/navara-core/tests/…`                                                         | Moved unit tests (see per-task Files sections)                                           |
| `packages/navara-core/fixtures/two-buildings.city.json`                                | Copy of the app fixture used by geometry tests                                           |
| `packages/navara-core/fixtures/two-buildings.city.jsonl`                               | Copy of the app fixture used by the CityJSONSeq parser test                              |
| `packages/navara-cityjson/{package.json,tsconfig.json,tsup.config.ts,src/index.ts}`    | Stub for the CityJSON Navara plugin (M7.3)                                               |
| `packages/navara-flatcitybuf/{package.json,tsconfig.json,tsup.config.ts,src/index.ts}` | Stub for the streaming plugin (M7.5)                                                     |
| `packages/navara-cityparquet/{package.json,tsconfig.json,tsup.config.ts,src/index.ts}` | Permanent stub (out of scope for this migration)                                         |

#### App repo

| Path                                                               | Change                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `.gitmodules`                                                      | Created — submodule entry for `packages/cityjson-navara-plugins`                                              |
| `package.json`                                                     | `file:` deps for the four plugin packages, exact `@navaramap/*` 0.0.5, pinned `three`                         |
| `vite.config.ts`                                                   | `resolve.alias` package-name → plugin `src/`; `packages` added to lint/fmt ignore patterns                    |
| `tsconfig.app.json`                                                | `baseUrl` + `paths` mapping `@cityjson/navara-*` → plugin `src/index.ts`                                      |
| `src/domain/citymodel/types.ts`                                    | Becomes a re-export shim over `@cityjson/navara-core`                                                         |
| `src/domain/citymodel/supportedEncodings.ts`                       | Re-export shim                                                                                                |
| `src/domain/citymodel/cityjson/types.ts`                           | Re-export shim                                                                                                |
| `src/domain/citymodel/cityjson/parseHelpers.ts`                    | Re-export shim                                                                                                |
| `src/domain/citymodel/cityjson/parseCityJSON.ts`                   | Re-export shim                                                                                                |
| `src/domain/citymodel/cityjsonseq/types.ts`                        | Re-export shim                                                                                                |
| `src/domain/citymodel/cityjsonseq/parseCityJSONSeq.ts`             | Re-export shim                                                                                                |
| `src/domain/citymodel/crsProjDefs.ts`                              | Re-export shim                                                                                                |
| `src/shared/surfaceColorMap.ts`                                    | Re-export shim                                                                                                |
| `src/scene/surfaceColors.ts`                                       | **Deleted** (its only consumer moves to core)                                                                 |
| `src/scene/buildCityMesh.ts`                                       | Reduced to the `BufferGeometry` wrapper; re-exports the moved core symbols                                    |
| `src/scene/applyRuleColors.ts`                                     | Rules→`SurfaceStyleEvaluator` adapter over core; re-exports `srgbHexToLinear`                                 |
| `src/features/rules/types.ts`                                      | Re-export shim over `@cityjson/navara-core` (`Rule` et al.)                                                   |
| `src/features/rules/evaluate.ts`                                   | Re-export shim (`evaluateCondition`/`evaluateRule`/`matchRule`)                                               |
| `src/domain/roofMetrics/types.ts`                                  | Re-export shim (`RoofMetrics`)                                                                                |
| `src/domain/roofMetrics/metrics.ts`                                | Re-export shim (`computeRoofMetrics` + Newell primitives)                                                     |
| `src/domain/geometry/derived.ts`                                   | Keeps `computeTotalRoofArea`/`computeVolume`/`computeSolarScore`; re-exports `computeFootprintArea` from core |
| `tests/unit/features/rules/evaluate.test.ts`                       | **Deleted** (moved to plugin repo)                                                                            |
| `tests/unit/domain/roofMetrics/metrics.test.ts`                    | **Deleted** (moved to plugin repo)                                                                            |
| `tests/unit/domain/citymodel/supportedEncodings.test.ts`           | **Deleted** (moved to plugin repo)                                                                            |
| `tests/unit/domain/citymodel/cityjson/parseCityJSON.test.ts`       | **Deleted** (moved)                                                                                           |
| `tests/unit/domain/citymodel/cityjsonseq/parseCityJSONSeq.test.ts` | **Deleted** (moved)                                                                                           |
| `tests/unit/scene/buildCityMeshArrays.test.ts`                     | Reduced to the wrapper-wiring describe (oracle describes moved)                                               |
| `tests/unit/scene/buildCityMesh.test.ts`                           | `computeOriginOffset` describe removed (moved)                                                                |
| `tests/unit/scene/ruleColorsWorkerSafe.test.ts`                    | `srgbHexToLinear` describes removed (moved); rule-adapter describes stay                                      |
| `docs/roadmap.md`                                                  | M7.1/M7.2 marked complete                                                                                     |

### M7.3–M7.4 (CityJSON plugin + viewport + interaction)

Submodule paths are relative to `packages/cityjson-navara-plugins/`.

Submodule paths are relative to `packages/cityjson-navara-plugins/`.

| File                                                                  | Responsibility                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `spike.html` (app root)                                               | Standalone spike entry page (removed in M7.7)                                                      |
| `src/spike/navaraMrtSpike.ts` (app)                                   | Spike: MRT vertex colors + pick path validation                                                    |
| `docs/superpowers/research/2026-08-01-navara-spike-findings.md` (app) | Recorded spike outcome + decision                                                                  |
| `packages/navara-cityjson/test/fakeView.ts`                           | Fake `ThreeView`/`ViewContext` test doubles (created once, reused)                                 |
| `packages/navara-cityjson/src/selection.ts`                           | Plugin-local `Selection`/`PickMode`/`ScreenPoint`/`PickedFeatureLike` types                        |
| `packages/navara-cityjson/src/cityMeshGeometry.ts`                    | `CityMeshArrays` → `BufferGeometry` (position/normal/color/objectIndex/surfaceIndex)               |
| `packages/navara-cityjson/src/enuPlacement.ts`                        | proj4 CRS → geodetic origin, ENU matrix build, `geodeticBoundsFromBBox`                            |
| `packages/navara-cityjson/src/surfaceColorLayers.ts`                  | base → rule → highlight vertex-color layering on typed arrays                                      |
| `packages/navara-cityjson/src/pickStrategy.ts`                        | `PickStrategy` typed capability carrying the Task B1 `PICK_PATH` verdict                           |
| `packages/navara-cityjson/src/cityModelMesh.ts`                       | Renderer-facing mesh object: geometry, material, LoD rebuild, style, highlight, picking            |
| `packages/navara-cityjson/src/cityModelRegistry.ts`                   | Engine-free `addCityModel`/`getHandle`/`handles` logic (descriptors + pick rays injected)          |
| `packages/navara-cityjson/src/CityModelMeshDesc.ts`                   | Navara `MeshDesc` subclass wrapping `CityModelMesh` (scene add/remove, MRT) — engine binding       |
| `packages/navara-cityjson/src/CityMeshArraysDesc.ts`                  | Navara `MeshDesc` subclass wrapping `CityMeshArraysMesh` — engine binding                          |
| `packages/navara-cityjson/src/CityJSONPlugin.ts`                      | Navara `Plugin` subclass: registers descriptors, delegates to `CityModelRegistry` — engine binding |
| `packages/navara-cityjson/src/types.ts`                               | `CityModelHandle`, `GeodeticBounds`, `AddCityModelOptions`                                         |
| `packages/navara-cityjson/src/cityMesh.ts`                            | `CityMeshArraysMesh` + `addCityMeshArrays`: the arrays+frame mesh primitive, engine-free (Task C8) |
| `packages/navara-cityjson/src/index.ts`                               | Package public exports                                                                             |
| `packages/navara-cityjson/test/*.test.ts`                             | Unit tests per module above                                                                        |
| `src/scene/NavaraViewport.tsx` (app)                                  | React viewport: session mount, store→handle effects, events, `CitySceneHandle`                     |
| `src/scene/navaraSession.ts` (app)                                    | StrictMode-safe async create/init/dispose sequencer (injectable deps)                              |
| `src/scene/geographicCamera.ts` (app)                                 | Geodetic bounds union, fit camera state, align presets (pure)                                      |
| `src/scene/cameraStateBridge.ts` (app)                                | Geographic camera state ↔ legacy snapshot tuples (temporary, deleted M7.6)                         |
| `src/scene/pickEventHandlers.ts` (app)                                | Pure pick/hover/click → `selectionStore` intent resolution                                         |
| `src/scene/cursorCrsReadout.ts` (app)                                 | Geodetic → source-CRS conversion + throttle gate (pure)                                            |
| `src/scene/handleSync.ts` (app)                                       | Pure store→handle reconciliation (layers, style, highlight, LoD, visibility, triangles)            |
| `src/features/rules/compileEvaluator.ts` (app)                        | `Rule[]` → `SurfaceStyleEvaluator`                                                                 |
| `src/app/App.tsx` (app, modified)                                     | Renders `NavaraViewport`; camera call sites use the bridge                                         |
| `vite.config.ts` (app, modified)                                      | Navara WASM/asset/dep-optimizer bundling fixes                                                     |
| `package.json` (app, modified)                                        | Pinned `@navaramap/*`, `three`, `postprocessing`; `@cityjson/navara-cityjson` file: dep            |
| `tests/unit/scene/navaraSession.test.ts`                              | StrictMode double-mount / dispose-before-init                                                      |
| `tests/unit/scene/geographicCamera.test.ts`                           | Bounds union, fit distance, align presets                                                          |
| `tests/unit/scene/cameraStateBridge.test.ts`                          | Round-trip geographic ↔ tuples                                                                     |
| `tests/unit/scene/pickEventHandlers.test.ts`                          | Hover/select/shift-toggle intents                                                                  |
| `tests/unit/scene/cursorCrsReadout.test.ts`                           | Geodetic → EPSG:7415 readout + throttle                                                            |
| `tests/unit/scene/handleSync.test.ts`                                 | Store→handle sync against a mock handle                                                            |
| `tests/unit/features/rules/compileEvaluator.test.ts`                  | Rule compilation to evaluator                                                                      |

### M7.5–M7.7 (streaming plugin, solar/tiles/persistence, teardown)

#### Created — plugin repo (`packages/cityjson-navara-plugins/`)

| Path                                                   | Responsibility                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/navara-core/src/geo/enuFrame.ts`             | WGS84 geodetic↔ECEF↔ENU math; replaces retired `sceneTransform.ts` (created earlier, in **Task A13b**, because Tasks B4/B6 place static layers with it) |
| `packages/navara-core/src/geo/sourceToEnu.ts`          | Exact per-vertex source-CRS → local-ENU transform (Task A13b)                                                                                           |
| `packages/navara-core/src/geo/geoidHeight.ts`          | `geoidHeightAt()` — EGM2008 undulation sampled from the Re:Earth Terrain service (Task A13b)                                                            |
| `packages/navara-core/tests/geoidHeight.test.ts`       | Geoid sampling against an injected fetch + synthetic 2x2 Terrain-RGB tile (Task A13b)                                                                   |
| `packages/navara-core/tests/sourceToEnu.test.ts`       | Far-from-origin ECEF parity test for the exact transform (Task A13b)                                                                                    |
| `packages/navara-core/tests/enuFrame.test.ts`          | ENU frame round-trips against a proj4 EPSG:4978 oracle (Task A13b)                                                                                      |
| `packages/navara-flatcitybuf/src/constants.ts`         | Streaming tunables (verbatim move)                                                                                                                      |
| `packages/navara-flatcitybuf/src/tileGrid.ts`          | Grid/cell key math (verbatim move minus `meshOffset`)                                                                                                   |
| `packages/navara-flatcitybuf/src/cellCache.ts`         | LRU resident-cell cache (verbatim move)                                                                                                                 |
| `packages/navara-flatcitybuf/src/levelPolicy.ts`       | Level + LoD ladder policy (verbatim move)                                                                                                               |
| `packages/navara-flatcitybuf/src/throttleGates.ts`     | Hysteresis gate (verbatim move)                                                                                                                         |
| `packages/navara-flatcitybuf/src/bucketFeatures.ts`    | One-traversal cell bucketing (verbatim move)                                                                                                            |
| `packages/navara-flatcitybuf/src/objectRecords.ts`     | `ResidentObjectRecord` builder (verbatim move)                                                                                                          |
| `packages/navara-flatcitybuf/src/workerProtocol.ts`    | Wire types incl. 5-attribute `CellGeometry` (verbatim move)                                                                                             |
| `packages/navara-flatcitybuf/src/workerClient.ts`      | Promise/epoch worker wrapper (verbatim move)                                                                                                            |
| `packages/navara-flatcitybuf/src/fcb.worker.ts`        | FCB reader + per-cell decode/recolor worker (moved, imports rewired to core)                                                                            |
| `packages/navara-flatcitybuf/src/viewportFootprint.ts` | Pure ray→ground→source-CRS footprint (rewritten for Navara rays)                                                                                        |
| `packages/navara-flatcitybuf/src/navaraRays.ts`        | Engine-free: ray normalisation + 4 screen-corner rays from an injected pick-ray fn + size provider                                                      |
| `packages/navara-flatcitybuf/src/engineRays.ts`        | 3-line engine binding: `@navaramap/three`'s `getPickRay` → `PickRaySource`                                                                              |
| `packages/navara-flatcitybuf/src/entryToArrays.ts`     | `CellEntry` → `CityMeshArrays` conversion consumed by the cell mesh factory (Task C10a)                                                                 |
| `packages/navara-flatcitybuf/src/commitPlanner.ts`     | `planCommit`/`commitNormal`/`commitSwap`/LoD helpers (moved from `useTileStreaming.ts`)                                                                 |
| `packages/navara-flatcitybuf/src/settleController.ts`  | Navara camera-event settle/abort state machine (rewritten)                                                                                              |
| `packages/navara-flatcitybuf/src/residentModel.ts`     | Pure merged resident model over a `CellCache`                                                                                                           |
| `packages/navara-flatcitybuf/src/cellMeshes.ts`        | Per-cell mesh handle sync (B1 source-identity resync)                                                                                                   |
| `packages/navara-flatcitybuf/src/streamLayer.ts`       | `FcbStreamLayerHandle`: commit loop, recolor (B2), status/ladder events                                                                                 |
| `packages/navara-flatcitybuf/src/plugin.ts`            | `FlatCityBufPlugin`: `openStream`, camera-driven driver, cell mesh factory, teardown — engine binding                                                   |
| `packages/navara-flatcitybuf/src/index.ts`             | Public exports                                                                                                                                          |
| `packages/navara-flatcitybuf/tests/*.test.ts`          | Ported unit tests incl. B1–B5 regressions                                                                                                               |

#### Created — app

| Path                                     | Responsibility                                                     |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `src/scene/googleTiles.ts`               | Pure Google Photorealistic 3D Tiles source/layer config for Navara |
| `tests/unit/scene/googleTiles.test.ts`   | Config unit tests (replaces `googleTilesLayer.test.ts`)            |
| `worker-spike.html` (app root)           | Task C4b worker-bundling spike page (removed at the end of C4b)    |
| `src/spike/workerBundlingSpike.ts` (app) | Task C4b spike entry driving the plugin-package worker             |

#### Modified — app

| Path                                                        | Change                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/features/streaming/streamStore.ts`                     | `StreamState` carries a plugin `handle` instead of `client`/`cache`/`lastCommit`    |
| `src/features/streaming/openStreamingLayer.ts`              | Thin wrapper over `FlatCityBufPlugin.openStream` + store registration               |
| `src/features/streaming/residentModel.ts`                   | Memo delegating to `handle.getResidentModel()`                                      |
| `src/features/streaming/useResidentSurfaces.ts`             | Takes the stream handle instead of a `WorkerClient`                                 |
| `src/ui/inspector/InspectorPanel.tsx`                       | Passes `handle` to `useObjectSurfaces`                                              |
| `src/scene/NavaraViewport.tsx`                              | Streaming layer flow, atmosphere date/time animation, Google tiles, `ready` promise |
| `src/features/solar/solarStore.ts`                          | ENU sun position from `view.atmosphere`; suncalc removed                            |
| `src/domain/geometry/derived.ts`                            | `computeSolarScore` takes an ENU (z-up) sun direction                               |
| `src/persistence/types.ts`                                  | `ViewState` = geographic camera; snapshot v3, no migration shim                     |
| `src/persistence/captureSnapshot.ts` / `restoreSnapshot.ts` | v3 capture + explicit old-version rejection                                         |
| `src/persistence/urlShare.ts`                               | `cam` field + `v: 3` gate                                                           |
| `src/app/App.tsx`                                           | Save/restore/share use geographic camera; `ready` replaces the 100 ms `setTimeout`  |
| `tests/integration/fcbStreaming.test.ts`                    | Imports the plugin's public exports                                                 |
| `package.json`                                              | R3F/@takram/3d-tiles-renderer/suncalc removed; `three`/`postprocessing` pinned      |
| `CLAUDE.md`, `docs/roadmap.md`                              | Tech stack, architecture, known issues, milestones                                  |

#### Deleted — app

`src/scene/CitySceneR3F.tsx`, `PostProcessingEffects.tsx`, `SceneEffectComposer.tsx`, `syncEffectComposerCameraSettings.ts`, `GoogleTilesLayer.tsx`, `TileCreasedNormalsPlugin.ts`, `highlightMesh.ts`, `applyRuleColors.ts`, `resolvePicking.ts`, `surfaceColors.ts`, `buildCityMesh.ts`; `src/features/streaming/{constants,tileGrid,cellCache,levelPolicy,throttleGates,bucketFeatures,objectRecords,workerProtocol,workerClient,fcb.worker,sceneTransform,viewportFootprint,useTileStreaming}.ts`; `tests/unit/scene/layerSceneMap.test.ts` (deleted earlier, in Task B11b) and `tests/unit/scene/{sceneEffectComposer,postProcessingEffects,googleTilesLayer,buildCityMesh,buildCityMeshArrays,highlightMesh,ruleColorsWorkerSafe,resolveSelection}.test.*` (Task C21 — see its deletion inventory); `tests/unit/features/streaming/{tileGrid,cellCache,levelPolicy,throttleGates,bucketFeatures,objectRecords,residentModel,workerClient,fcbWorkerCache,fcbWorkerTraversal,useTileStreaming,viewportFootprint,sceneTransform}.test.ts`; `src/scene/cameraStateBridge.ts` + `tests/unit/scene/cameraStateBridge.test.ts` (the temporary snapshot bridge from Task B9, deleted in Task C20); `spike.html` + `src/spike/navaraMrtSpike.ts` (the Task B1 spike, deleted in Task C21).

---

## M7.1 — Scaffold the plugin monorepo and wire it into the app

### Task A1: Add the plugin repo as a git submodule and fence it off from app tooling

**Files:**

- Create: `.gitmodules`
- Modify: `vite.config.ts`
- Test: (scaffolding — verification steps instead of a test cycle)

**Interfaces:**

- Consumes: nothing
- Produces: working tree at `packages/cityjson-navara-plugins` tracked as a submodule of the app repo; app lint/format ignore the submodule.

- [ ] **Step 1: Add the submodule from the SSH remote**

```bash
cd /data2/hideba/multiroof-viewer
git submodule add git@github.com:HideBa/cityjson-navara-plugins.git packages/cityjson-navara-plugins
```

Expected: `Cloning into '/data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins'...` followed by a successful clone. If SSH auth fails, stop and fix the key — `gh` is unavailable and the repo is private.

- [ ] **Step 2: Verify the submodule registration**

```bash
git -C /data2/hideba/multiroof-viewer submodule status
cat /data2/hideba/multiroof-viewer/.gitmodules
git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins log --oneline
```

Expected: one line from `submodule status` of the form ` <sha> packages/cityjson-navara-plugins (heads/main)`; `.gitmodules` contains `path = packages/cityjson-navara-plugins` and `url = git@github.com:HideBa/cityjson-navara-plugins.git`; the submodule log shows exactly one commit.

- [ ] **Step 3: Make the submodule track `main` and check out a branch**

```bash
git -C /data2/hideba/multiroof-viewer config -f .gitmodules submodule.packages/cityjson-navara-plugins.branch main
git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins checkout main
```

Expected: `Already on 'main'` (the submodule clone lands on `main`); `.gitmodules` now also contains `branch = main`.

- [ ] **Step 4: Exclude the submodule from the app's lint and format passes**

In `vite.config.ts`, change the two ignore-pattern arrays (currently identical lists without `packages`):

```ts
    ignorePatterns: ["coverage", "dist", "node_modules", "packages"],
```

(inside `lint:`) and

```ts
    ignorePatterns: ["dist", "coverage", "node_modules", "packages"],
```

(inside `fmt:`).

- [ ] **Step 5: Verify app tooling is unaffected**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing (exit 0); vitest prints `Test Files  62 passed (62)` and `Tests  743 passed (743)`. The submodule contains no `.ts` files yet and `vitest.config.ts` only includes `tests/**`, so nothing changes.

- [ ] **Step 6: Commit (parent repo only — the submodule has no new commits yet)**

```bash
cd /data2/hideba/multiroof-viewer
git add .gitmodules packages/cityjson-navara-plugins vite.config.ts
git commit -m "$(cat <<'EOF'
feat: add cityjson-navara-plugins as a submodule at packages/

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Scaffold the pnpm workspace root of the plugin monorepo

**Files:**

- Create: `packages/cityjson-navara-plugins/package.json`, `packages/cityjson-navara-plugins/pnpm-workspace.yaml`, `packages/cityjson-navara-plugins/.npmrc`, `packages/cityjson-navara-plugins/tsconfig.base.json`, `packages/cityjson-navara-plugins/tsconfig.json`, `packages/cityjson-navara-plugins/LICENSE`, `packages/cityjson-navara-plugins/README.md`
- Modify: `packages/cityjson-navara-plugins/.gitignore`
- Test: (scaffolding — verification steps instead of a test cycle)

**Interfaces:**

- Consumes: nothing
- Produces: `pnpm install` works at the monorepo root; root scripts `build`, `test`, `typecheck`.

- [ ] **Step 1: Write the workspace root manifest**

Create `packages/cityjson-navara-plugins/package.json`:

```json
{
  "name": "cityjson-navara-plugins",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "packageManager": "pnpm@10.18.0",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf packages/*/dist packages/*/dist-types packages/*/*.tsbuildinfo"
  },
  "devDependencies": {
    "@types/node": "24.9.2",
    "tsup": "8.5.0",
    "typescript": "5.9.3",
    "vitest": "3.2.4"
  }
}
```

- [ ] **Step 2: Write the workspace definition and pnpm settings**

Create `packages/cityjson-navara-plugins/pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

Create `packages/cityjson-navara-plugins/.npmrc`:

```ini
link-workspace-packages=true
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 3: Write the shared TypeScript configuration**

Create `packages/cityjson-navara-plugins/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": {
      "@cityjson/navara-core": ["packages/navara-core/src/index.ts"],
      "@cityjson/navara-cityjson": ["packages/navara-cityjson/src/index.ts"],
      "@cityjson/navara-flatcitybuf": [
        "packages/navara-flatcitybuf/src/index.ts"
      ],
      "@cityjson/navara-cityparquet": [
        "packages/navara-cityparquet/src/index.ts"
      ]
    }
  }
}
```

Note: `tsc -b` is used for **type checking only** and emits `.d.ts` into each package's gitignored `dist-types/`; the **published** `dist/` (JS + `.d.ts`) is produced by tsup. Two declaration outputs is deliberate — it keeps `composite` project references working without fighting tsup's own dts pipeline.

Create `packages/cityjson-navara-plugins/tsconfig.json` (solution file; references are added as each package is created — all four are listed now because Tasks A3/A4 create them immediately after):

```json
{
  "files": [],
  "references": [
    { "path": "./packages/navara-core" },
    { "path": "./packages/navara-cityjson" },
    { "path": "./packages/navara-flatcitybuf" },
    { "path": "./packages/navara-cityparquet" }
  ]
}
```

- [ ] **Step 4: Add MIT license and README**

Create `packages/cityjson-navara-plugins/LICENSE` with the standard MIT text, `Copyright (c) 2026 HideBa`.

Create `packages/cityjson-navara-plugins/README.md`:

````markdown
# cityjson-navara-plugins

CityJSON plugins for the [Navara](https://navara-docs.netlify.app) map engine, plus the
format-agnostic CityJSON domain code they share.

| Package                        | Status                                                    |
| ------------------------------ | --------------------------------------------------------- |
| `@cityjson/navara-core`        | CityJSON types, parsers, geometry building, styling hooks |
| `@cityjson/navara-cityjson`    | Navara plugin for static CityJSON / CityJSONSeq layers    |
| `@cityjson/navara-flatcitybuf` | Navara plugin for camera-driven FlatCityBuf streaming     |
| `@cityjson/navara-cityparquet` | Placeholder, not implemented                              |

## Development

```bash
corepack enable pnpm
pnpm install
pnpm build      # tsup: ESM + d.ts into each package's dist/
pnpm typecheck  # tsc -b (project references)
pnpm test       # vitest run
```
````

Only `@cityjson/navara-core` is engine-free. The plugin packages declare
`@navaramap/three` and `@navaramap/three-default-plugin` as **peer** dependencies
pinned to exact `0.0.5`, so the host app supplies a single engine instance.

## Consumption

`multiroof-viewer` consumes this repo as a git submodule at
`packages/cityjson-navara-plugins`, with `file:` dependencies onto the built packages
and a Vite alias onto `src/` for dev HMR.

````

- [ ] **Step 5: Extend the ignore file**

Append to `packages/cityjson-navara-plugins/.gitignore`:

```gitignore

# Build output
dist/
dist-types/
*.tsbuildinfo
````

- [ ] **Step 6: Verify the workspace installs**

```bash
corepack enable pnpm
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm install)
```

Expected: pnpm resolves and installs the four root devDependencies, prints `Done in …`, and creates `pnpm-lock.yaml` plus `node_modules/`. No workspace packages exist yet, so `packages/*` matching nothing is fine.

- [ ] **Step 7: Commit in the submodule, then bump the pointer in the app**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json tsconfig.json LICENSE README.md .gitignore
git commit -m "$(cat <<'EOF'
feat: scaffold pnpm workspace root with shared tsconfig, MIT license, README

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins
git commit -m "$(cat <<'EOF'
feat: bump plugin submodule to workspace-root scaffold

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Create the `@cityjson/navara-core` package skeleton

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-core/package.json`, `packages/cityjson-navara-plugins/packages/navara-core/tsconfig.json`, `packages/cityjson-navara-plugins/packages/navara-core/tsup.config.ts`, `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, `packages/cityjson-navara-plugins/packages/navara-core/README.md`
- Test: (scaffolding — verification steps instead of a test cycle; the first real test arrives in Task A5)

**Interfaces:**

- Consumes: `packages/cityjson-navara-plugins/tsconfig.base.json`
- Produces: package `@cityjson/navara-core@0.0.0` exporting `NAVARA_CORE_VERSION: string`; build artifacts `dist/index.js`, `dist/index.d.ts`.

- [ ] **Step 1: Write the core manifest**

Create `packages/cityjson-navara-plugins/packages/navara-core/package.json`:

```json
{
  "name": "@cityjson/navara-core",
  "version": "0.0.0",
  "description": "Format-agnostic CityJSON domain: types, parsers, geometry building, styling hooks",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run --dir tests"
  },
  "dependencies": {
    "proj4": "^2.20.8"
  },
  "peerDependencies": {
    "three": ">=0.183.0"
  },
  "devDependencies": {
    "@types/proj4": "^2.5.6",
    "three": "0.183.2",
    "tsup": "8.5.0",
    "typescript": "5.9.3",
    "vitest": "3.2.4"
  }
}
```

Rationale for the dependency split (spec §3): core is **engine-free** — it declares no `@navaramap/*` dependency at all. It keeps `three` as a _peer_ because the polygon triangulator uses `ShapeUtils`/`Vector2` (pure math, no GPU/DOM), and `proj4` as a real dependency because `crsProjDefs` registers EPSG definitions into proj4's global registry.

- [ ] **Step 2: Write the core tsconfig and tsup config**

Create `packages/cityjson-navara-plugins/packages/navara-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist-types",
    "tsBuildInfoFile": "dist-types/.tsbuildinfo"
  },
  "include": ["src", "tests"]
}
```

Create `packages/cityjson-navara-plugins/packages/navara-core/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
```

- [ ] **Step 3: Write the initial public barrel**

Create `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`:

```ts
/**
 * Public API of @cityjson/navara-core.
 *
 * Format-agnostic CityJSON domain code shared by every Navara CityJSON
 * plugin and by host applications: wire types, parsers, geometry building,
 * picking indices, and per-surface styling hooks. This package never imports
 * `@navaramap/*` — it is usable without the engine.
 */

/** Version of this package, asserted against package.json by tests/version.test.ts. */
export const NAVARA_CORE_VERSION = "0.0.0";
```

Create `packages/cityjson-navara-plugins/packages/navara-core/README.md`:

```markdown
# @cityjson/navara-core

Format-agnostic CityJSON domain code: `CityModel` types, CityJSON/CityJSONSeq parsers,
`buildCityMeshArrays` geometry building, surface color map, picking-index types, CRS proj4
definitions, and the per-surface `SurfaceStyleEvaluator` styling hook.

Engine-free: no `@navaramap/*` dependency. `three` is a peer dependency, used only for its
pure-math `ShapeUtils`/`Vector2` polygon triangulation helpers.
```

- [ ] **Step 4: Verify the package builds**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm install && pnpm --filter @cityjson/navara-core build && ls packages/navara-core/dist)
```

Expected: pnpm installs the new workspace package's deps; tsup prints `ESM dist/index.js` and `DTS dist/index.d.ts`; `ls` shows `index.js`, `index.js.map`, `index.d.ts`.

- [ ] **Step 5: Verify the type-check project reference resolves**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm exec tsc -b packages/navara-core)
```

Expected: no output (exit 0), and `packages/navara-core/dist-types/index.d.ts` exists.

- [ ] **Step 6: Commit in the submodule, then bump the pointer in the app**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: add @cityjson/navara-core package skeleton (tsup ESM + d.ts)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins
git commit -m "$(cat <<'EOF'
feat: bump plugin submodule to navara-core skeleton

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A4: Create the three plugin stub packages with pinned Navara peers

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/{package.json,tsconfig.json,tsup.config.ts,src/index.ts}`, `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/{package.json,tsconfig.json,tsup.config.ts,src/index.ts}`, `packages/cityjson-navara-plugins/packages/navara-cityparquet/{package.json,tsconfig.json,tsup.config.ts,src/index.ts}`
- Test: (scaffolding — verification steps instead of a test cycle)

**Interfaces:**

- Consumes: `@cityjson/navara-core` (`NAVARA_CORE_VERSION`)
- Produces: `@cityjson/navara-cityjson` exporting `CITYJSON_PLUGIN_PLACEHOLDER: string`; `@cityjson/navara-flatcitybuf` exporting `FLATCITYBUF_PLUGIN_PLACEHOLDER: string`; `@cityjson/navara-cityparquet` exporting `CITYPARQUET_PLUGIN_PLACEHOLDER: string`.

- [ ] **Step 1: Write the `@cityjson/navara-cityjson` manifest**

Create `packages/cityjson-navara-plugins/packages/navara-cityjson/package.json`:

```json
{
  "name": "@cityjson/navara-cityjson",
  "version": "0.0.0",
  "description": "Navara plugin rendering static CityJSON / CityJSONSeq city models",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run --dir tests"
  },
  "dependencies": {
    "@cityjson/navara-core": "workspace:*"
  },
  "peerDependencies": {
    "@navaramap/three": "0.0.5",
    "@navaramap/three-default-plugin": "0.0.5",
    "three": ">=0.183.0"
  },
  "devDependencies": {
    "@navaramap/three": "0.0.5",
    "@navaramap/three-default-plugin": "0.0.5",
    "three": "0.183.2",
    "tsup": "8.5.0",
    "typescript": "5.9.3",
    "vitest": "3.2.4"
  }
}
```

Decision recorded here: `@navaramap/*` are **peerDependencies pinned to exact `0.0.5`** (plus identical exact devDependencies so the plugin repo type-checks and tests standalone). Peer, not direct, because `ThreeView`'s descriptor/plugin registries are stateful — two copies of the engine in one bundle would break `instanceof` checks and descriptor registration.

- [ ] **Step 2: Write the `@cityjson/navara-flatcitybuf` manifest**

Create `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/package.json` — identical to Step 1 except:

```json
  "name": "@cityjson/navara-flatcitybuf",
  "description": "Navara plugin streaming FlatCityBuf city models by camera footprint",
```

and its `dependencies` block:

```json
  "dependencies": {
    "@cityjson/navara-core": "workspace:*",
    "@cityjson/flatcitybuf": "^0.3.0"
  },
```

- [ ] **Step 3: Write the `@cityjson/navara-cityparquet` manifest**

Create `packages/cityjson-navara-plugins/packages/navara-cityparquet/package.json`:

```json
{
  "name": "@cityjson/navara-cityparquet",
  "version": "0.0.0",
  "description": "Placeholder for a future CityParquet Navara plugin (not implemented)",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run --dir tests"
  },
  "dependencies": {
    "@cityjson/navara-core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "8.5.0",
    "typescript": "5.9.3",
    "vitest": "3.2.4"
  }
}
```

No `@navaramap/*` dependency: this package stays a stub for the whole migration (spec §9).

- [ ] **Step 4: Write tsconfig + tsup config for all three stubs**

For each of `navara-cityjson`, `navara-flatcitybuf`, `navara-cityparquet`, create `packages/cityjson-navara-plugins/packages/<pkg>/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist-types",
    "tsBuildInfoFile": "dist-types/.tsbuildinfo"
  },
  "include": ["src", "tests"],
  "references": [{ "path": "../navara-core" }]
}
```

and `packages/cityjson-navara-plugins/packages/<pkg>/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: [
    "@navaramap/three",
    "@navaramap/three-default-plugin",
    "three",
    "@cityjson/navara-core",
  ],
});
```

(For `navara-cityparquet` use the same file — listing externals it does not import is harmless.)

- [ ] **Step 5: Write the three stub entry points**

Create `packages/cityjson-navara-plugins/packages/navara-cityjson/src/index.ts`:

```ts
/**
 * @cityjson/navara-cityjson — Navara plugin for static CityJSON / CityJSONSeq
 * layers. Implemented in milestone M7.3; this entry point is a placeholder so
 * the package builds, type-checks, and can be wired into the host app early.
 */
import { NAVARA_CORE_VERSION } from "@cityjson/navara-core";

export const CITYJSON_PLUGIN_PLACEHOLDER = `@cityjson/navara-cityjson (core ${NAVARA_CORE_VERSION})`;
```

Create `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/index.ts`:

```ts
/**
 * @cityjson/navara-flatcitybuf — Navara plugin for camera-driven FlatCityBuf
 * streaming. Implemented in milestone M7.5; this entry point is a placeholder
 * so the package builds, type-checks, and can be wired into the host app early.
 */
import { NAVARA_CORE_VERSION } from "@cityjson/navara-core";

export const FLATCITYBUF_PLUGIN_PLACEHOLDER = `@cityjson/navara-flatcitybuf (core ${NAVARA_CORE_VERSION})`;
```

Create `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/index.ts`:

```ts
/**
 * @cityjson/navara-cityparquet — placeholder. CityParquet support is out of
 * scope for the Navara migration (see spec §9); this package exists so the
 * monorepo layout and the host app's dependency wiring are final.
 */
import { NAVARA_CORE_VERSION } from "@cityjson/navara-core";

export const CITYPARQUET_PLUGIN_PLACEHOLDER = `@cityjson/navara-cityparquet (core ${NAVARA_CORE_VERSION})`;
```

- [ ] **Step 6: Verify the whole workspace installs, builds, and type-checks**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm install && pnpm build && pnpm typecheck)
```

Expected: pnpm links `@cityjson/navara-core` into the three stubs and downloads `@navaramap/three@0.0.5` + `@navaramap/three-default-plugin@0.0.5`; `pnpm -r build` runs core first (topological order) and prints four `DTS ⚡️ Build success` lines; `tsc -b` prints nothing.

- [ ] **Step 7: Commit in the submodule, then bump the pointer in the app**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-cityjson packages/navara-flatcitybuf packages/navara-cityparquet pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: add navara-cityjson, navara-flatcitybuf, navara-cityparquet stubs

@navaramap/three and @navaramap/three-default-plugin are peer deps pinned to
exact 0.0.5 so the host app supplies a single engine instance.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins
git commit -m "$(cat <<'EOF'
feat: bump plugin submodule to four-package layout

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A5: Add the root vitest harness, the first core test, and GitHub Actions CI

**Files:**

- Create: `packages/cityjson-navara-plugins/vitest.config.ts`, `packages/cityjson-navara-plugins/packages/navara-core/tests/version.test.ts`, `packages/cityjson-navara-plugins/.github/workflows/ci.yml`
- Test: `packages/cityjson-navara-plugins/packages/navara-core/tests/version.test.ts`

**Interfaces:**

- Consumes: `NAVARA_CORE_VERSION` from `@cityjson/navara-core`
- Produces: `pnpm test` at the monorepo root collects `packages/*/tests/**/*.test.ts` with the `@cityjson/navara-*` aliases resolved to package `src/`.

- [ ] **Step 1: Write the failing test**

Create `packages/cityjson-navara-plugins/packages/navara-core/tests/version.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NAVARA_CORE_VERSION } from "../src/index";

describe("@cityjson/navara-core package identity", () => {
  it("exports a version string matching package.json", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf-8"),
    ) as { name: string; version: string };
    expect(manifest.name).toBe("@cityjson/navara-core");
    expect(NAVARA_CORE_VERSION).toBe(manifest.version);
  });

  it("is importable through its package name alias", async () => {
    const mod = await import("@cityjson/navara-core");
    expect(mod.NAVARA_CORE_VERSION).toBe(NAVARA_CORE_VERSION);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run)
```

Expected failure: `No test files found` (there is no root vitest config yet, so the default `include` does not reach `packages/*/tests`), exit code 1.

- [ ] **Step 3: Write the root vitest config**

Create `packages/cityjson-navara-plugins/vitest.config.ts`:

```ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  resolve(import.meta.dirname, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      "@cityjson/navara-core": pkg("navara-core"),
      "@cityjson/navara-cityjson": pkg("navara-cityjson"),
      "@cityjson/navara-flatcitybuf": pkg("navara-flatcitybuf"),
      "@cityjson/navara-cityparquet": pkg("navara-cityparquet"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run)
```

Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 5: Add the CI workflow**

Create `packages/cityjson-navara-plugins/.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.18.0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 6: Verify the exact CI command sequence locally**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test)
```

Expected: install reports `Lockfile is up to date`; build prints four success lines; typecheck prints nothing; test prints `Test Files  1 passed (1)`.

- [ ] **Step 7: Commit in the submodule, then bump the pointer in the app**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add vitest.config.ts packages/navara-core/tests .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
test: add root vitest harness, package identity test, and GitHub Actions CI

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins
git commit -m "$(cat <<'EOF'
test: bump plugin submodule to green CI (install/build/typecheck/test)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A6: Wire the app to the plugin packages (file: deps, Vite alias, tsconfig paths)

**Files:**

- Modify: `package.json`, `vite.config.ts`, `tsconfig.app.json`
- Create: `tests/unit/platform/navaraPackageWiring.test.ts`
- Test: `tests/unit/platform/navaraPackageWiring.test.ts`

**Interfaces:**

- Consumes: `CITYJSON_PLUGIN_PLACEHOLDER` from `@cityjson/navara-cityjson`, `NAVARA_CORE_VERSION` from `@cityjson/navara-core`
- Produces: app modules can `import … from "@cityjson/navara-*"` and have it resolve to the submodule's `src/` under Vite, vitest, and `tsc`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/platform/navaraPackageWiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NAVARA_CORE_VERSION } from "@cityjson/navara-core";
import { CITYJSON_PLUGIN_PLACEHOLDER } from "@cityjson/navara-cityjson";
import { FLATCITYBUF_PLUGIN_PLACEHOLDER } from "@cityjson/navara-flatcitybuf";
import { CITYPARQUET_PLUGIN_PLACEHOLDER } from "@cityjson/navara-cityparquet";

// The submodule packages are aliased to their `src/` entry points (see
// vite.config.ts). This test is the tripwire for that wiring: if the alias,
// the tsconfig paths, or the submodule checkout regress, every later Navara
// import in the app breaks, and this is the cheapest place to notice.
describe("@cityjson/navara-* package wiring", () => {
  it("resolves navara-core to the submodule source", () => {
    expect(NAVARA_CORE_VERSION).toBe("0.0.0");
  });

  it("resolves the three plugin packages to the submodule source", () => {
    expect(CITYJSON_PLUGIN_PLACEHOLDER).toContain("@cityjson/navara-cityjson");
    expect(FLATCITYBUF_PLUGIN_PLACEHOLDER).toContain(
      "@cityjson/navara-flatcitybuf",
    );
    expect(CITYPARQUET_PLUGIN_PLACEHOLDER).toContain(
      "@cityjson/navara-cityparquet",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/platform/navaraPackageWiring.test.ts
```

Expected failure: `Error: Failed to resolve import "@cityjson/navara-core" from "tests/unit/platform/navaraPackageWiring.test.ts". Does the file exist?`

- [ ] **Step 3: Add the `file:` dependencies and pin the engine-facing versions**

In `package.json`, inside `dependencies`, add the four `file:` entries (alphabetical placement next to the existing `@cityjson/flatcitybuf` line) and the two exact Navara entries, and change `"three": "latest"` to the installed exact version:

```json
    "@cityjson/flatcitybuf": "^0.3.0",
    "@cityjson/navara-cityjson": "file:packages/cityjson-navara-plugins/packages/navara-cityjson",
    "@cityjson/navara-cityparquet": "file:packages/cityjson-navara-plugins/packages/navara-cityparquet",
    "@cityjson/navara-core": "file:packages/cityjson-navara-plugins/packages/navara-core",
    "@cityjson/navara-flatcitybuf": "file:packages/cityjson-navara-plugins/packages/navara-flatcitybuf",
    "@duckdb/duckdb-wasm": "latest",
    "@navaramap/three": "0.0.5",
    "@navaramap/three-default-plugin": "0.0.5",
```

and

```json
    "three": "0.183.2",
```

`three@0.183.2` is the version already installed, so pinning is a no-op for the existing R3F stack while satisfying the plugin packages' `>=0.183.0` peer range (spec §4.5 — this also closes the "unpinned three" known issue for `three` itself).

- [ ] **Step 4: Build the plugin dist and install**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm build)
cd /data2/hideba/multiroof-viewer && npm install
```

Expected: npm links the four `file:` packages as symlinks into `node_modules/@cityjson/`, downloads `@navaramap/three@0.0.5` and `@navaramap/three-default-plugin@0.0.5`, and updates `package-lock.json`. The `pnpm build` first is what makes the `dist/`-pointing `exports` fields resolvable outside the alias path (production `vp build`, editors, and any tool that ignores the alias).

- [ ] **Step 5: Add the Vite alias**

In `vite.config.ts`, add a `resolve` block next to the existing `optimizeDeps` block (and the `node:path` import at the top of the file):

```ts
import { resolve } from "node:path";
```

```ts
  resolve: {
    alias: {
      // Dev HMR: resolve the submodule packages to their TypeScript sources so
      // editing a plugin file hot-reloads the app instead of requiring a
      // `pnpm -r build` round trip. Production builds go through the same
      // alias; the packages' own `dist/` output is what external consumers use.
      "@cityjson/navara-core": resolve(
        import.meta.dirname,
        "packages/cityjson-navara-plugins/packages/navara-core/src/index.ts",
      ),
      "@cityjson/navara-cityjson": resolve(
        import.meta.dirname,
        "packages/cityjson-navara-plugins/packages/navara-cityjson/src/index.ts",
      ),
      "@cityjson/navara-flatcitybuf": resolve(
        import.meta.dirname,
        "packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/index.ts",
      ),
      "@cityjson/navara-cityparquet": resolve(
        import.meta.dirname,
        "packages/cityjson-navara-plugins/packages/navara-cityparquet/src/index.ts",
      ),
    },
  },
```

- [ ] **Step 6: Add the matching tsconfig paths**

In `tsconfig.app.json`, add to `compilerOptions` (after `"jsx": "react-jsx",`):

```json
    "baseUrl": ".",
    "paths": {
      "@cityjson/navara-core": [
        "packages/cityjson-navara-plugins/packages/navara-core/src/index.ts"
      ],
      "@cityjson/navara-cityjson": [
        "packages/cityjson-navara-plugins/packages/navara-cityjson/src/index.ts"
      ],
      "@cityjson/navara-flatcitybuf": [
        "packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/index.ts"
      ],
      "@cityjson/navara-cityparquet": [
        "packages/cityjson-navara-plugins/packages/navara-cityparquet/src/index.ts"
      ]
    },
```

- [ ] **Step 7: Run the test and watch it pass**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/platform/navaraPackageWiring.test.ts
```

Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 8: Verify the whole app is still green**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  63 passed (63)` (62 baseline + the new wiring test) and `Tests  745 passed (745)`.

- [ ] **Step 9: Commit (app repo only — no submodule change in this task)**

```bash
cd /data2/hideba/multiroof-viewer
git add package.json package-lock.json vite.config.ts tsconfig.app.json tests/unit/platform/navaraPackageWiring.test.ts
git commit -m "$(cat <<'EOF'
feat: wire @cityjson/navara-* plugin packages into the app

file: deps onto the submodule packages, Vite alias + tsconfig paths onto
their src/ for dev HMR and type checking, exact @navaramap 0.0.5, pinned three.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## M7.2 — Move format-agnostic domain code into `@cityjson/navara-core`

**Move order** (derived from the actual import graph, leaves first, so every intermediate commit type-checks):

1. `citymodel/types.ts` + `supportedEncodings.ts` — imported by ~30 app modules; `types.ts` imports only `supportedEncodings.ts` (A7)
2. `cityjson/types.ts` → `cityjson/parseHelpers.ts` → `cityjson/parseCityJSON.ts` — depend only on (1) (A8)
3. `cityjsonseq/types.ts` → `cityjsonseq/parseCityJSONSeq.ts` — depend on (1) and (2) (A9)
4. `shared/surfaceColorMap.ts` + linear color table — depends on (1) (A10)
5. `scene/buildCityMesh.ts` array core — depends on (1) and (4) (A11)
6. `domain/roofMetrics/{types,metrics}.ts` + `computeFootprintArea` (out of `domain/geometry/derived.ts`) — depend only on (1) (A12)
7. `features/rules/{types,evaluate}.ts` — depend on (6)'s `RoofMetrics` (A12)
8. `scene/applyRuleColors.ts` worker-safe core — depends on (1), (5)'s `PickingIndex`, (6) and (7) (A12)
9. `citymodel/crsProjDefs.ts` — depends on nothing in the app; independent, moved last (A13)

**Amended 2026-08-02 after external review:** steps 6–7 were originally "stays in the app". They move because the FlatCityBuf worker (`@cityjson/navara-flatcitybuf/src/fcb.worker.ts`, Task C5) bakes rule colors off the main thread and `workerProtocol.ts` (Task C1) puts `Rule[]`/`RoofMetrics[]` on the wire — a plugin-package worker can never import from the app, so `Rule` and `matchRule` must live in `@cityjson/navara-core`. What stays in the app is everything _around_ the schema: `features/rules/presets.ts`, the rule-editing UI, the per-layer rule state on `layerStore`, `domain/roofMetrics/aggregate.ts` (analytics-only), and the app-side `compileRulesToEvaluator` glue (Task B14). App modules keep their old import paths through re-export shims.

---

### Task A7: Move the CityModel domain types and encoding helpers into core

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/types.ts`, `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/supportedEncodings.ts`, `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/supportedEncodings.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, `src/domain/citymodel/types.ts`, `src/domain/citymodel/supportedEncodings.ts`
- Delete: `tests/unit/domain/citymodel/supportedEncodings.test.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/supportedEncodings.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces (from `@cityjson/navara-core`): types `Vec3`, `BBox3`, `BuildingSurfaceType`, `Surface`, `CityObject`, `CityModelMetadata`, `CityModel`, `CityModelEncoding`; values `CITYMODEL_ENCODING_PRIORITY`, `isSupportedCityModelEncoding(value: string): value is CityModelEncoding`, `getPreferredCityModelEncoding(encodings: readonly CityModelEncoding[]): CityModelEncoding | null`

- [ ] **Step 1: Move the test file into the plugin repo**

```bash
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel
git -C /data2/hideba/multiroof-viewer mv tests/unit/domain/citymodel/supportedEncodings.test.ts \
  packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/supportedEncodings.test.ts
```

Then edit the moved file's import line — the only change to it — from

```ts
} from "../../../../src/domain/citymodel/supportedEncodings";
```

to

```ts
} from "../../src/citymodel/supportedEncodings";
```

(the file already imports `describe`/`it`/`expect` from `"vitest"`).

- [ ] **Step 2: Run it and watch it fail**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/citymodel/supportedEncodings.test.ts)
```

Expected failure: `Failed to load url ../../src/citymodel/supportedEncodings` — the source has not moved yet.

- [ ] **Step 3: Move the two source files verbatim**

Move `src/domain/citymodel/supportedEncodings.ts` (all 30 lines, verbatim — it has no imports) to `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/supportedEncodings.ts`.

Move `src/domain/citymodel/types.ts` (all 100 lines) to `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/types.ts` verbatim — its single import already reads

```ts
import type { CityModelEncoding } from "./supportedEncodings";
```

which stays correct at the new location.

- [ ] **Step 4: Export them from the core barrel**

In `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, append:

```ts
export type {
  Vec3,
  BBox3,
  BuildingSurfaceType,
  Surface,
  CityObject,
  CityModelMetadata,
  CityModel,
} from "./citymodel/types";
export type { CityModelEncoding } from "./citymodel/supportedEncodings";
export {
  CITYMODEL_ENCODING_PRIORITY,
  isSupportedCityModelEncoding,
  getPreferredCityModelEncoding,
} from "./citymodel/supportedEncodings";
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run && pnpm typecheck)
```

Expected: `Test Files  2 passed (2)`, `Tests  7 passed (7)`; `tsc -b` prints nothing.

- [ ] **Step 6: Replace the app modules with re-export shims**

Write `src/domain/citymodel/types.ts`:

```ts
/**
 * Re-export shim — these types now live in `@cityjson/navara-core`
 * (M7.2 of the Navara migration). App modules keep importing them from this
 * path; the shim is deleted in M7.7 once call sites are repointed.
 */

export type {
  Vec3,
  BBox3,
  BuildingSurfaceType,
  Surface,
  CityObject,
  CityModelMetadata,
  CityModel,
} from "@cityjson/navara-core";
```

Write `src/domain/citymodel/supportedEncodings.ts`:

```ts
/**
 * Re-export shim — the encoding list now lives in `@cityjson/navara-core`
 * (M7.2 of the Navara migration).
 */

export type { CityModelEncoding } from "@cityjson/navara-core";
export {
  CITYMODEL_ENCODING_PRIORITY,
  isSupportedCityModelEncoding,
  getPreferredCityModelEncoding,
} from "@cityjson/navara-core";
```

- [ ] **Step 7: Verify the app is still green**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  62 passed (62)` (63 minus the moved `supportedEncodings.test.ts`) with 0 failures.

- [ ] **Step 8: Commit in the submodule, then bump the pointer with the app changes**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/src/citymodel packages/navara-core/src/index.ts packages/navara-core/tests/citymodel
git commit -m "$(cat <<'EOF'
refactor: move CityModel domain types and encoding helpers into navara-core

Moved verbatim from multiroof-viewer src/domain/citymodel/{types,supportedEncodings}.ts
with their unit test.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins src/domain/citymodel/types.ts src/domain/citymodel/supportedEncodings.ts tests/unit/domain/citymodel/supportedEncodings.test.ts
git commit -m "$(cat <<'EOF'
refactor: re-export CityModel domain types from @cityjson/navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A8: Move the CityJSON wire types, parse helpers, and parser into core

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/cityjson/types.ts`, `.../src/citymodel/cityjson/parseHelpers.ts`, `.../src/citymodel/cityjson/parseCityJSON.ts`, `.../tests/citymodel/cityjson/parseCityJSON.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, `src/domain/citymodel/cityjson/types.ts`, `src/domain/citymodel/cityjson/parseHelpers.ts`, `src/domain/citymodel/cityjson/parseCityJSON.ts`
- Delete: `tests/unit/domain/citymodel/cityjson/parseCityJSON.test.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/cityjson/parseCityJSON.test.ts`

**Interfaces:**

- Consumes: `CityModel`, `CityObject`, `BBox3`, `CityModelMetadata`, `Vec3`, `Surface` from `../types`
- Produces (from `@cityjson/navara-core`): types `CityJSONRoot`, `CityJSONTransform`, `CityJSONVertex`, `CityJSONObjectType`, `CityJSONObject`, `CityJSONGeometryType`, `CityJSONGeometryBase`, `CityJSONSurfaceGeometry`, `CityJSONGeometryInstance`, `CityJSONGeometry`, `CityJSONSemanticSurfaceType`, `CityJSONSemanticSurface`, `CityJSONSemantics`, `CityJSONMetadata`, `CityJSONPointOfContact`, `CityJSONGeometryTemplates`; values `parseCityJSON(root: CityJSONRoot): CityModel`, `dequantizeAll(vertices, transform)`, `mergeBBox(a: BBox3 | null, b: BBox3 | null): BBox3 | null`, `parseCityObject(id, rawObj, realVertices): CityObject`, `mapMetadata(raw: CityJSONRoot["metadata"]): CityModelMetadata`

- [ ] **Step 1: Move the test file into the plugin repo**

```bash
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/cityjson
git -C /data2/hideba/multiroof-viewer mv tests/unit/domain/citymodel/cityjson/parseCityJSON.test.ts \
  packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/cityjson/parseCityJSON.test.ts
```

Then edit only the import paths in the moved file (it uses inline fixtures, no file reads):

```ts
import { parseCityJSON } from "../../../src/citymodel/cityjson/parseCityJSON";
import type { CityJSONRoot } from "../../../src/citymodel/cityjson/types";
```

(replacing the `../../../../../src/domain/citymodel/...` specifiers; leave every `import { … } from "vitest"` line untouched).

- [ ] **Step 2: Run it and watch it fail**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/citymodel/cityjson/parseCityJSON.test.ts)
```

Expected failure: `Failed to load url ../../../src/citymodel/cityjson/parseCityJSON`.

- [ ] **Step 3: Move the three source files**

Move verbatim (relative import specifiers stay valid because the directory shape is identical):

- `src/domain/citymodel/cityjson/types.ts` (213 lines, no imports) → `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/cityjson/types.ts`
- `src/domain/citymodel/cityjson/parseHelpers.ts` (397 lines; imports `from "../types"` and `from "./types"`) → `.../src/citymodel/cityjson/parseHelpers.ts`
- `src/domain/citymodel/cityjson/parseCityJSON.ts` (45 lines; imports `from "../types"`, `from "./types"`, `from "./parseHelpers"`) → `.../src/citymodel/cityjson/parseCityJSON.ts`

- [ ] **Step 4: Export them from the core barrel**

Append to `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`:

```ts
export type {
  CityJSONRoot,
  CityJSONTransform,
  CityJSONVertex,
  CityJSONObjectType,
  CityJSONObject,
  CityJSONGeometryType,
  CityJSONGeometryBase,
  CityJSONSurfaceGeometry,
  CityJSONGeometryInstance,
  CityJSONGeometry,
  CityJSONSemanticSurfaceType,
  CityJSONSemanticSurface,
  CityJSONSemantics,
  CityJSONMetadata,
  CityJSONPointOfContact,
  CityJSONGeometryTemplates,
} from "./citymodel/cityjson/types";
export {
  dequantizeAll,
  mergeBBox,
  parseCityObject,
  mapMetadata,
} from "./citymodel/cityjson/parseHelpers";
export { parseCityJSON } from "./citymodel/cityjson/parseCityJSON";
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run && pnpm typecheck)
```

Expected: `Test Files  3 passed (3)` with the parser's ~21 assertions green; `tsc -b` prints nothing.

- [ ] **Step 6: Replace the app modules with re-export shims**

Write `src/domain/citymodel/cityjson/types.ts`:

```ts
/**
 * Re-export shim — the raw CityJSON wire types now live in
 * `@cityjson/navara-core` (M7.2 of the Navara migration).
 */

export type {
  CityJSONRoot,
  CityJSONTransform,
  CityJSONVertex,
  CityJSONObjectType,
  CityJSONObject,
  CityJSONGeometryType,
  CityJSONGeometryBase,
  CityJSONSurfaceGeometry,
  CityJSONGeometryInstance,
  CityJSONGeometry,
  CityJSONSemanticSurfaceType,
  CityJSONSemanticSurface,
  CityJSONSemantics,
  CityJSONMetadata,
  CityJSONPointOfContact,
  CityJSONGeometryTemplates,
} from "@cityjson/navara-core";
```

Write `src/domain/citymodel/cityjson/parseHelpers.ts`:

```ts
/**
 * Re-export shim — the CityJSON parse helpers now live in
 * `@cityjson/navara-core` (M7.2 of the Navara migration).
 */

export {
  dequantizeAll,
  mergeBBox,
  parseCityObject,
  mapMetadata,
} from "@cityjson/navara-core";
```

Write `src/domain/citymodel/cityjson/parseCityJSON.ts`:

```ts
/**
 * Re-export shim — the CityJSON parser now lives in `@cityjson/navara-core`
 * (M7.2 of the Navara migration).
 */

export { parseCityJSON } from "@cityjson/navara-core";
```

- [ ] **Step 7: Verify the app is still green**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  61 passed (61)` with 0 failures (the `fcb.worker` and integration tests exercise `parseHelpers` through the shim).

- [ ] **Step 8: Commit in the submodule, then bump the pointer with the app changes**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/src packages/navara-core/tests
git commit -m "$(cat <<'EOF'
refactor: move CityJSON wire types, parse helpers, and parser into navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins src/domain/citymodel/cityjson tests/unit/domain/citymodel/cityjson
git commit -m "$(cat <<'EOF'
refactor: re-export the CityJSON parser from @cityjson/navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A9: Move the CityJSONSeq feature type and parser into core

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/cityjsonseq/types.ts`, `.../src/citymodel/cityjsonseq/parseCityJSONSeq.ts`, `.../tests/citymodel/cityjsonseq/parseCityJSONSeq.test.ts`, `packages/cityjson-navara-plugins/packages/navara-core/fixtures/two-buildings.city.jsonl`
- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, `src/domain/citymodel/cityjsonseq/types.ts`, `src/domain/citymodel/cityjsonseq/parseCityJSONSeq.ts`
- Delete: `tests/unit/domain/citymodel/cityjsonseq/parseCityJSONSeq.test.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/cityjsonseq/parseCityJSONSeq.test.ts`

**Interfaces:**

- Consumes: `dequantizeAll`, `mapMetadata`, `mergeBBox`, `parseCityObject` from `../cityjson/parseHelpers`; `CityJSONObject`, `CityJSONRoot`, `CityJSONVertex` from `../cityjson/types`
- Produces (from `@cityjson/navara-core`): type `CityJSONFeature`; value `parseCityJSONSeq(text: string): CityModel`

- [ ] **Step 1: Copy the fixture and move the test file**

```bash
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/fixtures
cp /data2/hideba/multiroof-viewer/fixtures/two-buildings.city.jsonl \
   /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/fixtures/two-buildings.city.jsonl
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/cityjsonseq
git -C /data2/hideba/multiroof-viewer mv tests/unit/domain/citymodel/cityjsonseq/parseCityJSONSeq.test.ts \
  packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/cityjsonseq/parseCityJSONSeq.test.ts
```

The fixture is **copied, not moved** — the app's integration test `tests/integration/loadCityJSONSeq.test.ts` still reads it from `fixtures/`.

Then edit the moved file's import and fixture path:

```ts
import { parseCityJSONSeq } from "../../../src/citymodel/cityjsonseq/parseCityJSONSeq";
```

and change the fixture resolution from `"../../../../../fixtures/two-buildings.city.jsonl"` to

```ts
const fixture = path.resolve(
  import.meta.dirname!,
  "../../../fixtures/two-buildings.city.jsonl",
);
```

- [ ] **Step 2: Run it and watch it fail**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/citymodel/cityjsonseq/parseCityJSONSeq.test.ts)
```

Expected failure: `Failed to load url ../../../src/citymodel/cityjsonseq/parseCityJSONSeq`.

- [ ] **Step 3: Move the two source files verbatim**

- `src/domain/citymodel/cityjsonseq/types.ts` (19 lines; imports `from "../cityjson/types"`) → `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/cityjsonseq/types.ts`
- `src/domain/citymodel/cityjsonseq/parseCityJSONSeq.ts` (73 lines; imports `from "../types"`, `from "../cityjson/types"`, `from "./types"`, `from "../cityjson/parseHelpers"`) → `.../src/citymodel/cityjsonseq/parseCityJSONSeq.ts`

All relative specifiers remain valid — the directory layout under `src/citymodel/` mirrors the app's `src/domain/citymodel/`.

- [ ] **Step 4: Export them from the core barrel**

Append to `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`:

```ts
export type { CityJSONFeature } from "./citymodel/cityjsonseq/types";
export { parseCityJSONSeq } from "./citymodel/cityjsonseq/parseCityJSONSeq";
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run && pnpm typecheck)
```

Expected: `Test Files  4 passed (4)`, all CityJSONSeq assertions green; `tsc -b` prints nothing.

- [ ] **Step 6: Replace the app modules with re-export shims**

Write `src/domain/citymodel/cityjsonseq/types.ts`:

```ts
/**
 * Re-export shim — the CityJSONSeq feature type now lives in
 * `@cityjson/navara-core` (M7.2 of the Navara migration).
 */

export type { CityJSONFeature } from "@cityjson/navara-core";
```

Write `src/domain/citymodel/cityjsonseq/parseCityJSONSeq.ts`:

```ts
/**
 * Re-export shim — the CityJSONSeq parser now lives in
 * `@cityjson/navara-core` (M7.2 of the Navara migration).
 */

export { parseCityJSONSeq } from "@cityjson/navara-core";
```

- [ ] **Step 7: Verify the app is still green**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  60 passed (60)` with 0 failures (`tests/integration/loadCityJSONSeq.test.ts` still passes through the shim).

- [ ] **Step 8: Commit in the submodule, then bump the pointer with the app changes**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/src packages/navara-core/tests packages/navara-core/fixtures
git commit -m "$(cat <<'EOF'
refactor: move CityJSONSeq types and parser into navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins src/domain/citymodel/cityjsonseq tests/unit/domain/citymodel/cityjsonseq
git commit -m "$(cat <<'EOF'
refactor: re-export the CityJSONSeq parser from @cityjson/navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A10: Move the surface color map into core and add linear-sRGB surface colors

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-core/src/styling/surfaceColors.ts`, `packages/cityjson-navara-plugins/packages/navara-core/tests/styling/surfaceColors.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, `src/shared/surfaceColorMap.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-core/tests/styling/surfaceColors.test.ts`

**Interfaces:**

- Consumes: `BuildingSurfaceType` from `../citymodel/types`
- Produces (from `@cityjson/navara-core`): `SURFACE_COLOR_VALUES: Record<BuildingSurfaceType, number>`, `SURFACE_COLOR_HEX: Record<BuildingSurfaceType, string>`, `SURFACE_COLORS_LINEAR: Record<BuildingSurfaceType, LinearRGB>`, `type LinearRGB = { readonly r: number; readonly g: number; readonly b: number }`

**Why the new table:** `src/scene/surfaceColors.ts` built `three.Color` instances purely to hand `.r/.g/.b` (already linear-sRGB, because `new Color(hex)` converts with ColorManagement on) to `buildCityMeshArrays`. Core computes the same numbers directly from the hex table, so the geometry builder needs no `three.Color` — and the test below locks the two against each other.

- [ ] **Step 1: Write the failing test**

Create `packages/cityjson-navara-plugins/packages/navara-core/tests/styling/surfaceColors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Color } from "three";
import {
  SURFACE_COLOR_VALUES,
  SURFACE_COLOR_HEX,
  SURFACE_COLORS_LINEAR,
} from "../../src/styling/surfaceColors";

// The renderer previously derived vertex colors from `new Color(hex)`, whose
// r/g/b are Linear-sRGB (ColorManagement is on by default in three). The
// linear table below must reproduce those numbers exactly, or every mesh
// silently shifts color the moment the geometry builder stops using three.
describe("SURFACE_COLORS_LINEAR parity with three.Color", () => {
  for (const [type, hex] of Object.entries(SURFACE_COLOR_VALUES)) {
    it(`matches new Color(0x${hex.toString(16)}) for ${type}`, () => {
      const expected = new Color(hex);
      const actual =
        SURFACE_COLORS_LINEAR[type as keyof typeof SURFACE_COLORS_LINEAR];
      expect(actual.r).toBeCloseTo(expected.r, 6);
      expect(actual.g).toBeCloseTo(expected.g, 6);
      expect(actual.b).toBeCloseTo(expected.b, 6);
    });
  }
});

describe("SURFACE_COLOR_HEX", () => {
  it("renders every value as a 6-digit CSS hex string", () => {
    for (const [type, hex] of Object.entries(SURFACE_COLOR_HEX)) {
      expect(hex, type).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps RoofSurface at #cc4444", () => {
    expect(SURFACE_COLOR_HEX.RoofSurface).toBe("#cc4444");
  });

  it("covers exactly the keys of SURFACE_COLOR_VALUES", () => {
    expect(Object.keys(SURFACE_COLOR_HEX).sort()).toEqual(
      Object.keys(SURFACE_COLOR_VALUES).sort(),
    );
    expect(Object.keys(SURFACE_COLORS_LINEAR).sort()).toEqual(
      Object.keys(SURFACE_COLOR_VALUES).sort(),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/styling/surfaceColors.test.ts)
```

Expected failure: `Failed to load url ../../src/styling/surfaceColors`.

- [ ] **Step 3: Write the core module**

Create `packages/cityjson-navara-plugins/packages/navara-core/src/styling/surfaceColors.ts` (the first two exports are `src/shared/surfaceColorMap.ts` verbatim, with the import path updated; the third is new):

```ts
/**
 * Single source of truth for surface type → color mapping.
 *
 * Raw hex values live here. CSS hex strings (UI layer) and Linear-sRGB
 * triples (vertex colors) are both derived from this map, so the renderer
 * never needs a `three.Color` just to look up a semantic color.
 */

import type { BuildingSurfaceType } from "../citymodel/types";
import { srgbHexToLinear } from "./srgb";

export const SURFACE_COLOR_VALUES: Record<BuildingSurfaceType, number> = {
  RoofSurface: 0xcc4444,
  WallSurface: 0xcccccc,
  GroundSurface: 0x886644,
  ClosureSurface: 0x999999,
  OuterCeilingSurface: 0xaaaaaa,
  OuterFloorSurface: 0x998877,
  Window: 0x6699cc,
  Door: 0x996633,
  unknown: 0x888888,
};

/** CSS hex string for use in UI (inspector dots, legends). */
export const SURFACE_COLOR_HEX: Record<BuildingSurfaceType, string> =
  Object.fromEntries(
    Object.entries(SURFACE_COLOR_VALUES).map(([k, v]) => [
      k,
      "#" + v.toString(16).padStart(6, "0"),
    ]),
  ) as Record<BuildingSurfaceType, string>;

/** A color in the Linear-sRGB working space, channels in [0, 1]. */
export interface LinearRGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Linear-sRGB vertex colors, byte-for-byte equivalent to what
 * `new three.Color(hex).r/g/b` produced before the geometry builder dropped
 * its `three.Color` dependency (parity locked by surfaceColors.test.ts).
 */
export const SURFACE_COLORS_LINEAR: Record<BuildingSurfaceType, LinearRGB> =
  Object.fromEntries(
    Object.entries(SURFACE_COLOR_HEX).map(([k, hex]) => {
      const [r, g, b] = srgbHexToLinear(hex);
      return [k, { r, g, b }];
    }),
  ) as Record<BuildingSurfaceType, LinearRGB>;
```

Create `packages/cityjson-navara-plugins/packages/navara-core/src/styling/srgb.ts` — lines 24–76 of `src/scene/applyRuleColors.ts` moved verbatim (`srgbChannelToLinear`, `expandHex`, `srgbHexToLinear`, and their doc comments), with this header replacing the app file's module docblock:

```ts
/**
 * sRGB → Linear-sRGB conversion for CSS hex colors.
 *
 * Matches `three.Color`'s conversion (ColorManagement on) so that colors
 * computed in a worker, in the geometry builder, and by a host application's
 * `three.Color` calls are numerically identical. Parity is locked by
 * tests/styling/srgbHexToLinear.test.ts.
 */

export type RGB = readonly [number, number, number];
```

(The app's `applyRuleColors.ts` keeps its own copy until Task A12 deletes it; A12 also adds the parity test. Creating `srgb.ts` here is what makes `SURFACE_COLORS_LINEAR` computable without `three`.)

- [ ] **Step 4: Export from the core barrel**

Append to `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`:

```ts
export type { LinearRGB } from "./styling/surfaceColors";
export {
  SURFACE_COLOR_VALUES,
  SURFACE_COLOR_HEX,
  SURFACE_COLORS_LINEAR,
} from "./styling/surfaceColors";
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run && pnpm typecheck)
```

Expected: `Test Files  5 passed (5)`; the 9 parity assertions and 3 hex assertions pass; `tsc -b` prints nothing.

- [ ] **Step 6: Replace the app color map with a re-export shim**

Write `src/shared/surfaceColorMap.ts`:

```ts
/**
 * Re-export shim — the surface color map now lives in
 * `@cityjson/navara-core` (M7.2 of the Navara migration).
 */

export { SURFACE_COLOR_VALUES, SURFACE_COLOR_HEX } from "@cityjson/navara-core";
```

`src/scene/surfaceColors.ts` (the `three.Color` table) stays untouched for now — Task A11 deletes it together with its only consumer.

- [ ] **Step 7: Verify the app is still green**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  60 passed (60)` with 0 failures.

- [ ] **Step 8: Commit in the submodule, then bump the pointer with the app changes**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/src packages/navara-core/tests
git commit -m "$(cat <<'EOF'
refactor: move the surface color map into navara-core with linear-sRGB table

SURFACE_COLORS_LINEAR reproduces new three.Color(hex).r/g/b exactly, so the
geometry builder no longer needs three just to look up semantic colors.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins src/shared/surfaceColorMap.ts
git commit -m "$(cat <<'EOF'
refactor: re-export the surface color map from @cityjson/navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A11: Move the geometry builder (arrays, triangulation, normals, origin offset) into core

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-core/src/geometry/buildCityMeshArrays.ts`, `packages/cityjson-navara-plugins/packages/navara-core/src/picking/types.ts`, `packages/cityjson-navara-plugins/packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts`, `packages/cityjson-navara-plugins/packages/navara-core/fixtures/two-buildings.city.json`
- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, `src/scene/buildCityMesh.ts`, `tests/unit/scene/buildCityMeshArrays.test.ts`, `tests/unit/scene/buildCityMesh.test.ts`
- Delete: `src/scene/surfaceColors.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts`

**Interfaces:**

- Consumes: `BBox3`, `CityModel`, `Vec3` from `../citymodel/types`; `SURFACE_COLORS_LINEAR` from `../styling/surfaceColors`; `ShapeUtils`, `Vector2` from `three` (peer)
- Produces (from `@cityjson/navara-core`): `buildCityMeshArrays(model: CityModel, layerId: string, originOffset?: Vec3, selectedLod?: string | null): CityMeshArrays`, `computeOriginOffset(model: CityModel): Vec3`, types `CityMeshArrays`, `PickingIndex`, `PickResult`

- [ ] **Step 1: Copy the fixture and create the core test file**

```bash
cp /data2/hideba/multiroof-viewer/fixtures/two-buildings.city.json \
   /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/fixtures/two-buildings.city.json
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/geometry
```

Copy `tests/unit/scene/buildCityMeshArrays.test.ts` to `packages/cityjson-navara-plugins/packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts`, then in the copy:

1. Delete the `describe("buildCityMeshArrays -> buildCityMesh wrapper wiring", …)` block (source lines 44–93) — `buildCityMesh` (the `BufferGeometry` wrapper) stays in the app.
2. Replace the whole import header (source lines 1–25) with:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../src/citymodel/cityjson/types";
import { parseCityJSON } from "../../src/citymodel/cityjson/parseCityJSON";
import {
  buildCityMeshArrays,
  computeOriginOffset,
} from "../../src/geometry/buildCityMeshArrays";
import type {
  CityModel,
  CityObject,
  Surface,
  Vec3,
} from "../../src/citymodel/types";

const fixture = path.resolve(
  import.meta.dirname!,
  "../../fixtures/two-buildings.city.json",
);
const model = parseCityJSON(
  JSON.parse(fs.readFileSync(fixture, "utf-8")) as CityJSONRoot,
);
const origin = computeOriginOffset(model);
```

3. Keep the `expectVertexSet` helper, `makeSurface`/`makeObject`/`makeModel` helpers, and the three oracle describes (`buildCityMeshArrays positions`, `buildCityMeshArrays face normals`, `buildCityMeshArrays LoD filtering`) verbatim. The face-normal describe imports `BufferGeometry`/`BufferAttribute` from `three` inside its body via the existing `computeVertexNormals()` oracle — keep those imports by adding, after the `vitest` import:

```ts
import { BufferAttribute, BufferGeometry } from "three";
```

4. Append the `computeOriginOffset` describe moved from `tests/unit/scene/buildCityMesh.test.ts` (source lines 54–81) verbatim:

```ts
describe("computeOriginOffset", () => {
  it("returns zero offset when model has no bbox", () => {
    const emptyModel: CityModel = {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    };
    expect(computeOriginOffset(emptyModel)).toEqual([0, 0, 0]);
  });

  it("returns the center of the bounding box", () => {
    const boxedModel: CityModel = {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: [100, 200, 0, 110, 210, 10],
      objects: {},
      vertexCount: 0,
    };
    const offset = computeOriginOffset(boxedModel);
    expect(offset[0]).toBeCloseTo(105);
    expect(offset[1]).toBeCloseTo(205);
    expect(offset[2]).toBeCloseTo(5);
  });
});
```

(the local consts are renamed `emptyModel`/`boxedModel` to avoid shadowing the file-level `model`).

- [ ] **Step 2: Run it and watch it fail**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/geometry/buildCityMeshArrays.test.ts)
```

Expected failure: `Failed to load url ../../src/geometry/buildCityMeshArrays`.

- [ ] **Step 3: Write the core geometry module**

Create `packages/cityjson-navara-plugins/packages/navara-core/src/picking/types.ts`:

```ts
/**
 * Picking indices: the mapping from the per-vertex `objectIndex` /
 * `surfaceIndex` attributes emitted by `buildCityMeshArrays` back to city
 * object IDs and surface positions. Renderer-agnostic — a Navara descriptor,
 * a raycast, or a GPU pick buffer all resolve through the same two types.
 */

export interface PickingIndex {
  /** ID of the layer this mesh belongs to. */
  readonly layerId: string;
  /** Ordered list of CityObject IDs, one per unique object index. */
  readonly objectKeys: ReadonlyArray<string>;
}

export interface PickResult {
  readonly layerId: string;
  readonly objectId: string;
  readonly surfaceIndex: number;
}
```

(`PickingIndex` is `src/scene/buildCityMesh.ts:17–22` verbatim; `PickResult` is `src/scene/resolvePicking.ts:13–17` verbatim. `resolveSelection` itself is NOT moved — it reads `BufferGeometry` attributes and dies with the R3F scene in M7.3.)

Create `packages/cityjson-navara-plugins/packages/navara-core/src/geometry/buildCityMeshArrays.ts` with this header:

```ts
/**
 * Converts normalized CityModel surfaces into plain typed arrays.
 *
 * Triangulates polygon surfaces, computes flat face normals, assigns vertex
 * colors from the semantic surface type, and emits per-vertex object/surface
 * indices for picking. Contains no GPU/DOM types, so it runs unchanged on the
 * main thread and inside a Web Worker; renderers wrap the arrays in their own
 * buffer objects.
 *
 * `three` is used only for its pure-math polygon helpers (`ShapeUtils`,
 * `Vector2`) — no renderer, no GPU resources.
 */

import { ShapeUtils, Vector2 } from "three";
import type { BBox3, CityModel, Vec3 } from "../citymodel/types";
import { SURFACE_COLORS_LINEAR } from "../styling/surfaceColors";
```

Then move, verbatim from `src/scene/buildCityMesh.ts`:

- `interface CityMeshArrays` (lines 37–45) and `interface SurfaceTriangulation` (lines 47–50)
- `export function buildCityMeshArrays` (lines 93–248, including its doc comment)
- `function computeFaceNormal` (lines 250–289)
- `function triangulateSurface` (lines 291–340)
- `function orientExteriorRing` (lines 342–368)
- `function computeRingCenter` (lines 370–382)
- `function computeNewellNormal` (lines 384–399)
- `interface ProjectionBasis` + `function buildProjectionBasis` (lines 401–455)
- `function projectRingTo2D` (lines 457–468)
- `subtractVec3`, `dotVec3`, `crossVec3` (lines 470–484)
- `export function computeOriginOffset` (lines 486–497, including its doc comment)

Exactly **one** line changes inside the moved code — the color lookup at line 158:

```ts
const color = SURFACE_COLORS_LINEAR[surface.type];
```

(was `const color = SURFACE_COLORS[surface.type];`). Everything downstream (`color.r/.g/.b`) is unchanged because `LinearRGB` has the same shape as the `three.Color` fields that were read.

- [ ] **Step 4: Export from the core barrel**

Append to `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`:

```ts
export type { CityMeshArrays } from "./geometry/buildCityMeshArrays";
export {
  buildCityMeshArrays,
  computeOriginOffset,
} from "./geometry/buildCityMeshArrays";
export type { PickingIndex, PickResult } from "./picking/types";
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run && pnpm typecheck && pnpm build)
```

Expected: `Test Files  6 passed (6)` with the position/normal/LoD oracles and both `computeOriginOffset` cases green; `tsc -b` prints nothing; tsup rebuilds all four packages.

- [ ] **Step 6: Reduce the app's `buildCityMesh.ts` to the BufferGeometry wrapper**

Write `src/scene/buildCityMesh.ts`:

```ts
/**
 * Wraps `@cityjson/navara-core`'s renderer-agnostic mesh arrays into a
 * Three.js BufferGeometry.
 *
 * The triangulation/normals/coloring live in the core package (M7.2 of the
 * Navara migration); this file is only the Three.js-specific tail of the
 * pipeline and disappears with the R3F scene in M7.3/M7.7.
 */

import { BufferAttribute, BufferGeometry } from "three";
import {
  buildCityMeshArrays,
  computeOriginOffset,
  type CityMeshArrays,
  type PickingIndex,
} from "@cityjson/navara-core";
import type { CityModel, Vec3 } from "../domain/citymodel/types";

export { buildCityMeshArrays, computeOriginOffset };
export type { CityMeshArrays, PickingIndex };

export interface CityMeshResult {
  readonly geometry: BufferGeometry;
  readonly triangleCount: number;
  readonly pickingIndex: PickingIndex;
  /** Snapshot of vertex colors before any highlight mutations. */
  readonly baseColors: Float32Array;
}

/**
 * Build a single merged BufferGeometry from all surfaces in a CityModel.
 * Vertex colors encode the semantic surface type.
 *
 * `originOffset` is an INPUT, not something this function computes or
 * returns: every vertex position is written as `coordinate - originOffset`,
 * so the offset is already baked into the geometry's own positions. Callers
 * get the offset to pass in from `computeOriginOffset` and are responsible
 * for keeping the mesh/group's OWN transform in whatever frame they chose.
 */
export function buildCityMesh(
  model: CityModel,
  layerId: string,
  originOffset: Vec3 = [0, 0, 0],
  selectedLod: string | null = null,
): CityMeshResult {
  const a = buildCityMeshArrays(model, layerId, originOffset, selectedLod);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(a.positions, 3));
  geometry.setAttribute("color", new BufferAttribute(a.colors, 3));
  geometry.setAttribute("normal", new BufferAttribute(a.normals, 3));
  geometry.setAttribute("objectIndex", new BufferAttribute(a.objectIndices, 1));
  geometry.setAttribute(
    "surfaceIndex",
    new BufferAttribute(a.surfaceIndices, 1),
  );

  return {
    geometry,
    triangleCount: a.triangleCount,
    pickingIndex: { layerId, objectKeys: a.objectKeys },
    baseColors: Float32Array.from(a.colors),
  };
}
```

- [ ] **Step 7: Delete the now-unused three.Color surface table and trim the app tests**

```bash
cd /data2/hideba/multiroof-viewer
grep -rn "surfaceColors" src tests   # expect: no hits outside src/scene/surfaceColors.ts itself
git rm src/scene/surfaceColors.ts
```

In `tests/unit/scene/buildCityMesh.test.ts`, delete the `describe("computeOriginOffset", …)` block (lines 54–81, now covered in the plugin repo) and drop `computeOriginOffset` from its import list, leaving:

```ts
import { buildCityMesh } from "../../../src/scene/buildCityMesh";
```

In `tests/unit/scene/buildCityMeshArrays.test.ts`, delete everything except the header and the `describe("buildCityMeshArrays -> buildCityMesh wrapper wiring", …)` block, so the file reads:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../../src/domain/citymodel/cityjson/parseCityJSON";
import {
  buildCityMesh,
  buildCityMeshArrays,
  computeOriginOffset,
} from "../../../src/scene/buildCityMesh";

const fixture = path.resolve(
  import.meta.dirname!,
  "../../../fixtures/two-buildings.city.json",
);
const model = parseCityJSON(
  JSON.parse(fs.readFileSync(fixture, "utf-8")) as CityJSONRoot,
);
const origin = computeOriginOffset(model);
```

followed by the unchanged wrapper-wiring describe (original lines 44–93). The `three` `BufferAttribute`/`BufferGeometry` import and the `CityModel`/`CityObject`/`Surface`/`Vec3` type imports are no longer used there and are removed.

- [ ] **Step 8: Verify the app is still green**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  60 passed (60)` with 0 failures — `tests/unit/scene/buildCityMesh.test.ts`, `tests/unit/scene/layerSceneMap.test.ts`, `tests/unit/features/streaming/fcbWorkerCache.test.ts` and the two integration tests all still exercise `buildCityMeshArrays` through the app wrapper.

- [ ] **Step 9: Commit in the submodule, then bump the pointer with the app changes**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/src packages/navara-core/tests packages/navara-core/fixtures
git commit -m "$(cat <<'EOF'
refactor: move buildCityMeshArrays, triangulation, normals and picking types into navara-core

Only changed line inside the moved code is the semantic color lookup, which
now reads SURFACE_COLORS_LINEAR instead of a three.Color table.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins src/scene/buildCityMesh.ts src/scene/surfaceColors.ts tests/unit/scene/buildCityMesh.test.ts tests/unit/scene/buildCityMeshArrays.test.ts
git commit -m "$(cat <<'EOF'
refactor: reduce buildCityMesh to a BufferGeometry wrapper over navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A12: Move the rule engine, roof metrics and the worker-safe rule-color core into `@cityjson/navara-core`

**Files:**

- Create (rule engine + roof metrics): `packages/cityjson-navara-plugins/packages/navara-core/src/roofMetrics/types.ts`, `.../src/roofMetrics/metrics.ts`, `.../src/roofMetrics/footprint.ts`, `.../src/rules/types.ts`, `.../src/rules/evaluate.ts`, `.../tests/roofMetrics/metrics.test.ts`, `.../tests/roofMetrics/footprint.test.ts`, `.../tests/rules/evaluate.test.ts`
- Create (styling hook): `packages/cityjson-navara-plugins/packages/navara-core/src/styling/buildStyleColors.ts`, `.../tests/styling/srgbHexToLinear.test.ts`, `.../tests/styling/buildStyleColors.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, `src/scene/applyRuleColors.ts`, `src/features/rules/types.ts`, `src/features/rules/evaluate.ts`, `src/domain/roofMetrics/types.ts`, `src/domain/roofMetrics/metrics.ts`, `src/domain/geometry/derived.ts`, `tests/unit/scene/ruleColorsWorkerSafe.test.ts`
- Delete (moved to the plugin repo): `tests/unit/domain/roofMetrics/metrics.test.ts`, `tests/unit/features/rules/evaluate.test.ts`
- Test: `.../tests/roofMetrics/metrics.test.ts`, `.../tests/roofMetrics/footprint.test.ts`, `.../tests/rules/evaluate.test.ts`, `.../tests/styling/srgbHexToLinear.test.ts`, `.../tests/styling/buildStyleColors.test.ts`

**Interfaces:**

- Consumes: `CityModel`, `CityObject`, `Surface`, `Vec3` from `../citymodel/types`; `RGB` from `./srgb`
- Produces (from `@cityjson/navara-core`):
  - `type ConditionOperator`, `interface Condition`, `type LogicMode`, `interface Rule` — the colorization-rule schema, moved verbatim from `src/features/rules/types.ts`
  - `evaluateCondition(fieldValue: unknown, condition: Condition): boolean`, `evaluateRule(attributes, metrics, rule): boolean`, `matchRule(attributes, metrics, rules): string | null` — moved verbatim from `src/features/rules/evaluate.ts`
  - `interface RoofMetrics`, `computeSurfaceNormal`, `computeArea`, `computeInclination`, `computeAzimuth`, `computeElevation`, `computeRoofMetrics(surface: Surface): RoofMetrics` — moved verbatim from `src/domain/roofMetrics/{types,metrics}.ts`
  - `computeFootprintArea(obj: CityObject): number | null` — moved out of `src/domain/geometry/derived.ts`
  - `srgbHexToLinear(hex: string): RGB` and `type RGB = readonly [number, number, number]`
  - `interface SurfaceInfo { readonly surfaceIndex: number; readonly surface: Surface }`
  - `interface CityObjectInfo { readonly objectId: string; readonly object: CityObject }`
  - `type SurfaceStyleEvaluator = (surface: SurfaceInfo, object: CityObjectInfo) => RGB | null` — the authoritative shape (see **Shared Interface Contract**); the evaluator returns a linear-sRGB triple, never a hex string or an engine `Color`
  - `buildStyleColorsFromArrays(model: CityModel, objectIndices: Uint32Array, surfaceIndices: Uint32Array, objectKeys: ReadonlyArray<string>, evaluate: SurfaceStyleEvaluator, baseColors: Float32Array): Float32Array | null`
- App keeps: `buildRuleColorsFromArrays(model, objectIndices, surfaceIndices, objectKeys, rules, baseColors)` and `buildRuleColors(model, geometry, pickingIndex, rules, baseColors)` with **unchanged signatures**, now implemented as adapters; plus new `compileRuleEvaluator(rules: ReadonlyArray<Rule>): SurfaceStyleEvaluator | null`. `src/features/rules/presets.ts`, the rule-editing UI, the per-layer rule state on `layerStore`, `src/domain/roofMetrics/aggregate.ts` and `computeTotalRoofArea`/`computeVolume`/`computeSolarScore` in `src/domain/geometry/derived.ts` are untouched.

**Decision (amended 2026-08-02 after external review):** the rule **schema** (`Rule` and friends), its **evaluation** (`matchRule`), and the **roof-metric computations** it depends on (`RoofMetrics`, `computeRoofMetrics`, `computeFootprintArea`) MOVE into `@cityjson/navara-core`; the app re-exports them from the old paths through shims, exactly like Tasks A7–A11. The original decision ("rules stay in the app") does not survive Part C: `@cityjson/navara-flatcitybuf`'s `workerProtocol.ts` (Task C1) puts `Rule[]` and `RoofMetrics[]` on the worker wire and `fcb.worker.ts` (Task C5) calls `buildRuleColorsFromArrays` inside the worker — a module in a plugin package can never import from the app, so those symbols must be resolvable from core or Part C cannot compile. Core still exposes the _callback_ hook too (`SurfaceStyleEvaluator` + `buildStyleColorsFromArrays`), which is what `setStyle(evaluator)` in the spec's §3 API sketch consumes for **static** layers; streaming layers use the `Rule[]` path in the worker instead (see **Streaming styling** in the Shared Interface Contract). What the app keeps is everything around the schema: rule editing UI, presets, and the per-layer rule store.

- [ ] **Step 1: Move the roof-metric and rule tests into the plugin repo (they fail first)**

```bash
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/roofMetrics
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/rules
cp /data2/hideba/multiroof-viewer/tests/unit/domain/roofMetrics/metrics.test.ts \
   /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/roofMetrics/metrics.test.ts
cp /data2/hideba/multiroof-viewer/tests/unit/features/rules/evaluate.test.ts \
   /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/tests/rules/evaluate.test.ts
```

In the copies, rewrite only the import lines (the test bodies move byte-identical):

- `tests/roofMetrics/metrics.test.ts`: every `../../../../src/domain/roofMetrics/metrics` becomes `../../src/roofMetrics/metrics`, and every `../../../../src/domain/citymodel/types` becomes `../../src/citymodel/types`.
- `tests/rules/evaluate.test.ts`: `../../../../src/features/rules/evaluate` becomes `../../src/rules/evaluate`, `../../../../src/features/rules/types` becomes `../../src/rules/types`, and `../../../../src/domain/roofMetrics/types` becomes `../../src/roofMetrics/types`.

Then add the new footprint test — `computeFootprintArea` has no app-side test today, and it becomes a public core export consumed by `objectRecords.ts` (Task C1), so it gets one now. Create `packages/navara-core/tests/roofMetrics/footprint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeFootprintArea } from "../../src/roofMetrics/footprint";
import type { CityObject, Surface } from "../../src/citymodel/types";

function surface(type: Surface["type"], size: number): Surface {
  return {
    type,
    rings: [
      [
        [0, 0, 0],
        [size, 0, 0],
        [size, size, 0],
        [0, size, 0],
      ],
    ],
    attributes: {},
    lod: "2",
  };
}

function object(surfaces: Surface[]): CityObject {
  return {
    id: "b1",
    objectType: "Building",
    attributes: {},
    surfaces,
    bbox: null,
    children: [],
    parents: [],
    lod: "2",
  };
}

describe("computeFootprintArea", () => {
  it("returns null when the object has no GroundSurface", () => {
    expect(
      computeFootprintArea(object([surface("RoofSurface", 4)])),
    ).toBeNull();
  });

  it("sums the exterior-ring areas of every GroundSurface", () => {
    const area = computeFootprintArea(
      object([
        surface("GroundSurface", 4),
        surface("RoofSurface", 10),
        surface("GroundSurface", 2),
      ]),
    );
    expect(area).toBeCloseTo(16 + 4, 9);
  });

  it("ignores a degenerate GroundSurface ring instead of throwing", () => {
    const degenerate: Surface = {
      type: "GroundSurface",
      rings: [],
      attributes: {},
      lod: "2",
    };
    expect(computeFootprintArea(object([degenerate]))).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/roofMetrics packages/navara-core/tests/rules)
```

Expected: three files fail with `Failed to load url ../../src/roofMetrics/metrics`, `.../footprint`, `.../src/rules/evaluate`.

- [ ] **Step 3: Move the five source modules into core (verbatim)**

```bash
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/src/roofMetrics
mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/src/rules
```

- `packages/navara-core/src/roofMetrics/types.ts` — `src/domain/roofMetrics/types.ts` byte-identical (no imports).
- `packages/navara-core/src/roofMetrics/metrics.ts` — `src/domain/roofMetrics/metrics.ts` with its two import lines changed to `import type { Surface, Vec3 } from "../citymodel/types";` and `import type { RoofMetrics } from "./types";`. Everything from `function newellNormal` to the end is byte-identical.
- `packages/navara-core/src/roofMetrics/footprint.ts` — new file holding `computeFootprintArea` lifted verbatim from `src/domain/geometry/derived.ts:13-20`, with this header:

```ts
/**
 * Footprint area from an object's GroundSurface rings.
 *
 * Lives in core (not next to `computeTotalRoofArea`/`computeVolume`, which
 * stay in the app's `domain/geometry/derived.ts`) because
 * `@cityjson/navara-flatcitybuf`'s `objectRecords.ts` needs it inside the FCB
 * worker, where the app is not importable.
 */
import type { CityObject } from "../citymodel/types";
import { computeArea } from "./metrics";
```

- `packages/navara-core/src/rules/types.ts` — `src/features/rules/types.ts` byte-identical (no imports).
- `packages/navara-core/src/rules/evaluate.ts` — `src/features/rules/evaluate.ts` with its two import lines changed to `import type { RoofMetrics } from "../roofMetrics/types";` and `import type { Condition, Rule } from "./types";`. Everything else is byte-identical.

Append to `packages/navara-core/src/index.ts`:

```ts
export type { RoofMetrics } from "./roofMetrics/types";
export {
  computeArea,
  computeAzimuth,
  computeElevation,
  computeInclination,
  computeRoofMetrics,
  computeSurfaceNormal,
} from "./roofMetrics/metrics";
export { computeFootprintArea } from "./roofMetrics/footprint";
export type {
  Condition,
  ConditionOperator,
  LogicMode,
  Rule,
} from "./rules/types";
export { evaluateCondition, evaluateRule, matchRule } from "./rules/evaluate";
```

- [ ] **Step 4: Run — expect pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run && pnpm typecheck)
```

Expected: `Test Files  9 passed (9)` — the six pre-existing core suites plus `roofMetrics/metrics`, `roofMetrics/footprint` and `rules/evaluate`, with exactly the case counts the app run had for the two moved files; `tsc -b` prints nothing.

- [ ] **Step 5: Replace the app modules with re-export shims and drop the moved tests**

Write `src/features/rules/types.ts`:

```ts
/**
 * Re-export shim — the colorization-rule schema now lives in
 * `@cityjson/navara-core` (M7.2), because the FlatCityBuf worker evaluates
 * rules off the main thread. The app keeps the presets, the editing UI and
 * the per-layer rule state; only the schema moved.
 */
export type {
  Condition,
  ConditionOperator,
  LogicMode,
  Rule,
} from "@cityjson/navara-core";
```

Write `src/features/rules/evaluate.ts`:

```ts
/**
 * Re-export shim — rule evaluation now lives in `@cityjson/navara-core`
 * (M7.2). See `src/features/rules/types.ts` for why.
 */
export {
  evaluateCondition,
  evaluateRule,
  matchRule,
} from "@cityjson/navara-core";
```

Write `src/domain/roofMetrics/types.ts`:

```ts
/** Re-export shim — `RoofMetrics` now lives in `@cityjson/navara-core` (M7.2). */
export type { RoofMetrics } from "@cityjson/navara-core";
```

Write `src/domain/roofMetrics/metrics.ts`:

```ts
/**
 * Re-export shim — the pure roof-geometry computations now live in
 * `@cityjson/navara-core` (M7.2); the FCB worker computes them per streamed
 * object, so they cannot live in the app.
 */
export {
  computeArea,
  computeAzimuth,
  computeElevation,
  computeInclination,
  computeRoofMetrics,
  computeSurfaceNormal,
} from "@cityjson/navara-core";
```

In `src/domain/geometry/derived.ts`, delete the `computeFootprintArea` function (lines 8–20, doc comment included) and re-export it instead, leaving `computeTotalRoofArea`, `computeVolume` and `computeSolarScore` byte-identical:

```ts
// src/domain/geometry/derived.ts — replacing the local computeFootprintArea
/** Re-export shim — moved to `@cityjson/navara-core` in M7.2 (the FCB worker
 *  needs it); the remaining functions in this file stay app-side. */
export { computeFootprintArea } from "@cityjson/navara-core";
```

Then delete the two moved app test files:

```bash
git rm tests/unit/domain/roofMetrics/metrics.test.ts tests/unit/features/rules/evaluate.test.ts
```

`tests/unit/domain/roofMetrics/aggregate.test.ts` and `tests/unit/features/rules/presets.test.ts` stay — they cover code that did not move.

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  58 passed (58)` with 0 failures — every consumer (`computeStats`, `objectRecords`, `InspectorPanel`, `RuleBuilderTab`, `applyRuleColors`, the FCB worker test) reaches the moved code through a shim.

- [ ] **Step 6: Write the failing srgb parity test in the plugin repo**

Create `packages/cityjson-navara-plugins/packages/navara-core/tests/styling/srgbHexToLinear.test.ts` by copying the three `srgbHexToLinear` describes from `tests/unit/scene/ruleColorsWorkerSafe.test.ts` (source lines 1–35 header comment, 39–95, 97–139, 140–264) with this import header:

```ts
import { describe, it, expect, vi } from "vitest";
import { Color } from "three";
import { srgbHexToLinear } from "../../src/styling/srgb";

// Independent (not imported from production) duplicate of the sRGB->linear
// channel formula, used only to build a "what the buggy un-expanded parse
// would have produced" comparison value in the 3-digit regression test
// below. Its own correctness is separately locked down by the three.Color
// parity tests above.
function srgbChannelToLinearForTest(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
```

- [ ] **Step 7: Write the failing evaluator test**

Create `packages/cityjson-navara-plugins/packages/navara-core/tests/styling/buildStyleColors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildStyleColorsFromArrays,
  type SurfaceStyleEvaluator,
} from "../../src/styling/buildStyleColors";
import type { CityModel, CityObject, Surface } from "../../src/citymodel/types";

function makeSurface(type: Surface["type"]): Surface {
  return {
    type,
    rings: [
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ],
    attributes: {},
    lod: "2",
  };
}

function makeModel(surfaces: Surface[]): CityModel {
  const object: CityObject = {
    id: "b1",
    objectType: "Building",
    attributes: {},
    surfaces,
    bbox: null,
    children: [],
    parents: [],
    lod: "2",
  };
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: { b1: object },
    vertexCount: 0,
  };
}

// Three vertices belonging to surface 0, three to surface 1, all of object 0.
const objectIndices = new Uint32Array([0, 0, 0, 0, 0, 0]);
const surfaceIndices = new Uint32Array([0, 0, 0, 1, 1, 1]);
const baseColors = new Float32Array(18).fill(0.5);

describe("buildStyleColorsFromArrays", () => {
  it("writes the evaluator's color on matching vertices and keeps base elsewhere", () => {
    const model = makeModel([
      makeSurface("RoofSurface"),
      makeSurface("WallSurface"),
    ]);
    const evaluate: SurfaceStyleEvaluator = (surface) =>
      surface.surface.type === "RoofSurface" ? [0.25, 0.5, 0.75] : null;

    const result = buildStyleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      evaluate,
      baseColors,
    );

    expect(result).not.toBeNull();
    // 0.25/0.5/0.75 are exactly representable in Float32Array, so toEqual is
    // safe here — do not substitute values like 0.1 that round on storage.
    expect([...result!.slice(0, 9)]).toEqual([
      0.25, 0.5, 0.75, 0.25, 0.5, 0.75, 0.25, 0.5, 0.75,
    ]);
    expect([...result!.slice(9)]).toEqual([
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    ]);
  });

  it("returns null when the evaluator never matches", () => {
    const model = makeModel([
      makeSurface("RoofSurface"),
      makeSurface("WallSurface"),
    ]);
    const result = buildStyleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      () => null,
      baseColors,
    );
    expect(result).toBeNull();
  });

  it("does not mutate the caller's baseColors", () => {
    const model = makeModel([
      makeSurface("RoofSurface"),
      makeSurface("WallSurface"),
    ]);
    buildStyleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      () => [1, 1, 1],
      baseColors,
    );
    expect([...baseColors]).toEqual(new Array(18).fill(0.5));
  });

  it("calls the evaluator once per (object, surface) pair, not per vertex", () => {
    const model = makeModel([
      makeSurface("RoofSurface"),
      makeSurface("RoofSurface"),
    ]);
    let calls = 0;
    buildStyleColorsFromArrays(
      model,
      objectIndices,
      surfaceIndices,
      ["b1"],
      () => {
        calls++;
        return [0, 0, 0];
      },
      baseColors,
    );
    expect(calls).toBe(2);
  });

  it("passes the resolved object id and surface index to the evaluator", () => {
    const model = makeModel([makeSurface("RoofSurface")]);
    const seen: Array<{ objectId: string; surfaceIndex: number }> = [];
    buildStyleColorsFromArrays(
      model,
      new Uint32Array([0, 0, 0]),
      new Uint32Array([0, 0, 0]),
      ["b1"],
      (surface, object) => {
        seen.push({
          objectId: object.objectId,
          surfaceIndex: surface.surfaceIndex,
        });
        return null;
      },
      new Float32Array(9),
    );
    expect(seen).toEqual([{ objectId: "b1", surfaceIndex: 0 }]);
  });

  it("skips vertices whose object key or surface index is unknown", () => {
    const model = makeModel([makeSurface("RoofSurface")]);
    const result = buildStyleColorsFromArrays(
      model,
      new Uint32Array([7, 7, 7]),
      new Uint32Array([0, 0, 0]),
      ["b1"],
      () => [1, 1, 1],
      new Float32Array(9),
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 8: Run both and watch them fail**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/styling)
```

Expected failure: `Failed to load url ../../src/styling/buildStyleColors` for the evaluator test; the srgb test passes already (Task A10 created `src/styling/srgb.ts`) — that is fine, it is the regression net for the app-side deletion in Step 5.

- [ ] **Step 9: Write the core styling module**

Create `packages/cityjson-navara-plugins/packages/navara-core/src/styling/buildStyleColors.ts`:

```ts
/**
 * Per-surface vertex recoloring driven by a host-supplied styling hook.
 *
 * The host (an app's rule engine, a thematic map, a legend) supplies a
 * `SurfaceStyleEvaluator`; this module walks the per-vertex object/surface
 * index arrays emitted by `buildCityMeshArrays`, resolves each vertex to its
 * `CityObject` + `Surface`, and writes the evaluator's Linear-sRGB color over
 * a copy of the base colors. The evaluator is called once per unique
 * (object, surface) pair, not once per vertex.
 *
 * Worker-safe: consumes plain typed arrays, no GPU/DOM types.
 *
 * Generalized from multiroof-viewer's `buildRuleColorsFromArrays`
 * (src/scene/applyRuleColors.ts:96-140), which hardcoded the rule engine;
 * the rule-specific parts (roof metrics, `matchRule`, RoofSurface gating)
 * are supplied by the caller through the evaluator — for static layers the
 * app compiles them (Task B14), for streaming layers the FCB worker does.
 */

import type { CityModel, CityObject, Surface } from "../citymodel/types";
import type { RGB } from "./srgb";

export interface SurfaceInfo {
  /** Index of the surface within `object.surfaces`. */
  readonly surfaceIndex: number;
  readonly surface: Surface;
}

export interface CityObjectInfo {
  /** ID of the city object the surface belongs to. */
  readonly objectId: string;
  readonly object: CityObject;
}

/**
 * Returns the Linear-sRGB color for a surface, or null to leave the surface
 * at its base (semantic) color.
 *
 * Both arguments carry their own identity (`surfaceIndex`, `objectId`), so no
 * third context argument is needed — this is the shape every consumer in this
 * plan uses (plugin `computeStyleColors`, app `compileRulesToEvaluator`).
 */
export type SurfaceStyleEvaluator = (
  surface: SurfaceInfo,
  object: CityObjectInfo,
) => RGB | null;

export function buildStyleColorsFromArrays(
  model: CityModel,
  objectIndices: Uint32Array,
  surfaceIndices: Uint32Array,
  objectKeys: ReadonlyArray<string>,
  evaluate: SurfaceStyleEvaluator,
  baseColors: Float32Array,
): Float32Array | null {
  const result = Float32Array.from(baseColors);
  let anyChange = false;

  // Cache: "objIdx:surfIdx" → resolved color, or null (no style)
  const colorCache = new Map<string, RGB | null>();

  for (let v = 0; v < objectIndices.length; v++) {
    const objIdx = objectIndices[v]!;
    const surfIdx = surfaceIndices[v]!;
    const cacheKey = `${objIdx}:${surfIdx}`;

    let styleColor = colorCache.get(cacheKey);
    if (styleColor === undefined) {
      styleColor = resolveStyleColor(
        objIdx,
        surfIdx,
        model,
        objectKeys,
        evaluate,
      );
      colorCache.set(cacheKey, styleColor);
    }

    if (styleColor) {
      const base = v * 3;
      result[base] = styleColor[0];
      result[base + 1] = styleColor[1];
      result[base + 2] = styleColor[2];
      anyChange = true;
    }
  }

  return anyChange ? result : null;
}

function resolveStyleColor(
  objIdx: number,
  surfIdx: number,
  model: CityModel,
  objectKeys: ReadonlyArray<string>,
  evaluate: SurfaceStyleEvaluator,
): RGB | null {
  const objectId = objectKeys[objIdx];
  if (!objectId) return null;

  const object = model.objects[objectId];
  if (!object) return null;

  const surface = object.surfaces[surfIdx];
  if (!surface) return null;

  return evaluate({ surfaceIndex: surfIdx, surface }, { objectId, object });
}
```

Append to `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`:

```ts
export type { RGB } from "./styling/srgb";
export { srgbHexToLinear } from "./styling/srgb";
export type {
  CityObjectInfo,
  SurfaceInfo,
  SurfaceStyleEvaluator,
} from "./styling/buildStyleColors";
export { buildStyleColorsFromArrays } from "./styling/buildStyleColors";
```

- [ ] **Step 10: Run the plugin tests and watch them pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run && pnpm typecheck)
```

Expected: `Test Files  11 passed (11)`; the six `buildStyleColorsFromArrays` cases and every srgb parity case pass, alongside the three suites moved in Steps 1–4; `tsc -b` prints nothing.

- [ ] **Step 11: Rewrite the app's `applyRuleColors.ts` as a rules→evaluator adapter**

Write `src/scene/applyRuleColors.ts`:

```ts
/**
 * Compiles the app's per-layer colorization rules into a
 * `SurfaceStyleEvaluator` and delegates the vertex walk to
 * `@cityjson/navara-core`.
 *
 * The rule engine (`matchRule`), the roof metrics and the format-agnostic
 * recoloring loop all live in `@cityjson/navara-core` now (M7.2 of the Navara
 * migration); this file is the thin app-side adapter that keeps
 * `buildRuleColorsFromArrays` and `buildRuleColors` at their previous
 * signatures and semantics, so the FCB worker and the R3F scene are
 * unaffected until they are rewired in Parts B and C.
 */

import type { BufferGeometry } from "three";
import {
  buildStyleColorsFromArrays,
  srgbHexToLinear,
  type PickingIndex,
  type RGB,
  type SurfaceStyleEvaluator,
} from "@cityjson/navara-core";
import type { CityModel } from "../domain/citymodel/types";
import {
  computeRoofMetrics,
  matchRule,
  type Rule,
} from "@cityjson/navara-core";

export { srgbHexToLinear };
export type { SurfaceStyleEvaluator };

const linearCache = new Map<string, RGB>();
function cachedLinear(hex: string): RGB {
  let c = linearCache.get(hex);
  if (!c) {
    c = srgbHexToLinear(hex);
    linearCache.set(hex, c);
  }
  return c;
}

/**
 * Compile enabled rules into a per-surface styling hook.
 *
 * Returns null when no rule is enabled, so callers can fall back to
 * baseColors without walking any vertices. Only RoofSurfaces are rule-colored
 * — every other semantic type keeps its base color.
 */
export function compileRuleEvaluator(
  rules: ReadonlyArray<Rule>,
): SurfaceStyleEvaluator | null {
  const enabledRules = rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) return null;

  return (surface, object) => {
    if (surface.surface.type !== "RoofSurface") return null;

    const metrics = computeRoofMetrics(surface.surface);
    // Merge object attributes and surface attributes for rule evaluation
    const attributes = {
      ...object.object.attributes,
      ...surface.surface.attributes,
    };
    const colorHex = matchRule(attributes, metrics, enabledRules);
    if (!colorHex) return null;

    return cachedLinear(colorHex);
  };
}

/**
 * Build a ruleColors array from the current rules and model.
 *
 * Returns null if no rules produced any color changes (all non-roof
 * or no matches), allowing the caller to fall back to baseColors.
 *
 * Worker-safe: consumes plain typed arrays, no BufferGeometry/Color.
 */
export function buildRuleColorsFromArrays(
  model: CityModel,
  objectIndices: Uint32Array,
  surfaceIndices: Uint32Array,
  objectKeys: ReadonlyArray<string>,
  rules: ReadonlyArray<Rule>,
  baseColors: Float32Array,
): Float32Array | null {
  const evaluate = compileRuleEvaluator(rules);
  if (!evaluate) return null;

  return buildStyleColorsFromArrays(
    model,
    objectIndices,
    surfaceIndices,
    objectKeys,
    evaluate,
    baseColors,
  );
}

/**
 * Build a ruleColors array from the current rules and model.
 *
 * Thin wrapper around `buildRuleColorsFromArrays` — reads the object/surface
 * index attributes off the geometry and delegates. Kept for the static
 * (main-thread) rendering path.
 */
export function buildRuleColors(
  model: CityModel,
  geometry: BufferGeometry,
  pickingIndex: PickingIndex,
  rules: ReadonlyArray<Rule>,
  baseColors: Float32Array,
): Float32Array | null {
  const objIdxAttr = geometry.getAttribute("objectIndex");
  const surfIdxAttr = geometry.getAttribute("surfaceIndex");
  if (!objIdxAttr || !surfIdxAttr) return null;

  const vertexCount = objIdxAttr.count;
  const objectIndices = new Uint32Array(vertexCount);
  const surfaceIndices = new Uint32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    objectIndices[v] = objIdxAttr.getX(v);
    surfaceIndices[v] = surfIdxAttr.getX(v);
  }

  return buildRuleColorsFromArrays(
    model,
    objectIndices,
    surfaceIndices,
    pickingIndex.objectKeys,
    rules,
    baseColors,
  );
}
```

- [ ] **Step 12: Trim the moved describes out of the app test file**

In `tests/unit/scene/ruleColorsWorkerSafe.test.ts`, delete the three `srgbHexToLinear …` describes (lines 39–264) and the `srgbChannelToLinearForTest` helper, keeping `describe("buildRuleColorsFromArrays", …)` and `describe("buildRuleColors (BufferGeometry wrapper)", …)` — those exercise the app's rule adapter and must stay green unchanged. Update the header to:

```ts
import { describe, it, expect } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import {
  buildRuleColorsFromArrays,
  buildRuleColors,
} from "../../../src/scene/applyRuleColors";
import type {
  CityModel,
  CityObject,
  Surface,
} from "../../../src/domain/citymodel/types";
import type { Rule } from "@cityjson/navara-core";
```

(`Color` and `vi` are no longer used by the remaining describes and are dropped from the imports.)

- [ ] **Step 13: Verify the app is still green**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  58 passed (58)` with 0 failures. The retained `buildRuleColorsFromArrays` describe passing is the proof that the adapter preserved behavior (empty-rules → null, no-match → null, roof-only coloring, per-pair caching).

- [ ] **Step 14: Commit in the submodule, then bump the pointer with the app changes**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/src packages/navara-core/tests
git commit -m "$(cat <<'EOF'
feat: move the rule engine and roof metrics into core, add SurfaceStyleEvaluator

The colorization-rule schema, matchRule, the roof-metric computations and
computeFootprintArea move into @cityjson/navara-core so the FlatCityBuf worker
can evaluate rules off the main thread. buildStyleColorsFromArrays generalizes
multiroof-viewer's buildRuleColorsFromArrays: the vertex walk and the
sRGB->linear conversion live in core, and the styling hook is injected as an
evaluator callback for static layers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins src/scene/applyRuleColors.ts src/features/rules/types.ts src/features/rules/evaluate.ts src/domain/roofMetrics/types.ts src/domain/roofMetrics/metrics.ts src/domain/geometry/derived.ts tests/unit/scene/ruleColorsWorkerSafe.test.ts tests/unit/domain/roofMetrics/metrics.test.ts tests/unit/features/rules/evaluate.test.ts
git commit -m "$(cat <<'EOF'
refactor: re-export rules and roof metrics from @cityjson/navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A13: Move the CRS proj4 definitions into core

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/crsProjDefs.ts`, `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/crsProjDefs.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`, `src/domain/citymodel/crsProjDefs.ts`, `src/features/solar/solarStore.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/crsProjDefs.test.ts`

**Interfaces:**

- Consumes: `proj4` (core dependency)
- Produces (from `@cityjson/navara-core`): `ensureProjDef(epsgCode: number): boolean` **and** `parseEpsgCode(uri: string | undefined): number | null`

`parseEpsgCode` moves here out of `src/features/solar/solarStore.ts`: three later consumers need it outside the app (Task B4's CRS gate, Task B13's cursor readout, Task C15's solar rewrite), and a store module is the wrong home for a pure CRS-URI parser.

- [ ] **Step 1: Write the failing test**

Create `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/crsProjDefs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import proj4 from "proj4";
import { ensureProjDef, parseEpsgCode } from "../../src/citymodel/crsProjDefs";

// ensureProjDef mutates proj4's global registry, so these cases assert on the
// registry's observable state rather than on isolation between them.
describe("ensureProjDef", () => {
  it("reports true for CRS proj4 ships built in, without registering anything", () => {
    expect(ensureProjDef(4326)).toBe(true);
    expect(proj4.defs("EPSG:4326")).toBeTruthy();
  });

  it("registers RD New for EPSG:28992 and reports metres", () => {
    expect(ensureProjDef(28992)).toBe(true);
    const def = proj4.defs("EPSG:28992") as { units?: string; proj?: string };
    expect(def.proj).toBe("sterea");
    expect(def.units).toBe("m");
  });

  it("registers the RD New horizontal component for the EPSG:7415 compound CRS", () => {
    expect(ensureProjDef(7415)).toBe(true);
    const def = proj4.defs("EPSG:7415") as { units?: string; proj?: string };
    expect(def.proj).toBe("sterea");
    expect(def.units).toBe("m");
  });

  it("is idempotent — a second call keeps the same definition", () => {
    ensureProjDef(28992);
    const first = proj4.defs("EPSG:28992");
    expect(ensureProjDef(28992)).toBe(true);
    expect(proj4.defs("EPSG:28992")).toBe(first);
  });

  it("reports false for a CRS that is neither built in nor in the fixed list", () => {
    expect(ensureProjDef(99999)).toBe(false);
    expect(proj4.defs("EPSG:99999")).toBeUndefined();
  });

  it("reprojects an RD New coordinate into WGS84 near Delft", () => {
    ensureProjDef(28992);
    const [lon, lat] = proj4("EPSG:28992", "EPSG:4326", [85530, 446100]);
    expect(lon).toBeCloseTo(4.36, 1);
    expect(lat).toBeCloseTo(52.01, 1);
  });
});

// Moved verbatim from tests/unit/features/solar/solarStore.test.ts (the five
// parseEpsgCode cases); the app file keeps its own describes for the solar
// store itself.
describe("parseEpsgCode", () => {
  it("parses an OGC CRS URI", () => {
    expect(parseEpsgCode("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(
      7415,
    );
  });

  it("parses a bare EPSG path", () => {
    expect(parseEpsgCode("EPSG/0/28992")).toBe(28992);
  });

  it("returns null for undefined", () => {
    expect(parseEpsgCode(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseEpsgCode("")).toBeNull();
  });

  it("returns null when the last segment is not a positive number", () => {
    expect(parseEpsgCode("https://example.com/crs/foo")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/citymodel/crsProjDefs.test.ts)
```

Expected failure: `Failed to load url ../../src/citymodel/crsProjDefs`.

- [ ] **Step 3: Move the source file verbatim**

Move `src/domain/citymodel/crsProjDefs.ts` (all 45 lines, including `RD_NEW_DEF`, `KNOWN_PROJ4_DEFS`, `ensureProjDef` and the module docblock) to `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/crsProjDefs.ts`. Its only import (`import proj4 from "proj4";`) is unchanged; edit the second paragraph of the docblock, which references app-only layers, to:

```ts
 * This module is the single place that registration happens. It lives in
 * the core package so both host-facing features (solar position, which
 * reprojects a model's CRS to lat/lon) and format-agnostic plugin code
 * (FlatCityBuf admission, which only needs to know whether a CRS is metric)
 * share one list instead of maintaining two that can silently drift apart.
```

Then append `parseEpsgCode`, moved verbatim from `src/features/solar/solarStore.ts` (lines 60–72, including its docblock), to the same file:

```ts
/**
 * Parse EPSG code from an OGC URI like
 * "https://www.opengis.net/def/crs/EPSG/0/7415" → 7415.
 */
export function parseEpsgCode(uri: string | undefined): number | null {
  if (!uri) return null;
  const segments = uri.split("/");
  const last = segments[segments.length - 1];
  if (!last) return null;
  const code = Number(last);
  return Number.isFinite(code) && code > 0 ? code : null;
}
```

- [ ] **Step 4: Export from the core barrel**

Append to `packages/cityjson-navara-plugins/packages/navara-core/src/index.ts`:

```ts
export { ensureProjDef, parseEpsgCode } from "./citymodel/crsProjDefs";
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run && pnpm typecheck)
```

Expected: `Test Files  12 passed (12)`, the six `ensureProjDef` and five `parseEpsgCode` cases green; `tsc -b` prints nothing.

- [ ] **Step 6: Replace the app module with a re-export shim**

Write `src/domain/citymodel/crsProjDefs.ts`:

```ts
/**
 * Re-export shim — proj4 EPSG registration now lives in
 * `@cityjson/navara-core` (M7.2 of the Navara migration). Importing through
 * this path keeps `solarStore` and `fcbSource` on the same proj4 registry.
 */

export { ensureProjDef } from "@cityjson/navara-core";
```

In `src/features/solar/solarStore.ts`, delete the local `parseEpsgCode`
definition (lines 60–72) and re-export the core one so the store's own call
site (line 182) and `tests/unit/features/solar/solarStore.test.ts` stay green
unchanged. Task C15 removes this re-export and has the test import from
`@cityjson/navara-core` directly:

```ts
import { ensureProjDef, parseEpsgCode } from "@cityjson/navara-core";

/** Re-exported for existing call sites; the definition now lives in
 *  @cityjson/navara-core (M7.2). Task C15 drops this re-export. */
export { parseEpsgCode };
```

- [ ] **Step 7: Verify the app is still green**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5
```

Expected: `tsc` prints nothing; vitest prints `Test Files  58 passed (58)` with 0 failures — in particular `tests/unit/domain/citymodel/flatcitybuf/fcbSource.test.ts` (the CRS admission matrix) and `tests/unit/features/solar/solarStore.test.ts` still pass, proving both consumers share one proj4 registry through the shim.

- [ ] **Step 8: Commit in the submodule, then bump the pointer with the app changes**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/src packages/navara-core/tests
git commit -m "$(cat <<'EOF'
refactor: move proj4 EPSG registration and parseEpsgCode into navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins src/domain/citymodel/crsProjDefs.ts src/features/solar/solarStore.ts
git commit -m "$(cat <<'EOF'
refactor: re-export ensureProjDef and parseEpsgCode from @cityjson/navara-core

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A13b: `enuFrame.ts` in navara-core — the ENU replacement for `sceneTransform.ts`

**Files:**

- Create: `/data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/src/geo/enuFrame.ts`
- Create: `.../packages/navara-core/src/geo/sourceToEnu.ts`
- Create: `.../packages/navara-core/src/geo/geoidHeight.ts`
- Modify: `.../packages/navara-core/src/index.ts` (re-export all three)
- Test: `.../packages/navara-core/tests/enuFrame.test.ts`, `.../packages/navara-core/tests/sourceToEnu.test.ts`, `.../packages/navara-core/tests/geoidHeight.test.ts`

**Interfaces:**

- Consumes: `proj4` (test oracle for `enuFrame`; production dependency of `sourceToEnu`), `ensureProjDef` from `../citymodel/crsProjDefs` (Task A13)
- Produces:

  ```ts
  export interface EnuFrame {
    readonly lngDeg: number;
    readonly latDeg: number;
    readonly heightM: number;
    readonly originEcef: readonly [number, number, number];
    /** Column-major 4x4, ENU(metres) -> ECEF(metres). */
    readonly matrix: Float64Array;
  }
  export function geodeticToEcef(
    lngDeg: number,
    latDeg: number,
    heightM: number,
  ): [number, number, number];
  export function ecefToGeodetic(p: readonly [number, number, number]): {
    lngDeg: number;
    latDeg: number;
    heightM: number;
  };
  export function makeEnuFrame(
    lngDeg: number,
    latDeg: number,
    heightM: number,
  ): EnuFrame;
  export function enuToEcef(
    frame: EnuFrame,
    v: readonly [number, number, number],
  ): [number, number, number];
  export function ecefToEnu(
    frame: EnuFrame,
    p: readonly [number, number, number],
  ): [number, number, number];

  // ── sourceToEnu.ts ──────────────────────────────────────────────────────
  export interface SourceToEnuOptions {
    readonly epsg: number;
    readonly frame: EnuFrame;
    readonly heightOffset: number;
  }
  export interface ProjectPositionsOptions extends SourceToEnuOptions {
    readonly originOffset: readonly [number, number, number];
  }
  export function sourceToEnuPoint(
    x: number,
    y: number,
    z: number,
    opts: SourceToEnuOptions,
  ): [number, number, number];
  /** In-place: origin-relative source deltas -> local ENU metres. */
  export function projectPositionsToEnu(
    positions: Float32Array,
    opts: ProjectPositionsOptions,
  ): Float32Array;

  // ── geoidHeight.ts ──────────────────────────────────────────────────────
  /** EGM2008 geoid undulation in metres at (lng, lat), i.e. exactly the
   *  `heightOffset` that turns an orthometric height into an ellipsoidal one.
   *  Resolves 0 (with a console.warn) if the service is unreachable. */
  export function geoidHeightAt(
    lngDeg: number,
    latDeg: number,
    fetchImpl?: typeof fetch,
  ): Promise<number>;
  /** Test seam: drops the cached TileJSON promise. */
  export function resetGeoidCacheForTest(): void;
  export const GEOID_TILEJSON_URL: string;
  export const GEOID_ATTRIBUTION: readonly string[];
  ```

**Steps:**

- [ ] **Step 1: Make the directory.** `mkdir -p /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/src/geo`

This module ships here, in Part A, rather than with the streaming work it was first written for: Task B4 builds every static layer's placement matrix from `makeEnuFrame`, and Task C8 builds every streaming cell's frame from it. One implementation, so static and streaming frames agree bit-for-bit.

- [ ] **Step 2: Write the failing test** at `packages/navara-core/tests/enuFrame.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import proj4 from "proj4";
  import {
    ecefToEnu,
    ecefToGeodetic,
    enuToEcef,
    geodeticToEcef,
    makeEnuFrame,
  } from "../src/geo/enuFrame";

  // Independent oracle: geocentric WGS84, so the assertions do not re-derive
  // the implementation's own formula.
  proj4.defs("EPSG:4978", "+proj=geocent +datum=WGS84 +units=m +no_defs");
  const DELFT = { lng: 4.3571, lat: 52.0116, h: 0 };

  describe("geodeticToEcef", () => {
    it("matches proj4's geocentric transform within 1 mm", () => {
      const got = geodeticToEcef(DELFT.lng, DELFT.lat, DELFT.h);
      const want = proj4("EPSG:4326", "EPSG:4978", [
        DELFT.lng,
        DELFT.lat,
        DELFT.h,
      ]) as [number, number, number];
      expect(got[0]).toBeCloseTo(want[0], 3);
      expect(got[1]).toBeCloseTo(want[1], 3);
      expect(got[2]).toBeCloseTo(want[2], 3);
    });
  });

  describe("ecefToGeodetic", () => {
    it("inverts geodeticToEcef to sub-millidegree / sub-millimetre", () => {
      const p = geodeticToEcef(DELFT.lng, DELFT.lat, 43.2);
      const g = ecefToGeodetic(p);
      expect(g.lngDeg).toBeCloseTo(DELFT.lng, 9);
      expect(g.latDeg).toBeCloseTo(DELFT.lat, 9);
      expect(g.heightM).toBeCloseTo(43.2, 3);
    });
  });

  describe("makeEnuFrame", () => {
    it("is z-up ENU: +x is east, +y is north, +z is up — no axis swap, unlike the retired sceneTransform", () => {
      const f = makeEnuFrame(DELFT.lng, DELFT.lat, 0);
      const east = enuToEcef(f, [1, 0, 0]).map((c, i) => c - f.originEcef[i]!);
      const north = enuToEcef(f, [0, 1, 0]).map((c, i) => c - f.originEcef[i]!);
      const up = enuToEcef(f, [0, 0, 1]).map((c, i) => c - f.originEcef[i]!);

      const lam = (DELFT.lng * Math.PI) / 180;
      // East basis is exactly (-sin λ, cos λ, 0).
      expect(east[0]).toBeCloseTo(-Math.sin(lam), 9);
      expect(east[1]).toBeCloseTo(Math.cos(lam), 9);
      expect(east[2]).toBeCloseTo(0, 9);
      // Up points away from the geocentre; north has a positive z component
      // in the northern hemisphere.
      expect(
        up[0]! * f.originEcef[0]! + up[2]! * f.originEcef[2]!,
      ).toBeGreaterThan(0);
      expect(north[2]).toBeGreaterThan(0);
      // Orthonormal.
      expect(
        east[0]! * north[0]! + east[1]! * north[1]! + east[2]! * north[2]!,
      ).toBeCloseTo(0, 9);
    });

    it("round-trips ecefToEnu(enuToEcef(v)) to millimetre accuracy 5 km out", () => {
      const f = makeEnuFrame(DELFT.lng, DELFT.lat, 0);
      const v = [3200, -4100, 87] as const;
      const back = ecefToEnu(f, enuToEcef(f, v));
      expect(back[0]).toBeCloseTo(v[0], 3);
      expect(back[1]).toBeCloseTo(v[1], 3);
      expect(back[2]).toBeCloseTo(v[2], 3);
    });

    it("places a point 1000 m east of the origin at a larger longitude and the same latitude", () => {
      const f = makeEnuFrame(DELFT.lng, DELFT.lat, 0);
      const g = ecefToGeodetic(enuToEcef(f, [1000, 0, 0]));
      expect(g.lngDeg).toBeGreaterThan(DELFT.lng);
      expect(g.latDeg).toBeCloseTo(DELFT.lat, 4);
    });
  });
  ```

- [ ] **Step 3: Run it — expect failure.** `cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-core/tests/enuFrame.test.ts` → `Error: Failed to resolve import "../src/geo/enuFrame"`.
- [ ] **Step 4: Implement `packages/navara-core/src/geo/enuFrame.ts`.**

  ```ts
  /**
   * WGS84 geodetic <-> ECEF <-> local ENU. Replaces the retired
   * `src/features/streaming/sceneTransform.ts`, whose `R·v = (v.x, v.z, −v.y)`
   * existed only because Three meshes were rotated −π/2 about X to fake Z-up.
   * Navara's ENU frame is already x=east, y=north, z=up, which is exactly
   * CityJSON's axis order — so the local->frame step is the identity and the
   * only transform left is the frame matrix itself.
   */
  const A = 6378137.0;
  const F = 1 / 298.257223563;
  const E2 = F * (2 - F);
  const B = A * (1 - F);
  const EP2 = (A * A - B * B) / (B * B);

  export interface EnuFrame {
    readonly lngDeg: number;
    readonly latDeg: number;
    readonly heightM: number;
    readonly originEcef: readonly [number, number, number];
    /** Column-major 4x4, ENU(metres) -> ECEF(metres). */
    readonly matrix: Float64Array;
  }

  export function geodeticToEcef(
    lngDeg: number,
    latDeg: number,
    heightM: number,
  ): [number, number, number] {
    const lam = (lngDeg * Math.PI) / 180;
    const phi = (latDeg * Math.PI) / 180;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const n = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
    return [
      (n + heightM) * cosPhi * Math.cos(lam),
      (n + heightM) * cosPhi * Math.sin(lam),
      (n * (1 - E2) + heightM) * sinPhi,
    ];
  }

  /** Bowring's closed-form inverse: no iteration, sub-mm for terrestrial heights. */
  export function ecefToGeodetic(p: readonly [number, number, number]): {
    lngDeg: number;
    latDeg: number;
    heightM: number;
  } {
    const [x, y, z] = p;
    const r = Math.hypot(x, y);
    const theta = Math.atan2(z * A, r * B);
    const phi = Math.atan2(
      z + EP2 * B * Math.sin(theta) ** 3,
      r - E2 * A * Math.cos(theta) ** 3,
    );
    const sinPhi = Math.sin(phi);
    const n = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
    return {
      lngDeg: (Math.atan2(y, x) * 180) / Math.PI,
      latDeg: (phi * 180) / Math.PI,
      heightM: r / Math.cos(phi) - n,
    };
  }

  export function makeEnuFrame(
    lngDeg: number,
    latDeg: number,
    heightM: number,
  ): EnuFrame {
    const originEcef = geodeticToEcef(lngDeg, latDeg, heightM);
    const lam = (lngDeg * Math.PI) / 180;
    const phi = (latDeg * Math.PI) / 180;
    const sl = Math.sin(lam);
    const cl = Math.cos(lam);
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    // Columns: east, north, up, translation (column-major, Three-compatible).
    const matrix = new Float64Array([
      -sl,
      cl,
      0,
      0,
      -sp * cl,
      -sp * sl,
      cp,
      0,
      cp * cl,
      cp * sl,
      sp,
      0,
      originEcef[0],
      originEcef[1],
      originEcef[2],
      1,
    ]);
    return { lngDeg, latDeg, heightM, originEcef, matrix };
  }

  export function enuToEcef(
    frame: EnuFrame,
    v: readonly [number, number, number],
  ): [number, number, number] {
    const m = frame.matrix;
    return [
      m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2] + m[12]!,
      m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2] + m[13]!,
      m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2] + m[14]!,
    ];
  }

  export function ecefToEnu(
    frame: EnuFrame,
    p: readonly [number, number, number],
  ): [number, number, number] {
    const m = frame.matrix;
    const dx = p[0] - m[12]!;
    const dy = p[1] - m[13]!;
    const dz = p[2] - m[14]!;
    // The rotation block is orthonormal, so the inverse is its transpose.
    return [
      m[0]! * dx + m[1]! * dy + m[2]! * dz,
      m[4]! * dx + m[5]! * dy + m[6]! * dz,
      m[8]! * dx + m[9]! * dy + m[10]! * dz,
    ];
  }
  ```

- [ ] **Step 5: Re-export.** Add `export * from "./geo/enuFrame";` to `packages/navara-core/src/index.ts`.
- [ ] **Step 6: Run — expect pass.** `pnpm vitest run packages/navara-core/tests/enuFrame.test.ts` → 5 passed.

- [ ] **Step 7: Write the failing test for the exact source-CRS → ENU transform**

`makeEnuFrame` places an origin; it does not place _vertices_. `buildCityMeshArrays` emits source-CRS deltas from the layer/cell origin, and those deltas are **not** ENU metres: a projected CRS carries a scale factor (RD New ≈ 0.9999908 near Amersfoort) and grid convergence (up to ~0.5° across the Netherlands), so a vertex 5 km from the origin lands metres away from where it belongs and a whole model is subtly rotated. This module does the transform exactly, once per geometry build.

Create `packages/navara-core/tests/sourceToEnu.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import proj4 from "proj4";
import { ensureProjDef } from "../src/citymodel/crsProjDefs";
import { geodeticToEcef, makeEnuFrame } from "../src/geo/enuFrame";
import {
  projectPositionsToEnu,
  sourceToEnuPoint,
} from "../src/geo/sourceToEnu";

// EPSG:7415 = RD New (x/y) + NAP (z), the two-buildings and Delft fixtures' CRS.
const EPSG = 7415;
// Amersfoort-ish origin, then a point 5 km north-east of it: far enough that
// projection scale + convergence are metres, not rounding noise.
const ORIGIN: readonly [number, number, number] = [155000, 463000, 0];
const FAR: readonly [number, number, number] = [160000, 468000, 12];

describe("sourceToEnuPoint", () => {
  it("matches a direct proj4 -> ECEF -> inverse-ENU computation for a far-from-origin point", () => {
    ensureProjDef(EPSG);
    const [oLng, oLat] = proj4(`EPSG:${EPSG}`, "WGS84", [
      ORIGIN[0],
      ORIGIN[1],
    ]) as [number, number];
    const frame = makeEnuFrame(oLng, oLat, 0);

    const got = sourceToEnuPoint(FAR[0], FAR[1], FAR[2], {
      epsg: EPSG,
      frame,
      heightOffset: 0,
    });

    // Independent oracle: proj4 to geodetic, geodetic to ECEF, then the
    // frame's transpose-rotation inverse, written out longhand here.
    const [lng, lat] = proj4(`EPSG:${EPSG}`, "WGS84", [FAR[0], FAR[1]]) as [
      number,
      number,
    ];
    const p = geodeticToEcef(lng, lat, FAR[2]);
    const m = frame.matrix;
    const dx = p[0] - m[12]!;
    const dy = p[1] - m[13]!;
    const dz = p[2] - m[14]!;
    const want: [number, number, number] = [
      m[0]! * dx + m[1]! * dy + m[2]! * dz,
      m[4]! * dx + m[5]! * dy + m[6]! * dz,
      m[8]! * dx + m[9]! * dy + m[10]! * dz,
    ];

    const scale = Math.hypot(want[0], want[1], want[2]);
    expect(Math.abs(got[0] - want[0]) / scale).toBeLessThan(1e-6);
    expect(Math.abs(got[1] - want[1]) / scale).toBeLessThan(1e-6);
    expect(Math.abs(got[2] - want[2]) / scale).toBeLessThan(1e-6);
  });

  it("differs measurably from the naive 'source deltas are ENU metres' shortcut", () => {
    ensureProjDef(EPSG);
    const [oLng, oLat] = proj4(`EPSG:${EPSG}`, "WGS84", [
      ORIGIN[0],
      ORIGIN[1],
    ]) as [number, number];
    const frame = makeEnuFrame(oLng, oLat, 0);
    const got = sourceToEnuPoint(FAR[0], FAR[1], FAR[2], {
      epsg: EPSG,
      frame,
      heightOffset: 0,
    });
    const naive = [FAR[0] - ORIGIN[0], FAR[1] - ORIGIN[1], FAR[2]] as const;
    // This is the whole point of the module: at 7 km out the shortcut is off
    // by more than a decimetre, which is visible against photoreal terrain.
    expect(Math.hypot(got[0] - naive[0], got[1] - naive[1])).toBeGreaterThan(
      0.1,
    );
  });

  it("adds heightOffset to the geodetic height, raising the point by that many metres", () => {
    ensureProjDef(EPSG);
    const [oLng, oLat] = proj4(`EPSG:${EPSG}`, "WGS84", [
      ORIGIN[0],
      ORIGIN[1],
    ]) as [number, number];
    const frame = makeEnuFrame(oLng, oLat, 0);
    const at0 = sourceToEnuPoint(ORIGIN[0], ORIGIN[1], 0, {
      epsg: EPSG,
      frame,
      heightOffset: 0,
    });
    const at43 = sourceToEnuPoint(ORIGIN[0], ORIGIN[1], 0, {
      epsg: EPSG,
      frame,
      heightOffset: 43,
    });
    expect(at43[2] - at0[2]).toBeCloseTo(43, 6);
    expect(at43[0]).toBeCloseTo(at0[0], 6);
    expect(at43[1]).toBeCloseTo(at0[1], 6);
  });
});

describe("projectPositionsToEnu", () => {
  it("rewrites a positions buffer of origin-relative source deltas in place", () => {
    ensureProjDef(EPSG);
    const [oLng, oLat] = proj4(`EPSG:${EPSG}`, "WGS84", [
      ORIGIN[0],
      ORIGIN[1],
    ]) as [number, number];
    const frame = makeEnuFrame(oLng, oLat, 0);
    const positions = new Float32Array([
      0,
      0,
      0,
      FAR[0] - ORIGIN[0],
      FAR[1] - ORIGIN[1],
      FAR[2],
    ]);
    projectPositionsToEnu(positions, {
      originOffset: ORIGIN,
      epsg: EPSG,
      frame,
      heightOffset: 0,
    });
    // The origin vertex stays at the frame origin.
    expect(positions[0]).toBeCloseTo(0, 3);
    expect(positions[1]).toBeCloseTo(0, 3);
    expect(positions[2]).toBeCloseTo(0, 3);
    const want = sourceToEnuPoint(FAR[0], FAR[1], FAR[2], {
      epsg: EPSG,
      frame,
      heightOffset: 0,
    });
    expect(positions[3]).toBeCloseTo(want[0], 2);
    expect(positions[4]).toBeCloseTo(want[1], 2);
    expect(positions[5]).toBeCloseTo(want[2], 2);
  });
});
```

- [ ] **Step 8: Run — expect failure.** `pnpm vitest run packages/navara-core/tests/sourceToEnu.test.ts` → `Failed to resolve import "../src/geo/sourceToEnu"`.

- [ ] **Step 9: Implement `packages/navara-core/src/geo/sourceToEnu.ts`.**

  ```ts
  /**
   * Exact source-CRS -> local-ENU vertex placement.
   *
   * `buildCityMeshArrays` emits vertices as *source-CRS deltas* from a chosen
   * origin (the model's bbox centre, or a streaming cell's centre). Those
   * deltas are NOT ENU metres: a projected CRS carries a point scale factor
   * and a grid convergence angle, so treating "x=east, y=north" as an identity
   * mapping mis-places and mis-rotates everything more than a few hundred
   * metres from the origin. Against photorealistic terrain that is visible.
   *
   * So each vertex is transformed exactly:
   *
   *     source (x, y, z)
   *       -> proj4(EPSG:n -> WGS84)          = (lng, lat)
   *       -> height = z + heightOffset
   *       -> geodeticToEcef                  = ECEF metres
   *       -> inverse of the frame's ENU matrix = local ENU metres
   *
   * The cost is one proj4 call per vertex, paid once per geometry build (a LoD
   * change, or a worker decoding a cell) — never per frame. In the FlatCityBuf
   * pipeline it runs inside the worker.
   */
  import proj4 from "proj4";
  import { ensureProjDef } from "../citymodel/crsProjDefs";
  import { geodeticToEcef, type EnuFrame } from "./enuFrame";

  export interface SourceToEnuOptions {
    /** Source CRS of the incoming x/y. Must already be proj4-registrable. */
    readonly epsg: number;
    /** Destination frame; its origin height already includes `heightOffset`. */
    readonly frame: EnuFrame;
    /** Metres added to every vertex's geodetic height: the geoid undulation
     *  at the layer/cell origin, from `geoidHeightAt()` (see Global
     *  Constraints -> Vertical datum). 0 means "treat z as ellipsoidal". */
    readonly heightOffset: number;
  }

  export interface ProjectPositionsOptions extends SourceToEnuOptions {
    /** The source-CRS origin the positions buffer is relative to. */
    readonly originOffset: readonly [number, number, number];
  }

  export function sourceToEnuPoint(
    x: number,
    y: number,
    z: number,
    opts: SourceToEnuOptions,
  ): [number, number, number] {
    ensureProjDef(opts.epsg);
    const [lng, lat] = proj4(`EPSG:${opts.epsg}`, "WGS84", [x, y]) as [
      number,
      number,
    ];
    const p = geodeticToEcef(lng, lat, z + opts.heightOffset);
    const m = opts.frame.matrix;
    const dx = p[0] - m[12]!;
    const dy = p[1] - m[13]!;
    const dz = p[2] - m[14]!;
    // The rotation block is orthonormal, so its inverse is its transpose.
    return [
      m[0]! * dx + m[1]! * dy + m[2]! * dz,
      m[4]! * dx + m[5]! * dy + m[6]! * dz,
      m[8]! * dx + m[9]! * dy + m[10]! * dz,
    ];
  }

  /**
   * In-place rewrite of a `CityMeshArrays.positions` buffer: origin-relative
   * source deltas in, local ENU metres out. Float64 is used throughout the
   * computation; only the final store is Float32, which is safe because the
   * result is small (metres from a nearby origin), unlike the ECEF value.
   */
  export function projectPositionsToEnu(
    positions: Float32Array,
    opts: ProjectPositionsOptions,
  ): Float32Array {
    const [ox, oy, oz] = opts.originOffset;
    for (let i = 0; i < positions.length; i += 3) {
      const enu = sourceToEnuPoint(
        positions[i]! + ox,
        positions[i + 1]! + oy,
        positions[i + 2]! + oz,
        opts,
      );
      positions[i] = enu[0];
      positions[i + 1] = enu[1];
      positions[i + 2] = enu[2];
    }
    return positions;
  }
  ```

  Add `export * from "./geo/sourceToEnu";` to `packages/navara-core/src/index.ts`.

  Note the ordering dependency: this module imports `ensureProjDef` from `./citymodel/crsProjDefs`, which Task A13 created — so A13b genuinely must run after A13, as the task order already says.

- [ ] **Step 10: Run — expect pass.** `pnpm vitest run packages/navara-core/tests/sourceToEnu.test.ts packages/navara-core/tests/enuFrame.test.ts` → 9 passed (5 enuFrame + 4 sourceToEnu).

- [ ] **Step 11: Write the failing geoid-sampling test**

`heightOffset` is not a per-CRS constant — it is the **EGM2008 geoid undulation** at the layer's origin, sampled from the Re:Earth Terrain service (Global Constraints → Vertical datum). `ellipsoidal = orthometric + undulation`, so the sampled value _is_ the offset. The service is global, keyless, and serves Mapbox Terrain-RGB raster tiles behind a TileJSON document.

Create `packages/navara-core/tests/geoidHeight.test.ts`. Everything is driven through an injected `fetchImpl`, so the suite never touches the network:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GEOID_ATTRIBUTION,
  GEOID_TILEJSON_URL,
  geoidHeightAt,
  resetGeoidCacheForTest,
} from "../src/geo/geoidHeight";

const TILEJSON = {
  tilejson: "2.2.0",
  tiles: ["https://terrain.reearth.land/mapbox/geoid/{z}/{x}/{y}.png"],
  minzoom: 0,
  maxzoom: 9,
  encoding: "mapbox",
};

/**
 * A synthetic 2x2 Terrain-RGB tile. Mapbox encoding is
 * `height = -10000 + (R * 65536 + G * 256 + B) * 0.1`, so a target height h
 * needs the integer `(h + 10000) / 0.1` split across the three channels.
 */
function rgbFor(height: number): [number, number, number] {
  const v = Math.round((height + 10000) / 0.1);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Row-major RGBA for a 2x2 tile: [topLeft, topRight, bottomLeft, bottomRight]. */
function tilePixels(heights: readonly [number, number, number, number]) {
  const data = new Uint8ClampedArray(2 * 2 * 4);
  heights.forEach((h, i) => {
    const [r, g, b] = rgbFor(h);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return { width: 2, height: 2, data };
}

/** fetch fake: TileJSON first, then the raster tile as a Blob whose decoded
 *  pixels the module reads through the injected decoder seam. */
function makeFetch(
  heights: readonly [number, number, number, number],
  opts: { tileStatus?: number; tileJsonStatus?: number } = {},
) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === GEOID_TILEJSON_URL) {
      return new Response(JSON.stringify(TILEJSON), {
        status: opts.tileJsonStatus ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Blob([new Uint8Array([1, 2, 3])]), {
      status: opts.tileStatus ?? 200,
    });
  });
  return {
    impl: impl as unknown as typeof fetch,
    calls,
    pixels: tilePixels(heights),
  };
}

describe("geoidHeightAt", () => {
  beforeEach(() => {
    resetGeoidCacheForTest();
    vi.restoreAllMocks();
  });

  it("decodes a Terrain-RGB pixel into metres of undulation", async () => {
    // All four texels carry the same value, so fractional sampling is
    // irrelevant here and the assertion is purely about decoding.
    const f = makeFetch([43.2, 43.2, 43.2, 43.2]);
    const h = await geoidHeightAt(4.3571, 52.0116, f.impl, {
      decode: async () => f.pixels,
    });
    // Terrain-RGB quantises to 0.1 m, so 0.05 m is the tightest honest bound.
    expect(h).toBeCloseTo(43.2, 1);
  });

  it("fetches the TileJSON once and reuses it across calls", async () => {
    const f = makeFetch([43, 43, 43, 43]);
    const decode = async () => f.pixels;
    await geoidHeightAt(4.35, 52.01, f.impl, { decode });
    await geoidHeightAt(5.12, 52.09, f.impl, { decode });
    expect(f.calls.filter((u) => u === GEOID_TILEJSON_URL)).toHaveLength(1);
    // ...but each sample still fetches its own raster tile.
    expect(
      f.calls.filter((u) => u !== GEOID_TILEJSON_URL).length,
    ).toBeGreaterThan(1);
  });

  it("expands the TileJSON template with the slippy-map tile for the coordinate", async () => {
    const f = makeFetch([1, 1, 1, 1]);
    await geoidHeightAt(0, 0, f.impl, { decode: async () => f.pixels });
    const tileUrl = f.calls.find((u) => u !== GEOID_TILEJSON_URL)!;
    // (0,0) at the plan's fixed zoom 5 is the tile just past the middle of
    // the 32x32 grid in both axes.
    expect(tileUrl).toBe(
      "https://terrain.reearth.land/mapbox/geoid/5/16/16.png",
    );
  });

  it("samples at the FRACTIONAL position inside the tile, not always texel 0", async () => {
    // Top-left 0 m, top-right 100 m: a coordinate in the tile's right half
    // must read the right-hand texel.
    const f = makeFetch([0, 100, 0, 100]);
    const decode = async () => f.pixels;
    // Longitude chosen to land in the right half of its tile at zoom 5.
    const right = await geoidHeightAt(11.2, 0.0001, f.impl, { decode });
    expect(right).toBeCloseTo(100, 1);
  });

  it("falls back to 0 with a warning when the tile request fails (offline / no SLA)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = makeFetch([43, 43, 43, 43], { tileStatus: 404 });
    await expect(
      geoidHeightAt(4.35, 52.01, f.impl, { decode: async () => f.pixels }),
    ).resolves.toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/geoid/i);
  });

  it("falls back to 0 when the TileJSON itself is unreachable, and does not cache the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = makeFetch([43, 43, 43, 43], { tileJsonStatus: 503 });
    await expect(
      geoidHeightAt(4.35, 52.01, bad.impl, { decode: async () => bad.pixels }),
    ).resolves.toBe(0);
    // A later call must be able to succeed — a transient 503 at startup must
    // not poison every layer for the rest of the session.
    const good = makeFetch([43, 43, 43, 43]);
    await expect(
      geoidHeightAt(4.35, 52.01, good.impl, {
        decode: async () => good.pixels,
      }),
    ).resolves.toBeCloseTo(43, 1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to 0 when the decoder throws, rather than rejecting", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = makeFetch([43, 43, 43, 43]);
    await expect(
      geoidHeightAt(4.35, 52.01, f.impl, {
        decode: async () => {
          throw new Error("no ImageBitmap here");
        },
      }),
    ).resolves.toBe(0);
  });

  it("exposes the licence strings the app is required to display", () => {
    expect(GEOID_ATTRIBUTION.join(" ")).toMatch(/Mapterhorn/);
    expect(GEOID_ATTRIBUTION.join(" ")).toMatch(/OpenStreetMap/);
  });
});
```

- [ ] **Step 12: Run — expect failure.** `pnpm vitest run packages/navara-core/tests/geoidHeight.test.ts` → `Failed to resolve import "../src/geo/geoidHeight"`.

- [ ] **Step 13: Implement `packages/navara-core/src/geo/geoidHeight.ts`**

  ```ts
  /**
   * EGM2008 geoid undulation sampling.
   *
   * CityJSON z is an orthometric height above a local vertical datum (NAP for
   * EPSG:7415); the ENU frame is built on the WGS84 ellipsoid. The conversion
   * is `ellipsoidal = orthometric + N`, where N is the geoid undulation — so
   * the number this module returns IS the `heightOffset` the ENU transform
   * needs (see `sourceToEnu.ts` and Global Constraints -> Vertical datum).
   *
   * Source: the Re:Earth Terrain service, which publishes EGM2008 as
   * Mapbox Terrain-RGB raster tiles. Global coverage, no API key, no auth.
   *
   * ATTRIBUTION IS MANDATORY wherever this is used: CC BY 4.0 Mapterhorn and
   * ODbL OpenStreetMap (see GEOID_ATTRIBUTION; the app renders it in Task
   * C17's attribution overlay).
   *
   * BEST EFFORT, NO SLA: every failure path resolves 0 with one console.warn
   * rather than rejecting. A model then renders at its old, geoid-separation-
   * low position instead of not rendering at all — the right trade-off for an
   * offline dev session.
   */
  export const GEOID_TILEJSON_URL =
    "https://terrain.reearth.land/mapbox/geoid/tilejson.json";

  export const GEOID_ATTRIBUTION: readonly string[] = [
    "Geoid (EGM2008): © Mapterhorn, CC BY 4.0",
    "© OpenStreetMap contributors, ODbL",
  ];

  /**
   * Fixed sample zoom. The geoid is an extremely smooth field — undulation
   * changes by centimetres per kilometre — so a coarse zoom is both accurate
   * enough and kind to the service. Clamped to the TileJSON's own
   * minzoom/maxzoom at call time.
   */
  const SAMPLE_ZOOM = 5;

  interface TileJson {
    readonly tiles: readonly string[];
    readonly minzoom?: number;
    readonly maxzoom?: number;
    /** "mapbox" (Terrain-RGB) or "terrarium". Verified at runtime, see below. */
    readonly encoding?: string;
  }

  export interface RasterPixels {
    readonly width: number;
    readonly height: number;
    /** RGBA, row-major, 4 bytes per pixel. */
    readonly data: Uint8ClampedArray;
  }

  export interface GeoidSampleDeps {
    /** Blob -> RGBA pixels. Injected so the module has no DOM dependency and
     *  the tests need no image codec. Defaults to `decodeWithImageBitmap`. */
    decode?(blob: Blob): Promise<RasterPixels>;
  }

  let tileJsonPromise: Promise<TileJson> | null = null;

  /** Test seam: drops the cached TileJSON promise. */
  export function resetGeoidCacheForTest(): void {
    tileJsonPromise = null;
  }

  async function loadTileJson(fetchImpl: typeof fetch): Promise<TileJson> {
    if (tileJsonPromise) return tileJsonPromise;
    const pending = (async () => {
      const res = await fetchImpl(GEOID_TILEJSON_URL);
      if (!res.ok) throw new Error(`TileJSON HTTP ${res.status}`);
      return (await res.json()) as TileJson;
    })();
    tileJsonPromise = pending;
    // A transient failure at startup must not poison every later layer, so
    // drop the cache on rejection and keep it only on success.
    pending.catch(() => {
      if (tileJsonPromise === pending) tileJsonPromise = null;
    });
    return pending;
  }

  /**
   * Default decoder. `createImageBitmap` + OffscreenCanvas exist in both the
   * window and (in modern browsers) worker contexts, so this works from the
   * FCB worker too; where OffscreenCanvas is missing it throws and the caller
   * falls back to 0. Nothing in the plan calls this from Node — the tests
   * inject `decode` instead.
   */
  async function decodeWithImageBitmap(blob: Blob): Promise<RasterPixels> {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context for geoid tile decoding");
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return { width: image.width, height: image.height, data: image.data };
    } finally {
      bitmap.close();
    }
  }

  /** Slippy-map tile coordinate, kept fractional so the caller can address a
   *  texel inside the tile rather than only the tile itself. */
  function tileCoords(
    lngDeg: number,
    latDeg: number,
    zoom: number,
  ): { x: number; y: number } {
    const n = 2 ** zoom;
    const lat =
      (Math.max(-85.05112878, Math.min(85.05112878, latDeg)) * Math.PI) / 180;
    return {
      x: ((lngDeg + 180) / 360) * n,
      y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
    };
  }

  /**
   * Mapbox Terrain-RGB: `height = -10000 + (R * 65536 + G * 256 + B) * 0.1`.
   *
   * IMPLEMENTATION NOTE — VERIFY THIS AGAINST THE SERVICE. The TileJSON's
   * `encoding` field is authoritative. If it reports "terrarium" rather than
   * "mapbox", switch to the Terrarium formula
   * `height = R * 256 + G + B / 256 - 32768` and update the test's `rgbFor`
   * helper to match. Do not assume; read the field (this function already
   * receives it) and make the branch explicit.
   */
  function decodeHeight(
    r: number,
    g: number,
    b: number,
    encoding: string | undefined,
  ): number {
    if (encoding === "terrarium") return r * 256 + g + b / 256 - 32768;
    return -10000 + (r * 65536 + g * 256 + b) * 0.1;
  }

  export async function geoidHeightAt(
    lngDeg: number,
    latDeg: number,
    fetchImpl: typeof fetch = fetch,
    deps: GeoidSampleDeps = {},
  ): Promise<number> {
    try {
      const tileJson = await loadTileJson(fetchImpl);
      const template = tileJson.tiles[0];
      if (!template) throw new Error("TileJSON has no tile template");

      const zoom = Math.max(
        tileJson.minzoom ?? 0,
        Math.min(tileJson.maxzoom ?? SAMPLE_ZOOM, SAMPLE_ZOOM),
      );
      const { x, y } = tileCoords(lngDeg, latDeg, zoom);
      const tileX = Math.floor(x);
      const tileY = Math.floor(y);

      const url = template
        .replace("{z}", String(zoom))
        .replace("{x}", String(tileX))
        .replace("{y}", String(tileY));
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`geoid tile HTTP ${res.status}`);

      const decode = deps.decode ?? decodeWithImageBitmap;
      const pixels = await decode(await res.blob());

      // Address the texel the coordinate actually falls on: the fractional
      // part of the tile coordinate scaled by the tile's pixel size.
      const px = Math.min(
        pixels.width - 1,
        Math.max(0, Math.floor((x - tileX) * pixels.width)),
      );
      const py = Math.min(
        pixels.height - 1,
        Math.max(0, Math.floor((y - tileY) * pixels.height)),
      );
      const i = (py * pixels.width + px) * 4;
      return decodeHeight(
        pixels.data[i]!,
        pixels.data[i + 1]!,
        pixels.data[i + 2]!,
        tileJson.encoding,
      );
    } catch (error) {
      console.warn(
        `[geoid] Could not sample geoid undulation at ${lngDeg.toFixed(4)}, ${latDeg.toFixed(4)}; ` +
          `falling back to 0 m (the model will sit at its geoid separation below terrain).`,
        error,
      );
      return 0;
    }
  }
  ```

  Add `export * from "./geo/geoidHeight";` to `packages/navara-core/src/index.ts`.

- [ ] **Step 14: Run — expect pass.** `pnpm vitest run packages/navara-core/tests/geoidHeight.test.ts` → 8 passed.

- [ ] **Step 15: Verify the encoding and the fixed zoom against the real service (once, by hand)**

  The `encoding` branch and the zoom-5 tile URL above are written from the service's documented shape; confirm both before relying on them:

  ```bash
  cd /data2/hideba/multiroof-viewer
  curl -s https://terrain.reearth.land/mapbox/geoid/tilejson.json | head -40
  curl -sI "https://terrain.reearth.land/mapbox/geoid/5/16/10.png" | head -3
  ```

  Expected: the TileJSON reports `"encoding": "mapbox"` (if it says `terrarium`, take the branch documented in `decodeHeight` and flip the test's `rgbFor` helper); `tiles[0]` matches the `{z}/{x}/{y}` template the test expands; the tile request returns `200` with an image content type. Record the observed `encoding`, `minzoom`/`maxzoom` and `attribution` string in the commit message. Then sanity-check one known value in the browser console once Task B11b runs: EGM2008 undulation near Delft (4.3571 E, 52.0116 N) should come back at roughly **+43 m**; anything near 0 or wildly different means the decode branch is wrong.

- [ ] **Step 16: Commit in the submodule, then bump the pointer in the app.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "feat: add ENU frame math, exact source-CRS to ENU placement, and EGM2008 geoid sampling to navara-core" -m "Geoid undulation is sampled from the Re:Earth Terrain service (EGM2008 as Terrain-RGB tiles, global, keyless); observed TileJSON encoding/zoom range recorded in Step 15. Attribution: CC BY 4.0 Mapterhorn + ODbL OpenStreetMap." -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins push origin main
  git -C /data2/hideba/multiroof-viewer add packages/cityjson-navara-plugins
  git -C /data2/hideba/multiroof-viewer commit -m "feat: bump plugin submodule to ENU frame math" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task A14: Part A wrap-up — full green in both repos, README/roadmap updated

**Files:**

- Modify: `packages/cityjson-navara-plugins/packages/navara-core/README.md`, `docs/roadmap.md`
- Test: (verification task — runs the complete suites of both repos)

**Interfaces:**

- Consumes: everything produced by Tasks A1–A13b
- Produces: no new exports; a documented, verified M7.1/M7.2 completion point.

- [ ] **Step 1: Verify the plugin repo end to end, exactly as CI does**

```bash
(cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test)
```

Expected: install reports the lockfile is up to date; `pnpm -r build` prints a `Build success` line per package; `tsc -b` prints nothing; `vitest run` prints `Test Files  15 passed (15)` with 0 failures (twelve from A5–A13 plus `enuFrame.test.ts`, `sourceToEnu.test.ts` and `geoidHeight.test.ts` from A13b).

- [ ] **Step 2: Verify the packaged output actually contains the moved API**

```bash
grep -c "buildCityMeshArrays\|buildStyleColorsFromArrays\|parseCityJSONSeq\|ensureProjDef\|matchRule\|computeRoofMetrics\|projectPositionsToEnu\|geoidHeightAt" \
  /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-core/dist/index.d.ts
```

Expected: a count of at least `8` — the d.ts bundle exposes the moved API, including the rule engine, the ENU placement helpers the FCB worker will import, and the geoid sampler, so the app's `file:` dependency resolves types even without the Vite alias.

- [ ] **Step 3: Verify the app end to end**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run 2>&1 | tail -5 && npm run build
```

Expected: `tsc` prints nothing; vitest prints `Test Files  58 passed (58)` with 0 failures; `npm run build` completes with a Vite bundle (this is the first check that the alias also works in a production build, not just under vitest).

- [ ] **Step 4: Document the finished surface in the core README**

Replace the body of `packages/cityjson-navara-plugins/packages/navara-core/README.md` with:

````markdown
# @cityjson/navara-core

Format-agnostic CityJSON domain code, engine-free (no `@navaramap/*` dependency).
`three` is a peer dependency, used only for its pure-math `ShapeUtils`/`Vector2`
polygon helpers; `proj4` is a direct dependency for CRS registration.

## API

| Area           | Exports                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain types   | `CityModel`, `CityObject`, `Surface`, `BuildingSurfaceType`, `Vec3`, `BBox3`, `CityModelMetadata`, `CityModelEncoding`                                                          |
| Encodings      | `CITYMODEL_ENCODING_PRIORITY`, `isSupportedCityModelEncoding`, `getPreferredCityModelEncoding`                                                                                  |
| CityJSON       | `parseCityJSON`, `dequantizeAll`, `mergeBBox`, `parseCityObject`, `mapMetadata`, plus the raw `CityJSON*` wire types                                                            |
| CityJSONSeq    | `parseCityJSONSeq`, `CityJSONFeature`                                                                                                                                           |
| Geometry       | `buildCityMeshArrays`, `computeOriginOffset`, `CityMeshArrays`                                                                                                                  |
| Geo frames     | `EnuFrame`, `makeEnuFrame`, `geodeticToEcef`, `ecefToGeodetic`, `enuToEcef`, `ecefToEnu`                                                                                        |
| Placement      | `sourceToEnuPoint`, `projectPositionsToEnu`, `SourceToEnuOptions`, `ProjectPositionsOptions`                                                                                    |
| Vertical datum | `geoidHeightAt`, `GEOID_TILEJSON_URL`, `GEOID_ATTRIBUTION`, `RasterPixels`, `GeoidSampleDeps` (EGM2008 undulation from the Re:Earth Terrain service)                            |
| Roof metrics   | `RoofMetrics`, `computeRoofMetrics`, `computeArea`, `computeSurfaceNormal`, `computeInclination`, `computeAzimuth`, `computeElevation`, `computeFootprintArea`                  |
| Rules          | `Rule`, `Condition`, `ConditionOperator`, `LogicMode`, `evaluateCondition`, `evaluateRule`, `matchRule`                                                                         |
| Picking        | `PickingIndex`, `PickResult`                                                                                                                                                    |
| Styling        | `SURFACE_COLOR_VALUES`, `SURFACE_COLOR_HEX`, `SURFACE_COLORS_LINEAR`, `srgbHexToLinear`, `SurfaceInfo`, `CityObjectInfo`, `SurfaceStyleEvaluator`, `buildStyleColorsFromArrays` |
| CRS            | `ensureProjDef`, `parseEpsgCode`                                                                                                                                                |

## Development

```bash
pnpm --filter @cityjson/navara-core build
pnpm vitest run packages/navara-core
```
````

````

- [ ] **Step 5: Mark the milestones in the app roadmap**

In `docs/roadmap.md`, add under the milestone list:

```markdown
- M7.1 (plugin monorepo scaffold + submodule + app wiring): Complete
- M7.2 (format-agnostic domain moved into @cityjson/navara-core; app re-exports at the old paths): Complete
````

- [ ] **Step 6: Commit in the submodule, then bump the pointer with the app docs**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/README.md
git commit -m "$(cat <<'EOF'
docs: document the @cityjson/navara-core public API after the M7.2 move

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
cd /data2/hideba/multiroof-viewer
git add packages/cityjson-navara-plugins docs/roadmap.md
git commit -m "$(cat <<'EOF'
docs: mark M7.1 and M7.2 complete in the roadmap

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Run the code review required by CLAUDE.md before moving to M7.3**

Run the `feature-dev:code-reviewer` agent (high effort) over the M7.1/M7.2 diff in both repos — the app diff (`git log --oneline -16 -p`) and the submodule diff (`git -C packages/cityjson-navara-plugins log --oneline -9 -p`). Address any critical finding before starting M7.3 (Task B1).

---

## M7.3 — Plugin + viewport rendering a static CityJSON layer

---

### Task B1: SPIKE — MRT vertex colors + custom-mesh picking (decision checkpoint)

Validates the two spec §8 risks before any descriptor work: (1) per-vertex colors under Navara's MRT G-buffer with a standard material, (2) picking a custom mesh. Also the discovery vehicle for Vite/WASM bundling.

**Files:**

- Create: `spike.html`
- Create: `src/spike/navaraMrtSpike.ts`
- Create: `docs/superpowers/research/2026-08-01-navara-spike-findings.md`
- Modify: `package.json`, `vite.config.ts`

**Interfaces:**

- Consumes: `ThreeView`, `DefaultPlugin`, `geodeticToVector3`, `eastNorthUpToFixedFrame`, `degreeToRadian`, `getPickRay`, `PickableMeshWrapper` from `@navaramap/three`; `MeshDesc` from `@navaramap/three-default-descs`.
- Produces: no exported app API. Produces four written verdicts consumed by later tasks: `MRT_VERTEX_COLORS_OK` (boolean), `PICK_PATH ∈ {"pickable-wrapper", "own-raycast"}` (becomes the typed `PickStrategy` capability in Task B6), `PROD_BUNDLE_OK` (boolean — the spike page works in `npm run build` + `vite preview`, not just dev), `NODE_IMPORT_SAFE` (boolean — `@navaramap/three` imports in plain Node without WebGL/WASM side effects), plus a recorded **camera event trace** that Tasks C7 and C20 consume.

- [ ] **Step 1: Install pinned engine deps**

```bash
cd /data2/hideba/multiroof-viewer && npm i --save-exact @navaramap/three@0.0.5 @navaramap/three-default-plugin@0.0.5 @navaramap/three-default-descs@0.0.5 three@0.183.2 postprocessing@6.39.0
```

Expect: install succeeds with no unmet-peer errors for `three`/`postprocessing`.

- [ ] **Step 2: Discover the real export names**

```bash
cd /data2/hideba/multiroof-viewer && node -e "import('@navaramap/three').then(m=>console.log(Object.keys(m).sort().join(' ')))" && node -e "import('@navaramap/three-default-descs').then(m=>console.log(Object.keys(m).sort().join(' ')))" && node -e "import('@navaramap/three-default-plugin').then(m=>console.log(Object.keys(m).sort().join(' ')))"
```

Expect at minimum: `ThreeView` (default or named), `geodeticToVector3`, `eastNorthUpToFixedFrame`, `degreeToRadian`, `getPickRay`, `vector3ToGeodetic`; `MeshDesc`, `BoxMeshDesc`; `DefaultPlugin`. If a Node import throws (WASM at module scope), note it — every plugin unit test in Part B must then avoid importing `@navaramap/*` (the plan already isolates that; see Task B2's fakes).

- [ ] **Step 3: Write the spike entry**

```html
<!-- spike.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Navara MRT / pick spike</title>
    <style>
      html,
      body,
      #app {
        margin: 0;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/spike/navaraMrtSpike.ts"></script>
  </body>
</html>
```

```ts
// src/spike/navaraMrtSpike.ts
import ThreeView, {
  degreeToRadian,
  eastNorthUpToFixedFrame,
  geodeticToVector3,
  getPickRay,
  PickableMeshWrapper,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { MeshDesc } from "@navaramap/three-default-descs";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from "three";

const SITE = { lng: 4.3571, lat: 52.0116, height: 0 };

/** Two 40 m triangles: left one pure red, right one pure green — per vertex. */
function spikeGeometry(): BufferGeometry {
  const positions = new Float32Array([
    -40, -40, 0, 0, -40, 0, -40, 40, 0, 0, -40, 0, 40, 40, 0, 0, 40, 0,
  ]);
  const normals = new Float32Array(18);
  for (let i = 2; i < 18; i += 3) normals[i] = 1;
  const colors = new Float32Array([
    1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]);
  const objectIndex = new Uint32Array([0, 0, 0, 1, 1, 1]);
  const surfaceIndex = new Uint32Array([0, 0, 0, 7, 7, 7]);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setAttribute("normal", new BufferAttribute(normals, 3));
  g.setAttribute("color", new BufferAttribute(colors, 3));
  g.setAttribute("objectIndex", new BufferAttribute(objectIndex, 1));
  g.setAttribute("surfaceIndex", new BufferAttribute(surfaceIndex, 1));
  g.computeBoundingSphere();
  return g;
}

interface SpikeConfig {
  readonly spike: { readonly enabled: boolean };
}

class SpikeMeshDesc extends MeshDesc<SpikeConfig> {
  static key = "spike";
  createMesh(): Mesh {
    const mesh = new Mesh(
      spikeGeometry(),
      new MeshStandardMaterial({ vertexColors: true, flatShading: true }),
    );
    const origin = geodeticToVector3({
      lng: degreeToRadian(SITE.lng),
      lat: degreeToRadian(SITE.lat),
      height: SITE.height,
    });
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(eastNorthUpToFixedFrame(origin));
    mesh.matrixWorldNeedsUpdate = true;

    // PICK PATH A (the API report's sanctioned route for custom meshes with
    // standard materials): register the mesh with the GPU picking pipeline and
    // give each triangle a batch id we can map back to (objectIndex,
    // surfaceIndex). Two triangles => batch ids 0 and 1, and the mapping table
    // below is what CityModelMesh.resolvePick would own in production.
    (globalThis as Record<string, unknown>).__spikeBatchMap = [
      { objectIndex: 0, surfaceIndex: 0 },
      { objectIndex: 1, surfaceIndex: 7 },
    ];
    const batchIds = new Uint32Array([0, 0, 0, 1, 1, 1]);
    mesh.geometry.setAttribute("batchId", new BufferAttribute(batchIds, 1));
    const pickable = new PickableMeshWrapper(mesh, {
      layerId: "spike",
      properties: { kind: "spike" },
    });
    (globalThis as Record<string, unknown>).__spikePickable = pickable;

    (globalThis as Record<string, unknown>).__spikeMesh = mesh;
    return mesh;
  }
}

async function main(): Promise<void> {
  const container = document.getElementById("app")!;
  const plugin = new DefaultPlugin();
  const view = new ThreeView({ container, useNormal: true, shadow: true });
  view.addPlugin(plugin);
  view.registerMesh("spike", SpikeMeshDesc);
  await view.init();
  plugin.addDefaultPhotorealScene();
  view.atmosphere.date = new Date("2026-07-16T10:00:00Z");
  view.addMesh({ spike: { enabled: true } });
  view.setCamera({
    lng: SITE.lng,
    lat: SITE.lat,
    height: 300,
    heading: 0,
    pitch: -60,
    roll: 0,
  });

  (globalThis as Record<string, unknown>).__spikeView = view;
  (globalThis as Record<string, unknown>).__spikeRaycast = (
    x: number,
    y: number,
  ) => {
    const mesh = (globalThis as Record<string, unknown>).__spikeMesh as Mesh;
    const ray = getPickRay(view, x, y) as {
      origin: Vector3;
      direction: Vector3;
    };
    const rc = new Raycaster(ray.origin, ray.direction.clone().normalize());
    const hit = rc.intersectObject(mesh, false)[0];
    if (!hit?.face) return null;
    const oi = mesh.geometry.getAttribute("objectIndex").getX(hit.face.a);
    const si = mesh.geometry.getAttribute("surfaceIndex").getX(hit.face.a);
    return { objectIndex: oi, surfaceIndex: si };
  };

  const picks: unknown[] = [];
  view.on("pick", (f: unknown) => {
    picks.push(f);
    console.log("SPIKE pick event:", JSON.stringify(f));
  });
  (globalThis as Record<string, unknown>).__spikePicks = picks;

  // Camera event trace (Step 7): every camera-ish event, timestamped, so the
  // real cadence can be read off instead of assumed. Tasks C7 and C20 consume
  // this trace.
  const trace: Array<{ t: number; e: string }> = [];
  (globalThis as Record<string, unknown>).__spikeTrace = trace;
  (globalThis as Record<string, unknown>).__spikeTraceReset = () => {
    trace.length = 0;
  };
  for (const e of [
    "movestart",
    "move",
    "moveend",
    "idle",
    "frustumChanged",
    "resize",
  ]) {
    view.on(e, () => trace.push({ t: Math.round(performance.now()), e }));
  }
}

void main().catch((e) => {
  console.error("SPIKE failed:", e);
});
```

- [ ] **Step 4: Run and observe in the browser**

```bash
cd /data2/hideba/multiroof-viewer && npm run dev &
sleep 6
agent-browser open http://localhost:5173/spike.html
sleep 8
agent-browser errors
agent-browser console
agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/spike-mrt.png
```

Expected observations (record each as pass/fail):

- `agent-browser errors` is empty; `console` has no 404 for `.wasm`, no "Failed to fetch dynamically imported module", no `atmosphereAssetsUrl`/`stbnUrl` fetch failure.
- Screenshot shows a lit globe with **one red triangle and one green triangle** side by side (not a single flat color, not white, not black).

If a WASM/worker/asset load fails, fix bundling now and re-run this step until clean:

```ts
// vite.config.ts — inside defineConfig({...})
  optimizeDeps: {
    exclude: [
      "@cityjson/flatcitybuf",
      "@duckdb/duckdb-wasm",
      "@navaramap/three",
      "@navaramap/three-default-plugin",
      "@navaramap/three-default-descs",
    ],
  },
  assetsInclude: ["**/*.wasm"],
```

Record the exact fix applied (it is the input to Task B8's bundling step).

- [ ] **Step 5: Exercise BOTH pick paths — `PickableMeshWrapper` first**

Path A is the route the API report sanctions for custom meshes with standard materials, so it is tested first and it decides `PICK_PATH`; path B (our own raycast) is the measured fallback.

```bash
# Path A -- Navara's own GPU pick pipeline via PickableMeshWrapper.
agent-browser eval "window.__spikeTraceReset(); window.__spikePicks.length = 0"
agent-browser eval "const c=document.querySelector('canvas'); const r=c.getBoundingClientRect(); ['pointerdown','pointerup','click'].forEach(t=>c.dispatchEvent(new PointerEvent(t,{clientX:r.left+r.width*0.42,clientY:r.top+r.height*0.5,bubbles:true})));"
sleep 1
agent-browser eval "JSON.stringify(window.__spikePicks)"
agent-browser eval "const c=document.querySelector('canvas'); const r=c.getBoundingClientRect(); ['pointerdown','pointerup','click'].forEach(t=>c.dispatchEvent(new PointerEvent(t,{clientX:r.left+r.width*0.58,clientY:r.top+r.height*0.5,bubbles:true})));"
sleep 1
agent-browser eval "JSON.stringify(window.__spikePicks)"
agent-browser eval "JSON.stringify(window.__spikeBatchMap)"

# Path B -- our own RTE-aware raycast against the same rendered descriptor.
agent-browser eval "JSON.stringify(window.__spikeRaycast(window.innerWidth*0.42, window.innerHeight*0.5))"
agent-browser eval "JSON.stringify(window.__spikeRaycast(window.innerWidth*0.58, window.innerHeight*0.5))"
agent-browser console
```

Expected observations (record each as pass/fail):

- **Path A:** the first click pushes a `PickedFeature` whose `layerId` is `"spike"` and whose `batchId` is `0`; the second pushes `batchId` `1`. Combined with `__spikeBatchMap` that is a 1:1 mapping onto `{objectIndex, surfaceIndex}` — i.e. `PickableMeshWrapper` **can** carry our per-surface identity, and `PICK_PATH = "pickable-wrapper"`.
  - If `__spikePicks` stays empty, or `batchId` is always `0`/`undefined`, or `properties` comes back without the wrapper's payload, path A fails — record exactly which, because that is the evidence for `PICK_PATH = "own-raycast"`.
- **Path B:** the two `__spikeRaycast` calls return `{"objectIndex":0,"surfaceIndex":0}` and `{"objectIndex":1,"surfaceIndex":7}` respectively (left triangle then right triangle), proving the `getPickRay` + `three` `Raycaster` route works against a **rendered** descriptor under RTE.

- [ ] **Step 6: Verify the spike survives a production bundle, not just the dev server**

The dev server transforms modules on the fly; the production bundle is where WASM URLs, worker chunks and `atmosphereAssetsUrl`/`stbnUrl` asset copying actually get resolved. Task C4b later does the same for the FCB worker; this step covers the engine itself.

```bash
npm run build 2>&1 | tail -20
cd /data2/hideba/multiroof-viewer && npx vite preview --port 4173 &
sleep 4
agent-browser open http://localhost:4173/spike.html
sleep 8
agent-browser errors
agent-browser console
agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/spike-mrt-prod.png
agent-browser eval "JSON.stringify(window.__spikeRaycast(window.innerWidth*0.42, window.innerHeight*0.5))"
```

Expected: `npm run build` exits 0; `spike.html` appears among the emitted inputs (if Vite skipped it, add it to `build.rollupOptions.input` alongside `index.html` and rebuild); the preview page renders the same red and green triangles on the globe; `agent-browser errors` is empty and the console shows no `.wasm` 404, no missing worker chunk and no atmosphere-asset failure; the Step 5 raycast still resolves. Record any bundling fix needed here verbatim (static asset copying, `build.assetsInlineLimit`, extra `optimizeDeps.exclude` entries) — Task B8 and Task C4b both build on it. `PROD_BUNDLE_OK` is true only when this whole step passes.

- [ ] **Step 7: Record a real-browser camera event trace**

Tasks C7 (settle controller) and C20 (camera restore) both assume a cadence the API report does not document. Measure it once here and write the trace into the findings doc, so C7's tests are written against a measured cadence rather than an assumed one.

```bash
# (a) drag with inertia -- one user gesture
agent-browser eval "window.__spikeTraceReset()"
agent-browser eval "const c=document.querySelector('canvas'); const r=c.getBoundingClientRect(); const p=(t,fx,fy)=>c.dispatchEvent(new PointerEvent(t,{clientX:r.left+r.width*fx,clientY:r.top+r.height*fy,bubbles:true})); p('pointerdown',0.4,0.5); for(let i=1;i<=10;i++) p('pointermove',0.4+i*0.03,0.5+i*0.01); p('pointerup',0.7,0.6);"
sleep 3
agent-browser eval "JSON.stringify(window.__spikeTrace)"

# (b) animated flyTo
agent-browser eval "window.__spikeTraceReset(); window.__spikeView.flyTo({lng:4.30,lat:52.05,height:2000,heading:30,pitch:-45,roll:0})"
sleep 5
agent-browser eval "JSON.stringify(window.__spikeTrace)"

# (c) programmatic setCamera -- the camera-restore path
agent-browser eval "window.__spikeTraceReset(); window.__spikeView.setCamera({lng:4.3571,lat:52.0116,height:300,heading:0,pitch:-60,roll:0})"
sleep 3
agent-browser eval "JSON.stringify(window.__spikeTrace)"

# (d) window resize
agent-browser eval "window.__spikeTraceReset()"
agent-browser resize 1000 700
sleep 3
agent-browser eval "JSON.stringify(window.__spikeTrace)"
```

For each of (a)–(d) record in the findings doc: the exact event sequence, how many `movestart`/`moveend` pairs one gesture produced, whether `move` kept firing through inertia after pointer-up, whether `idle` arrived and how long after the last `move`, and whether `setCamera`/`flyTo`/`resize` emit camera events at all. Then state the two conclusions C7 and C20 consume:

- `CAMERA_BURST_SHAPE` — one `movestart … moveend` per user gesture (the mapping Task C7 assumes), or several.
- `PROGRAMMATIC_MOVE_EMITS` — whether `setCamera`/`flyTo` emit `movestart`/`move`/`moveend`. **If they do**, Task C7 gains a `suppress(fn)` method that brackets programmatic camera writes and swallows the burst, Task C7's test list gains the corresponding case, and Task C20's restore calls `setCameraState` inside it — otherwise a restored camera would trigger a streaming commit. **If they do not**, C7's cadence mapping stands unchanged and C20 needs no bracket.

- [ ] **Step 8: Check whether `@navaramap/three` is importable in plain Node**

The plugin-package test isolation rule (Global Constraints → Testing conventions) is structural either way; this step records _how hard_ a rule it is.

```bash
cd /data2/hideba/multiroof-viewer && node -e "
  const t0 = Date.now();
  import('@navaramap/three')
    .then((m) => console.log('NODE_IMPORT_SAFE=true keys=' + Object.keys(m).length + ' ms=' + (Date.now() - t0)))
    .catch((e) => console.log('NODE_IMPORT_SAFE=false ' + e.message));
"
```

Expected: exactly one line. Record it as `NODE_IMPORT_SAFE`. A `false` makes the engine-binding-module split a hard requirement (plugin unit tests would otherwise fail at import time, before any fake can help); a `true` keeps it as the structure that makes fakes injectable. The findings doc states which.

- [ ] **Step 9: DECISION CHECKPOINT — record outcome, stop if blocked**

Write `docs/superpowers/research/2026-08-01-navara-spike-findings.md` containing: the export lists from Step 2, the bundling fixes from Steps 4 and 6, both screenshot verdicts (dev and preview), both pick paths' results from Step 5, the four camera traces from Step 7, the Node import result from Step 8, plus these verdicts:

- `MRT_VERTEX_COLORS_OK = true` **only if** both the dev and the preview screenshots show distinct red and green triangles with a standard `MeshStandardMaterial({vertexColors:true})`.
  - **If false: STOP and re-plan.** Fallback path to plan: a custom `ShaderMaterial` that writes `vColor` into the G-buffer via `setupMaterialForMRT()`, plus a `getPassKey()` override returning `"mrt"`; every later task that says "standard material" changes to that material, and Task B3's geometry stays as-is.
- `PICK_PATH = "pickable-wrapper"` **only if** Step 5's path A produced per-triangle `batchId`s that map 1:1 onto our `(objectIndex, surfaceIndex)` pairs. Otherwise `PICK_PATH = "own-raycast"`.
  - `own-raycast` is a supported outcome, not a failure — and the verdict does not stay prose. It is transcribed into the typed capability `PickStrategy` (Task B6 creates `packages/navara-cityjson/src/pickStrategy.ts`), supplied as `new CityJSONPlugin({ pickStrategy })` / `new FlatCityBufPlugin({ pickStrategy })` (Tasks B7/C11), and branched on in exactly three places: `CityModelMesh.resolvePick` (B6), descriptor construction (B7), and per-cell meshes (C8). Both branches ship and both are unit-tested; the capability selects which one runs at runtime. Only if **neither** path resolves a triangle (path A empty **and** both raycast calls return `null`, e.g. because RTE makes `matrixWorld` incompatible with the ECEF pick ray) **STOP and re-plan** with the RTE-aware alternative: raycast in RTE space using a `calcCameraPosition()`-relative ray origin.
- `PROD_BUNDLE_OK = true` **only if** Step 6 passed end to end. **If false: STOP** and fix bundling before any plugin work — every later browser check runs through the same pipeline.
- `NODE_IMPORT_SAFE` — from Step 8, verbatim.
- `CAMERA_BURST_SHAPE` and `PROGRAMMATIC_MOVE_EMITS` — from Step 7. Tasks C7 and C20 quote these back; if they were not measured, C7 must not be started.

- [ ] **Step 10: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add spike.html src/spike/navaraMrtSpike.ts docs/superpowers/research/2026-08-01-navara-spike-findings.md package.json package-lock.json vite.config.ts && git commit -m "$(cat <<'EOF'
feat: navara MRT vertex-color + custom-mesh pick spike

Pins @navaramap 0.0.5, three 0.183.2, postprocessing 6.39.0 and records the
M7.3 spike verdicts: MRT vertex colors, PICK_PATH (PickableMeshWrapper vs own
raycast), production-bundle viability, the measured camera event trace, the
Node import result, and the Vite bundling fixes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Plugin test doubles — fake `ThreeView` / `ViewContext`

The only place the fake-view harness code appears. Every later plugin test imports it.

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/test/fakeView.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-cityjson/test/fakeView.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-cityjson/package.json`

**Interfaces:**

- Consumes: nothing from Navara (deliberately — the fakes exist so unit tests never import `@navaramap/*`).
- Produces:
  - `class FakeViewContext { readonly scene: object[]; readonly mrtCalls: object[]; addToScene(o): void; removeFromScene(o): void; setupMaterialForMRT(o): void }`
  - `class FakeThreeView { readonly ctx: FakeViewContext; readonly registeredMeshes: Map<string, unknown>; readonly addedConfigs: unknown[]; initialized: boolean; disposed: boolean; camera: FakeCamera; registerMesh(name, desc): void; addPlugin(p): void; addMesh<T>(config): FakeHandle; init(): Promise<void>; dispose(): void; setCamera(s): void; flyTo(s): void; on(evt, cb): void; emit(evt, payload): void; getPickRay(x, y): { origin; direction } }`
  - `interface FakeHandle { ref: unknown; visible: boolean; update(patch: unknown): void; delete(): void }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/navara-cityjson/test/fakeView.test.ts
import { describe, it, expect } from "vitest";
import { FakeThreeView } from "./fakeView";

describe("FakeThreeView", () => {
  it("rejects registerMesh after init and runs plugin init during init()", async () => {
    const view = new FakeThreeView();
    const seen: string[] = [];
    view.addPlugin({
      init: async (v, ctx) => {
        seen.push(typeof v === "object" && ctx ? "init" : "bad");
        (v as FakeThreeView).registerMesh("cityModel", class {});
      },
    });
    await view.init();
    expect(seen).toEqual(["init"]);
    expect(view.registeredMeshes.has("cityModel")).toBe(true);
    expect(() => view.registerMesh("late", class {})).toThrow(/after init/);
  });

  it("addMesh returns a handle whose delete removes the descriptor instance", () => {
    const view = new FakeThreeView();
    const handle = view.addMesh({ cityModel: { id: "L1" } });
    expect(view.addedConfigs).toHaveLength(1);
    handle.delete();
    expect(handle.deleted).toBe(true);
  });

  it("emit dispatches to on() listeners", () => {
    const view = new FakeThreeView();
    const got: unknown[] = [];
    view.on("click", (p) => got.push(p));
    view.emit("click", { x: 3, y: 4 });
    expect(got).toEqual([{ x: 3, y: 4 }]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/fakeView.test.ts
```

Expected: `Failed to resolve import "./fakeView"`.

- [ ] **Step 3: Implement the fakes**

```ts
// packages/navara-cityjson/test/fakeView.ts
export interface FakeHandle {
  ref: unknown;
  visible: boolean;
  deleted: boolean;
  update(patch: unknown): void;
  delete(): void;
}

export class FakeViewContext {
  readonly scene: object[] = [];
  readonly mrtCalls: object[] = [];

  addToScene(o: object): void {
    this.scene.push(o);
  }

  removeFromScene(o: object): void {
    const i = this.scene.indexOf(o);
    if (i >= 0) this.scene.splice(i, 1);
  }

  setupMaterialForMRT(o: object): void {
    this.mrtCalls.push(o);
  }
}

export interface FakeCameraState {
  lng: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}

export class FakeThreeView {
  readonly ctx = new FakeViewContext();
  readonly registeredMeshes = new Map<string, unknown>();
  readonly addedConfigs: unknown[] = [];
  readonly handles: FakeHandle[] = [];
  readonly plugins: Array<{ init(v: unknown, c: unknown): Promise<void> }> = [];
  readonly setCameraCalls: FakeCameraState[] = [];
  readonly flyToCalls: FakeCameraState[] = [];
  initialized = false;
  disposed = false;
  /** Descriptor factory used by addMesh; tests override to build real meshes. */
  descriptorFactory: ((config: unknown) => unknown) | null = null;
  camera = {
    positionGeographic: { lng: 4.35, lat: 52.01, height: 500 },
    orientation: { heading: 12, pitch: -45, roll: 0 },
  };
  pickRay = {
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
  };

  private readonly listeners = new Map<
    string,
    Array<(payload: unknown) => void>
  >();

  registerMesh(name: string, desc: unknown): void {
    if (this.initialized) throw new Error("registerMesh called after init");
    this.registeredMeshes.set(name, desc);
  }

  addPlugin(p: { init(v: unknown, c: unknown): Promise<void> }): void {
    if (this.initialized) throw new Error("addPlugin called after init");
    this.plugins.push(p);
  }

  async init(): Promise<void> {
    await Promise.all(this.plugins.map((p) => p.init(this, this.ctx)));
    this.initialized = true;
  }

  addMesh(config: unknown): FakeHandle {
    this.addedConfigs.push(config);
    const ref = this.descriptorFactory
      ? this.descriptorFactory(config)
      : { config };
    const handle: FakeHandle = {
      ref,
      visible: true,
      deleted: false,
      update: (patch: unknown) => {
        this.addedConfigs.push(patch);
      },
      delete: () => {
        handle.deleted = true;
      },
    };
    this.handles.push(handle);
    return handle;
  }

  setCamera(s: FakeCameraState): void {
    this.setCameraCalls.push(s);
    this.camera = {
      positionGeographic: { lng: s.lng, lat: s.lat, height: s.height },
      orientation: { heading: s.heading, pitch: s.pitch, roll: s.roll },
    };
  }

  flyTo(s: FakeCameraState): void {
    this.flyToCalls.push(s);
    this.setCamera(s);
  }

  getPickRay(): { origin: object; direction: object } {
    return this.pickRay;
  }

  on(evt: string, cb: (payload: unknown) => void): void {
    const arr = this.listeners.get(evt) ?? [];
    arr.push(cb);
    this.listeners.set(evt, arr);
  }

  emit(evt: string, payload: unknown): void {
    for (const cb of this.listeners.get(evt) ?? []) cb(payload);
  }

  dispose(): void {
    this.disposed = true;
  }
}
```

Add the runtime deps the later tasks need:

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm --filter @cityjson/navara-cityjson add three proj4 @cityjson/navara-core@workspace:* && pnpm --filter @cityjson/navara-cityjson add -D @types/three @types/proj4
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/fakeView.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit (submodule, then parent pointer)**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && git add packages/navara-cityjson && git commit -m "$(cat <<'EOF'
test: fake ThreeView/ViewContext doubles for navara-cityjson

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
cd /data2/hideba/multiroof-viewer && git add packages/cityjson-navara-plugins && git commit -m "$(cat <<'EOF'
chore: bump cityjson-navara-plugins pointer (fake view test doubles)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `CityMeshArrays` → `BufferGeometry`

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityMeshGeometry.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-cityjson/test/cityMeshGeometry.test.ts`

**Interfaces:**

- Consumes: `CityMeshArrays` from `@cityjson/navara-core`.
- Produces:
  - `geometryFromMeshArrays(arrays: CityMeshArrays): BufferGeometry` — attributes `position`(3), `normal`(3), `color`(3), `objectIndex`(1), `surfaceIndex`(1); `computeBoundingSphere()` called.
  - `disposeGeometry(geometry: BufferGeometry): void`

- [ ] **Step 1: Write the failing test**

```ts
// packages/navara-cityjson/test/cityMeshGeometry.test.ts
import { describe, it, expect } from "vitest";
import type { CityMeshArrays } from "@cityjson/navara-core";
import { geometryFromMeshArrays } from "../src/cityMeshGeometry";

function arrays(): CityMeshArrays {
  return {
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    colors: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
    objectIndices: new Uint32Array([0, 0, 0]),
    surfaceIndices: new Uint32Array([3, 3, 3]),
    objectKeys: ["B1"],
    triangleCount: 1,
  };
}

describe("geometryFromMeshArrays", () => {
  it("wires all five attributes with the right item sizes", () => {
    const g = geometryFromMeshArrays(arrays());
    expect(g.getAttribute("position").itemSize).toBe(3);
    expect(g.getAttribute("normal").itemSize).toBe(3);
    expect(g.getAttribute("color").itemSize).toBe(3);
    expect(g.getAttribute("objectIndex").itemSize).toBe(1);
    expect(g.getAttribute("surfaceIndex").itemSize).toBe(1);
    expect(g.getAttribute("position").count).toBe(3);
  });

  it("keeps index attributes readable per vertex and computes bounds", () => {
    const g = geometryFromMeshArrays(arrays());
    expect(g.getAttribute("objectIndex").getX(2)).toBe(0);
    expect(g.getAttribute("surfaceIndex").getX(2)).toBe(3);
    expect(g.boundingSphere).not.toBeNull();
    expect(g.boundingSphere!.radius).toBeGreaterThan(0);
  });

  it("does not copy the color array (the GPU buffer is mutated in place)", () => {
    const a = arrays();
    const g = geometryFromMeshArrays(a);
    expect(g.getAttribute("color").array).toBe(a.colors);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/cityMeshGeometry.test.ts
```

Expected: `Failed to resolve import "../src/cityMeshGeometry"`.

- [ ] **Step 3: Implement**

```ts
// packages/navara-cityjson/src/cityMeshGeometry.ts
/**
 * CityMeshArrays -> BufferGeometry. The only Three.js-specific step of the
 * geometry pipeline; everything upstream of it (triangulation, normals,
 * colors, picking indices) is worker-safe and lives in @cityjson/navara-core.
 *
 * The `color` attribute intentionally wraps the SAME Float32Array the caller
 * passed: highlight/style layering mutates that buffer in place and flips
 * `needsUpdate`, exactly as the pre-Navara renderer did.
 */
import { BufferAttribute, BufferGeometry } from "three";
import type { CityMeshArrays } from "@cityjson/navara-core";

export function geometryFromMeshArrays(arrays: CityMeshArrays): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(arrays.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(arrays.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(arrays.colors, 3));
  geometry.setAttribute(
    "objectIndex",
    new BufferAttribute(arrays.objectIndices, 1),
  );
  geometry.setAttribute(
    "surfaceIndex",
    new BufferAttribute(arrays.surfaceIndices, 1),
  );
  geometry.computeBoundingSphere();
  return geometry;
}

export function disposeGeometry(geometry: BufferGeometry): void {
  geometry.dispose();
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/cityMeshGeometry.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && git add packages/navara-cityjson && git commit -m "$(cat <<'EOF'
feat: CityMeshArrays -> BufferGeometry for the navara cityjson plugin

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
cd /data2/hideba/multiroof-viewer && git add packages/cityjson-navara-plugins && git commit -m "$(cat <<'EOF'
chore: bump cityjson-navara-plugins pointer (mesh geometry)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: ENU placement math (proj4 origin + geodetic bounds)

Pure, Node-testable half of §4.3 georeferencing. The ENU→ECEF matrix comes from `@cityjson/navara-core`'s `makeEnuFrame` (Task A13b), not from Navara's `geodeticToVector3`/`eastNorthUpToFixedFrame`, so this module never imports `@navaramap/*`.

**Scope note (amended 2026-08-02 after external review):** this module places an **origin** — it does not place vertices. Source-CRS deltas from that origin are _not_ ENU metres (projection scale factor + grid convergence), so every vertex is separately transformed by core's `projectPositionsToEnu` in the geometry build path: Task B6 for static layers, the FCB worker (Task C5) for streaming cells. `originLleFromOffset` and `geodeticBoundsFromBBox` stay exactly as specified below; the vertical-datum `heightOffset` (Global Constraints → Vertical datum) is applied by the caller when it builds the frame, so `placementMatrixFromLle` keeps taking a plain `Lle`.

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/enuPlacement.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-cityjson/test/enuPlacement.test.ts`

**Interfaces:**

- Consumes: `ensureProjDef`, `parseEpsgCode`, `computeOriginOffset`, `makeEnuFrame` (Task A13b) from `@cityjson/navara-core`; `proj4`; `Matrix4` from `three`.
- Produces:
  - `interface Lle { readonly lng: number; readonly lat: number; readonly height: number }` (degrees, metres)
  - `interface GeodeticBounds { readonly west: number; readonly south: number; readonly east: number; readonly north: number; readonly minHeight: number; readonly maxHeight: number }` (degrees, metres)
  - `resolveEpsg(crs: string | number | undefined): number` — throws `CrsUnresolvedError` when absent/unregisterable (spec §4.3 CRS gate)
  - `originLleFromOffset(originOffset: Vec3, epsg: number): Lle`
  - `geodeticBoundsFromBBox(bbox: BBox3, epsg: number): GeodeticBounds`
  - `placementMatrixFromLle(lle: Lle): Matrix4` — the ENU→ECEF placement matrix, built from core's `makeEnuFrame` (Task A13b) and **never** from Navara's `eastNorthUpToFixedFrame`, so static layers and streaming cells share one frame implementation and placement stays testable without WASM
  - `class CrsUnresolvedError extends Error`

- [ ] **Step 1: Write the failing test**

```ts
// packages/navara-cityjson/test/enuPlacement.test.ts
import { describe, it, expect } from "vitest";
import { makeEnuFrame } from "@cityjson/navara-core";
import {
  CrsUnresolvedError,
  geodeticBoundsFromBBox,
  originLleFromOffset,
  placementMatrixFromLle,
  resolveEpsg,
} from "../src/enuPlacement";

// Fixture CRS: EPSG:7415 (RD New + NAP), the two-buildings fixture's CRS.
const RD = "https://www.opengis.net/def/crs/EPSG/0/7415";

describe("resolveEpsg", () => {
  it("parses an OGC CRS URI", () => {
    expect(resolveEpsg(RD)).toBe(7415);
  });

  it("accepts a bare numeric code", () => {
    expect(resolveEpsg(28992)).toBe(28992);
  });

  it("throws for a missing CRS (the spec 4.3 gate)", () => {
    expect(() => resolveEpsg(undefined)).toThrow(CrsUnresolvedError);
  });

  it("throws for a CRS proj4 cannot resolve", () => {
    expect(() =>
      resolveEpsg("https://www.opengis.net/def/crs/EPSG/0/99999"),
    ).toThrow(CrsUnresolvedError);
  });
});

describe("originLleFromOffset", () => {
  it("reprojects an RD New origin into the Delft area", () => {
    const lle = originLleFromOffset([85000, 446000, 12], 7415);
    expect(lle.lng).toBeCloseTo(4.348, 2);
    expect(lle.lat).toBeCloseTo(52.006, 2);
    expect(lle.height).toBe(12);
  });
});

describe("geodeticBoundsFromBBox", () => {
  it("returns a west<east / south<north box covering all four corners", () => {
    const b = geodeticBoundsFromBBox(
      [84900, 445900, 0, 85100, 446100, 20],
      7415,
    );
    expect(b.west).toBeLessThan(b.east);
    expect(b.south).toBeLessThan(b.north);
    expect(b.minHeight).toBe(0);
    expect(b.maxHeight).toBe(20);
    const centreLng = (b.west + b.east) / 2;
    expect(centreLng).toBeCloseTo(4.348, 2);
  });
});

describe("placementMatrixFromLle", () => {
  it("carries core's ENU frame, so placement matches the streaming plugin's cell frames", () => {
    const lle = { lng: 4.3571, lat: 52.0116, height: 0 };
    const m = placementMatrixFromLle(lle);
    const frame = makeEnuFrame(lle.lng, lle.lat, lle.height);
    // Matrix4.elements is column-major, exactly like EnuFrame.matrix.
    expect(m.elements[12]).toBeCloseTo(frame.originEcef[0], 6);
    expect(m.elements[13]).toBeCloseTo(frame.originEcef[1], 6);
    expect(m.elements[14]).toBeCloseTo(frame.originEcef[2], 6);
    expect(m.elements[15]).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/enuPlacement.test.ts
```

Expected: `Failed to resolve import "../src/enuPlacement"`.

- [ ] **Step 3: Implement**

```ts
// packages/navara-cityjson/src/enuPlacement.ts
/**
 * Georeferencing for a city model: source CRS -> WGS84 geodetic, used to
 * place a local-ENU-metre mesh on the globe (spec 4.3) and to report
 * geodetic bounds for fitAll/fitLayer.
 *
 * Deliberately free of @navaramap imports: the ECEF/ENU matrix comes from
 * @cityjson/navara-core's `makeEnuFrame` (Task A13b), never from Navara's
 * `eastNorthUpToFixedFrame`. That keeps this module unit-testable in Node and
 * keeps static layers and streaming cells on one frame implementation.
 */
import proj4 from "proj4";
import { Matrix4 } from "three";
import {
  ensureProjDef,
  makeEnuFrame,
  parseEpsgCode,
  type BBox3,
  type Vec3,
} from "@cityjson/navara-core";

export interface Lle {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
}

export interface GeodeticBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}

export class CrsUnresolvedError extends Error {
  constructor(readonly crs: string | number | undefined) {
    super(
      `Cannot georeference this layer: CRS ${
        crs === undefined ? "(missing)" : String(crs)
      } has no proj4 definition. Navara has no planar mode, so the layer cannot be loaded.`,
    );
    this.name = "CrsUnresolvedError";
  }
}

export function resolveEpsg(crs: string | number | undefined): number {
  const epsg = typeof crs === "number" ? crs : parseEpsgCode(crs);
  if (epsg === null || epsg === undefined) throw new CrsUnresolvedError(crs);
  if (!ensureProjDef(epsg)) throw new CrsUnresolvedError(crs);
  return epsg;
}

function toWgs84(epsg: number, x: number, y: number): [number, number] {
  return proj4(`EPSG:${epsg}`, "WGS84", [x, y]) as [number, number];
}

export function originLleFromOffset(originOffset: Vec3, epsg: number): Lle {
  const [lng, lat] = toWgs84(epsg, originOffset[0], originOffset[1]);
  return { lng, lat, height: originOffset[2] };
}

export function geodeticBoundsFromBBox(
  bbox: BBox3,
  epsg: number,
): GeodeticBounds {
  const corners: Array<[number, number]> = [
    [bbox[0], bbox[1]],
    [bbox[3], bbox[1]],
    [bbox[3], bbox[4]],
    [bbox[0], bbox[4]],
  ];
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of corners) {
    const [lng, lat] = toWgs84(epsg, x, y);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north, minHeight: bbox[2], maxHeight: bbox[5] };
}

/** ENU(metres) -> ECEF placement matrix for a layer origin. */
export function placementMatrixFromLle(lle: Lle): Matrix4 {
  const frame = makeEnuFrame(lle.lng, lle.lat, lle.height);
  return new Matrix4().fromArray(Array.from(frame.matrix));
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/enuPlacement.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && git add packages/navara-cityjson && git commit -m "$(cat <<'EOF'
feat: CRS gate, ENU origin and geodetic bounds for city model placement

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
cd /data2/hideba/multiroof-viewer && git add packages/cityjson-navara-plugins && git commit -m "$(cat <<'EOF'
chore: bump cityjson-navara-plugins pointer (ENU placement)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: Vertex color layering (base → style → highlight)

Ports `src/scene/highlightMesh.ts` + the evaluator half of `src/scene/applyRuleColors.ts` onto typed arrays, inside the plugin.

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/surfaceColorLayers.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/selection.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-cityjson/test/surfaceColorLayers.test.ts`

**Interfaces:**

- Consumes: `srgbHexToLinear`, `CityObject`, `Surface`, `SurfaceStyleEvaluator`, `SurfaceInfo`, `CityObjectInfo` from `@cityjson/navara-core`.
- Produces (`selection.ts`):
  - `type PickMode = "object" | "surface"`
  - `interface ObjectSelection { readonly kind: "object"; readonly layerId: string; readonly objectId: string }`
  - `interface SurfaceSelection { readonly kind: "surface"; readonly layerId: string; readonly objectId: string; readonly surfaceIndex: number }`
  - `type Selection = ObjectSelection | SurfaceSelection`
  - `interface ScreenPoint { readonly x: number; readonly y: number }`
  - `interface PickedFeatureLike { readonly batchId?: number; readonly layerId?: string; readonly properties?: Readonly<Record<string, unknown>> }`
- Produces (`surfaceColorLayers.ts`):
  - `HIGHLIGHT_COLOR_HEX = "#e8973f"`, `HOVER_COLOR_HEX = "#fbbf24"`
  - `computeStyleColors(evaluator: SurfaceStyleEvaluator, objectIndices: Uint32Array, surfaceIndices: Uint32Array, objectKeys: readonly string[], lookup: (id: string) => CityObject | undefined, baseColors: Float32Array): Float32Array | null`
  - `paintLayers(target: Float32Array, source: Float32Array, objectIndices: Uint32Array, surfaceIndices: Uint32Array, objectKeys: readonly string[], selections: readonly Selection[], hovered: Selection | null): void`

- [ ] **Step 1: Write the failing test**

```ts
// packages/navara-cityjson/test/surfaceColorLayers.test.ts
import { describe, it, expect } from "vitest";
import { srgbHexToLinear, type CityObject } from "@cityjson/navara-core";
import {
  computeStyleColors,
  HIGHLIGHT_COLOR_HEX,
  HOVER_COLOR_HEX,
  paintLayers,
} from "../src/surfaceColorLayers";

/** 4 vertices: v0,v1 -> object 0 surface 0; v2,v3 -> object 1 surface 1. */
const objectIndices = new Uint32Array([0, 0, 1, 1]);
const surfaceIndices = new Uint32Array([0, 0, 1, 1]);
const objectKeys = ["B1", "B2"];
// 0.25 / 0.5 are exactly representable in a Float32Array, so the toEqual
// assertions below are safe (0.1 and 0.2 are not — they round on storage).
const base = new Float32Array([
  0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
]);

function obj(id: string, type: "RoofSurface" | "WallSurface"): CityObject {
  return {
    id,
    objectType: "Building",
    attributes: {},
    surfaces: [
      { type, rings: [], attributes: {}, lod: "2" },
      { type, rings: [], attributes: {}, lod: "2" },
    ],
    bbox: null,
    children: [],
    parents: [],
    lod: "2",
  };
}

const lookup = (id: string) =>
  id === "B1" ? obj("B1", "RoofSurface") : obj("B2", "WallSurface");

describe("computeStyleColors", () => {
  it("writes the evaluator color only where it returns non-null", () => {
    const out = computeStyleColors(
      // The evaluator returns a linear-sRGB triple (see Shared Interface
      // Contract) — the buffer takes it verbatim, with no hex round trip.
      (surface) =>
        surface.surface.type === "RoofSurface" ? [1, 0, 0.5] : null,
      objectIndices,
      surfaceIndices,
      objectKeys,
      lookup,
      base,
    );
    expect(out).not.toBeNull();
    expect(Array.from(out!.slice(0, 3))).toEqual([1, 0, 0.5]);
    expect(Array.from(out!.slice(6, 9))).toEqual([0.5, 0.5, 0.5]);
  });

  it("returns null when the evaluator never matches", () => {
    const out = computeStyleColors(
      () => null,
      objectIndices,
      surfaceIndices,
      objectKeys,
      lookup,
      base,
    );
    expect(out).toBeNull();
  });
});

describe("paintLayers", () => {
  it("restores the source layer then paints selection over hover", () => {
    const target = new Float32Array(base.length);
    paintLayers(
      target,
      base,
      objectIndices,
      surfaceIndices,
      objectKeys,
      [{ kind: "object", layerId: "L", objectId: "B1" }],
      { kind: "object", layerId: "L", objectId: "B1" },
    );
    const [hr, hg, hb] = srgbHexToLinear(HIGHLIGHT_COLOR_HEX);
    expect(target[0]).toBeCloseTo(hr, 6);
    expect(target[1]).toBeCloseTo(hg, 6);
    expect(target[2]).toBeCloseTo(hb, 6);
    expect(Array.from(target.slice(6, 9))).toEqual([0.5, 0.5, 0.5]);
  });

  it("honours surface-level selection granularity", () => {
    const target = new Float32Array(base.length);
    paintLayers(
      target,
      base,
      objectIndices,
      surfaceIndices,
      objectKeys,
      [{ kind: "surface", layerId: "L", objectId: "B2", surfaceIndex: 9 }],
      null,
    );
    expect(Array.from(target.slice(6, 9))).toEqual([0.5, 0.5, 0.5]);
  });

  it("paints hover when nothing is selected", () => {
    const target = new Float32Array(base.length);
    paintLayers(target, base, objectIndices, surfaceIndices, objectKeys, [], {
      kind: "surface",
      layerId: "L",
      objectId: "B2",
      surfaceIndex: 1,
    });
    const [r, g, b] = srgbHexToLinear(HOVER_COLOR_HEX);
    expect(target[6]).toBeCloseTo(r, 6);
    expect(target[7]).toBeCloseTo(g, 6);
    expect(target[8]).toBeCloseTo(b, 6);
    expect(Array.from(target.slice(0, 3))).toEqual([0.25, 0.25, 0.25]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/surfaceColorLayers.test.ts
```

Expected: `Failed to resolve import "../src/surfaceColorLayers"`.

- [ ] **Step 3: Implement**

```ts
// packages/navara-cityjson/src/selection.ts
/** Structural copies of the app's selection domain types — the plugin must
 *  not depend on the app. Kept identical to src/domain/selection/types.ts. */
export type PickMode = "object" | "surface";

export interface ObjectSelection {
  readonly kind: "object";
  readonly layerId: string;
  readonly objectId: string;
}

export interface SurfaceSelection {
  readonly kind: "surface";
  readonly layerId: string;
  readonly objectId: string;
  readonly surfaceIndex: number;
}

export type Selection = ObjectSelection | SurfaceSelection;

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface PickedFeatureLike {
  readonly batchId?: number;
  readonly layerId?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}
```

```ts
// packages/navara-cityjson/src/surfaceColorLayers.ts
/**
 * Vertex-color layer stack: base -> style (rules) -> highlight, ported from
 * the pre-Navara src/scene/highlightMesh.ts and applyRuleColors.ts.
 *
 * `computeStyleColors` is the evaluator-driven analogue of core's
 * `buildRuleColorsFromArrays` (which stays as-is for the worker/streaming
 * path in M7.5): identical caching by "objIdx:surfIdx", identical
 * "return null when nothing matched" contract.
 */
import {
  srgbHexToLinear,
  type CityObject,
  type SurfaceStyleEvaluator,
} from "@cityjson/navara-core";
import type { Selection } from "./selection";

export const HIGHLIGHT_COLOR_HEX = "#e8973f";
export const HOVER_COLOR_HEX = "#fbbf24";

const HIGHLIGHT_RGB = srgbHexToLinear(HIGHLIGHT_COLOR_HEX);
const HOVER_RGB = srgbHexToLinear(HOVER_COLOR_HEX);

type RGB = readonly [number, number, number];

export function computeStyleColors(
  evaluator: SurfaceStyleEvaluator,
  objectIndices: Uint32Array,
  surfaceIndices: Uint32Array,
  objectKeys: readonly string[],
  lookup: (objectId: string) => CityObject | undefined,
  baseColors: Float32Array,
): Float32Array | null {
  const result = Float32Array.from(baseColors);
  const cache = new Map<string, RGB | null>();
  let anyChange = false;

  for (let v = 0; v < objectIndices.length; v++) {
    const objIdx = objectIndices[v]!;
    const surfIdx = surfaceIndices[v]!;
    const key = `${objIdx}:${surfIdx}`;

    let rgb = cache.get(key);
    if (rgb === undefined) {
      rgb = null;
      const objectId = objectKeys[objIdx];
      const object = objectId === undefined ? undefined : lookup(objectId);
      const surface = object?.surfaces[surfIdx];
      if (object && objectId !== undefined && surface) {
        const color = evaluator(
          { surfaceIndex: surfIdx, surface },
          { objectId, object },
        );
        // The evaluator already returns linear-sRGB; no conversion needed.
        if (color) rgb = color;
      }
      cache.set(key, rgb);
    }

    if (rgb) {
      const base = v * 3;
      result[base] = rgb[0];
      result[base + 1] = rgb[1];
      result[base + 2] = rgb[2];
      anyChange = true;
    }
  }

  return anyChange ? result : null;
}

function matchesSurface(
  selection: Selection | null,
  surfaceIdx: number,
): boolean {
  if (!selection) return false;
  if (selection.kind === "object") return true;
  return selection.surfaceIndex === surfaceIdx;
}

export function paintLayers(
  target: Float32Array,
  source: Float32Array,
  objectIndices: Uint32Array,
  surfaceIndices: Uint32Array,
  objectKeys: readonly string[],
  selections: readonly Selection[],
  hovered: Selection | null,
): void {
  target.set(source);

  const selectedByIdx = new Map<number, Selection>();
  for (const sel of selections) {
    const idx = objectKeys.indexOf(sel.objectId);
    if (idx >= 0) selectedByIdx.set(idx, sel);
  }
  const hoveredIdx = hovered ? objectKeys.indexOf(hovered.objectId) : -1;

  for (let v = 0; v < objectIndices.length; v++) {
    const oIdx = objectIndices[v]!;
    const sIdx = surfaceIndices[v]!;
    const base = v * 3;

    if (
      hoveredIdx >= 0 &&
      oIdx === hoveredIdx &&
      matchesSurface(hovered, sIdx)
    ) {
      target[base] = HOVER_RGB[0];
      target[base + 1] = HOVER_RGB[1];
      target[base + 2] = HOVER_RGB[2];
    }

    const sel = selectedByIdx.get(oIdx);
    if (sel && matchesSurface(sel, sIdx)) {
      target[base] = HIGHLIGHT_RGB[0];
      target[base + 1] = HIGHLIGHT_RGB[1];
      target[base + 2] = HIGHLIGHT_RGB[2];
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/surfaceColorLayers.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && git add packages/navara-cityjson && git commit -m "$(cat <<'EOF'
feat: base/style/highlight vertex color layering in navara-cityjson

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
cd /data2/hideba/multiroof-viewer && git add packages/cityjson-navara-plugins && git commit -m "$(cat <<'EOF'
chore: bump cityjson-navara-plugins pointer (color layering)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B6: `CityModelMesh` — the renderer-facing mesh object

All handle behaviour lives here, in a plain class with no `@navaramap` import, so it is fully unit-testable in Node. `CityModelMeshDesc` (Task B7) is a thin Navara wrapper around it.

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/pickStrategy.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityModelMesh.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-cityjson/test/cityModelMesh.test.ts`

**Interfaces:**

- Consumes: `geometryFromMeshArrays` (B3), `geodeticBoundsFromBBox`/`originLleFromOffset`/`resolveEpsg`/`placementMatrixFromLle` (B4, which wraps core's `makeEnuFrame`), `computeStyleColors`/`paintLayers` (B5), and from core: `buildCityMeshArrays`, `computeOriginOffset`, `makeEnuFrame`, `projectPositionsToEnu` (Task A13b). The geoid sample itself is **not** taken here — `CityModelMesh` is synchronous; Task B7's registry awaits `geoidHeightAt()` and calls `setHeightOffset()`.
- Produces:
  - `type PickStrategy = "pickable-wrapper" | "own-raycast"` and `const DEFAULT_PICK_STRATEGY: PickStrategy` — the typed carrier for Task B1's `PICK_PATH` verdict (see Global Constraints → Risk gate)
  - `interface CityModelMeshOptions { readonly id: string; readonly model: CityModel; readonly crs?: string | number; readonly lod?: string | null; readonly heightOffset?: number; readonly pickStrategy?: PickStrategy; readonly makePlacementMatrix?: (lle: Lle) => Matrix4 }` — `makePlacementMatrix` defaults to `placementMatrixFromLle` (core's ENU frame) and tests override it to keep matrix assertions readable; `heightOffset` defaults to `0` and is normally set a moment later by `setHeightOffset()` once the async geoid sample resolves (Task B7; see Global Constraints → Vertical datum); `pickStrategy` defaults to `DEFAULT_PICK_STRATEGY`
  - `class CityModelMesh` with `readonly id`, `readonly object3d: Mesh`, `readonly epsg: number`, `readonly pickStrategy: PickStrategy`, `setVisible(v)`, `setLod(lod)`, `setHeightOffset(metres)`, `setStyle(evaluator)`, `setHighlight(selections, hovered)`, `resolveVertex(vertexIndex): SurfaceSelection | null`, `resolveRaycast(ray): SurfaceSelection | null`, `resolveVertexIndices(objectIndex, surfaceIndex): SurfaceSelection | null`, `batchIdMap(): ReadonlyArray<{ objectIndex: number; surfaceIndex: number }>`, `getBoundsGeodetic()`, `triangleCount()`, `dispose()`

- [ ] **Step 0: Write the typed pick-strategy capability**

Task B1 Step 9 produced a `PICK_PATH` verdict. It becomes a value, not a sentence in a markdown file, so every consumer type-checks against it:

```ts
// packages/navara-cityjson/src/pickStrategy.ts
/**
 * How a city-model mesh resolves a screen pick into a surface.
 *
 * - "pickable-wrapper": Navara's GPU pick pipeline resolves the triangle and
 *   the `pick` event carries a `batchId` we map back through
 *   `CityModelMesh.batchIdMap()`.
 * - "own-raycast": we take `getPickRay(view, x, y)` and raycast the mesh
 *   ourselves, reading `objectIndex`/`surfaceIndex` off the hit face.
 *
 * Both branches ship and both are unit-tested; this value decides which one
 * runs. Its value is transcribed from the Task B1 spike's `PICK_PATH` verdict
 * (docs/superpowers/research/2026-08-01-navara-spike-findings.md) — update the
 * constant below to match that document, and nothing else changes.
 */
export type PickStrategy = "pickable-wrapper" | "own-raycast";

/** Set from Task B1's PICK_PATH verdict. */
export const DEFAULT_PICK_STRATEGY: PickStrategy = "pickable-wrapper";
```

Add one case to `test/cityModelMesh.test.ts` (written together with Step 1's cases) proving the capability actually routes:

```ts
import { DEFAULT_PICK_STRATEGY } from "../src/pickStrategy";

describe("pick strategy capability", () => {
  it("exposes the configured strategy and defaults to the spike's verdict", () => {
    const wrapper = new CityModelMesh({
      ...opts,
      lod: "2",
      pickStrategy: "pickable-wrapper",
    });
    const raycast = new CityModelMesh({
      ...opts,
      lod: "2",
      pickStrategy: "own-raycast",
    });
    expect(wrapper.pickStrategy).toBe("pickable-wrapper");
    expect(raycast.pickStrategy).toBe("own-raycast");
    expect(new CityModelMesh({ ...opts, lod: "2" }).pickStrategy).toBe(
      DEFAULT_PICK_STRATEGY,
    );
    wrapper.dispose();
    raycast.dispose();
  });

  it("setHeightOffset re-places the mesh and re-projects its vertices", () => {
    // The default placement matrix is injected in `opts`, so assert on the
    // frame the vertices were projected into: raising the offset by 43 m
    // must move every vertex down by ~43 m in the NEW frame (the frame origin
    // rose with it), not leave them untouched.
    const m = new CityModelMesh({ ...opts, lod: "2" });
    const before = Float32Array.from(
      m.object3d.geometry.getAttribute("position").array as Float32Array,
    );
    m.setHeightOffset(43);
    const after = m.object3d.geometry.getAttribute("position")
      .array as Float32Array;
    expect(after.length).toBe(before.length);
    for (let i = 2; i < after.length; i += 3) {
      expect(after[i]! - before[i]!).toBeCloseTo(-43, 3);
    }
    m.dispose();
  });

  it("setHeightOffset with the current value is a no-op (no geometry churn)", () => {
    const m = new CityModelMesh({ ...opts, lod: "2" });
    const geometry = m.object3d.geometry;
    m.setHeightOffset(0);
    expect(m.object3d.geometry).toBe(geometry);
    m.dispose();
  });

  it("publishes a batchId map under the wrapper strategy so a batchId round-trips to a surface", () => {
    const m = new CityModelMesh({
      ...opts,
      lod: "2",
      pickStrategy: "pickable-wrapper",
    });
    const map = m.batchIdMap();
    // One quad at LoD 2 -> 2 triangles -> 2 batch ids, both on surface 0.
    expect(map).toHaveLength(2);
    expect(
      m.resolveVertexIndices(map[0]!.objectIndex, map[0]!.surfaceIndex),
    ).toEqual({
      kind: "surface",
      layerId: "L1",
      objectId: "B1",
      surfaceIndex: 0,
    });
    m.dispose();
  });
});
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/navara-cityjson/test/cityModelMesh.test.ts
import { describe, it, expect } from "vitest";
import { Matrix4 } from "three";
import type { CityModel } from "@cityjson/navara-core";
import { CityModelMesh } from "../src/cityModelMesh";

function quad(z: number, lod: string) {
  return {
    type: "RoofSurface" as const,
    rings: [
      [
        [85000, 446000, z],
        [85010, 446000, z],
        [85010, 446010, z],
        [85000, 446010, z],
      ],
    ] as const,
    attributes: {},
    lod,
  };
}

const model: CityModel = {
  sourceEncoding: "cityjson",
  metadata: { referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415" },
  bbox: [85000, 446000, 0, 85010, 446010, 6],
  objects: {
    B1: {
      id: "B1",
      objectType: "Building",
      attributes: { fn: "house" },
      surfaces: [quad(6, "2"), quad(3, "1")],
      bbox: [85000, 446000, 0, 85010, 446010, 6],
      children: [],
      parents: [],
      lod: "2",
    },
  },
  vertexCount: 8,
};

const opts = {
  id: "L1",
  model,
  crs: "https://www.opengis.net/def/crs/EPSG/0/7415",
  makePlacementMatrix: () => new Matrix4().makeTranslation(1, 2, 3),
};

describe("CityModelMesh", () => {
  it("builds a mesh placed by the injected ENU matrix", () => {
    const m = new CityModelMesh({ ...opts, lod: "2" });
    expect(m.object3d.matrixAutoUpdate).toBe(false);
    expect(m.object3d.matrix.elements[12]).toBe(1);
    expect(m.triangleCount()).toBe(2); // one quad -> 2 triangles at LoD 2
    m.dispose();
  });

  it("setLod rebuilds geometry with only that LoD's surfaces", () => {
    const m = new CityModelMesh({ ...opts, lod: "2" });
    const before = m.object3d.geometry;
    m.setLod("1");
    expect(m.object3d.geometry).not.toBe(before);
    expect(m.triangleCount()).toBe(2);
    m.dispose();
  });

  it("setStyle recolors matching surfaces and setStyle(null) restores base", () => {
    const m = new CityModelMesh({ ...opts, lod: "2" });
    const colors = m.object3d.geometry.getAttribute("color");
    const before = colors.getX(0);
    m.setStyle(() => [0, 1, 0]);
    expect(colors.getX(0)).not.toBe(before);
    expect(colors.getY(0)).toBeGreaterThan(0.9);
    m.setStyle(null);
    expect(colors.getX(0)).toBe(before);
    m.dispose();
  });

  it("setHighlight layers over the style colors, not the base colors", () => {
    const m = new CityModelMesh({ ...opts, lod: "2" });
    const colors = m.object3d.geometry.getAttribute("color");
    m.setStyle(() => [0, 1, 0]);
    m.setHighlight([{ kind: "object", layerId: "L1", objectId: "B1" }], null);
    expect(colors.getX(0)).toBeGreaterThan(0.5); // highlight orange has red
    m.setHighlight([], null);
    expect(colors.getY(0)).toBeGreaterThan(0.9); // back to the style green
    m.dispose();
  });

  it("resolveVertex maps a vertex index to a surface selection", () => {
    const m = new CityModelMesh({ ...opts, lod: "2" });
    expect(m.resolveVertex(0)).toEqual({
      kind: "surface",
      layerId: "L1",
      objectId: "B1",
      surfaceIndex: 0,
    });
    expect(m.resolveVertex(9999)).toBeNull();
    m.dispose();
  });

  it("reports geodetic bounds around Delft", () => {
    const m = new CityModelMesh({ ...opts, lod: "2" });
    const b = m.getBoundsGeodetic();
    expect(b.west).toBeGreaterThan(4.3);
    expect(b.east).toBeLessThan(4.4);
    expect(b.south).toBeGreaterThan(51.9);
    expect(b.maxHeight).toBe(6);
    m.dispose();
  });

  it("throws CrsUnresolvedError when the model has no usable CRS", () => {
    expect(
      () =>
        new CityModelMesh({
          ...opts,
          crs: undefined,
          model: { ...model, metadata: {} },
        }),
    ).toThrow(/Cannot georeference/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/cityModelMesh.test.ts
```

Expected: `Failed to resolve import "../src/cityModelMesh"`.

- [ ] **Step 3: Implement**

```ts
// packages/navara-cityjson/src/cityModelMesh.ts
/**
 * The renderer-facing city model mesh: geometry + material + the whole
 * CityModelHandle behaviour set (LoD rebuild, style, highlight, pick
 * resolution, bounds, triangle count).
 *
 * Deliberately free of @navaramap imports — the ENU placement matrix comes
 * from `placementMatrixFromLle` (core's `makeEnuFrame`, Task A13b) and can be
 * overridden through `makePlacementMatrix` in tests. That keeps every
 * behaviour above unit-testable in Node, and keeps static layers and
 * streaming cells (Task C8) on one frame implementation.
 */
import {
  FrontSide,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
  type BufferGeometry,
} from "three";
import {
  buildCityMeshArrays,
  computeOriginOffset,
  makeEnuFrame,
  projectPositionsToEnu,
  type CityMeshArrays,
  type CityModel,
  type EnuFrame,
  type SurfaceStyleEvaluator,
  type Vec3,
} from "@cityjson/navara-core";
import { geometryFromMeshArrays } from "./cityMeshGeometry";
import {
  geodeticBoundsFromBBox,
  originLleFromOffset,
  placementMatrixFromLle,
  resolveEpsg,
  type GeodeticBounds,
  type Lle,
} from "./enuPlacement";
import { DEFAULT_PICK_STRATEGY, type PickStrategy } from "./pickStrategy";
import { computeStyleColors, paintLayers } from "./surfaceColorLayers";
import type { Selection, SurfaceSelection } from "./selection";

export interface CityModelMeshOptions {
  readonly id: string;
  readonly model: CityModel;
  readonly crs?: string | number;
  readonly lod?: string | null;
  /** Metres added to every vertex's geodetic height before the ENU transform
   *  (the geoid undulation at the layer origin). Defaults to 0; Task B7's
   *  registry calls `setHeightOffset()` when its async `geoidHeightAt()`
   *  sample resolves. See Global Constraints -> Vertical datum. */
  readonly heightOffset?: number;
  /** Task B1's PICK_PATH verdict. Defaults to DEFAULT_PICK_STRATEGY. */
  readonly pickStrategy?: PickStrategy;
  /** Defaults to `placementMatrixFromLle` (core's ENU frame). */
  readonly makePlacementMatrix?: (lle: Lle) => Matrix4;
}

export class CityModelMesh {
  readonly id: string;
  readonly epsg: number;
  readonly pickStrategy: PickStrategy;
  readonly object3d: Mesh;

  private readonly model: CityModel;
  private readonly originOffset: Vec3;
  private frame: EnuFrame;
  private heightOffset: number;
  private placement: Matrix4;
  private readonly makePlacementMatrix: (lle: Lle) => Matrix4;
  private lod: string | null;
  private arrays: CityMeshArrays;
  private baseColors: Float32Array;
  private styleColors: Float32Array | null = null;
  private evaluator: SurfaceStyleEvaluator | null = null;
  private selections: readonly Selection[] = [];
  private hovered: Selection | null = null;

  constructor(options: CityModelMeshOptions) {
    this.id = options.id;
    this.model = options.model;
    this.epsg = resolveEpsg(
      options.crs ?? options.model.metadata.referenceSystem,
    );
    this.pickStrategy = options.pickStrategy ?? DEFAULT_PICK_STRATEGY;
    this.lod = options.lod ?? null;
    this.originOffset = computeOriginOffset(options.model);
    this.heightOffset = options.heightOffset ?? 0;
    this.makePlacementMatrix =
      options.makePlacementMatrix ?? placementMatrixFromLle;
    this.applyHeightOffset();

    this.arrays = this.buildArrays();
    this.baseColors = Float32Array.from(this.arrays.colors);

    this.object3d = new Mesh(
      geometryFromMeshArrays(this.arrays),
      new MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        side: FrontSide,
      }),
    );
    this.object3d.name = `cityModel:${this.id}`;
    this.object3d.userData.layerId = this.id;
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
    this.applyPlacement();
  }

  private buildArrays(): CityMeshArrays {
    const arrays = buildCityMeshArrays(
      this.model,
      this.id,
      this.originOffset,
      this.lod,
    );
    // buildCityMeshArrays emits *source-CRS deltas* from originOffset. Those
    // are NOT ENU metres: a projected CRS carries scale factor and grid
    // convergence, so a delta 5 km from the origin is off by metres in
    // position and by a fraction of a degree in bearing. Re-place every vertex
    // exactly: source (x, y, z) -> lng/lat -> +heightOffset -> ECEF ->
    // inverse ENU frame. Runs once per LoD rebuild, not per frame.
    projectPositionsToEnu(arrays.positions, {
      originOffset: this.originOffset,
      epsg: this.epsg,
      frame: this.frame,
      heightOffset: this.heightOffset,
    });
    return arrays;
  }

  /** Rebuilds the ENU frame and the placement matrix for the current
   *  `heightOffset`. Called from the constructor and from setHeightOffset. */
  private applyHeightOffset(): void {
    const originLle = originLleFromOffset(this.originOffset, this.epsg);
    const height = originLle.height + this.heightOffset;
    this.frame = makeEnuFrame(originLle.lng, originLle.lat, height);
    this.placement = this.makePlacementMatrix({ ...originLle, height });
  }

  private applyPlacement(): void {
    this.object3d.matrixAutoUpdate = false;
    this.object3d.matrix.copy(this.placement);
    this.object3d.matrixWorld.copy(this.placement);
    this.object3d.matrixWorldNeedsUpdate = true;
  }

  private get geometry(): BufferGeometry {
    return this.object3d.geometry;
  }

  /** Recompute style colors, then repaint the live color attribute. */
  private repaint(): void {
    this.styleColors = this.evaluator
      ? computeStyleColors(
          this.evaluator,
          this.arrays.objectIndices,
          this.arrays.surfaceIndices,
          this.arrays.objectKeys,
          (objectId) => this.model.objects[objectId],
          this.baseColors,
        )
      : null;

    const attr = this.geometry.getAttribute("color");
    paintLayers(
      attr.array as Float32Array,
      this.styleColors ?? this.baseColors,
      this.arrays.objectIndices,
      this.arrays.surfaceIndices,
      this.arrays.objectKeys,
      this.selections,
      this.hovered,
    );
    attr.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.object3d.visible = visible;
  }

  setLod(lod: string | null): void {
    if (lod === this.lod) return;
    this.lod = lod;
    this.rebuildGeometry();
  }

  /**
   * Re-place the mesh at a new vertical-datum offset.
   *
   * The geoid sample is asynchronous (a network fetch), and blocking first
   * render on it would mean a blank viewport whenever the terrain service is
   * slow. So the mesh is built at offset 0 and re-placed the moment the
   * sample lands — one extra geometry pass per layer, no ordering hazard, and
   * a failed sample simply never calls this. See Global Constraints ->
   * Vertical datum.
   */
  setHeightOffset(metres: number): void {
    if (metres === this.heightOffset) return;
    this.heightOffset = metres;
    this.applyHeightOffset();
    this.applyPlacement();
    // Vertices are baked in the OLD frame, so they must be re-projected, not
    // just re-matrixed — the frame origin moved along the ellipsoid normal.
    this.rebuildGeometry();
  }

  private rebuildGeometry(): void {
    const old = this.geometry;
    this.arrays = this.buildArrays();
    this.baseColors = Float32Array.from(this.arrays.colors);
    this.object3d.geometry = geometryFromMeshArrays(this.arrays);
    old.dispose();
    this.repaint();
  }

  setStyle(evaluator: SurfaceStyleEvaluator | null): void {
    this.evaluator = evaluator;
    this.repaint();
  }

  setHighlight(
    selections: readonly Selection[],
    hovered: Selection | null = null,
  ): void {
    this.selections = selections;
    this.hovered = hovered;
    this.repaint();
  }

  resolveVertex(vertexIndex: number): SurfaceSelection | null {
    const objIdxAttr = this.geometry.getAttribute("objectIndex");
    const surfIdxAttr = this.geometry.getAttribute("surfaceIndex");
    if (!objIdxAttr || !surfIdxAttr) return null;
    if (vertexIndex < 0 || vertexIndex >= objIdxAttr.count) return null;
    const objectId = this.arrays.objectKeys[objIdxAttr.getX(vertexIndex)];
    if (objectId === undefined) return null;
    return {
      kind: "surface",
      layerId: this.id,
      objectId,
      surfaceIndex: surfIdxAttr.getX(vertexIndex),
    };
  }

  /** Own-raycast pick path (spike PICK_PATH="own-raycast"): ECEF ray in,
   *  surface selection out. */
  resolveRaycast(ray: {
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
  }): SurfaceSelection | null {
    if (!this.object3d.visible) return null;
    const raycaster = new Raycaster(
      new Vector3(ray.origin.x, ray.origin.y, ray.origin.z),
      new Vector3(
        ray.direction.x,
        ray.direction.y,
        ray.direction.z,
      ).normalize(),
      0,
      Infinity,
    );
    const hit = raycaster.intersectObject(this.object3d, false)[0];
    if (!hit?.face) return null;
    return this.resolveVertex(hit.face.a);
  }

  /** PickedFeature path: object/surface indices straight from the payload. */
  resolveVertexIndices(
    objectIndex: number,
    surfaceIndex: number,
  ): SurfaceSelection | null {
    const objectId = this.arrays.objectKeys[objectIndex];
    if (objectId === undefined) return null;
    return { kind: "surface", layerId: this.id, objectId, surfaceIndex };
  }

  /** pickable-wrapper pick path (spike PICK_PATH="pickable-wrapper"): the
   *  per-triangle batch id Navara reports back maps 1:1 onto this table, whose
   *  index is the batch id and whose entry is the triangle's
   *  (objectIndex, surfaceIndex). Rebuilt with the geometry on every LoD
   *  change; empty under the own-raycast strategy so nothing pays for it. */
  batchIdMap(): ReadonlyArray<{
    readonly objectIndex: number;
    readonly surfaceIndex: number;
  }> {
    if (this.pickStrategy !== "pickable-wrapper") return [];
    const map: Array<{ objectIndex: number; surfaceIndex: number }> = [];
    for (let t = 0; t < this.arrays.triangleCount; t++) {
      const v = t * 3;
      map.push({
        objectIndex: this.arrays.objectIndices[v]!,
        surfaceIndex: this.arrays.surfaceIndices[v]!,
      });
    }
    return map;
  }

  getBoundsGeodetic(): GeodeticBounds {
    const bbox = this.model.bbox ?? [0, 0, 0, 0, 0, 0];
    const b = geodeticBoundsFromBBox(bbox, this.epsg);
    // Report the same heights the mesh is actually placed at, so fitAll /
    // fitLayer frame the model where it renders (Global Constraints ->
    // Vertical datum).
    return {
      ...b,
      minHeight: b.minHeight + this.heightOffset,
      maxHeight: b.maxHeight + this.heightOffset,
    };
  }

  triangleCount(): number {
    return this.arrays.triangleCount;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.object3d.material;
    if (Array.isArray(material)) {
      for (const m of material) m.dispose();
    } else {
      material.dispose();
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/cityModelMesh.test.ts
```

Expected: 11 passed (the 7 original cases, the two pick-strategy cases and the two `setHeightOffset` cases from Step 0).

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && git add packages/navara-cityjson && git commit -m "$(cat <<'EOF'
feat: CityModelMesh with LoD rebuild, style, highlight and pick resolution

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
cd /data2/hideba/multiroof-viewer && git add packages/cityjson-navara-plugins && git commit -m "$(cat <<'EOF'
chore: bump cityjson-navara-plugins pointer (CityModelMesh)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B7: `CityModelRegistry` + `CityJSONPlugin` + `CityModelMeshDesc` + `CityModelHandle`

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/types.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityModelRegistry.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityMesh.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/CityModelMeshDesc.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/CityMeshArraysDesc.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/CityJSONPlugin.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-cityjson/src/index.ts`
- Test: `packages/cityjson-navara-plugins/packages/navara-cityjson/test/cityModelRegistry.test.ts`

**Engine-binding split (amended 2026-08-02 after external review):** the tested unit is `CityModelRegistry` — the `addCityModel`/`getHandle`/`handles`/`resolvePick` logic — and it imports **nothing** from `@navaramap/*`. The two things it needs from the engine are injected at construction: the descriptor classes (opaque `unknown` values it hands to `view.registerMesh`) and a `PickRayProvider`. `CityJSONPlugin` is then a ~25-line `Plugin` subclass that supplies the real descriptors and the real `getPickRay`, and delegates every method. This is what makes the Global-Constraints rule ("plugin unit tests never import `@navaramap/*`") structurally true rather than aspirational: `test/cityModelRegistry.test.ts` imports `../src/cityModelRegistry`, which cannot transitively reach the engine. The same split puts `CityMeshArraysDesc` in its own file so `cityMesh.ts` (`CityMeshArraysMesh` + `addCityMeshArrays`, both engine-free) stays importable from Node — Task C10a's streaming tests depend on that.

**Interfaces:**

- Consumes: `CityModelMesh` (B6), `PickStrategy`/`DEFAULT_PICK_STRATEGY` (B6), `placementMatrixFromLle` (B4 → core's `makeEnuFrame`, Task A13b), `geometryFromMeshArrays` (B3), `FakeThreeView` (B2, tests only). `Plugin` and `getPickRay` from `@navaramap/three` and `MeshDesc` from `@navaramap/three-default-descs` are imported **only** by `CityJSONPlugin.ts`, `CityModelMeshDesc.ts` and `CityMeshArraysDesc.ts`.
- Produces (spec §3 verbatim, concretized per the **Shared Interface Contract**):

```ts
interface CityModelHandle {
  readonly id: string;
  setVisible(v: boolean): void;
  setLod(lod: string): void; // rebuilds geometry filtered by LoD
  setStyle(evaluator: SurfaceStyleEvaluator | null): void; // per-surface rule colors
  setHighlight(sel: readonly Selection[], hovered?: Selection): void;
  resolvePick(pick: PickedFeatureLike | ScreenPoint): Selection | null;
  getBoundsGeodetic(): GeodeticBounds; // for fitLayer/fitAll
  triangleCount(): number;
  delete(): void;
}

type SurfaceStyleEvaluator = (
  surface: SurfaceInfo,
  object: CityObjectInfo,
) => readonly [number, number, number] | null; // linear-sRGB, from core

interface AddCityModelOptions {
  readonly id: string;
  readonly crs?: string | number;
  readonly lod?: string | null;
  /** Vertical-datum correction in metres. When omitted, the registry samples
   *  it asynchronously with `geoidHeightAt(originLng, originLat)` and applies
   *  it via `setHeightOffset()` (Global Constraints -> Vertical datum). */
  readonly heightOffset?: number;
}

/** Low-level primitive the streaming plugin builds one of per resident cell
 *  (Task C8); CityModelHandle is a composition over the same machinery. */
interface CityMeshHandle {
  readonly ref: unknown;
  setColors(colors: Float32Array): void;
  setVisible(v: boolean): void;
  triangleCount(): number;
  delete(): void;
}

function addCityMeshArrays(
  view: ThreeView,
  opts: { id: string; arrays: CityMeshArrays; frame: EnuFrame },
): CityMeshHandle;

/** Engine-free. Everything the engine supplies is injected here. */
interface PickRayProvider {
  getPickRay(
    x: number,
    y: number,
  ): {
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
  } | null;
}
class CityModelRegistry {
  constructor(deps: {
    readonly descriptors: ReadonlyArray<readonly [string, unknown]>;
    readonly pickRays: PickRayProvider;
    readonly pickStrategy?: PickStrategy;
  });
  attach(view: CityModelViewLike): void; // registerMesh loop, called from plugin init()
  addCityModel(model: CityModel, opts: AddCityModelOptions): CityModelHandle;
  getHandle(id: string): CityModelHandle | undefined;
  handles(): readonly CityModelHandle[];
}

/** The only engine binding in this task: constructs the registry with the real
 *  descriptors + getPickRay and forwards every call. */
class CityJSONPlugin extends Plugin<ThreeView, ViewContext> {
  constructor(opts?: { readonly pickStrategy?: PickStrategy });
  async init(view, ctx): Promise<void>; // registers CityModelMeshDesc + CityMeshArraysDesc
  addCityModel(model: CityModel, opts: AddCityModelOptions): CityModelHandle;
  getHandle(id: string): CityModelHandle | undefined;
  handles(): readonly CityModelHandle[];
}
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/navara-cityjson/test/cityModelRegistry.test.ts
import { describe, it, expect, vi } from "vitest";
import { Matrix4 } from "three";
import type { CityModel } from "@cityjson/navara-core";
import {
  CityModelRegistry,
  CITY_MESH_ARRAYS_KEY,
  CITY_MODEL_MESH_KEY,
  type PickRayProvider,
} from "../src/cityModelRegistry";
import { CityModelMesh } from "../src/cityModelMesh";
import { FakeThreeView } from "./fakeView";

// Stand-ins for CityModelMeshDesc / CityMeshArraysDesc: the registry only ever
// forwards these to view.registerMesh, so their identity is all that matters —
// and that is exactly why the registry never has to import @navaramap/*.
const FAKE_DESCS = [
  [CITY_MODEL_MESH_KEY, class FakeCityModelDesc {}],
  [CITY_MESH_ARRAYS_KEY, class FakeCityMeshArraysDesc {}],
] as const;

const noRays: PickRayProvider = { getPickRay: () => null };

/** Registry under test, plus the fake plugin shell that attaches it — this
 *  keeps the "descriptors registered before view.init()" assertion honest
 *  without pulling the real Plugin base class (and its WASM) into Node. */
function makeRegistry(view: FakeThreeView, pickRays: PickRayProvider = noRays) {
  const registry = new CityModelRegistry({
    descriptors: FAKE_DESCS,
    pickRays,
  });
  view.addPlugin({ init: async (v: unknown) => registry.attach(v as never) });
  return registry;
}

const model: CityModel = {
  sourceEncoding: "cityjson",
  metadata: { referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415" },
  bbox: [85000, 446000, 0, 85010, 446010, 6],
  objects: {
    B1: {
      id: "B1",
      objectType: "Building",
      attributes: {},
      surfaces: [
        {
          type: "RoofSurface",
          rings: [
            [
              [85000, 446000, 6],
              [85010, 446000, 6],
              [85010, 446010, 6],
            ],
          ],
          attributes: {},
          lod: "2",
        },
      ],
      bbox: [85000, 446000, 0, 85010, 446010, 6],
      children: [],
      parents: [],
      lod: "2",
    },
  },
  vertexCount: 3,
};

/** Wires the fake view's descriptor factory to build a real CityModelMesh
 *  with an injected identity placement, standing in for the Navara desc. */
function withFakeDescriptor(view: FakeThreeView): void {
  view.descriptorFactory = (config) => {
    const c = (
      config as Record<
        string,
        { model: CityModel; id: string; crs?: string; lod?: string | null }
      >
    )[CITY_MODEL_MESH_KEY]!;
    return new CityModelMesh({
      id: c.id,
      model: c.model,
      crs: c.crs,
      lod: c.lod ?? null,
      makePlacementMatrix: () => new Matrix4(),
    });
  };
}

describe("CityModelRegistry", () => {
  it("registers both descriptors during init, before the view is initialized", async () => {
    const view = new FakeThreeView();
    makeRegistry(view);
    await view.init();
    expect(view.registeredMeshes.has(CITY_MODEL_MESH_KEY)).toBe(true);
    expect(view.registeredMeshes.has(CITY_MESH_ARRAYS_KEY)).toBe(true);
    expect(view.registeredMeshes.get(CITY_MODEL_MESH_KEY)).toBe(
      FAKE_DESCS[0][1],
    );
  });

  it("addCityModel before init throws with an actionable message", () => {
    const registry = new CityModelRegistry({
      descriptors: FAKE_DESCS,
      pickRays: noRays,
    });
    expect(() => registry.addCityModel(model, { id: "L1" })).toThrow(
      /before .*init/i,
    );
  });

  it("addCityModel returns a handle with the spec surface", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    const registry = makeRegistry(view);
    await view.init();

    const handle = registry.addCityModel(model, { id: "L1", lod: "2" });
    expect(handle.id).toBe("L1");
    expect(handle.triangleCount()).toBe(1);
    expect(handle.getBoundsGeodetic().west).toBeGreaterThan(4.3);
    expect(registry.getHandle("L1")).toBe(handle);
    expect(registry.handles()).toHaveLength(1);
  });

  it("delete removes the handle from the registry and deletes the mesh handle", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    const registry = makeRegistry(view);
    await view.init();

    const handle = registry.addCityModel(model, { id: "L1", lod: "2" });
    handle.delete();
    expect(registry.getHandle("L1")).toBeUndefined();
    expect(view.handles[0]!.deleted).toBe(true);
  });

  it("resolvePick maps a PickedFeature carrying our indices to a surface selection", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    const registry = makeRegistry(view);
    await view.init();

    const handle = registry.addCityModel(model, { id: "L1", lod: "2" });
    expect(
      handle.resolvePick({ properties: { objectIndex: 0, surfaceIndex: 0 } }),
    ).toEqual({
      kind: "surface",
      layerId: "L1",
      objectId: "B1",
      surfaceIndex: 0,
    });
  });

  it("resolvePick with a screen point asks the INJECTED pick-ray provider, never the engine", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    const getPickRay = vi.fn(() => null);
    const registry = makeRegistry(view, { getPickRay });
    await view.init();

    const handle = registry.addCityModel(model, { id: "L1", lod: "2" });
    expect(handle.resolvePick({ x: 12, y: 34 })).toBeNull();
    expect(getPickRay).toHaveBeenCalledWith(12, 34);
  });

  it("addCityModel rejects an unreferenceable CRS (spec 4.3 gate)", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    const registry = makeRegistry(view);
    await view.init();

    expect(() =>
      registry.addCityModel({ ...model, metadata: {} }, { id: "L2" }),
    ).toThrow(/Cannot georeference/);
  });
});

describe("CityModelRegistry vertical datum", () => {
  /** Registry whose geoid sampler is injected, so nothing touches the network. */
  function withSampler(view: FakeThreeView, sample: typeof geoidSpy) {
    const registry = new CityModelRegistry({
      descriptors: FAKE_DESCS,
      pickRays: noRays,
      sampleGeoidHeight: sample,
    });
    view.addPlugin({ init: async (v: unknown) => registry.attach(v as never) });
    return registry;
  }
  const geoidSpy = vi.fn(async () => 43.2);

  beforeEach(() => geoidSpy.mockClear());

  it("samples the geoid at the layer ORIGIN and re-places the mesh when it resolves", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    const registry = withSampler(view, geoidSpy);
    await view.init();

    const handle = registry.addCityModel(model, { id: "L1", lod: "2" });
    // The mesh is live before the sample lands — first paint is never blocked.
    expect(handle.triangleCount()).toBe(1);
    await vi.waitFor(() => expect(geoidSpy).toHaveBeenCalledTimes(1));
    const [lng, lat] = geoidSpy.mock.calls[0]!;
    expect(lng).toBeCloseTo(4.35, 1); // fixture origin, EPSG:7415 -> WGS84
    expect(lat).toBeCloseTo(52.0, 1);
    await vi.waitFor(() =>
      expect(handle.getBoundsGeodetic().maxHeight).toBeCloseTo(6 + 43.2, 3),
    );
  });

  it("does NOT sample when the caller supplied an explicit heightOffset", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    const registry = withSampler(view, geoidSpy);
    await view.init();

    const handle = registry.addCityModel(model, {
      id: "L1",
      lod: "2",
      heightOffset: 12,
    });
    await Promise.resolve();
    expect(geoidSpy).not.toHaveBeenCalled();
    expect(handle.getBoundsGeodetic().maxHeight).toBeCloseTo(6 + 12, 3);
  });

  it("ignores a sample that lands after the layer was deleted", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    let release!: (v: number) => void;
    const slow = vi.fn(
      () => new Promise<number>((r) => (release = r)),
    ) as typeof geoidSpy;
    const registry = withSampler(view, slow);
    await view.init();

    const handle = registry.addCityModel(model, { id: "L1", lod: "2" });
    handle.delete();
    release(43.2);
    await Promise.resolve();
    // No throw, and nothing tried to touch the disposed mesh.
    expect(registry.getHandle("L1")).toBeUndefined();
  });

  it("leaves the mesh at 0 m when sampling fails — core resolves 0, it never rejects", async () => {
    const view = new FakeThreeView();
    withFakeDescriptor(view);
    const registry = withSampler(view, vi.fn(async () => 0) as typeof geoidSpy);
    await view.init();

    const handle = registry.addCityModel(model, { id: "L1", lod: "2" });
    await Promise.resolve();
    expect(handle.getBoundsGeodetic().maxHeight).toBeCloseTo(6, 3);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson/test/cityModelRegistry.test.ts
```

Expected: `Failed to resolve import "../src/CityJSONPlugin"`.

- [ ] **Step 3: Implement types + descriptor + plugin**

```ts
// packages/navara-cityjson/src/types.ts
import type { SurfaceStyleEvaluator } from "@cityjson/navara-core";
import type { GeodeticBounds } from "./enuPlacement";
import type { PickedFeatureLike, ScreenPoint, Selection } from "./selection";

export type { GeodeticBounds } from "./enuPlacement";
export type {
  PickedFeatureLike,
  ScreenPoint,
  Selection,
  SurfaceSelection,
  ObjectSelection,
  PickMode,
} from "./selection";

export interface AddCityModelOptions {
  readonly id: string;
  readonly crs?: string | number;
  readonly lod?: string | null;
}

export interface CityModelHandle {
  readonly id: string;
  setVisible(v: boolean): void;
  setLod(lod: string): void;
  setStyle(evaluator: SurfaceStyleEvaluator | null): void;
  setHighlight(sel: readonly Selection[], hovered?: Selection): void;
  resolvePick(pick: PickedFeatureLike | ScreenPoint): Selection | null;
  getBoundsGeodetic(): GeodeticBounds;
  triangleCount(): number;
  delete(): void;
}
```

```ts
// packages/navara-cityjson/src/CityModelMeshDesc.ts
/**
 * Navara MeshDesc wrapper around CityModelMesh. Everything behavioural lives
 * in CityModelMesh (Node-testable); this class only owns the engine contract:
 * create the instance, opt into MRT, and tear down on destroy. Placement is
 * NOT an engine concern here — CityModelMesh builds its matrix from
 * @cityjson/navara-core's makeEnuFrame (Task A13b).
 */
import { PickableMeshWrapper } from "@navaramap/three";
import { MeshDesc } from "@navaramap/three-default-descs";
import type { Mesh } from "three";
import type { CityModel } from "@cityjson/navara-core";
import { CityModelMesh } from "./cityModelMesh";
import type { PickStrategy } from "./pickStrategy";

export interface CityModelDescConfig {
  readonly cityModel: {
    readonly id: string;
    readonly model: CityModel;
    readonly crs?: string | number;
    readonly lod?: string | null;
    /** Initial vertical-datum offset. Usually 0 here — the registry applies
     *  the sampled geoid undulation through `setHeightOffset()` once it
     *  resolves (Global Constraints -> Vertical datum). */
    readonly heightOffset?: number;
    readonly pickStrategy?: PickStrategy;
  };
}

export class CityModelMeshDesc extends MeshDesc<CityModelDescConfig> {
  static key = "cityModel";

  /** The behaviour object every CityModelHandle method delegates to. */
  cityMesh!: CityModelMesh;

  createMesh(): Mesh {
    const config = this.config.cityModel;
    this.cityMesh = new CityModelMesh({
      id: config.id,
      model: config.model,
      crs: config.crs,
      lod: config.lod ?? null,
      heightOffset: config.heightOffset,
      pickStrategy: config.pickStrategy,
      // No makePlacementMatrix override: the default is
      // placementMatrixFromLle -> core's makeEnuFrame (Task A13b). Using
      // Navara's geodeticToVector3/eastNorthUpToFixedFrame here would give
      // static layers a different frame implementation from streaming cells.
    });
    // pickable-wrapper strategy (Task B1 PICK_PATH): hand the mesh to Navara's
    // GPU pick pipeline and publish the batchId -> (objectIndex, surfaceIndex)
    // table the plugin's resolvePick reads back. Under "own-raycast" this is
    // skipped entirely and nothing is registered with the pick pipeline.
    if (this.cityMesh.pickStrategy === "pickable-wrapper") {
      this.pickable = new PickableMeshWrapper(this.cityMesh.object3d, {
        layerId: config.id,
        properties: { layerId: config.id },
      });
    }
    // MRT G-buffer opt-in for the standard material (spec 8 risk, validated
    // by the M7.3 spike). If the spike set MRT_VERTEX_COLORS_OK = false, this
    // is where the custom setupMaterialForMRT() ShaderMaterial goes instead.
    this.ctx.setupMaterialForMRT?.(this.cityMesh.object3d.material);
    return this.cityMesh.object3d;
  }

  getPassKey(): string {
    return "mrt";
  }

  onDestroy(): void {
    this.pickable?.dispose?.();
    this.cityMesh?.dispose();
    super.onDestroy();
  }

  private pickable: PickableMeshWrapper | undefined;
}
```

```ts
// packages/navara-cityjson/src/cityModelRegistry.ts
/**
 * The whole of the CityJSON plugin's behaviour, with no engine import.
 *
 * Everything the Navara engine supplies is injected: the descriptor classes
 * (opaque values forwarded to view.registerMesh) and a PickRayProvider. That
 * makes this file — and therefore every assertion in
 * test/cityModelRegistry.test.ts — runnable in plain Node, which is the rule
 * in Global Constraints -> Testing conventions. CityJSONPlugin.ts is the
 * ~25-line binding that supplies the real ones.
 */
import {
  computeOriginOffset,
  geoidHeightAt,
  type CityModel,
  type SurfaceStyleEvaluator,
} from "@cityjson/navara-core";
import { originLleFromOffset, resolveEpsg } from "./enuPlacement";
import type { CityModelMesh } from "./cityModelMesh";
import { DEFAULT_PICK_STRATEGY, type PickStrategy } from "./pickStrategy";
import type {
  AddCityModelOptions,
  CityModelHandle,
  GeodeticBounds,
} from "./types";
import type { PickedFeatureLike, ScreenPoint, Selection } from "./selection";

export const CITY_MODEL_MESH_KEY = "cityModel";
export const CITY_MESH_ARRAYS_KEY = "cityMeshArrays";

export interface PickRayProvider {
  getPickRay(
    x: number,
    y: number,
  ): {
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
  } | null;
}

interface MeshHandleLike {
  ref: unknown;
  visible: boolean;
  delete(): void;
}

export interface CityModelViewLike {
  registerMesh(name: string, desc: unknown): void;
  addMesh(config: unknown): MeshHandleLike;
}

export interface CityModelRegistryDeps {
  /** [descriptorKey, descriptorClass] pairs, registered in order. */
  readonly descriptors: ReadonlyArray<readonly [string, unknown]>;
  readonly pickRays: PickRayProvider;
  readonly pickStrategy?: PickStrategy;
  /** Geoid undulation sampler. Injected so tests resolve it synchronously
   *  instead of hitting the terrain service; defaults to core's
   *  `geoidHeightAt`. */
  readonly sampleGeoidHeight?: (
    lngDeg: number,
    latDeg: number,
  ) => Promise<number>;
}

function isScreenPoint(
  pick: PickedFeatureLike | ScreenPoint,
): pick is ScreenPoint {
  return (
    typeof (pick as ScreenPoint).x === "number" &&
    typeof (pick as ScreenPoint).y === "number"
  );
}

export class CityModelRegistry {
  private view: CityModelViewLike | null = null;
  private readonly handlesById = new Map<string, CityModelHandle>();
  private readonly pickStrategy: PickStrategy;

  constructor(private readonly deps: CityModelRegistryDeps) {
    this.pickStrategy = deps.pickStrategy ?? DEFAULT_PICK_STRATEGY;
  }

  /** Called from the plugin's init(), i.e. during view.init() — descriptors
   *  must be registered before the view finishes initializing. */
  attach(view: CityModelViewLike): void {
    for (const [key, desc] of this.deps.descriptors)
      view.registerMesh(key, desc);
    this.view = view;
  }

  addCityModel(model: CityModel, opts: AddCityModelOptions): CityModelHandle {
    const view = this.view;
    if (!view) {
      throw new Error(
        "CityJSONPlugin.addCityModel called before view.init() — add the plugin with view.addPlugin(plugin) and await view.init() first.",
      );
    }

    const meshHandle = view.addMesh({
      [CITY_MODEL_MESH_KEY]: {
        id: opts.id,
        model,
        crs: opts.crs,
        lod: opts.lod ?? null,
        heightOffset: opts.heightOffset,
        pickStrategy: this.pickStrategy,
      },
    });

    const ref = meshHandle.ref as { cityMesh?: CityModelMesh } | CityModelMesh;
    const mesh: CityModelMesh =
      (ref as { cityMesh?: CityModelMesh }).cityMesh ?? (ref as CityModelMesh);

    const handle: CityModelHandle = {
      id: opts.id,
      setVisible: (v: boolean) => {
        mesh.setVisible(v);
        meshHandle.visible = v;
      },
      setLod: (lod: string) => mesh.setLod(lod),
      setStyle: (evaluator: SurfaceStyleEvaluator | null) =>
        mesh.setStyle(evaluator),
      setHighlight: (sel: readonly Selection[], hovered?: Selection) =>
        mesh.setHighlight(sel, hovered ?? null),
      resolvePick: (pick: PickedFeatureLike | ScreenPoint) => {
        if (isScreenPoint(pick)) {
          // own-raycast path: the ray comes from the INJECTED provider, so
          // this branch is exercised in Node with a fake.
          const ray = this.deps.pickRays.getPickRay(pick.x, pick.y);
          return ray ? mesh.resolveRaycast(ray) : null;
        }
        // pickable-wrapper path: prefer an explicit objectIndex/surfaceIndex
        // pair, else map the engine's batchId through the mesh's table.
        const objectIndex = pick.properties?.objectIndex;
        const surfaceIndex = pick.properties?.surfaceIndex;
        if (
          typeof objectIndex === "number" &&
          typeof surfaceIndex === "number"
        ) {
          return mesh.resolveVertexIndices(objectIndex, surfaceIndex);
        }
        if (typeof pick.batchId === "number") {
          const entry = mesh.batchIdMap()[pick.batchId];
          if (!entry) return null;
          return mesh.resolveVertexIndices(
            entry.objectIndex,
            entry.surfaceIndex,
          );
        }
        return null;
      },
      getBoundsGeodetic: (): GeodeticBounds => mesh.getBoundsGeodetic(),
      triangleCount: () => mesh.triangleCount(),
      delete: () => {
        this.handlesById.delete(opts.id);
        meshHandle.delete();
      },
    };

    this.handlesById.set(opts.id, handle);

    // Vertical datum. A caller-supplied heightOffset wins outright; otherwise
    // sample the geoid at the layer origin and re-place when it lands. The
    // mesh renders immediately at offset 0 rather than waiting on a network
    // round trip, and a failed sample resolves 0 (core logs the warning), so
    // this promise never rejects and never blocks first paint. See Global
    // Constraints -> Vertical datum.
    if (opts.heightOffset === undefined) {
      const sample = this.deps.sampleGeoidHeight ?? geoidHeightAt;
      const origin = originLleFromOffset(
        computeOriginOffset(model),
        resolveEpsg(opts.crs ?? model.metadata.referenceSystem),
      );
      void sample(origin.lng, origin.lat).then((metres) => {
        // The layer may have been deleted while the fetch was in flight.
        if (this.handlesById.get(opts.id) !== handle) return;
        mesh.setHeightOffset(metres);
      });
    }

    return handle;
  }

  getHandle(id: string): CityModelHandle | undefined {
    return this.handlesById.get(id);
  }

  handles(): readonly CityModelHandle[] {
    return [...this.handlesById.values()];
  }
}
```

```ts
// packages/navara-cityjson/src/CityJSONPlugin.ts
/**
 * Navara plugin exposing CityJSON/CityJSONSeq city models as globe-placed
 * meshes. Registration happens inside init() — the sanctioned pattern
 * (DefaultPlugin does the same); view.addPlugin() must still be called
 * before view.init(), which Task B8's ordered plugin list guarantees.
 *
 * This is an ENGINE BINDING MODULE: it is one of only three files in this
 * package that import @navaramap/*. All behaviour lives in CityModelRegistry,
 * which is engine-free and therefore unit-testable in Node.
 */
import { getPickRay, Plugin } from "@navaramap/three";
import type { CityModel } from "@cityjson/navara-core";
import { CityMeshArraysDesc } from "./CityMeshArraysDesc";
import { CityModelMeshDesc } from "./CityModelMeshDesc";
import {
  CityModelRegistry,
  CITY_MESH_ARRAYS_KEY,
  CITY_MODEL_MESH_KEY,
  type CityModelViewLike,
} from "./cityModelRegistry";
import type { PickStrategy } from "./pickStrategy";
import type { AddCityModelOptions, CityModelHandle } from "./types";
import type { PickedFeatureLike, ScreenPoint, Selection } from "./selection";

export { CITY_MESH_ARRAYS_KEY, CITY_MODEL_MESH_KEY };

export interface CityJSONPluginOptions {
  /** Task B1's PICK_PATH verdict; defaults to DEFAULT_PICK_STRATEGY. */
  readonly pickStrategy?: PickStrategy;
}

export class CityJSONPlugin extends Plugin<CityModelViewLike, unknown> {
  private view: CityModelViewLike | null = null;
  private readonly registry: CityModelRegistry;

  constructor(options: CityJSONPluginOptions = {}) {
    super();
    this.registry = new CityModelRegistry({
      descriptors: [
        [CITY_MODEL_MESH_KEY, CityModelMeshDesc],
        [CITY_MESH_ARRAYS_KEY, CityMeshArraysDesc],
      ],
      // The engine seam, supplied here and nowhere else.
      pickRays: {
        getPickRay: (x, y) =>
          (
            getPickRay as (
              v: unknown,
              x: number,
              y: number,
            ) => {
              origin: { x: number; y: number; z: number };
              direction: { x: number; y: number; z: number };
            } | null
          )(this.view, x, y),
      },
      pickStrategy: options.pickStrategy,
    });
  }

  async init(view: CityModelViewLike): Promise<void> {
    this.view = view;
    this.registry.attach(view);
  }

  addCityModel(model: CityModel, opts: AddCityModelOptions): CityModelHandle {
    return this.registry.addCityModel(model, opts);
  }

  getHandle(id: string): CityModelHandle | undefined {
    return this.registry.getHandle(id);
  }

  handles(): readonly CityModelHandle[] {
    return this.registry.handles();
  }
}
```

`resolveVertexIndices` and `batchIdMap` were added to `CityModelMesh` in Task B6; nothing more is needed on that class here.

```ts
// packages/navara-cityjson/src/index.ts
export {
  CityJSONPlugin,
  CITY_MESH_ARRAYS_KEY,
  CITY_MODEL_MESH_KEY,
} from "./CityJSONPlugin";
export { CityModelMeshDesc } from "./CityModelMeshDesc";
export { CityMeshArraysDesc } from "./CityMeshArraysDesc";
export { CityModelMesh } from "./cityModelMesh";
export { CityModelRegistry } from "./cityModelRegistry";
export { addCityMeshArrays, CityMeshArraysMesh } from "./cityMesh";
export { DEFAULT_PICK_STRATEGY } from "./pickStrategy";
export type { PickStrategy } from "./pickStrategy";
export type { CityModelViewLike, PickRayProvider } from "./cityModelRegistry";
export {
  CrsUnresolvedError,
  geodeticBoundsFromBBox,
  originLleFromOffset,
  placementMatrixFromLle,
  resolveEpsg,
} from "./enuPlacement";
export {
  HIGHLIGHT_COLOR_HEX,
  HOVER_COLOR_HEX,
  computeStyleColors,
  paintLayers,
} from "./surfaceColorLayers";
export type { AddCityMeshArraysOptions, CityMeshHandle } from "./cityMesh";

// NOTE: this barrel re-exports the three engine-binding modules
// (CityJSONPlugin, CityModelMeshDesc, CityMeshArraysDesc), so it transitively
// imports @navaramap/*. Plugin unit tests therefore import the specific
// engine-free module (`../src/cityModelRegistry`, `../src/cityMesh`, ...),
// never `../src/index` — see Global Constraints -> Testing conventions.
export type {
  AddCityModelOptions,
  CityModelHandle,
  GeodeticBounds,
  ObjectSelection,
  PickMode,
  PickedFeatureLike,
  ScreenPoint,
  Selection,
  SurfaceSelection,
} from "./types";
export type { Lle } from "./enuPlacement";
```

- [ ] **Step 4: Add the low-level `addCityMeshArrays` primitive**

`@cityjson/navara-flatcitybuf` needs one mesh per resident cell, built straight
from worker-produced `CityMeshArrays` plus an `EnuFrame` — no `CityModel`, no
LoD rebuild, no evaluator. Task C8 consumes exactly this signature, so it is
part of the package's public API rather than an internal of `CityModelMesh`.

```ts
// packages/navara-cityjson/src/cityMesh.ts
/**
 * Low-level "arrays + frame -> mesh on the globe" primitive.
 *
 * CityModelMesh (B6) is the rich, model-backed version of the same idea; this
 * one exists because the streaming plugin has neither a CityModel nor an LoD
 * to rebuild from — it has one decoded cell and one ENU frame per cell.
 */
import {
  FrontSide,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from "three";
import type { CityMeshArrays, EnuFrame } from "@cityjson/navara-core";
import { geometryFromMeshArrays } from "./cityMeshGeometry";
import { DEFAULT_PICK_STRATEGY, type PickStrategy } from "./pickStrategy";

export interface AddCityMeshArraysOptions {
  readonly id: string;
  readonly arrays: CityMeshArrays;
  readonly frame: EnuFrame;
  /** Task B1's PICK_PATH verdict; defaults to DEFAULT_PICK_STRATEGY. */
  readonly pickStrategy?: PickStrategy;
}

export interface CityMeshHandle {
  /** The descriptor instance, for callers that need the raw Object3D. */
  readonly ref: unknown;
  /** The behaviour object, so a caller can raycast it directly (Task C10b). */
  readonly mesh: CityMeshArraysMesh;
  /** Swap the vertex-color buffer (rule recolor of a resident cell). */
  setColors(colors: Float32Array): void;
  setVisible(visible: boolean): void;
  triangleCount(): number;
  /** index = engine batch id, entry = (objectIndex, surfaceIndex). */
  batchIdMap(): ReadonlyArray<{
    readonly objectIndex: number;
    readonly surfaceIndex: number;
  }>;
  delete(): void;
}

/** The behaviour object, free of @navaramap imports so it is Node-testable. */
export class CityMeshArraysMesh {
  readonly object3d: Mesh;
  readonly pickStrategy: PickStrategy;
  private readonly arrays: CityMeshArrays;

  constructor(options: AddCityMeshArraysOptions) {
    this.arrays = options.arrays;
    this.pickStrategy = options.pickStrategy ?? DEFAULT_PICK_STRATEGY;
    this.object3d = new Mesh(
      geometryFromMeshArrays(options.arrays),
      new MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        side: FrontSide,
      }),
    );
    this.object3d.name = `cityMesh:${options.id}`;
    this.object3d.matrixAutoUpdate = false;
    const m = new Matrix4().fromArray(Array.from(options.frame.matrix));
    this.object3d.matrix.copy(m);
    this.object3d.matrixWorld.copy(m);
    this.object3d.matrixWorldNeedsUpdate = true;
    this.object3d.castShadow = true;
    this.object3d.receiveShadow = true;
  }

  setColors(colors: Float32Array): void {
    const attr = this.object3d.geometry.getAttribute("color");
    (attr.array as Float32Array).set(colors);
    attr.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.object3d.visible = visible;
  }

  triangleCount(): number {
    return this.arrays.triangleCount;
  }

  /** Own-raycast pick path for a streamed cell: ECEF ray in, the hit face's
   *  (objectIndex, surfaceIndex) out. The caller (Task C10b's stream layer)
   *  knows its own layerId and objectKeys and builds the Selection. */
  resolveRaycast(ray: {
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
  }): { objectIndex: number; surfaceIndex: number } | null {
    if (!this.object3d.visible) return null;
    const raycaster = new Raycaster(
      new Vector3(ray.origin.x, ray.origin.y, ray.origin.z),
      new Vector3(
        ray.direction.x,
        ray.direction.y,
        ray.direction.z,
      ).normalize(),
      0,
      Infinity,
    );
    const hit = raycaster.intersectObject(this.object3d, false)[0];
    if (!hit?.face) return null;
    return {
      objectIndex: this.arrays.objectIndices[hit.face.a]!,
      surfaceIndex: this.arrays.surfaceIndices[hit.face.a]!,
    };
  }

  /** Same contract as CityModelMesh.batchIdMap(): index = engine batch id,
   *  entry = that triangle's (objectIndex, surfaceIndex). Lets a streamed cell
   *  resolve a pick exactly the way a static layer does (Task C10b). */
  batchIdMap(): ReadonlyArray<{
    readonly objectIndex: number;
    readonly surfaceIndex: number;
  }> {
    if (this.pickStrategy !== "pickable-wrapper") return [];
    const map: Array<{ objectIndex: number; surfaceIndex: number }> = [];
    for (let t = 0; t < this.arrays.triangleCount; t++) {
      const v = t * 3;
      map.push({
        objectIndex: this.arrays.objectIndices[v]!,
        surfaceIndex: this.arrays.surfaceIndices[v]!,
      });
    }
    return map;
  }

  dispose(): void {
    this.object3d.geometry.dispose();
    const material = this.object3d.material;
    if (Array.isArray(material)) {
      for (const m of material) m.dispose();
    } else {
      material.dispose();
    }
  }
}

export function addCityMeshArrays(
  view: {
    addMesh(config: unknown): {
      ref: unknown;
      visible: boolean;
      delete(): void;
    };
  },
  opts: AddCityMeshArraysOptions,
): CityMeshHandle {
  const meshHandle = view.addMesh({ cityMeshArrays: opts });
  const ref = meshHandle.ref as { cityMesh?: CityMeshArraysMesh };
  const mesh = ref.cityMesh ?? (meshHandle.ref as CityMeshArraysMesh);
  return {
    ref: meshHandle.ref,
    mesh,
    setColors: (colors) => mesh.setColors(colors),
    setVisible: (visible) => {
      mesh.setVisible(visible);
      meshHandle.visible = visible;
    },
    triangleCount: () => mesh.triangleCount(),
    batchIdMap: () => mesh.batchIdMap(),
    delete: () => meshHandle.delete(),
  };
}
```

The Navara descriptor around it lives in its **own** file, so `cityMesh.ts`
stays engine-free and importable from Node — Task C10a's tests depend on that:

```ts
// packages/navara-cityjson/src/CityMeshArraysDesc.ts
/**
 * ENGINE BINDING MODULE. Navara MeshDesc wrapper around CityMeshArraysMesh —
 * one instance per streaming cell. All behaviour is in CityMeshArraysMesh
 * (`cityMesh.ts`), which imports nothing from @navaramap/*.
 */
import { PickableMeshWrapper } from "@navaramap/three";
import { MeshDesc } from "@navaramap/three-default-descs";
import type { Mesh } from "three";
import { CityMeshArraysMesh, type AddCityMeshArraysOptions } from "./cityMesh";
import { DEFAULT_PICK_STRATEGY } from "./pickStrategy";

export interface CityMeshArraysDescConfig {
  readonly cityMeshArrays: AddCityMeshArraysOptions;
}

export class CityMeshArraysDesc extends MeshDesc<CityMeshArraysDescConfig> {
  static key = "cityMeshArrays";
  cityMesh!: CityMeshArraysMesh;
  private pickable: PickableMeshWrapper | undefined;

  createMesh(): Mesh {
    const config = this.config.cityMeshArrays;
    this.cityMesh = new CityMeshArraysMesh(config);
    if ((config.pickStrategy ?? DEFAULT_PICK_STRATEGY) === "pickable-wrapper") {
      this.pickable = new PickableMeshWrapper(this.cityMesh.object3d, {
        layerId: config.id,
        properties: { layerId: config.id },
      });
    }
    this.ctx.setupMaterialForMRT?.(this.cityMesh.object3d.material);
    return this.cityMesh.object3d;
  }

  getPassKey(): string {
    return "mrt";
  }

  onDestroy(): void {
    this.pickable?.dispose?.();
    this.cityMesh?.dispose();
    super.onDestroy();
  }
}
```

`AddCityMeshArraysOptions` gains two optional fields the streaming plugin sets:
`readonly pickStrategy?: PickStrategy` and `readonly batchIdMap?: ReadonlyArray<{ objectIndex: number; surfaceIndex: number }>`
(`CityMeshArraysMesh` exposes the latter through `batchIdMap()`, exactly as
`CityModelMesh` does, so a streamed cell resolves a pick the same way a static
layer does — Task C10b).

`CityJSONPlugin.init` registers both descriptors through the injected
`descriptors` list; there is no separate `registerMesh` call to add.

Add the matching cases to `test/cityModelRegistry.test.ts` (for the key) and
`test/cityMesh.test.ts` (for the primitive, which is the engine-free half):

```ts
// test/cityMesh.test.ts
it("addCityMeshArrays returns a handle over the descriptor instance", () => {
  const view = new FakeThreeView();
  view.descriptorFactory = (config) => ({
    cityMesh: new CityMeshArraysMesh(
      (config as Record<string, AddCityMeshArraysOptions>)[
        CITY_MESH_ARRAYS_KEY
      ]!,
    ),
  });
  const handle = addCityMeshArrays(view as never, {
    id: "cell:1/0/0",
    arrays: {
      positions: new Float32Array(9),
      normals: new Float32Array(9),
      colors: new Float32Array(9).fill(0.25),
      objectIndices: new Uint32Array(3),
      surfaceIndices: new Uint32Array(3),
      objectKeys: ["B1"],
      triangleCount: 1,
    },
    frame: makeEnuFrame(4.3571, 52.0116, 0),
  });
  expect(handle.triangleCount()).toBe(1);
  handle.setColors(new Float32Array(9).fill(0.5));
  handle.setVisible(false);
  expect(view.handles[0]!.visible).toBe(false);
  handle.delete();
  expect(view.handles[0]!.deleted).toBe(true);
});
```

(the test's header imports `makeEnuFrame` from `@cityjson/navara-core`,
`addCityMeshArrays`/`CityMeshArraysMesh`/`AddCityMeshArraysOptions` from
`../src/cityMesh`, `CITY_MESH_ARRAYS_KEY` from `../src/cityModelRegistry`, and
`FakeThreeView` from `./fakeView` — no `@navaramap/*` anywhere.)

- [ ] **Step 5: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityjson && pnpm -r build
```

Expected: all `navara-cityjson` test files pass (`cityModelRegistry.test.ts` 12 cases — 8 registry + 4 vertical-datum, `cityMesh.test.ts` 1 case, plus the earlier files), and tsup builds `@cityjson/navara-cityjson` with d.ts emitted. Also confirm the isolation rule holds: `grep -rn "@navaramap" packages/navara-cityjson/src | cut -d: -f1 | sort -u` must list exactly `CityJSONPlugin.ts`, `CityMeshArraysDesc.ts` and `CityModelMeshDesc.ts`, and `grep -rn "@navaramap" packages/navara-cityjson/test` must be empty.

- [ ] **Step 6: Commit**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && git add packages/navara-cityjson && git commit -m "$(cat <<'EOF'
feat: CityModelRegistry, CityJSONPlugin, mesh descriptors and CityModelHandle

The behaviour lives in the engine-free CityModelRegistry (descriptors and
getPickRay injected); CityJSONPlugin is the thin @navaramap binding.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
cd /data2/hideba/multiroof-viewer && git add packages/cityjson-navara-plugins && git commit -m "$(cat <<'EOF'
chore: bump cityjson-navara-plugins pointer (CityJSONPlugin)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B8: `navaraSession` — ordered plugin registration + StrictMode-safe create/init/dispose

**Files:**

- Create: `src/scene/navaraSession.ts`
- Test: `tests/unit/scene/navaraSession.test.ts`
- Modify: `package.json` (add `@cityjson/navara-cityjson` file: dep), `vite.config.ts` (alias + optimizeDeps from Task B1)

**Design (amended 2026-08-02 after external review):** the session takes an **ordered plugin list**, not a fixed pair of factories. Navara rejects `addPlugin()` after `init()`, and `NavaraViewport` only ever sees the session — so the list is the single registration point, and any later task that needs another plugin (Task C13's `FlatCityBufPlugin`) appends to it instead of trying to register after the fact. The caller constructs the plugin instances itself and therefore keeps fully typed refs to them; the session also returns them keyed, for consumers that only hold the `ready` result. `ready` is **resolve-or-reject** (Shared Interface Contract → `CitySceneHandle`): an init failure rejects with the underlying error rather than resolving `null`, and a dispose-before-init rejects with a distinguishable `NavaraSessionDisposedError` that callers swallow.

**Interfaces:**

- Consumes: `CityJSONPlugin` from `@cityjson/navara-cityjson` (constructed by the caller, not by this module).
- Produces:
  - `interface NavaraPluginSpec<T = unknown> { readonly key: string; readonly instance: T; afterInit?(view: NavaraViewLike): void }`
  - `interface NavaraSessionOptions<TView> { createView(): TView; readonly plugins: readonly NavaraPluginSpec[] }`
  - `interface NavaraSessionResult<TView> { readonly view: TView; readonly plugins: ReadonlyMap<string, unknown> }`
  - `interface NavaraSession<TView> { readonly ready: Promise<NavaraSessionResult<TView>>; dispose(): void }`
  - `class NavaraSessionDisposedError extends Error`
  - `createNavaraSession<TView extends NavaraViewLike>(options: NavaraSessionOptions<TView>): NavaraSession<TView>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scene/navaraSession.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  createNavaraSession,
  NavaraSessionDisposedError,
} from "../../../src/scene/navaraSession";

function makeSetup() {
  const view = {
    addPlugin: vi.fn(),
    init: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
    }),
    dispose: vi.fn(),
  };
  const defaultPlugin = { addDefaultPhotorealScene: vi.fn() };
  const cityPlugin = { id: "city" };
  const flatPlugin = { id: "flat" };
  const plugins = [
    {
      key: "default",
      instance: defaultPlugin,
      afterInit: () => defaultPlugin.addDefaultPhotorealScene(),
    },
    { key: "cityjson", instance: cityPlugin },
    { key: "flatcitybuf", instance: flatPlugin },
  ];
  return {
    view,
    defaultPlugin,
    cityPlugin,
    flatPlugin,
    plugins,
    options: { createView: () => view, plugins },
  };
}

describe("createNavaraSession", () => {
  it("adds EVERY plugin, in list order, before init", async () => {
    const { view, cityPlugin, flatPlugin, defaultPlugin, options } =
      makeSetup();
    const session = createNavaraSession(options as never);
    await session.ready;

    expect(view.addPlugin.mock.calls.map((c) => c[0])).toEqual([
      defaultPlugin,
      cityPlugin,
      flatPlugin,
    ]);
    // The LAST addPlugin still precedes init: adding after init throws in
    // Navara, which is the whole reason the list exists.
    expect(view.addPlugin.mock.invocationCallOrder[2]!).toBeLessThan(
      view.init.mock.invocationCallOrder[0]!,
    );
  });

  it("returns the constructed plugin instances keyed, so callers hold typed refs", async () => {
    const { cityPlugin, flatPlugin, options } = makeSetup();
    const result = await createNavaraSession(options as never).ready;
    expect(result.plugins.get("cityjson")).toBe(cityPlugin);
    expect(result.plugins.get("flatcitybuf")).toBe(flatPlugin);
  });

  it("runs afterInit hooks only after init settles", async () => {
    const { view, defaultPlugin, options } = makeSetup();
    const session = createNavaraSession(options as never);
    expect(defaultPlugin.addDefaultPhotorealScene).not.toHaveBeenCalled();
    await session.ready;
    expect(defaultPlugin.addDefaultPhotorealScene).toHaveBeenCalledTimes(1);
    expect(
      defaultPlugin.addDefaultPhotorealScene.mock.invocationCallOrder[0]!,
    ).toBeGreaterThan(view.init.mock.invocationCallOrder[0]!);
  });

  it("dispose before init resolves REJECTS with NavaraSessionDisposedError and skips scene setup", async () => {
    const { view, defaultPlugin, options } = makeSetup();
    const session = createNavaraSession(options as never);
    session.dispose();
    await expect(session.ready).rejects.toBeInstanceOf(
      NavaraSessionDisposedError,
    );
    expect(defaultPlugin.addDefaultPhotorealScene).not.toHaveBeenCalled();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it("dispose is idempotent (StrictMode double cleanup)", async () => {
    const { view, options } = makeSetup();
    const session = createNavaraSession(options as never);
    await session.ready;
    session.dispose();
    session.dispose();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it("REJECTS with the init error instead of swallowing it into null", async () => {
    const { view, options } = makeSetup();
    view.init.mockRejectedValueOnce(new Error("wasm boom"));
    const session = createNavaraSession(options as never);
    await expect(session.ready).rejects.toThrow("wasm boom");
    // The dead view is still torn down, and the rejection is not a
    // NavaraSessionDisposedError, so callers can tell failure from unmount.
    expect(view.dispose).toHaveBeenCalledTimes(1);
    await expect(session.ready).rejects.not.toBeInstanceOf(
      NavaraSessionDisposedError,
    );
  });

  it("does not emit an unhandled rejection when nobody awaits ready", async () => {
    const { view, options } = makeSetup();
    view.init.mockRejectedValueOnce(new Error("wasm boom"));
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    createNavaraSession(options as never).dispose();
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", onUnhandled);
    expect(onUnhandled).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/scene/navaraSession.test.ts
```

Expected: `Failed to resolve import "../../../src/scene/navaraSession"`.

- [ ] **Step 3: Implement**

```ts
// src/scene/navaraSession.ts
/**
 * Creation/teardown sequencer for a Navara ThreeView, isolated from React so
 * the StrictMode double-mount contract is unit-testable:
 *
 *  - EVERY plugin in the ordered list is added BEFORE init() (adding after
 *    init throws in Navara). Callers append to the list instead of calling
 *    addPlugin() later — NavaraViewport never sees the view before init has
 *    started, so the list is the only registration point;
 *  - `ready` resolves with the view plus the plugin instances, or REJECTS:
 *    with the underlying error if init() threw, or with
 *    NavaraSessionDisposedError if dispose() beat init to the finish. Callers
 *    distinguish the two: the first is a real failure to surface, the second
 *    is a StrictMode remount to ignore;
 *  - dispose() called while init() is still in flight waits for init to
 *    settle and then disposes exactly once;
 *  - dispose() is idempotent.
 */
export interface NavaraViewLike {
  addPlugin(plugin: unknown): void;
  init(): Promise<void>;
  dispose(): void;
}

/** Raised through `ready` when the session was torn down before it went live.
 *  Not a failure — React StrictMode produces one of these on every mount. */
export class NavaraSessionDisposedError extends Error {
  constructor() {
    super("Navara session was disposed before initialization completed.");
    this.name = "NavaraSessionDisposedError";
  }
}

export interface NavaraPluginSpec<T = unknown> {
  /** Stable key for looking the instance up on the result. */
  readonly key: string;
  /** Constructed by the caller, so the caller keeps a fully typed reference. */
  readonly instance: T;
  /** Runs after view.init() settles, in list order — e.g. DefaultPlugin's
   *  addDefaultPhotorealScene(). Skipped when the session was disposed. */
  afterInit?(view: NavaraViewLike): void;
}

export interface NavaraSessionOptions<
  TView extends NavaraViewLike = NavaraViewLike,
> {
  createView(): TView;
  /** Registered with view.addPlugin() in this exact order, before init. */
  readonly plugins: readonly NavaraPluginSpec[];
}

export interface NavaraSessionResult<
  TView extends NavaraViewLike = NavaraViewLike,
> {
  readonly view: TView;
  /** The same instances that were passed in, keyed by spec.key. */
  readonly plugins: ReadonlyMap<string, unknown>;
}

export interface NavaraSession<TView extends NavaraViewLike = NavaraViewLike> {
  readonly ready: Promise<NavaraSessionResult<TView>>;
  dispose(): void;
}

export function createNavaraSession<TView extends NavaraViewLike>(
  options: NavaraSessionOptions<TView>,
): NavaraSession<TView> {
  let cancelled = false;
  let disposed = false;
  const view = options.createView();
  const specs = options.plugins;

  const disposeOnce = (): void => {
    if (disposed) return;
    disposed = true;
    view.dispose();
  };

  const ready = (async (): Promise<NavaraSessionResult<TView>> => {
    for (const spec of specs) view.addPlugin(spec.instance);
    try {
      await view.init();
    } catch (error) {
      disposeOnce();
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (cancelled) {
      disposeOnce();
      throw new NavaraSessionDisposedError();
    }
    for (const spec of specs) spec.afterInit?.(view);
    const plugins = new Map<string, unknown>();
    for (const spec of specs) plugins.set(spec.key, spec.instance);
    return { view, plugins };
  })();

  // A caller may never attach a rejection handler (dispose-before-ready during
  // a StrictMode remount), so keep the runtime from reporting it as unhandled.
  // `ready` itself stays rejectable for the callers that do await it.
  const settled = ready.catch(() => undefined);

  return {
    ready,
    dispose: () => {
      cancelled = true;
      void settled.then(disposeOnce);
    },
  };
}
```

- [ ] **Step 4: Run — expect pass, then wire the app dependency**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/navaraSession.test.ts
```

Expected: 7 passed. Then add the plugin dep + alias (Part A already added `@cityjson/navara-core`; this adds the second package):

```bash
cd /data2/hideba/multiroof-viewer && npm pkg set dependencies.@cityjson/navara-cityjson="file:packages/cityjson-navara-plugins/packages/navara-cityjson" && npm install
```

```ts
// vite.config.ts — inside defineConfig({...}), next to the Part A alias entry
  resolve: {
    alias: {
      "@cityjson/navara-cityjson": new URL(
        "./packages/cityjson-navara-plugins/packages/navara-cityjson/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
```

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add src/scene/navaraSession.ts tests/unit/scene/navaraSession.test.ts package.json package-lock.json vite.config.ts && git commit -m "$(cat <<'EOF'
feat: ordered-plugin navara session sequencer and plugin wiring

Plugins are registered from an ordered list before view.init(), the session
returns the constructed instances, and ready resolves-or-rejects instead of
collapsing an init failure into null.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B9: Geographic camera math (fit, align, bounds union)

**Files:**

- Create: `src/scene/geographicCamera.ts`
- Create: `src/scene/cameraStateBridge.ts`
- Test: `tests/unit/scene/geographicCamera.test.ts`
- Test: `tests/unit/scene/cameraStateBridge.test.ts`

**Interfaces:**

- Consumes: `GeodeticBounds` from `@cityjson/navara-cityjson`.
- Produces (`geographicCamera.ts`):
  - `interface GeographicCameraState { readonly lng: number; readonly lat: number; readonly height: number; readonly heading: number; readonly pitch: number; readonly roll: number }`
  - `unionGeodeticBounds(bounds: readonly GeodeticBounds[]): GeodeticBounds | null`
  - `boundsDiagonalMetres(bounds: GeodeticBounds): number`
  - `cameraForBounds(bounds: GeodeticBounds): GeographicCameraState`
  - `alignCameraForBounds(bounds: GeodeticBounds, direction: ViewDirection): GeographicCameraState`
- Produces (`cameraStateBridge.ts`):
  - `cameraStateToTuples(state: GeographicCameraState): { position: readonly [number, number, number]; target: readonly [number, number, number] }`
  - `cameraStateFromTuples(position: readonly [number, number, number], target: readonly [number, number, number]): GeographicCameraState`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/scene/geographicCamera.test.ts
import { describe, it, expect } from "vitest";
import {
  alignCameraForBounds,
  boundsDiagonalMetres,
  cameraForBounds,
  unionGeodeticBounds,
} from "../../../src/scene/geographicCamera";

const a = {
  west: 4.34,
  south: 52.0,
  east: 4.35,
  north: 52.01,
  minHeight: 0,
  maxHeight: 12,
};
const b = {
  west: 4.36,
  south: 51.99,
  east: 4.37,
  north: 52.005,
  minHeight: 2,
  maxHeight: 30,
};

describe("unionGeodeticBounds", () => {
  it("returns null for an empty list", () => {
    expect(unionGeodeticBounds([])).toBeNull();
  });

  it("covers every input box", () => {
    const u = unionGeodeticBounds([a, b])!;
    expect(u.west).toBe(4.34);
    expect(u.east).toBe(4.37);
    expect(u.south).toBe(51.99);
    expect(u.north).toBe(52.01);
    expect(u.minHeight).toBe(0);
    expect(u.maxHeight).toBe(30);
  });
});

describe("boundsDiagonalMetres", () => {
  it("scales longitude by cos(latitude)", () => {
    const d = boundsDiagonalMetres(a);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1600);
  });
});

describe("cameraForBounds", () => {
  it("centres on the box with a tilted view above the top of the model", () => {
    const c = cameraForBounds(a);
    expect(c.lng).toBeCloseTo(4.345, 6);
    expect(c.lat).toBeCloseTo(52.005, 6);
    expect(c.height).toBeGreaterThan(12);
    expect(c.heading).toBe(0);
    expect(c.pitch).toBe(-60);
    expect(c.roll).toBe(0);
  });

  it("never drops below the minimum viewing height for a tiny model", () => {
    const c = cameraForBounds({
      west: 4.35,
      south: 52,
      east: 4.3501,
      north: 52.0001,
      minHeight: 0,
      maxHeight: 3,
    });
    expect(c.height).toBeGreaterThanOrEqual(200);
  });
});

describe("alignCameraForBounds", () => {
  it("maps top to a straight-down view", () => {
    const c = alignCameraForBounds(a, "top");
    expect(c.pitch).toBe(-90);
    expect(c.heading).toBe(0);
  });

  it("maps the four horizontal directions to distinct headings at pitch 0", () => {
    const headings = (["front", "back", "right", "left"] as const).map(
      (d) => alignCameraForBounds(a, d).heading,
    );
    expect(headings).toEqual([0, 180, 90, 270]);
    expect(alignCameraForBounds(a, "right").pitch).toBe(0);
  });

  it("keeps the fit distance when aligning", () => {
    expect(alignCameraForBounds(a, "front").height).toBe(
      cameraForBounds(a).height,
    );
  });
});
```

```ts
// tests/unit/scene/cameraStateBridge.test.ts
import { describe, it, expect } from "vitest";
import {
  cameraStateFromTuples,
  cameraStateToTuples,
} from "../../../src/scene/cameraStateBridge";

describe("cameraStateBridge", () => {
  it("round-trips a geographic camera state through the legacy tuples", () => {
    const state = {
      lng: 4.3571,
      lat: 52.0116,
      height: 812.5,
      heading: 33,
      pitch: -47,
      roll: 0,
    };
    const { position, target } = cameraStateToTuples(state);
    expect(position).toEqual([4.3571, 52.0116, 812.5]);
    expect(target).toEqual([33, -47, 0]);
    expect(cameraStateFromTuples(position, target)).toEqual(state);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/geographicCamera.test.ts tests/unit/scene/cameraStateBridge.test.ts
```

Expected: both files fail to resolve their imports.

- [ ] **Step 3: Implement**

```ts
// src/scene/geographicCamera.ts
/**
 * Geographic camera math for the Navara viewport (spec 4.2). Pure: no engine
 * import, so fitAll/fitLayer/alignView are unit-testable without WebGL.
 */
import type { GeodeticBounds } from "@cityjson/navara-cityjson";
import type { ViewDirection } from "./ViewAlignButtons";

export interface GeographicCameraState {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly heading: number;
  readonly pitch: number;
  readonly roll: number;
}

const METRES_PER_DEGREE_LAT = 111_320;
const MIN_VIEW_HEIGHT_M = 200;
const FIT_DISTANCE_FACTOR = 1.5;

export function unionGeodeticBounds(
  bounds: readonly GeodeticBounds[],
): GeodeticBounds | null {
  if (bounds.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (const b of bounds) {
    west = Math.min(west, b.west);
    south = Math.min(south, b.south);
    east = Math.max(east, b.east);
    north = Math.max(north, b.north);
    minHeight = Math.min(minHeight, b.minHeight);
    maxHeight = Math.max(maxHeight, b.maxHeight);
  }
  return { west, south, east, north, minHeight, maxHeight };
}

export function boundsDiagonalMetres(bounds: GeodeticBounds): number {
  const midLat = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
  const dx =
    (bounds.east - bounds.west) * METRES_PER_DEGREE_LAT * Math.cos(midLat);
  const dy = (bounds.north - bounds.south) * METRES_PER_DEGREE_LAT;
  const dz = bounds.maxHeight - bounds.minHeight;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function fitHeight(bounds: GeodeticBounds): number {
  return Math.max(
    bounds.maxHeight + boundsDiagonalMetres(bounds) * FIT_DISTANCE_FACTOR,
    MIN_VIEW_HEIGHT_M,
  );
}

export function cameraForBounds(bounds: GeodeticBounds): GeographicCameraState {
  return {
    lng: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
    height: fitHeight(bounds),
    heading: 0,
    pitch: -60,
    roll: 0,
  };
}

const ALIGN_PRESETS: Record<
  ViewDirection,
  { readonly heading: number; readonly pitch: number }
> = {
  top: { heading: 0, pitch: -90 },
  bottom: { heading: 0, pitch: 90 },
  front: { heading: 0, pitch: 0 },
  back: { heading: 180, pitch: 0 },
  right: { heading: 90, pitch: 0 },
  left: { heading: 270, pitch: 0 },
};

export function alignCameraForBounds(
  bounds: GeodeticBounds,
  direction: ViewDirection,
): GeographicCameraState {
  const preset = ALIGN_PRESETS[direction];
  return {
    lng: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
    height: fitHeight(bounds),
    heading: preset.heading,
    pitch: preset.pitch,
    roll: 0,
  };
}
```

```ts
// src/scene/cameraStateBridge.ts
/**
 * TEMPORARY bridge between the geographic camera state (spec 4.2) and the
 * snapshot schema's two legacy 3-tuples. Deleted in M7.6, when the snapshot
 * version is bumped and stores {lng,lat,height,heading,pitch,roll} directly.
 *
 * Encoding: position = [lng, lat, height], target = [heading, pitch, roll].
 */
import type { GeographicCameraState } from "./geographicCamera";

export function cameraStateToTuples(state: GeographicCameraState): {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
} {
  return {
    position: [state.lng, state.lat, state.height],
    target: [state.heading, state.pitch, state.roll],
  };
}

export function cameraStateFromTuples(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
): GeographicCameraState {
  return {
    lng: position[0],
    lat: position[1],
    height: position[2],
    heading: target[0],
    pitch: target[1],
    roll: target[2],
  };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/geographicCamera.test.ts tests/unit/scene/cameraStateBridge.test.ts && npx tsc -b --noEmit
```

Expected: 8 + 1 passed, no type errors.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add src/scene/geographicCamera.ts src/scene/cameraStateBridge.ts tests/unit/scene/geographicCamera.test.ts tests/unit/scene/cameraStateBridge.test.ts && git commit -m "$(cat <<'EOF'
feat: geographic camera fit/align math and the temporary snapshot bridge

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B10: Store→handle reconciliation (layers add/remove/visible/LoD/triangles)

**Files:**

- Create: `src/scene/handleSync.ts`
- Test: `tests/unit/scene/handleSync.test.ts`

**Interfaces:**

- Consumes: `CityModelHandle`, `GeodeticBounds`, `ScreenPoint`, `Selection` (`@cityjson/navara-cityjson`), `Layer` (`src/features/layers/layerStore.ts`).
- Produces:
  - `interface CityModelRegistry { get(id: string): CityModelHandle | undefined; add(layer: Layer): CityModelHandle; }`
  - `syncLayers(registry: CityModelRegistry, layers: readonly Layer[], live: Map<string, LiveLayer>, onError: (layerId: string, error: unknown) => void): void`
  - `interface LiveLayer { readonly handle: CityModelHandle; lod: string | null; visible: boolean }`
  - `interface InteractionHandle { readonly id: string; setHighlight(sel: readonly Selection[], hovered?: Selection): void; resolvePick(pick: ScreenPoint): Selection | null; getBoundsGeodetic(): GeodeticBounds | null; triangleCount(): number }` — the four members static `CityModelHandle`s and streaming `FcbStreamLayerHandle`s have in common (Shared Interface Contract → Interaction registries). Declared here in Part B with only static implementors; Task C13 adds the streaming ones.
  - `totalTriangles(layers: readonly Layer[], live: ReadonlyMap<string, LiveLayer>, streams?: ReadonlyMap<string, InteractionHandle>): number` — `streams` defaults to an empty map, so every Part B call site is unchanged

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scene/handleSync.test.ts
import { describe, it, expect, vi } from "vitest";
import type { Layer } from "../../../src/features/layers/layerStore";
import {
  interactionHandles,
  syncLayers,
  totalTriangles,
  type LiveLayer,
} from "../../../src/scene/handleSync";

function fakeHandle(id: string, triangles = 100) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setStyle: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    getBoundsGeodetic: vi.fn(),
    triangleCount: () => triangles,
    delete: vi.fn(),
  };
}

function layer(patch: Partial<Layer> & { id: string }): Layer {
  return {
    name: patch.id,
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    },
    modelRef: { kind: "url", url: "x" },
    visible: true,
    rules: [],
    rulesEnabled: false,
    selectedLod: "2",
    availableLods: ["2", "1"],
    lodMode: "manual",
    isStreaming: false,
    ...patch,
  } as Layer;
}

describe("syncLayers", () => {
  it("adds a handle for a new layer", () => {
    const handle = fakeHandle("L1");
    const registry = { get: () => undefined, add: vi.fn(() => handle) };
    const live = new Map<string, LiveLayer>();
    syncLayers(registry as never, [layer({ id: "L1" })], live, () => {});
    expect(registry.add).toHaveBeenCalledTimes(1);
    expect(live.get("L1")!.handle).toBe(handle);
  });

  it("deletes the handle of a removed layer", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: handle as never, lod: "2", visible: true }],
    ]);
    syncLayers(
      { get: () => undefined, add: vi.fn() } as never,
      [],
      live,
      () => {},
    );
    expect(handle.delete).toHaveBeenCalledTimes(1);
    expect(live.size).toBe(0);
  });

  it("pushes only changed visibility and LoD", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: handle as never, lod: "2", visible: true }],
    ]);
    const registry = { get: () => handle, add: vi.fn() };
    syncLayers(registry as never, [layer({ id: "L1" })], live, () => {});
    expect(handle.setVisible).not.toHaveBeenCalled();
    expect(handle.setLod).not.toHaveBeenCalled();

    syncLayers(
      registry as never,
      [layer({ id: "L1", visible: false, selectedLod: "1" })],
      live,
      () => {},
    );
    expect(handle.setVisible).toHaveBeenCalledWith(false);
    expect(handle.setLod).toHaveBeenCalledWith("1");
  });

  it("reports an add failure through onError without throwing (CRS gate)", () => {
    const registry = {
      get: () => undefined,
      add: () => {
        throw new Error("Cannot georeference this layer");
      },
    };
    const errors: Array<[string, unknown]> = [];
    const live = new Map<string, LiveLayer>();
    expect(() =>
      syncLayers(registry as never, [layer({ id: "L1" })], live, (id, e) =>
        errors.push([id, e]),
      ),
    ).not.toThrow();
    expect(errors[0]![0]).toBe("L1");
    expect(live.size).toBe(0);
  });

  it("skips streaming layers (M7.5 owns those)", () => {
    const registry = { get: () => undefined, add: vi.fn() };
    syncLayers(
      registry as never,
      [layer({ id: "S1", isStreaming: true })],
      new Map(),
      () => {},
    );
    expect(registry.add).not.toHaveBeenCalled();
  });
});

describe("totalTriangles", () => {
  it("counts only visible layers", () => {
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: fakeHandle("L1", 30) as never, lod: "2", visible: true },
      ],
      [
        "L2",
        { handle: fakeHandle("L2", 70) as never, lod: "2", visible: false },
      ],
    ]);
    expect(
      totalTriangles(
        [layer({ id: "L1" }), layer({ id: "L2", visible: false })],
        live,
      ),
    ).toBe(30);
  });

  it("counts streaming handles from the second registry too", () => {
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: fakeHandle("L1", 30) as never, lod: "2", visible: true },
      ],
    ]);
    const streams = new Map([["S1", fakeHandle("S1", 12) as never]]);
    expect(
      totalTriangles(
        [layer({ id: "L1" }), layer({ id: "S1", isStreaming: true })],
        live,
        streams,
      ),
    ).toBe(42);
  });
});

describe("interactionHandles", () => {
  it("returns visible layers' handles in layer order, static and streaming alike", () => {
    const h1 = fakeHandle("L1");
    const s1 = fakeHandle("S1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: h1 as never, lod: "2", visible: true }],
    ]);
    const streams = new Map([["S1", s1 as never]]);
    const layers = [
      layer({ id: "S1", isStreaming: true }),
      layer({ id: "L1" }),
      layer({ id: "L2", visible: false }),
    ];
    expect(interactionHandles(layers, live, streams)).toEqual([s1, h1]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/handleSync.test.ts
```

Expected: `Failed to resolve import "../../../src/scene/handleSync"`.

- [ ] **Step 3: Implement**

```ts
// src/scene/handleSync.ts
/**
 * Pure store -> engine reconciliation for static city model layers.
 *
 * Kept out of NavaraViewport so the add/remove/visible/LoD decisions are
 * testable against a mock handle (the R3F version of this logic lived inside
 * a 150-line useEffect and was only reachable through test-only exports).
 * `syncLayers` skips streaming layers — @cityjson/navara-flatcitybuf creates
 * and owns their meshes from M7.5 on. They are NOT absent from the app,
 * though: `interactionHandles`/`totalTriangles` take a second registry so
 * picking, highlighting, fit and the triangle readout cover streamed cells
 * too (Shared Interface Contract -> Interaction registries).
 */
import type {
  CityModelHandle,
  GeodeticBounds,
  ScreenPoint,
  Selection,
} from "@cityjson/navara-cityjson";
import type { Layer } from "../features/layers/layerStore";

export interface LiveLayer {
  readonly handle: CityModelHandle;
  lod: string | null;
  visible: boolean;
}

export interface CityModelRegistry {
  get(id: string): CityModelHandle | undefined;
  add(layer: Layer): CityModelHandle;
}

export function syncLayers(
  registry: CityModelRegistry,
  layers: readonly Layer[],
  live: Map<string, LiveLayer>,
  onError: (layerId: string, error: unknown) => void,
): void {
  const wanted = new Set(layers.filter((l) => !l.isStreaming).map((l) => l.id));

  for (const [id, entry] of live) {
    if (wanted.has(id)) continue;
    entry.handle.delete();
    live.delete(id);
  }

  for (const layer of layers) {
    if (layer.isStreaming) continue;

    let entry = live.get(layer.id);
    if (!entry) {
      try {
        const handle = registry.add(layer);
        entry = {
          handle,
          lod: layer.selectedLod,
          visible: layer.visible,
        };
        live.set(layer.id, entry);
        handle.setVisible(layer.visible);
      } catch (e) {
        onError(layer.id, e);
        continue;
      }
    }

    if (entry.lod !== layer.selectedLod) {
      entry.lod = layer.selectedLod;
      if (layer.selectedLod !== null) entry.handle.setLod(layer.selectedLod);
    }
    if (entry.visible !== layer.visible) {
      entry.visible = layer.visible;
      entry.handle.setVisible(layer.visible);
    }
  }
}

/** The interaction surface static and streaming layers share. Only *styling*
 *  differs between them (Shared Interface Contract -> Streaming styling). */
export interface InteractionHandle {
  readonly id: string;
  setHighlight(sel: readonly Selection[], hovered?: Selection): void;
  resolvePick(pick: ScreenPoint): Selection | null;
  getBoundsGeodetic(): GeodeticBounds | null;
  triangleCount(): number;
}

const NO_STREAMS: ReadonlyMap<string, InteractionHandle> = new Map();

/** Visible layers' interaction handles, in layer order — static from `live`,
 *  streaming from `streams`. One registry, so picking, highlighting, fit and
 *  the triangle readout can never disagree about which layers exist. */
export function interactionHandles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  streams: ReadonlyMap<string, InteractionHandle> = NO_STREAMS,
): readonly InteractionHandle[] {
  const out: InteractionHandle[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    const handle = live.get(layer.id)?.handle ?? streams.get(layer.id);
    if (handle) out.push(handle as InteractionHandle);
  }
  return out;
}

export function totalTriangles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  streams: ReadonlyMap<string, InteractionHandle> = NO_STREAMS,
): number {
  let total = 0;
  for (const handle of interactionHandles(layers, live, streams)) {
    total += handle.triangleCount();
  }
  return total;
}
```

Note: the first `handle.setVisible(layer.visible)` right after `add` is intentional — a freshly created descriptor is visible by default, and the test "adds a handle for a new layer" only asserts registration, so this call is safe with either initial value.

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/handleSync.test.ts && npx tsc -b --noEmit
```

Expected: 12 passed, no type errors.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add src/scene/handleSync.ts tests/unit/scene/handleSync.test.ts && git commit -m "$(cat <<'EOF'
feat: pure store-to-handle layer reconciliation for the navara viewport

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B11a: `NavaraViewport` — engine lifecycle, globe + photoreal scene, no layers

The first of the two halves the original B11 was split into (it replaced a ~1900-line component and rewired `App.tsx` in one step). B11a stands up the component and proves the engine renders; B11b adds layer sync and switches `App.tsx` over. Each half ends green on its own, so a failure in one does not require unwinding the other.

**Files:**

- Create: `src/scene/NavaraViewport.tsx`
- Create: `src/app/App.css` addition (`.navara-viewport`)
- Test: `tests/unit/scene/navaraViewport.test.tsx`

**Interfaces:**

- Consumes: `createNavaraSession`/`NavaraSessionDisposedError`/`NavaraPluginSpec` (B8), `alignCameraForBounds`/`cameraForBounds`/`unionGeodeticBounds`/`GeographicCameraState` (B9), `CityJSONPlugin` (B7), `ThreeView`/`DefaultPlugin` from `@navaramap/*`.
- Produces:
  - `interface CitySceneHandle { fitAll(): void; fitLayer(layerId: string): void; alignView(direction: ViewDirection): void; getCameraState(): GeographicCameraState | null; setCameraState(state: GeographicCameraState): void; readonly ready: Promise<void> }` — `getStreamingPlugin()` joins it in Task C13. `ready` is resolve-or-reject per the **Shared Interface Contract**: it resolves once `view.init()` and plugin registration have settled, and rejects with the init error if the engine could not start. A StrictMode dispose-before-init is swallowed, not propagated.
  - `interface NavaraViewportProps { readonly onTriangleCount: (count: number) => void; readonly onFps?: (fps: number) => void; readonly onCursorPosition?: (pos: readonly [number, number, number] | null) => void; readonly onLayerError?: (layerId: string, message: string) => void }`
  - `const NavaraViewport: ForwardRefExoticComponent<NavaraViewportProps & RefAttributes<CitySceneHandle>>`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/scene/navaraViewport.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createRef } from "react";

const addPlugin = vi.fn();
const init = vi.fn(async () => {});
const dispose = vi.fn();
vi.mock("@navaramap/three", () => ({
  default: vi.fn(() => ({
    addPlugin,
    init,
    dispose,
    on: vi.fn(),
    off: vi.fn(),
    camera: {
      positionGeographic: { lng: 4.35, lat: 52, height: 500 },
      orientation: { heading: 0, pitch: -60, roll: 0 },
    },
    setCamera: vi.fn(),
    flyTo: vi.fn(),
  })),
}));
const defaultPluginInstance = { addDefaultPhotorealScene: vi.fn() };
vi.mock("@navaramap/three-default-plugin", () => ({
  DefaultPlugin: vi.fn(() => defaultPluginInstance),
}));
const cityPluginInstance = { getHandle: vi.fn(), addCityModel: vi.fn() };
vi.mock("@cityjson/navara-cityjson", () => ({
  CityJSONPlugin: vi.fn(() => cityPluginInstance),
}));

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";

describe("NavaraViewport lifecycle", () => {
  beforeEach(() => {
    addPlugin.mockClear();
    init.mockClear();
    dispose.mockClear();
    init.mockImplementation(async () => {});
    defaultPluginInstance.addDefaultPhotorealScene.mockClear();
  });

  it("registers DefaultPlugin then CityJSONPlugin, both before view.init()", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addPlugin.mock.calls.map((c) => c[0])).toEqual([
      defaultPluginInstance,
      cityPluginInstance,
    ]);
    expect(addPlugin.mock.invocationCallOrder[1]!).toBeLessThan(
      init.mock.invocationCallOrder[0]!,
    );
  });

  it("adds the photoreal scene after init, and resolves `ready`", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).resolves.toBeUndefined();
    expect(
      defaultPluginInstance.addDefaultPhotorealScene,
    ).toHaveBeenCalledTimes(1);
  });

  it("REJECTS `ready` and shows an error panel when view.init() fails", async () => {
    init.mockRejectedValueOnce(new Error("wasm boom"));
    const ref = createRef<CitySceneHandle>();
    const { findByRole } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).rejects.toThrow("wasm boom");
    // The failure is visible, not just a console line: C20's restore flow
    // catches the rejection, and the user sees why nothing rendered.
    expect((await findByRole("alert")).textContent).toMatch(/wasm boom/);
  });

  it("getCameraState reads the engine camera; setCameraState writes it", async () => {
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await ref.current!.ready;
    expect(ref.current!.getCameraState()).toEqual({
      lng: 4.35,
      lat: 52,
      height: 500,
      heading: 0,
      pitch: -60,
      roll: 0,
    });
  });

  it("disposes the view on unmount", async () => {
    const { unmount } = render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run tests/unit/scene/navaraViewport.test.tsx
```

Expected: `Failed to resolve import "../../../src/scene/NavaraViewport"`.

- [ ] **Step 3: Write the component (lifecycle half)**

```tsx
// src/scene/NavaraViewport.tsx
/**
 * Navara viewport: owns the ThreeView lifecycle, mirrors the stores into
 * CityModelHandles, and exposes the imperative CitySceneHandle App.tsx uses.
 *
 * Replacement for CitySceneR3F.tsx (spec 4.1). No React Three Fiber: Navara
 * is imperative, so the whole engine lives behind refs and focused effects.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { CityJSONPlugin } from "@cityjson/navara-cityjson";
import {
  createNavaraSession,
  NavaraSessionDisposedError,
} from "./navaraSession";
import {
  alignCameraForBounds,
  cameraForBounds,
  unionGeodeticBounds,
  type GeographicCameraState,
} from "./geographicCamera";
import { ViewAlignButtons, type ViewDirection } from "./ViewAlignButtons";

export interface CitySceneHandle {
  fitAll: () => void;
  fitLayer: (layerId: string) => void;
  alignView: (direction: ViewDirection) => void;
  getCameraState: () => GeographicCameraState | null;
  setCameraState: (state: GeographicCameraState) => void;
  /** Resolves once the engine is live (view.init() + plugins registered);
   *  REJECTS with the init error if it never came up. App.tsx awaits this
   *  inside try/catch instead of a 100 ms setTimeout — see Task C20. */
  readonly ready: Promise<void>;
}

export interface NavaraViewportProps {
  readonly onTriangleCount: (count: number) => void;
  readonly onFps?: (fps: number) => void;
  readonly onCursorPosition?: (
    pos: readonly [number, number, number] | null,
  ) => void;
  readonly onLayerError?: (layerId: string, message: string) => void;
}

type ViewInstance = InstanceType<typeof ThreeView>;

export const NavaraViewport = forwardRef<CitySceneHandle, NavaraViewportProps>(
  function NavaraViewport({ onTriangleCount, onFps, onLayerError }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<ViewInstance | null>(null);
    const cityPluginRef = useRef<CityJSONPlugin | null>(null);
    const [engineReady, setEngineReady] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);

    // CitySceneHandle.ready — created eagerly so a consumer can await it
    // before the mount effect has run. Resolve-or-reject, never a hang:
    // see the Shared Interface Contract.
    const readyRef = useRef<{
      promise: Promise<void>;
      resolve: () => void;
      reject: (e: unknown) => void;
    } | null>(null);
    if (readyRef.current === null) {
      let resolve!: () => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Nobody may ever await it (the component can unmount first), so make
      // sure a rejection is never reported as unhandled.
      promise.catch(() => undefined);
      readyRef.current = { promise, resolve, reject };
    }

    // --- Engine lifecycle (StrictMode-safe, see navaraSession.ts) ---
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Constructed here so this component keeps typed refs; the session only
      // needs them in registration order (Task B8). Task B11b appends nothing;
      // Task C13 appends the FlatCityBuf plugin to this same array.
      const defaultPlugin = new DefaultPlugin();
      const cityPlugin = new CityJSONPlugin();

      const session = createNavaraSession({
        createView: () =>
          new ThreeView({ container, useNormal: true, shadow: true }),
        plugins: [
          {
            key: "default",
            instance: defaultPlugin,
            afterInit: () => defaultPlugin.addDefaultPhotorealScene(),
          },
          { key: "cityjson", instance: cityPlugin },
        ],
      });

      session.ready.then(
        (result) => {
          viewRef.current = result.view as ViewInstance;
          cityPluginRef.current = cityPlugin;
          setInitError(null);
          setEngineReady(true);
          readyRef.current!.resolve();
        },
        (error: unknown) => {
          // A StrictMode remount disposed this session before it went live —
          // the remount's session will resolve the same `ready`.
          if (error instanceof NavaraSessionDisposedError) return;
          const message =
            error instanceof Error ? error.message : String(error);
          setInitError(message);
          readyRef.current!.reject(error);
        },
      );

      return () => {
        setEngineReady(false);
        viewRef.current = null;
        cityPluginRef.current = null;
        session.dispose();
      };
    }, []);

    // --- FPS readout from the render loop ---
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view || !onFps) return;
      let frames = 0;
      let last = performance.now();
      const onPostRender = () => {
        frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          onFps(Math.round((frames * 1000) / (now - last)));
          frames = 0;
          last = now;
        }
      };
      view.on("postRender", onPostRender);
      return () => view.off("postRender", onPostRender);
    }, [engineReady, onFps]);

    // --- camera helpers (bounds sources are added in Task B11b) ---
    const boundsOf = useCallback((_ids?: readonly string[]) => {
      return unionGeodeticBounds([]);
    }, []);

    const fitAll = useCallback(() => {
      const view = viewRef.current;
      const bounds = boundsOf();
      if (!view || !bounds) return;
      view.flyTo(cameraForBounds(bounds));
    }, [boundsOf]);

    const fitLayer = useCallback(
      (layerId: string) => {
        const view = viewRef.current;
        const bounds = boundsOf([layerId]);
        if (!view || !bounds) return;
        view.flyTo(cameraForBounds(bounds));
      },
      [boundsOf],
    );

    const alignView = useCallback(
      (direction: ViewDirection) => {
        const view = viewRef.current;
        const bounds = boundsOf();
        if (!view || !bounds) return;
        view.setCamera(alignCameraForBounds(bounds, direction));
      },
      [boundsOf],
    );

    const getCameraState = useCallback((): GeographicCameraState | null => {
      const view = viewRef.current;
      if (!view) return null;
      const { lng, lat, height } = view.camera.positionGeographic;
      const { heading, pitch, roll } = view.camera.orientation;
      return { lng, lat, height, heading, pitch, roll };
    }, []);

    const setCameraState = useCallback((state: GeographicCameraState) => {
      viewRef.current?.setCamera(state);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        fitAll,
        fitLayer,
        alignView,
        getCameraState,
        setCameraState,
        ready: readyRef.current!.promise,
      }),
      [fitAll, fitLayer, alignView, getCameraState, setCameraState],
    );

    return (
      <div className="navara-viewport" ref={containerRef}>
        {initError !== null && (
          <div className="navara-viewport__error" role="alert">
            The 3D engine failed to start: {initError}
          </div>
        )}
        <ViewAlignButtons onAlign={alignView} />
      </div>
    );
  },
);
```

`onTriangleCount` and `onLayerError` are destructured but unused until B11b; keep them in the signature so the props contract does not change between the two halves.

Add the container styles next to the existing `.viewport` rule in `src/app/App.css`:

```css
.navara-viewport {
  position: absolute;
  inset: 0;
}

.navara-viewport__error {
  position: absolute;
  inset-inline: 1rem;
  top: 1rem;
  z-index: 2;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  background: var(--color-danger-bg, #5a1d1d);
  color: var(--color-danger-fg, #ffdede);
  font-size: 0.9rem;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/navaraViewport.test.tsx && npx tsc -b --noEmit
```

Expected: 5 passed, no type errors. `App.tsx` still renders the old `CityScene` at this point — that is deliberate; B11b does the switch.

- [ ] **Step 5: Browser check the bare globe**

Temporarily render the component by adding `?navara=1` handling, or simply point the spike page at it — the cheapest check is to run the B11b browser step instead if you prefer. If checking now:

```bash
cd /data2/hideba/multiroof-viewer && npm run dev &
sleep 6
agent-browser open http://localhost:5173/spike.html
agent-browser errors
```

Expected: unchanged from Task B1 (the spike still works; nothing regressed in `vite.config.ts`).

- [ ] **Step 6: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add src/scene/NavaraViewport.tsx src/app/App.css tests/unit/scene/navaraViewport.test.tsx && git commit -m "$(cat <<'EOF'
feat: add the NavaraViewport engine lifecycle host

Ordered plugin registration before init, resolve-or-reject ready promise, an
in-viewport init error panel, and the geographic camera accessors.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B11b: Static layer sync + `App.tsx` switch (end-to-end static CityJSON)

Closes M7.3: the app renders `fixtures/two-buildings.city.json` on the globe.

**Files:**

- Modify: `src/scene/NavaraViewport.tsx`
- Modify: `src/app/App.tsx`
- Delete: `tests/unit/scene/layerSceneMap.test.ts`

**Interfaces:**

- Consumes: `syncLayers`/`totalTriangles`/`interactionHandles`/`LiveLayer` (B10), `CityModelHandle` (B7), `useLayerStore`, `cameraStateFromTuples`/`cameraStateToTuples` (B9).
- Produces: no new exported API — `CitySceneHandle` and `NavaraViewportProps` are unchanged from B11a.

- [ ] **Step 1: Add the layer-sync effect and the real bounds source**

```tsx
// src/scene/NavaraViewport.tsx — additional imports
import type { CityModelHandle } from "@cityjson/navara-cityjson";
import { useLayerStore } from "../features/layers/layerStore";
import {
  interactionHandles,
  syncLayers,
  totalTriangles,
  type LiveLayer,
} from "./handleSync";
```

```tsx
// src/scene/NavaraViewport.tsx — inside the component
const liveRef = useRef(new Map<string, LiveLayer>());
const layers = useLayerStore((s) => s.layers);

// --- layers -> handles ---
const [fitToken, setFitToken] = useState(0);
useEffect(() => {
  const plugin = cityPluginRef.current;
  if (!engineReady || !plugin) return;
  const before = liveRef.current.size;
  syncLayers(
    {
      get: (id) => plugin.getHandle(id),
      add: (layer) =>
        plugin.addCityModel(layer.model, {
          id: layer.id,
          crs: layer.model.metadata.referenceSystem,
          lod: layer.selectedLod,
        }),
    },
    layers,
    liveRef.current,
    (layerId, error) =>
      onLayerError?.(
        layerId,
        error instanceof Error ? error.message : String(error),
      ),
  );
  onTriangleCount(totalTriangles(layers, liveRef.current));
  if (liveRef.current.size > before) setFitToken((t) => t + 1);
}, [engineReady, layers, onTriangleCount, onLayerError]);

// Fit once whenever a layer is newly added.
useEffect(() => {
  if (fitToken === 0) return;
  fitAll();
}, [fitToken, fitAll]);
```

Replace B11a's placeholder `boundsOf` with the real one, and clear `liveRef` in the lifecycle effect's cleanup:

```tsx
const boundsOf = useCallback((ids?: readonly string[]) => {
  const handles: CityModelHandle[] = [];
  for (const [id, entry] of liveRef.current) {
    if (ids && !ids.includes(id)) continue;
    handles.push(entry.handle);
  }
  return unionGeodeticBounds(handles.map((h) => h.getBoundsGeodetic()));
}, []);
```

(`interactionHandles` is imported now because Task B15 wires picking through it; B11b only needs `syncLayers`/`totalTriangles`.)

- [ ] **Step 2: Switch `App.tsx` over**

Replace the import and the render site, and route camera persistence through the bridge:

```tsx
// src/app/App.tsx — imports (replacing lines 32-33)
import { NavaraViewport } from "../scene/NavaraViewport";
import type { CitySceneHandle } from "../scene/NavaraViewport";
import {
  cameraStateFromTuples,
  cameraStateToTuples,
} from "../scene/cameraStateBridge";
```

```tsx
// src/app/App.tsx — handleSave (was: cameraPosition/cameraTarget straight off the handle)
const cameraState = sceneRef.current?.getCameraState();
if (!cameraState) return;
const cameraTuples = cameraStateToTuples(cameraState);
```

then `cameraPosition: cameraTuples.position, cameraTarget: cameraTuples.target` in the `captureSnapshot` call (and identically in the share handler at ~line 463).

```tsx
// src/app/App.tsx — restore (~line 439) and share-load (~line 575)
cameraTimerRef.current = setTimeout(() => {
  sceneRef.current?.setCameraState(
    cameraStateFromTuples(viewState.cameraPosition, viewState.cameraTarget),
  );
}, 100);
```

(The 100 ms timeout survives only until Task C20, which replaces it with `await ready` inside try/catch.)

```tsx
// src/app/App.tsx — render site (was <CityScene .../>)
<NavaraViewport
  ref={sceneRef}
  onTriangleCount={setTriangleCount}
  onFps={setFps}
  onCursorPosition={setCursorPosition}
  onLayerError={(layerId, message) => {
    setToast(`Layer ${layerId}: ${message}`);
    setTimeout(() => setToast(null), 6000);
  }}
/>
```

- [ ] **Step 3: Type check and run the suite**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run
```

Expected: no type errors. Test failures are expected **only** in files that import the deleted-in-M7.7 R3F modules (`tests/unit/scene/layerSceneMap.test.ts` and any test importing `CitySceneR3F`); those files are retired here — delete `tests/unit/scene/layerSceneMap.test.ts` (spec §6: "retired with the file it tests") and re-run until green. Note the deletion: Task C21's inventory assumes `layerSceneMap.test.ts` is already gone by then.

- [ ] **Step 4: Browser verification (the M7.3 acceptance gate)**

```bash
cd /data2/hideba/multiroof-viewer && npm run dev &
sleep 6
agent-browser open http://localhost:5173
agent-browser snapshot -i
```

Load the fixture through the UI (use the file input ref from the snapshot):

```bash
agent-browser upload input[type=file] /data2/hideba/multiroof-viewer/fixtures/two-buildings.city.json
sleep 4
agent-browser errors
agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/m73-two-buildings.png
agent-browser get text .status-bar
```

Expected observations:

- No page errors; console free of WASM/asset 404s.
- Screenshot: two red-roofed buildings sitting on the photorealistic globe near Delft, camera tilted (pitch −60), sky visible.
- The buildings sit **on** the terrain, not ~43 m below it. This is the first end-to-end check of the geoid-sampled vertical offset (Global Constraints → Vertical datum) and of the exact source-CRS→ENU vertex transform (Task A13b). Note they may render sunk for a fraction of a second and then snap up — that is `setHeightOffset()` re-placing them when the async sample lands (Task B7), and it is expected. If they stay sunk, check the network panel for the `terrain.reearth.land` requests and the console for the `[geoid]` warning; if they float, check `projectPositionsToEnu` and the Terrain-RGB decode branch (Task A13b Step 15).
- Status bar reports a non-zero triangle count.
- Clicking the toolbar "Fit all" and the T/F/R align buttons visibly re-frames the model:

```bash
agent-browser find text "T" click
sleep 2
agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/m73-top-view.png
```

Expected: top-down view of the two footprints.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git rm tests/unit/scene/layerSceneMap.test.ts && git add src/scene/NavaraViewport.tsx src/app/App.tsx && git commit -m "$(cat <<'EOF'
feat: render city models through the navara viewport (M7.3)

Replaces CityScene with NavaraViewport: layer->handle sync, geographic
CitySceneHandle (fitAll/fitLayer/alignView/camera state).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## M7.4 — Picking, cursor readout, rules, highlight, LoD

---

### Task B12: Pick event → selection intents

**Files:**

- Create: `src/scene/pickEventHandlers.ts`
- Test: `tests/unit/scene/pickEventHandlers.test.ts`

**Interfaces:**

- Consumes: `Selection`, `PickMode` (`src/domain/selection/types.ts`), `CityModelHandle`.
- Produces:
  - `type PickIntent = { kind: "hover"; selection: Selection | null } | { kind: "select"; selection: Selection | null } | { kind: "toggle"; selection: Selection }`
  - `resolveFirstHit(handles: Iterable<CityModelHandle>, point: ScreenPoint): Selection | null`
  - `narrowToMode(selection: Selection | null, mode: PickMode): Selection | null`
  - `pickIntentFor(event: { readonly type: "move" | "click"; readonly shiftKey: boolean }, selection: Selection | null): PickIntent`
  - `applyPickIntent(intent: PickIntent, store: SelectionActionsSubset): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scene/pickEventHandlers.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  applyPickIntent,
  narrowToMode,
  pickIntentFor,
  resolveFirstHit,
} from "../../../src/scene/pickEventHandlers";

const surfaceSel = {
  kind: "surface" as const,
  layerId: "L1",
  objectId: "B1",
  surfaceIndex: 4,
};

function handle(result: unknown) {
  return { resolvePick: vi.fn(() => result) };
}

describe("resolveFirstHit", () => {
  it("returns the first handle that resolves a selection", () => {
    const a = handle(null);
    const b = handle(surfaceSel);
    expect(resolveFirstHit([a, b] as never, { x: 10, y: 20 })).toBe(surfaceSel);
    expect(a.resolvePick).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("returns null when nothing is hit", () => {
    expect(resolveFirstHit([handle(null)] as never, { x: 1, y: 1 })).toBeNull();
  });
});

describe("narrowToMode", () => {
  it("keeps surface granularity in surface mode", () => {
    expect(narrowToMode(surfaceSel, "surface")).toEqual(surfaceSel);
  });

  it("collapses to an object selection in object mode", () => {
    expect(narrowToMode(surfaceSel, "object")).toEqual({
      kind: "object",
      layerId: "L1",
      objectId: "B1",
    });
  });

  it("passes null through", () => {
    expect(narrowToMode(null, "object")).toBeNull();
  });
});

describe("pickIntentFor", () => {
  it("maps a move to a hover intent", () => {
    expect(
      pickIntentFor({ type: "move", shiftKey: false }, surfaceSel),
    ).toEqual({ kind: "hover", selection: surfaceSel });
  });

  it("maps a plain click to select and a shift-click to toggle", () => {
    expect(
      pickIntentFor({ type: "click", shiftKey: false }, surfaceSel),
    ).toEqual({ kind: "select", selection: surfaceSel });
    expect(
      pickIntentFor({ type: "click", shiftKey: true }, surfaceSel),
    ).toEqual({ kind: "toggle", selection: surfaceSel });
  });

  it("maps a shift-click on empty space to a clearing select", () => {
    expect(pickIntentFor({ type: "click", shiftKey: true }, null)).toEqual({
      kind: "select",
      selection: null,
    });
  });
});

describe("applyPickIntent", () => {
  it("dispatches to the matching store action", () => {
    const store = { hover: vi.fn(), select: vi.fn(), toggleSelect: vi.fn() };
    applyPickIntent({ kind: "hover", selection: null }, store);
    applyPickIntent({ kind: "select", selection: surfaceSel }, store);
    applyPickIntent({ kind: "toggle", selection: surfaceSel }, store);
    expect(store.hover).toHaveBeenCalledWith(null);
    expect(store.select).toHaveBeenCalledWith(surfaceSel);
    expect(store.toggleSelect).toHaveBeenCalledWith(surfaceSel);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/pickEventHandlers.test.ts
```

Expected: `Failed to resolve import "../../../src/scene/pickEventHandlers"`.

- [ ] **Step 3: Implement**

```ts
// src/scene/pickEventHandlers.ts
/**
 * Pointer/pick events -> selection store intents.
 *
 * Handles resolve picks at SURFACE granularity always (see
 * CityModelHandle.resolvePick); narrowing to object granularity is the app's
 * job, exactly as the pre-Navara resolvePicking.ts documented.
 */
import type { PickMode, Selection } from "../domain/selection/types";
import type { CityModelHandle, ScreenPoint } from "@cityjson/navara-cityjson";

export type PickIntent =
  | { readonly kind: "hover"; readonly selection: Selection | null }
  | { readonly kind: "select"; readonly selection: Selection | null }
  | { readonly kind: "toggle"; readonly selection: Selection };

export interface SelectionActionsSubset {
  hover(selection: Selection | null): void;
  select(selection: Selection | null): void;
  toggleSelect(selection: Selection): void;
}

export function resolveFirstHit(
  handles: Iterable<CityModelHandle>,
  point: ScreenPoint,
): Selection | null {
  for (const handle of handles) {
    const hit = handle.resolvePick(point) as Selection | null;
    if (hit) return hit;
  }
  return null;
}

export function narrowToMode(
  selection: Selection | null,
  mode: PickMode,
): Selection | null {
  if (!selection) return null;
  if (mode === "surface") return selection;
  return {
    kind: "object",
    layerId: selection.layerId,
    objectId: selection.objectId,
  };
}

export function pickIntentFor(
  event: { readonly type: "move" | "click"; readonly shiftKey: boolean },
  selection: Selection | null,
): PickIntent {
  if (event.type === "move") return { kind: "hover", selection };
  if (event.shiftKey && selection) return { kind: "toggle", selection };
  return { kind: "select", selection };
}

export function applyPickIntent(
  intent: PickIntent,
  store: SelectionActionsSubset,
): void {
  if (intent.kind === "hover") {
    store.hover(intent.selection);
    return;
  }
  if (intent.kind === "toggle") {
    store.toggleSelect(intent.selection);
    return;
  }
  store.select(intent.selection);
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/pickEventHandlers.test.ts
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add src/scene/pickEventHandlers.ts tests/unit/scene/pickEventHandlers.test.ts && git commit -m "$(cat <<'EOF'
feat: pick/hover/shift-toggle intent resolution for the navara viewport

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B13: Cursor CRS readout (throttled)

**Files:**

- Create: `src/scene/cursorCrsReadout.ts`
- Test: `tests/unit/scene/cursorCrsReadout.test.ts`

**Interfaces:**

- Consumes: `ensureProjDef`, `parseEpsgCode` from `@cityjson/navara-core`; `proj4`.
- Produces:
  - `crsFromGeodetic(lngDeg: number, latDeg: number, height: number, epsg: number): readonly [number, number, number] | null`
  - `epsgForLayer(referenceSystem: string | undefined): number | null`
  - `createThrottle(intervalMs: number, now?: () => number): (fn: () => void) => void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scene/cursorCrsReadout.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  createThrottle,
  crsFromGeodetic,
  epsgForLayer,
} from "../../../src/scene/cursorCrsReadout";

describe("epsgForLayer", () => {
  it("parses an OGC CRS URI", () => {
    expect(epsgForLayer("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(
      7415,
    );
  });

  it("returns null when the CRS has no proj4 definition", () => {
    expect(epsgForLayer(undefined)).toBeNull();
    expect(
      epsgForLayer("https://www.opengis.net/def/crs/EPSG/0/99999"),
    ).toBeNull();
  });
});

describe("crsFromGeodetic", () => {
  it("inverts WGS84 back into RD New metres", () => {
    const out = crsFromGeodetic(4.348, 52.006, 14, 7415)!;
    expect(out[0]).toBeGreaterThan(84000);
    expect(out[0]).toBeLessThan(86000);
    expect(out[1]).toBeGreaterThan(445000);
    expect(out[1]).toBeLessThan(447000);
    expect(out[2]).toBe(14);
  });

  it("returns null for an unusable epsg", () => {
    expect(crsFromGeodetic(4.348, 52.006, 0, 99999)).toBeNull();
  });
});

describe("createThrottle", () => {
  it("runs immediately then suppresses until the interval elapses", () => {
    let t = 1000;
    const throttle = createThrottle(66, () => t);
    const fn = vi.fn();
    throttle(fn);
    throttle(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    t += 70;
    throttle(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/cursorCrsReadout.test.ts
```

Expected: `Failed to resolve import "../../../src/scene/cursorCrsReadout"`.

- [ ] **Step 3: Implement**

```ts
// src/scene/cursorCrsReadout.ts
/**
 * Status-bar cursor readout: Navara reports positions in ECEF, the viewport
 * converts them to geodetic with vector3ToGeodetic, and this module takes it
 * the last step back into the layer's source CRS (the coordinates the user
 * recognises), plus the throttle gate the old pointer handler had inline.
 */
import proj4 from "proj4";
import { ensureProjDef, parseEpsgCode } from "@cityjson/navara-core";

export function epsgForLayer(
  referenceSystem: string | undefined,
): number | null {
  const epsg = parseEpsgCode(referenceSystem);
  if (epsg === null) return null;
  return ensureProjDef(epsg) ? epsg : null;
}

export function crsFromGeodetic(
  lngDeg: number,
  latDeg: number,
  height: number,
  epsg: number,
): readonly [number, number, number] | null {
  if (!ensureProjDef(epsg)) return null;
  try {
    const [x, y] = proj4("WGS84", `EPSG:${epsg}`, [lngDeg, latDeg]) as [
      number,
      number,
    ];
    return [x, y, height];
  } catch {
    return null;
  }
}

export function createThrottle(
  intervalMs: number,
  now: () => number = () => performance.now(),
): (fn: () => void) => void {
  let last = -Infinity;
  return (fn: () => void) => {
    const t = now();
    if (t - last < intervalMs) return;
    last = t;
    fn();
  };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/cursorCrsReadout.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add src/scene/cursorCrsReadout.ts tests/unit/scene/cursorCrsReadout.test.ts && git commit -m "$(cat <<'EOF'
feat: geodetic -> source-CRS cursor readout with a throttle gate

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B14: Rule compilation → `SurfaceStyleEvaluator`

**Files:**

- Create: `src/features/rules/compileEvaluator.ts`
- Test: `tests/unit/features/rules/compileEvaluator.test.ts`

**Interfaces:**

- Consumes: `matchRule`, `computeRoofMetrics`, `Rule`, `SurfaceStyleEvaluator`, `SurfaceInfo`, `CityObjectInfo`, `srgbHexToLinear` — all from `@cityjson/navara-core` (Task A12 moved the rule engine and roof metrics there; the app's `src/features/rules/*` and `src/domain/roofMetrics/*` are now re-export shims, so importing from core directly is the non-indirect path).
- Produces: `compileRulesToEvaluator(rules: ReadonlyArray<Rule>, rulesEnabled: boolean): SurfaceStyleEvaluator | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/rules/compileEvaluator.test.ts
import { describe, it, expect } from "vitest";
import { srgbHexToLinear } from "@cityjson/navara-core";
import { compileRulesToEvaluator } from "../../../../src/features/rules/compileEvaluator";
import type { Rule } from "@cityjson/navara-core";
import type {
  CityObject,
  Surface,
} from "../../../../src/domain/citymodel/types";

const flatRoof: Surface = {
  type: "RoofSurface",
  rings: [
    [
      [0, 0, 10],
      [10, 0, 10],
      [10, 10, 10],
      [0, 10, 10],
    ],
  ],
  attributes: {},
  lod: "2",
};

const wall: Surface = { ...flatRoof, type: "WallSurface" };

const object: CityObject = {
  id: "B1",
  objectType: "Building",
  attributes: { function: "residential" },
  surfaces: [flatRoof, wall],
  bbox: null,
  children: [],
  parents: [],
  lod: "2",
};

const rules: ReadonlyArray<Rule> = [
  {
    id: "r1",
    name: "flat roofs",
    color: "#4ec84e",
    conditions: [{ field: "slopeDeg", operator: "<", value: 5 }],
    logic: "AND",
    enabled: true,
  },
  {
    id: "r2",
    name: "disabled",
    color: "#ff0000",
    conditions: [],
    logic: "AND",
    enabled: false,
  },
];

describe("compileRulesToEvaluator", () => {
  it("returns null when rules are disabled for the layer", () => {
    expect(compileRulesToEvaluator(rules, false)).toBeNull();
  });

  it("returns null when no rule is enabled", () => {
    expect(compileRulesToEvaluator([rules[1]!], true)).toBeNull();
  });

  it("colors a matching roof surface", () => {
    const evaluator = compileRulesToEvaluator(rules, true)!;
    const color = evaluator(
      { surfaceIndex: 0, surface: flatRoof },
      { objectId: "B1", object },
    );
    // Linear-sRGB triple, not a hex string and not an engine Color.
    expect(color).toEqual(srgbHexToLinear("#4ec84e"));
  });

  it("never colors a non-roof surface", () => {
    const evaluator = compileRulesToEvaluator(rules, true)!;
    expect(
      evaluator({ surfaceIndex: 1, surface: wall }, { objectId: "B1", object }),
    ).toBeNull();
  });

  it("merges object attributes under surface attributes for rule fields", () => {
    const evaluator = compileRulesToEvaluator(
      [
        {
          id: "r3",
          name: "by attribute",
          color: "#123456",
          conditions: [{ field: "function", operator: "=", value: "shed" }],
          logic: "AND",
          enabled: true,
        },
      ],
      true,
    )!;
    const shedSurface: Surface = {
      ...flatRoof,
      attributes: { function: "shed" },
    };
    expect(
      evaluator(
        { surfaceIndex: 0, surface: shedSurface },
        { objectId: "B1", object },
      ),
    ).toEqual(srgbHexToLinear("#123456"));
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/features/rules/compileEvaluator.test.ts
```

Expected: `Failed to resolve import ".../compileEvaluator"`.

- [ ] **Step 3: Implement**

```ts
// src/features/rules/compileEvaluator.ts
/**
 * Per-layer rules -> SurfaceStyleEvaluator (spec 5's `ruleStore-per-layer
 * --compile--> SurfaceStyleEvaluator --> handle.setStyle` edge).
 *
 * Same semantics the pre-Navara applyRuleColors.ts had: only RoofSurface
 * participates, metrics come from computeRoofMetrics, and object attributes
 * are merged UNDER surface attributes before matching. The evaluator returns
 * a LINEAR-sRGB triple (the Shared Interface Contract shape): vertex-color
 * buffers consume those floats directly, so there is no hex round trip and no
 * dependency on any engine Color class.
 */
import {
  srgbHexToLinear,
  type CityObjectInfo,
  type RGB,
  type SurfaceInfo,
  type SurfaceStyleEvaluator,
} from "@cityjson/navara-core";
import { computeRoofMetrics, matchRule } from "@cityjson/navara-core";
import type { Rule } from "./types";

export function compileRulesToEvaluator(
  rules: ReadonlyArray<Rule>,
  rulesEnabled: boolean,
): SurfaceStyleEvaluator | null {
  if (!rulesEnabled) return null;
  const active = rules.filter((r) => r.enabled);
  if (active.length === 0) return null;

  // Rule colors are a handful of hex strings; convert each one once.
  const linearCache = new Map<string, RGB>();

  return (surface: SurfaceInfo, object: CityObjectInfo) => {
    if (surface.surface.type !== "RoofSurface") return null;
    const metrics = computeRoofMetrics(surface.surface);
    const attributes = {
      ...object.object.attributes,
      ...surface.surface.attributes,
    };
    const hex = matchRule(attributes, metrics, active);
    if (hex === null) return null;
    let rgb = linearCache.get(hex);
    if (!rgb) {
      rgb = srgbHexToLinear(hex);
      linearCache.set(hex, rgb);
    }
    return rgb;
  };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/features/rules/compileEvaluator.test.ts && npx tsc -b --noEmit
```

Expected: 5 passed, no type errors.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add src/features/rules/compileEvaluator.ts tests/unit/features/rules/compileEvaluator.test.ts && git commit -m "$(cat <<'EOF'
feat: compile per-layer rules into a SurfaceStyleEvaluator

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B15: Wire events, style and highlight into `NavaraViewport`

**Files:**

- Modify: `src/scene/NavaraViewport.tsx`
- Modify: `src/scene/handleSync.ts`
- Test: `tests/unit/scene/handleSync.test.ts` (extend)

**Interfaces:**

- Consumes: B12 (`resolveFirstHit`/`narrowToMode`/`pickIntentFor`/`applyPickIntent`), B13 (`crsFromGeodetic`/`epsgForLayer`/`createThrottle`), B14 (`compileRulesToEvaluator`), B10 (`interactionHandles`/`InteractionHandle`), `useSelectionStore`.
- Produces (added to `handleSync.ts`):
  - `syncStyles(layers: readonly Layer[], live: ReadonlyMap<string, LiveLayer>, compile: (rules: ReadonlyArray<Rule>, enabled: boolean) => SurfaceStyleEvaluator | null, applied: Map<string, string>): void` — only layers present in `live` are styled, and `syncLayers` never puts a streaming layer there, so streaming layers are untouched here: their rules are baked in the worker via the streaming handle's `setRules` (Task C13)
  - `syncHighlight(layers: readonly Layer[], live: ReadonlyMap<string, LiveLayer>, selections: readonly Selection[], hovered: Selection | null, streams?: ReadonlyMap<string, InteractionHandle>): void` — `streams` defaults to an empty map so Part B call sites are unchanged; Task C13 passes the streaming registry so streamed cells highlight exactly like static layers (Shared Interface Contract → Interaction registries)

- [ ] **Step 1: Write the failing tests (appended to `handleSync.test.ts`)**

```ts
// tests/unit/scene/handleSync.test.ts — append
import { syncHighlight, syncStyles } from "../../../src/scene/handleSync";

describe("syncStyles", () => {
  it("compiles and pushes a style once per rule-signature change", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: handle as never, lod: "2", visible: true }],
    ]);
    const applied = new Map<string, string>();
    const compile = vi.fn(() => (() => null) as never);
    const rules = [
      {
        id: "r1",
        name: "n",
        color: "#fff",
        conditions: [],
        logic: "AND" as const,
        enabled: true,
      },
    ];

    syncStyles(
      [layer({ id: "L1", rules, rulesEnabled: true })],
      live,
      compile,
      applied,
    );
    syncStyles(
      [layer({ id: "L1", rules, rulesEnabled: true })],
      live,
      compile,
      applied,
    );
    expect(handle.setStyle).toHaveBeenCalledTimes(1);

    syncStyles(
      [layer({ id: "L1", rules, rulesEnabled: false })],
      live,
      compile,
      applied,
    );
    expect(handle.setStyle).toHaveBeenCalledTimes(2);
  });
});

describe("syncHighlight", () => {
  it("gives each handle only its own layer's selections and hover", () => {
    const h1 = fakeHandle("L1");
    const h2 = fakeHandle("L2");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: h1 as never, lod: "2", visible: true }],
      ["L2", { handle: h2 as never, lod: "2", visible: true }],
    ]);
    const sel = { kind: "object" as const, layerId: "L1", objectId: "B1" };
    const hov = { kind: "object" as const, layerId: "L2", objectId: "B9" };

    syncHighlight([layer({ id: "L1" }), layer({ id: "L2" })], live, [sel], hov);
    expect(h1.setHighlight).toHaveBeenCalledWith([sel], undefined);
    expect(h2.setHighlight).toHaveBeenCalledWith([], hov);
  });

  it("highlights STREAMING layers from the second registry too", () => {
    const stream = fakeHandle("S1");
    const sel = { kind: "object" as const, layerId: "S1", objectId: "B7" };
    syncHighlight(
      [layer({ id: "S1", isStreaming: true })],
      new Map(),
      [sel],
      null,
      new Map([["S1", stream as never]]),
    );
    expect(stream.setHighlight).toHaveBeenCalledWith([sel], undefined);
  });

  it("still styles nothing for a streaming layer — only highlight crosses over", () => {
    const stream = fakeHandle("S1");
    const applied = new Map<string, string>();
    syncStyles(
      [layer({ id: "S1", isStreaming: true })],
      new Map(),
      vi.fn(),
      applied,
    );
    expect(stream.setStyle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/handleSync.test.ts
```

Expected: `syncStyles`/`syncHighlight` are not exported.

- [ ] **Step 3: Implement the two sync functions**

```ts
// src/scene/handleSync.ts — append
import type { Rule, SurfaceStyleEvaluator } from "@cityjson/navara-core";
import type { Selection } from "../domain/selection/types";
// InteractionHandle is declared earlier in this file (Task B10).

/** Stable signature of a layer's styling inputs — cheap enough to stringify
 *  (rules are a handful of small objects, edited far less often than this
 *  effect re-runs) and, unlike reference identity, correct regardless of
 *  whether a rule edit replaced the array wholesale. */
function styleSignature(rules: ReadonlyArray<Rule>, enabled: boolean): string {
  return enabled ? JSON.stringify(rules) : "disabled";
}

export function syncStyles(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  compile: (
    rules: ReadonlyArray<Rule>,
    enabled: boolean,
  ) => SurfaceStyleEvaluator | null,
  applied: Map<string, string>,
): void {
  for (const layer of layers) {
    const entry = live.get(layer.id);
    if (!entry) continue;
    const signature = styleSignature(layer.rules, layer.rulesEnabled);
    if (applied.get(layer.id) === signature) continue;
    applied.set(layer.id, signature);
    entry.handle.setStyle(compile(layer.rules, layer.rulesEnabled));
  }
  for (const id of [...applied.keys()]) {
    if (!live.has(id)) applied.delete(id);
  }
}

export function syncHighlight(
  layers: readonly Layer[],
  live: ReadonlyMap<string, LiveLayer>,
  selections: readonly Selection[],
  hovered: Selection | null,
  streams: ReadonlyMap<string, InteractionHandle> = new Map(),
): void {
  for (const layer of layers) {
    // Static and streaming layers both highlight; only *styling* is
    // static-only (streaming rule colors are baked in the worker).
    const handle = live.get(layer.id)?.handle ?? streams.get(layer.id);
    if (!handle) continue;
    handle.setHighlight(
      selections.filter((s) => s.layerId === layer.id),
      hovered?.layerId === layer.id ? hovered : undefined,
    );
  }
}
```

- [ ] **Step 4: Wire them plus the events into `NavaraViewport.tsx`**

```tsx
// src/scene/NavaraViewport.tsx — additional imports
import { vector3ToGeodetic, radianToDegree } from "@navaramap/three";
import { useSelectionStore } from "../features/selection/selectionStore";
import { compileRulesToEvaluator } from "../features/rules/compileEvaluator";
import {
  applyPickIntent,
  narrowToMode,
  pickIntentFor,
  resolveFirstHit,
} from "./pickEventHandlers";
import {
  createThrottle,
  crsFromGeodetic,
  epsgForLayer,
} from "./cursorCrsReadout";
import {
  interactionHandles,
  syncHighlight,
  syncStyles,
  type InteractionHandle,
} from "./handleSync";
```

Add the (still empty in Part B) streaming registry ref next to `liveRef`, so
Task C13 only has to populate it:

```tsx
// src/scene/NavaraViewport.tsx — next to liveRef
/** Streaming layer handles, keyed by layer id. Empty until Task C13 opens a
 *  FlatCityBuf layer; every interaction path already reads it. */
const streamsRef = useRef(new Map<string, InteractionHandle>());
```

```tsx
// src/scene/NavaraViewport.tsx — inside the component, after the layers effect

// --- rules -> setStyle ---
const appliedStylesRef = useRef(new Map<string, string>());
useEffect(() => {
  if (!engineReady) return;
  syncStyles(
    layers,
    liveRef.current,
    compileRulesToEvaluator,
    appliedStylesRef.current,
  );
}, [engineReady, layers]);

// --- selection/hover -> setHighlight ---
const selections = useSelectionStore((s) => s.selections);
const hovered = useSelectionStore((s) => s.hovered);
useEffect(() => {
  if (!engineReady) return;
  syncHighlight(
    layers,
    liveRef.current,
    selections,
    hovered,
    streamsRef.current,
  );
}, [engineReady, layers, selections, hovered]);

// --- pointer events -> selection + cursor readout ---
useEffect(() => {
  const view = viewRef.current;
  if (!engineReady || !view) return;

  // ONE registry for interaction. In Part B it only ever contains static
  // handles; Task C13 fills `streamsRef` and the same closure then picks and
  // highlights streamed cells with no further change here.
  const handles = () =>
    interactionHandles(layers, liveRef.current, streamsRef.current);

  const throttleCursor = createThrottle(66);

  const onMove = (e: { x: number; y: number }) => {
    const store = useSelectionStore.getState();
    if (store.toolMode !== "select") return;
    const hit = narrowToMode(
      resolveFirstHit(handles(), { x: e.x, y: e.y }),
      store.mode,
    );
    applyPickIntent(
      pickIntentFor({ type: "move", shiftKey: false }, hit),
      store,
    );

    if (!onCursorPosition) return;
    throttleCursor(() => {
      const ecef = view.pickDepthPosition(e.x, e.y);
      if (!ecef) {
        onCursorPosition(null);
        return;
      }
      const lle = vector3ToGeodetic(ecef);
      const layerId = hit?.layerId ?? layers[0]?.id;
      const layer = layers.find((l) => l.id === layerId);
      const epsg = epsgForLayer(layer?.model.metadata.referenceSystem);
      onCursorPosition(
        epsg === null
          ? null
          : crsFromGeodetic(
              radianToDegree(lle.lng),
              radianToDegree(lle.lat),
              lle.height,
              epsg,
            ),
      );
    });
  };

  const onClick = (e: { x: number; y: number; shiftKey?: boolean }) => {
    const store = useSelectionStore.getState();
    if (store.toolMode !== "select") return;
    const hit = narrowToMode(
      resolveFirstHit(handles(), { x: e.x, y: e.y }),
      store.mode,
    );
    applyPickIntent(
      pickIntentFor({ type: "click", shiftKey: e.shiftKey === true }, hit),
      store,
    );
  };

  const onLeave = () => {
    useSelectionStore.getState().hover(null);
    onCursorPosition?.(null);
  };

  view.on("mousemove", onMove);
  view.on("click", onClick);
  view.on("mouseleave", onLeave);
  return () => {
    view.off("mousemove", onMove);
    view.off("click", onClick);
    view.off("mouseleave", onLeave);
  };
}, [engineReady, layers, onCursorPosition]);
```

Also destructure `onCursorPosition` in the component signature (Tasks B11a/B11b left it unused).

If the Task B1 spike set `PICK_PATH = "pickable-wrapper"`, additionally register `view.on("pick", ...)` and pass the `PickedFeatureLike` straight to `handle.resolvePick` instead of the screen point — `resolvePick` already accepts both.

```bash
cd /data2/hideba/multiroof-viewer && npx vitest run tests/unit/scene/handleSync.test.ts && npx tsc -b --noEmit
```

Expected: 8 passed, no type errors.

- [ ] **Step 5: Commit**

```bash
cd /data2/hideba/multiroof-viewer && git add src/scene/handleSync.ts src/scene/NavaraViewport.tsx tests/unit/scene/handleSync.test.ts && git commit -m "$(cat <<'EOF'
feat: wire picking, cursor readout, rule styling and highlight into the viewport

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task B16: M7.4 browser smoke — pick, rules, LoD, legend, inspector

**Files:**

- Modify: `docs/superpowers/research/2026-08-01-navara-spike-findings.md` (append the M7.4 smoke log)
- Modify: `docs/roadmap.md` (mark M7.3/M7.4 complete)

**Interfaces:**

- Consumes: everything built in B1–B15. Produces: no new code API.

- [ ] **Step 1: Full suite + type check before touching the browser**

```bash
cd /data2/hideba/multiroof-viewer && npx tsc -b --noEmit && npx vitest run && cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run
```

Expected: 0 failed files in both suites.

- [ ] **Step 2: Load the fixture and pick a building**

```bash
cd /data2/hideba/multiroof-viewer && npm run dev &
sleep 6
agent-browser open http://localhost:5173
agent-browser upload input[type=file] /data2/hideba/multiroof-viewer/fixtures/two-buildings.city.json
sleep 4
agent-browser mouse move 700 420
sleep 1
agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/m74-hover.png
agent-browser click canvas
sleep 1
agent-browser snapshot -i
agent-browser get text .status-bar
```

Expected observations:

- Hover screenshot shows one building tinted amber (`#fbbf24`); the other unchanged.
- After the click the building is orange (`#e8973f`) and the attribute panel lists `NL.IMBAG.Pand.0001` (or `...0002`).
- Status bar shows a cursor coordinate in the 85 000 / 446 000 range (RD New metres), not lat/lon.

- [ ] **Step 3: Surface mode + shift multi-select**

```bash
agent-browser find text "Surface" click
agent-browser click canvas
sleep 1
agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/m74-surface-pick.png
agent-browser eval "(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click', { clientX: r.left + 400, clientY: r.top + 380, shiftKey: true, bubbles: true })); return 'sent'; })()"
sleep 1
agent-browser snapshot -i
```

Expected: in surface mode only ONE face of the building is orange (not the whole solid); after the shift-click the inspector reports two selections.

- [ ] **Step 4: Rules, legend, LoD**

```bash
agent-browser find text "Rules" click
agent-browser snapshot -i
# add the "flat roofs" preset via the rules UI refs from the snapshot, then:
sleep 2
agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/m74-rules.png
agent-browser get text .legend-overlay
agent-browser find text "LoD" click
agent-browser select .lod-selector "1"
sleep 2
agent-browser get text .status-bar
agent-browser errors
```

Expected observations:

- Rule screenshot: matching roof faces switch to the rule color while walls keep their base grey; toggling the layer's rules off restores the base colors.
- Legend overlay lists the active rule name and color.
- Switching LoD 2 → 1 changes the triangle count in the status bar and the geometry visibly simplifies; switching back restores it.
- `agent-browser errors` is empty throughout.

- [ ] **Step 5: Record the smoke log, update the roadmap, commit**

Append to `docs/superpowers/research/2026-08-01-navara-spike-findings.md` a short "M7.4 smoke log" section with each expectation above marked pass/fail and the screenshot paths. Mark M7.3 and M7.4 complete in `docs/roadmap.md`.

Run the code review required by CLAUDE.md for a milestone (feature-dev:code-reviewer, high effort) over the Part B diff, address critical findings, then:

```bash
cd /data2/hideba/multiroof-viewer && git add docs/superpowers/research/2026-08-01-navara-spike-findings.md docs/roadmap.md && git commit -m "$(cat <<'EOF'
docs: record M7.3/M7.4 navara smoke results and milestone status

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Exit criteria for Part B

- `npx tsc -b --noEmit` clean; `npx vitest run` and `pnpm vitest run` (plugin) both 0 failed files.
- `fixtures/two-buildings.city.json` renders georeferenced on the photorealistic globe; fitAll/fitLayer/align buttons work.
- Hover, click, shift-multi-select, surface mode, rule colorization, LoD switching, visibility, triangle count and cursor CRS readout all verified in the browser.
- Streaming layers are deliberately skipped by `syncLayers` — M7.5 (`@cityjson/navara-flatcitybuf`) picks them up. The interaction registry (`interactionHandles`, `syncHighlight`, `totalTriangles`) already takes the second `streams` map and defaults it to empty, so Task C13 fills it without changing any of these signatures.
- The typed `PickStrategy` capability carries Task B1's `PICK_PATH` verdict; both branches are implemented and unit-tested, and the browser smoke exercised whichever one the constant selects.
- Still open for Part C: persistence schema bump (removes `src/scene/cameraStateBridge.ts`), solar/atmosphere date wiring, Google 3D Tiles layer, deletion of the R3F stack and `spike.html`, dependency pruning.

---

## M7.5 — `@cityjson/navara-flatcitybuf` streaming plugin

### Task C1: Scaffold the streaming package and move the Three-free pure modules

**Files:**

- Create: `/data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-flatcitybuf/package.json` (only if Task A4 left it absent), `.../src/constants.ts`, `.../src/tileGrid.ts`, `.../src/cellCache.ts`, `.../src/levelPolicy.ts`, `.../src/throttleGates.ts`, `.../src/bucketFeatures.ts`, `.../src/objectRecords.ts`, `.../src/workerProtocol.ts`, `.../src/index.ts`
- Test: `.../packages/navara-flatcitybuf/tests/tileGrid.test.ts`, `.../tests/cellCache.test.ts`, `.../tests/levelPolicy.test.ts`, `.../tests/throttleGates.test.ts`, `.../tests/bucketFeatures.test.ts`, `.../tests/objectRecords.test.ts`
- Delete (deferred to Task C22, not now): the app copies

**Interfaces:**

- Consumes: `@cityjson/navara-core` → `CityModel`, `CityObject`, `BBox3`, `Vec3`, `computeFootprintArea`, `computeRoofMetrics`, `RoofMetrics`, `Rule` (all moved there by Task A12); `@cityjson/flatcitybuf`
- Produces: `makeGrid(extent: BBox3): Grid`, `cellSize(grid, level): number`, `cellBBox(grid, key): [number,number,number,number]`, `cellCentre(grid, key, z): Vec3`, `keysCovering(grid, bbox, level): CellKey[]`, `ownerKey(grid, featureBBox, level): CellKey | null`, `CellCache<T>`, `CellStats`, `chooseLevel`, `buildLadder`, `lodForCellSize`, `LodSelection`, `shouldRefetch`, `CommitView`, `bucketFeatures`, `toObjectRecords`, `CellGeometry`, `ResidentObjectRecord`, `WorkerRequest`, `WorkerResponse`, `emptyCellGeometry`, `assertCellGeometry`, plus every constant in `constants.ts`

**Steps:**

- [ ] **Step 1: Confirm what Task A4 scaffolded.** Run `ls -R /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-flatcitybuf`. If `package.json` is missing, create it mirroring `navara-cityjson`'s, with `"name": "@cityjson/navara-flatcitybuf"`, `"dependencies": { "@cityjson/navara-core": "workspace:*", "@cityjson/navara-cityjson": "workspace:*", "@cityjson/flatcitybuf": "^0.3.0" }`, `"peerDependencies": { "@navaramap/three": "0.0.5" }`, and the same `tsup`/`vitest` scripts.
- [ ] **Step 2: Move the six pure modules verbatim.** `git -C /data2/hideba/multiroof-viewer show HEAD:src/features/streaming/constants.ts` etc. — copy `constants.ts` (lines 1–15), `tileGrid.ts` (lines 13–100, i.e. everything **except** `meshOffset`, lines 4–11, which dies with `sceneTransform`), `cellCache.ts` (1–123), `levelPolicy.ts` (1–60), `throttleGates.ts` (1–31), `bucketFeatures.ts` (1–47), `objectRecords.ts` (1–62), `workerProtocol.ts` (1–120) into `packages/navara-flatcitybuf/src/`. Changed lines only:
  - `tileGrid.ts` line 1–2 become:
    ```ts
    import { BASE_CELL_M, MIN_CELL_M } from "./constants";
    import type { BBox3, Vec3 } from "@cityjson/navara-core";
    ```
    and the `meshOffset` function plus its doc comment are dropped.
  - `bucketFeatures.ts` line 7 becomes `import type { CityModel, CityObject } from "@cityjson/navara-core";`
  - `objectRecords.ts` lines 11–13 become:
    ```ts
    import {
      computeFootprintArea,
      computeRoofMetrics,
      type CityModel,
    } from "@cityjson/navara-core";
    ```
  - `workerProtocol.ts` lines 1–2 become `import type { BBox3, RoofMetrics, Rule } from "@cityjson/navara-core";`
- [ ] **Step 3: Move the six test files.** Copy `tests/unit/features/streaming/{tileGrid,cellCache,levelPolicy,throttleGates,bucketFeatures,objectRecords}.test.ts` to `packages/navara-flatcitybuf/tests/`, rewriting every `../../../../src/features/streaming/X` import to `../src/X` and every `../../../../src/domain/...` import to `@cityjson/navara-core`. In `tileGrid.test.ts`, delete the `describe("meshOffset", ...)` block.
- [ ] **Step 4: Add `src/index.ts`.**
  ```ts
  export * from "./constants";
  export * from "./tileGrid";
  export * from "./cellCache";
  export * from "./levelPolicy";
  export * from "./throttleGates";
  export * from "./bucketFeatures";
  export * from "./objectRecords";
  export * from "./workerProtocol";
  ```
- [ ] **Step 5: Run the plugin suite.** `cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins && pnpm vitest run packages/navara-flatcitybuf` — expect all six moved files green (same counts as in the app: tileGrid minus the `meshOffset` cases).
- [ ] **Step 6: Commit (submodule first).**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "refactor: move Three-free streaming primitives into @cityjson/navara-flatcitybuf" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C3: Rewrite `viewportFootprint` against Navara pick rays

**Files:**

- Create: `/data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/viewportFootprint.ts`
- Test: `.../packages/navara-flatcitybuf/tests/viewportFootprint.test.ts`

**Interfaces:**

- Consumes: `EnuFrame`, `ecefToGeodetic` from `@cityjson/navara-core`; `MAX_FOOTPRINT_SPAN_M`, `T_MAX_M` from `./constants`
- Produces:
  ```ts
  export interface Ray {
    readonly origin: readonly [number, number, number];
    readonly direction: readonly [number, number, number];
  }
  export interface Footprint {
    readonly bbox: [number, number, number, number];
    readonly span: number;
    readonly centre: [number, number];
  }
  export interface FootprintDeps {
    readonly cornerRays: readonly [Ray, Ray, Ray, Ray];
    readonly frame: EnuFrame;
    readonly toSourceXY: (
      lngDeg: number,
      latDeg: number,
    ) => readonly [number, number] | null;
  }
  export const EPS: number;
  export function viewportFootprint(deps: FootprintDeps): Footprint | null;
  ```

**Design note (decided after reading `src/features/streaming/viewportFootprint.ts:29-80`):** the old code unprojected 4 NDC corners of a Three `PerspectiveCamera`, intersected each ray with a **horizontal Y plane** at `groundY`, and converted through `sceneToSource`. The Navara equivalent keeps the identical structure but changes the three engine-coupled pieces: rays come from `getPickRay` in ECEF (Task C4's adapter), the ground plane becomes the layer's **ENU up-plane through the frame origin** (a real tangent plane, not a Y plane — so `groundY` disappears; the frame's height carries it), and the CRS conversion is `ecefToGeodetic` + proj4 inverse instead of `sceneToSource`. The `T_MAX_M` clamp, the `EPS` band, the `MAX_FOOTPRINT_SPAN_M` rejection, and the overflow-safe centre are preserved verbatim.

**Steps:**

- [ ] **Step 1: Write the failing test** at `packages/navara-flatcitybuf/tests/viewportFootprint.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import {
    makeEnuFrame,
    enuToEcef,
    type EnuFrame,
  } from "@cityjson/navara-core";
  import { EPS, viewportFootprint, type Ray } from "../src/viewportFootprint";
  import { MAX_FOOTPRINT_SPAN_M, T_MAX_M } from "../src/constants";

  const FRAME: EnuFrame = makeEnuFrame(4.3571, 52.0116, 0);

  /** A ray from `enuEye` toward `enuTarget`, both in the frame's ENU metres. */
  function ray(
    enuEye: readonly [number, number, number],
    enuTarget: readonly [number, number, number],
  ): Ray {
    const o = enuToEcef(FRAME, enuEye);
    const t = enuToEcef(FRAME, enuTarget);
    const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]] as const;
    const len = Math.hypot(d[0], d[1], d[2]);
    return { origin: o, direction: [d[0] / len, d[1] / len, d[2] / len] };
  }

  /** Identity-ish projection: treat degrees as a linear local metric grid so
   *  the test asserts the footprint pipeline, not proj4. */
  const toSourceXY = (lng: number, lat: number) =>
    [(lng - FRAME.lngDeg) * 68000, (lat - FRAME.latDeg) * 111000] as const;

  describe("viewportFootprint", () => {
    it("gives a centred rectangle for a straight-down view", () => {
      const eye = [0, 0, 500] as const;
      const f = viewportFootprint({
        cornerRays: [
          ray(eye, [-400, -250, 0]),
          ray(eye, [400, -250, 0]),
          ray(eye, [400, 250, 0]),
          ray(eye, [-400, 250, 0]),
        ],
        frame: FRAME,
        toSourceXY,
      });
      expect(f).not.toBeNull();
      expect(f!.centre[0]).toBeCloseTo(0, 0);
      expect(f!.centre[1]).toBeCloseTo(0, 0);
      expect(f!.span).toBeCloseTo(800, -1);
    });

    it("clamps an up-looking (horizon) ray at T_MAX_M instead of running to infinity", () => {
      const eye = [0, 0, 300] as const;
      const horizon = ray(eye, [0, 100000, 300.0001]);
      const f = viewportFootprint({
        cornerRays: [
          ray(eye, [-200, -200, 0]),
          ray(eye, [200, -200, 0]),
          horizon,
          horizon,
        ],
        frame: FRAME,
        toSourceXY,
      });
      expect(f).not.toBeNull();
      expect(f!.bbox.every(Number.isFinite)).toBe(true);
      expect(f!.bbox[3]).toBeLessThanOrEqual(T_MAX_M + 1);
    });

    it("uses T_MAX_M — not the true, larger intersection — when a corner's real ground hit is beyond it", () => {
      const eye = [0, 0, 1000] as const;
      // dz/|d| shallow enough that the true hit is ~20 km out.
      const far = ray(eye, [0, 20000, 0]);
      const f = viewportFootprint({
        cornerRays: [far, far, ray(eye, [0, -10, 0]), ray(eye, [10, 0, 0])],
        frame: FRAME,
        toSourceXY,
      });
      expect(f).not.toBeNull();
      expect(f!.bbox[3]).toBeLessThan(T_MAX_M + 1);
    });

    it("rejects a footprint wider than MAX_FOOTPRINT_SPAN_M rather than returning an oversized rectangle", () => {
      const eye = [0, 0, 9000] as const;
      const f = viewportFootprint({
        cornerRays: [
          ray(eye, [-6000, -6000, 0]),
          ray(eye, [6000, -6000, 0]),
          ray(eye, [6000, 6000, 0]),
          ray(eye, [-6000, 6000, 0]),
        ],
        frame: FRAME,
        toSourceXY,
      });
      expect(f).toBeNull();
      expect(MAX_FOOTPRINT_SPAN_M).toBeLessThan(12000);
    });

    it("returns null when the projection refuses a corner (unprojectable coordinates)", () => {
      const eye = [0, 0, 500] as const;
      const f = viewportFootprint({
        cornerRays: [
          ray(eye, [-100, -100, 0]),
          ray(eye, [100, -100, 0]),
          ray(eye, [100, 100, 0]),
          ray(eye, [-100, 100, 0]),
        ],
        frame: FRAME,
        toSourceXY: () => null,
      });
      expect(f).toBeNull();
    });

    it("falls back to T_MAX_M when |dirUp| is inside the EPS band, matching the pre-migration branch", () => {
      const eye = [0, 0, 100] as const;
      const flat = ray(eye, [1e9, 0, 100]); // essentially parallel to the plane
      const f = viewportFootprint({
        cornerRays: [flat, flat, ray(eye, [-5, -5, 0]), ray(eye, [5, 5, 0])],
        frame: FRAME,
        toSourceXY,
      });
      expect(EPS).toBe(1e-6);
      expect(f).not.toBeNull();
      expect(f!.bbox[2]).toBeGreaterThan(1000); // clamped ray, not a 100 m hit
    });
  });
  ```

- [ ] **Step 2: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/viewportFootprint.test.ts` → `Failed to resolve import "../src/viewportFootprint"`.
- [ ] **Step 3: Implement `src/viewportFootprint.ts`.**

  ```ts
  /**
   * The ground area the camera can see, as a source-CRS AABB.
   *
   * Ported from the app's `src/features/streaming/viewportFootprint.ts`. The
   * ray source changed (Navara ECEF pick rays instead of NDC unprojection)
   * and the ground plane is now the layer's ENU tangent plane through its
   * frame origin instead of a horizontal Three Y-plane; the T_MAX_M clamp,
   * the EPS band, the MAX_FOOTPRINT_SPAN_M rejection and the overflow-safe
   * centre are unchanged.
   */
  import {
    ecefToEnu,
    ecefToGeodetic,
    type EnuFrame,
  } from "@cityjson/navara-core";
  import { MAX_FOOTPRINT_SPAN_M, T_MAX_M } from "./constants";

  export const EPS = 1e-6;

  export interface Ray {
    readonly origin: readonly [number, number, number];
    readonly direction: readonly [number, number, number];
  }

  export interface Footprint {
    readonly bbox: [number, number, number, number];
    readonly span: number;
    readonly centre: [number, number];
  }

  export interface FootprintDeps {
    readonly cornerRays: readonly [Ray, Ray, Ray, Ray];
    readonly frame: EnuFrame;
    readonly toSourceXY: (
      lngDeg: number,
      latDeg: number,
    ) => readonly [number, number] | null;
  }

  export function viewportFootprint(deps: FootprintDeps): Footprint | null {
    const pts: Array<[number, number]> = [];

    for (const r of deps.cornerRays) {
      // Work in ENU: the ground plane is z = 0 there, so the intersection is
      // the same one-line test the Three version used on its Y plane.
      const eye = ecefToEnu(deps.frame, r.origin);
      const tip = ecefToEnu(deps.frame, [
        r.origin[0] + r.direction[0],
        r.origin[1] + r.direction[1],
        r.origin[2] + r.direction[2],
      ]);
      const dir: [number, number, number] = [
        tip[0] - eye[0],
        tip[1] - eye[1],
        tip[2] - eye[2],
      ];

      let t = T_MAX_M;
      if (dir[2] < -EPS || (dir[2] > EPS && eye[2] < 0)) {
        const tHit = -eye[2] / dir[2];
        if (tHit > 0 && tHit <= T_MAX_M) t = tHit;
      }
      const hitEnu: [number, number, number] = [
        eye[0] + dir[0] * t,
        eye[1] + dir[1] * t,
        eye[2] + dir[2] * t,
      ];
      const m = deps.frame.matrix;
      const hitEcef: [number, number, number] = [
        m[0]! * hitEnu[0] + m[4]! * hitEnu[1] + m[8]! * hitEnu[2] + m[12]!,
        m[1]! * hitEnu[0] + m[5]! * hitEnu[1] + m[9]! * hitEnu[2] + m[13]!,
        m[2]! * hitEnu[0] + m[6]! * hitEnu[1] + m[10]! * hitEnu[2] + m[14]!,
      ];
      const g = ecefToGeodetic(hitEcef);
      const src = deps.toSourceXY(g.lngDeg, g.latDeg);
      if (!src || !Number.isFinite(src[0]) || !Number.isFinite(src[1])) {
        return null;
      }
      pts.push([src[0], src[1]]);
    }

    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const bbox: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    if (!Number.isFinite(span) || span > MAX_FOOTPRINT_SPAN_M) return null;

    return {
      bbox,
      span,
      // Overflow-safe midpoint, same as the pre-migration version.
      centre: [
        bbox[0] + (bbox[2] - bbox[0]) / 2,
        bbox[1] + (bbox[3] - bbox[1]) / 2,
      ],
    };
  }
  ```

- [ ] **Step 4: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/viewportFootprint.test.ts` → 6 passed.
- [ ] **Step 5: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "feat: rewrite viewportFootprint against ECEF pick rays and an ENU ground plane" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C4: `navaraRays.ts` — screen-corner rays from an injected pick-ray source

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/navaraRays.ts` (engine-free)
- Create: `.../packages/navara-flatcitybuf/src/engineRays.ts` (the only `@navaramap` import besides `plugin.ts`)
- Test: `.../packages/navara-flatcitybuf/tests/navaraRays.test.ts`

**Design (amended 2026-08-02 after external review):** two things changed from the drafted version. (1) There is no `(view as { canvas }).canvas` cast: the API report documents `canvas` as a **constructor option** of `ThreeView`, not a property of it, so the viewport size is passed in instead — `NavaraViewport` owns the container `div` and its `ResizeObserver`, and hands the plugin a `getViewportSize()` closure (Task C13). (2) `getPickRay` is injected rather than imported by the tested module, so `navaraRays.ts` is engine-free and `viewRaySource` — the real constructor, not a hand-written fake — is what the unit test exercises. `engineRays.ts` is a three-line binding over `@navaramap/three`.

**Interfaces:**

- Consumes: `Ray` from `./viewportFootprint`; (`engineRays.ts` only) `getPickRay` from `@navaramap/three`
- Produces:
  ```ts
  export interface ViewportSize {
    readonly width: number;
    readonly height: number;
  }
  export interface PickRaySource {
    readonly width: number;
    readonly height: number;
    getPickRay(x: number, y: number): unknown;
  }
  export function toRay(raw: unknown): Ray;
  export function cornerRays(src: PickRaySource): readonly [Ray, Ray, Ray, Ray];
  /** The real constructor: both seams injected, so it is Node-testable. */
  export function viewRaySource(deps: {
    getPickRay(x: number, y: number): unknown;
    getSize(): ViewportSize;
  }): PickRaySource;
  // engineRays.ts
  export function navaraViewRaySource(
    view: unknown,
    getSize: () => ViewportSize,
  ): PickRaySource;
  ```

**Steps:**

- [ ] **Step 1: Write the failing test** at `tests/navaraRays.test.ts`:

  ```ts
  import { describe, it, expect, vi } from "vitest";
  import {
    cornerRays,
    toRay,
    viewRaySource,
    type PickRaySource,
  } from "../src/navaraRays";

  function src(calls: Array<[number, number]>): PickRaySource {
    return {
      width: 800,
      height: 600,
      getPickRay(x, y) {
        calls.push([x, y]);
        return { origin: [x, y, 100], direction: [0, 0, -1] };
      },
    };
  }

  describe("toRay", () => {
    it("accepts {origin,direction} object vectors as well as array vectors", () => {
      const r = toRay({
        origin: { x: 1, y: 2, z: 3 },
        direction: { x: 0, y: 0, z: -1 },
      });
      expect(r.origin).toEqual([1, 2, 3]);
      expect(r.direction).toEqual([0, 0, -1]);
    });

    it("throws a diagnosable error for an unexpected payload shape instead of yielding NaNs downstream", () => {
      expect(() => toRay({ foo: 1 })).toThrow(/pick ray/i);
    });
  });

  describe("cornerRays", () => {
    it("samples the four viewport corners in the same order the footprint expects", () => {
      const calls: Array<[number, number]> = [];
      const rays = cornerRays(src(calls));
      expect(calls).toEqual([
        [0, 0],
        [800, 0],
        [800, 600],
        [0, 600],
      ]);
      expect(rays).toHaveLength(4);
      expect(rays[1].origin[0]).toBe(800);
    });
  });

  describe("viewRaySource", () => {
    it("reads its dimensions from the injected size provider on EVERY access, so a resize is picked up", () => {
      let size = { width: 800, height: 600 };
      const source = viewRaySource({
        getPickRay: () => ({ origin: [0, 0, 0], direction: [0, 0, -1] }),
        getSize: () => size,
      });
      expect([source.width, source.height]).toEqual([800, 600]);
      size = { width: 1024, height: 768 };
      expect([source.width, source.height]).toEqual([1024, 768]);
    });

    it("forwards screen coordinates to the injected getPickRay untouched", () => {
      const getPickRay = vi.fn(() => ({
        origin: [0, 0, 0],
        direction: [0, 0, -1],
      }));
      const source = viewRaySource({
        getPickRay,
        getSize: () => ({ width: 800, height: 600 }),
      });
      cornerRays(source);
      expect(getPickRay.mock.calls).toEqual([
        [0, 0],
        [800, 0],
        [800, 600],
        [0, 600],
      ]);
    });
  });
  ```

- [ ] **Step 2: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/navaraRays.test.ts` → module not found.
- [ ] **Step 3: Implement `src/navaraRays.ts` (no `@navaramap` import).**

  ```ts
  import type { Ray } from "./viewportFootprint";

  export interface ViewportSize {
    readonly width: number;
    readonly height: number;
  }

  export interface PickRaySource {
    readonly width: number;
    readonly height: number;
    getPickRay(x: number, y: number): unknown;
  }

  function vec(v: unknown): [number, number, number] | null {
    if (Array.isArray(v) && v.length >= 3) {
      return [Number(v[0]), Number(v[1]), Number(v[2])];
    }
    if (v && typeof v === "object" && "x" in v && "y" in v && "z" in v) {
      const o = v as { x: number; y: number; z: number };
      return [o.x, o.y, o.z];
    }
    return null;
  }

  /** Normalises whatever `getPickRay` returns into our own Ray, failing loudly
   *  (rather than producing NaN coordinates deep inside the footprint math)
   *  if the engine's payload shape ever changes. */
  export function toRay(raw: unknown): Ray {
    const r = raw as { origin?: unknown; direction?: unknown; dir?: unknown };
    const origin = vec(r?.origin);
    const direction = vec(r?.direction ?? r?.dir);
    if (!origin || !direction) {
      throw new Error(
        `unsupported pick ray payload: ${JSON.stringify(raw)?.slice(0, 120)}`,
      );
    }
    return { origin, direction };
  }

  export function cornerRays(
    src: PickRaySource,
  ): readonly [Ray, Ray, Ray, Ray] {
    const { width: w, height: h } = src;
    return [
      toRay(src.getPickRay(0, 0)),
      toRay(src.getPickRay(w, 0)),
      toRay(src.getPickRay(w, h)),
      toRay(src.getPickRay(0, h)),
    ];
  }

  /**
   * The production PickRaySource.
   *
   * Both seams are injected: `getPickRay` (so this module never imports
   * @navaramap/*) and `getSize` (because ThreeView documents `canvas` as a
   * CONSTRUCTOR OPTION, not a property — the viewport component owns the
   * container element and its ResizeObserver, and passes the measurement in).
   * `width`/`height` are getters, so a resize between commits is picked up
   * without rebuilding the source.
   */
  export function viewRaySource(deps: {
    getPickRay(x: number, y: number): unknown;
    getSize(): ViewportSize;
  }): PickRaySource {
    return {
      get width() {
        return deps.getSize().width;
      },
      get height() {
        return deps.getSize().height;
      },
      getPickRay: (x, y) => deps.getPickRay(x, y),
    };
  }
  ```

  And the engine binding, in its own file:

  ```ts
  // packages/navara-flatcitybuf/src/engineRays.ts
  /**
   * ENGINE BINDING MODULE — one of only two files in this package that import
   * @navaramap/*. Everything testable lives in navaraRays.ts.
   */
  import { getPickRay } from "@navaramap/three";
  import {
    viewRaySource,
    type PickRaySource,
    type ViewportSize,
  } from "./navaraRays";

  export function navaraViewRaySource(
    view: unknown,
    getSize: () => ViewportSize,
  ): PickRaySource {
    return viewRaySource({
      getPickRay: (x, y) =>
        (getPickRay as (v: unknown, x: number, y: number) => unknown)(
          view,
          x,
          y,
        ),
      getSize,
    });
  }
  ```

- [ ] **Step 4: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/navaraRays.test.ts` → 5 passed. Then confirm the isolation rule: `grep -rn "@navaramap" packages/navara-flatcitybuf/src` must list only `engineRays.ts` (and, after Task C11, `plugin.ts`), and `grep -rn "@navaramap" packages/navara-flatcitybuf/tests` must be empty.
- [ ] **Step 5: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "feat: add a normalising pick-ray adapter for footprint corners, with injected engine + size seams" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C4b: SPIKE — worker bundling through the plugin package (decision checkpoint)

Task B1 proved the **engine's** WASM/assets survive dev and a production bundle. It said nothing about **workers inside a plugin package consumed through the app's Vite source alias** — which is exactly what Task C5's `new Worker(new URL("./fcb.worker.ts", import.meta.url), { type: "module" })` will be, and the drafted C5 asserted "Vite/tsup both resolve this URL form" with nothing behind it. A worker that fails to resolve fails at runtime, in the browser, after the whole streaming engine has been moved. Prove the pattern first with a trivial worker; C5 then copies the recorded configuration.

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/spike/ping.worker.ts`, `.../src/spike/pingClient.ts`
- Create: `worker-spike.html` (app root), `src/spike/workerBundlingSpike.ts` (app)
- Modify: `vite.config.ts` (only if the spike proves a change is needed)
- Delete at the end of this task: all four spike files

**Interfaces:**

- Consumes: nothing (the point is to have no dependencies).
- Produces: a written verdict `WORKER_URL_FORM_OK` plus the exact Vite configuration required, appended to `docs/superpowers/research/2026-08-01-navara-spike-findings.md`.

**Steps:**

- [ ] **Step 1: Create the trivial worker inside the plugin package**

  ```ts
  // packages/navara-flatcitybuf/src/spike/ping.worker.ts
  // Deliberately dependency-free: this spike tests MODULE RESOLUTION, not logic.
  self.onmessage = (e: MessageEvent<{ n: number }>) => {
    (self as unknown as Worker).postMessage({ pong: e.data.n * 2 });
  };
  export {};
  ```

  ```ts
  // packages/navara-flatcitybuf/src/spike/pingClient.ts
  /** The exact URL form Task C5's workerClient uses, in the exact package. */
  export function ping(n: number): Promise<number> {
    const worker = new Worker(new URL("./ping.worker.ts", import.meta.url), {
      type: "module",
    });
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ pong: number }>) => {
        resolve(e.data.pong);
        worker.terminate();
      };
      worker.onerror = (e) => {
        reject(new Error(`worker failed: ${e.message}`));
        worker.terminate();
      };
      worker.postMessage({ n });
    });
  }
  ```

  Export it from the package barrel for the duration of the spike:
  `export { ping } from "./spike/pingClient";` in `packages/navara-flatcitybuf/src/index.ts`.

- [ ] **Step 2: Consume it from the app through the Vite source alias**

  ```html
  <!-- worker-spike.html -->
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Plugin worker bundling spike</title>
    </head>
    <body>
      <pre id="out">running…</pre>
      <script type="module" src="/src/spike/workerBundlingSpike.ts"></script>
    </body>
  </html>
  ```

  ```ts
  // src/spike/workerBundlingSpike.ts
  import { ping } from "@cityjson/navara-flatcitybuf";

  const out = document.getElementById("out")!;
  ping(21)
    .then((pong) => {
      out.textContent = `WORKER_OK pong=${pong}`;
      (globalThis as Record<string, unknown>).__workerSpike = {
        ok: true,
        pong,
      };
    })
    .catch((e: Error) => {
      out.textContent = `WORKER_FAIL ${e.message}`;
      (globalThis as Record<string, unknown>).__workerSpike = {
        ok: false,
        error: e.message,
      };
    });
  ```

  Add the app dependency + alias if Task C1 has not already:

  ```bash
  npm pkg set dependencies.@cityjson/navara-flatcitybuf="file:packages/cityjson-navara-plugins/packages/navara-flatcitybuf" && npm install
  ```

  and the matching `resolve.alias` entry in `vite.config.ts` pointing at the package's `src/index.ts`, next to the Part A/B entries.

- [ ] **Step 3: Verify in DEV**

  ```bash
  cd /data2/hideba/multiroof-viewer && npm run dev &
  sleep 6
  agent-browser open http://localhost:5173/worker-spike.html
  sleep 3
  agent-browser eval "JSON.stringify(window.__workerSpike)"
  agent-browser errors
  ```

  Expected: `{"ok":true,"pong":42}` and no console errors. A failure here is almost always one of: the alias resolving to `dist/` instead of `src/`, `optimizeDeps` pre-bundling the package (add it to `optimizeDeps.exclude`), or the worker being emitted as an IIFE (`worker: { format: "es" }` in `vite.config.ts`). Record whichever fix was needed.

- [ ] **Step 4: Verify in a PRODUCTION build + preview**

  ```bash
  cd /data2/hideba/multiroof-viewer && npm run build 2>&1 | tail -20
  npx vite preview --port 4173 &
  sleep 4
  agent-browser open http://localhost:4173/worker-spike.html
  sleep 3
  agent-browser eval "JSON.stringify(window.__workerSpike)"
  agent-browser errors
  agent-browser eval "performance.getEntriesByType('resource').filter(r=>/worker/i.test(r.name)).map(r=>r.name)"
  ```

  Expected: `{"ok":true,"pong":42}` again; the resource list shows a hashed worker chunk actually fetched (not a 404); `worker-spike.html` is among the build's emitted inputs (add it to `build.rollupOptions.input` if Vite skipped it).

- [ ] **Step 5: DECISION CHECKPOINT — record and clean up**

  Append to `docs/superpowers/research/2026-08-01-navara-spike-findings.md` a "Worker bundling (Task C4b)" section with: the dev result, the preview result, the emitted chunk name, and the exact `vite.config.ts` diff required (or "none"). Set `WORKER_URL_FORM_OK`.
  - **If false: STOP and re-plan Task C5's worker packaging** before moving the FCB worker. The documented alternatives, in order of preference: (a) `worker: { format: "es" }` plus `optimizeDeps.exclude` for the package; (b) keep `fcb.worker.ts` in the **app** (`src/features/streaming/fcb.worker.ts`) and have the plugin accept an injected `createWorker: () => Worker` factory — the plugin stays engine-agnostic and the app owns the bundling; (c) ship a pre-built worker asset from the package's tsup output. Choose one and rewrite C5 accordingly.

  Then delete the spike, which has served its purpose:

  ```bash
  cd /data2/hideba/multiroof-viewer
  rm -rf packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/spike
  git rm worker-spike.html src/spike/workerBundlingSpike.ts
  ```

  and remove the `export { ping } ...` line from the package barrel.

- [ ] **Step 6: Commit.**

  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "chore: worker bundling spike (removed); findings recorded in the app repo" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  cd /data2/hideba/multiroof-viewer && git add -A && git commit -m "$(cat <<'EOF'
  chore: verify plugin-package worker bundling in dev and production preview

  Records WORKER_URL_FORM_OK and the required Vite configuration before the FCB
  worker moves into @cityjson/navara-flatcitybuf (Task C5).

  Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task C5: Move `workerClient` + `fcb.worker` (B3 rollback preserved)

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/workerClient.ts`, `.../src/fcb.worker.ts`
- Test: `.../packages/navara-flatcitybuf/tests/workerClient.test.ts`, `.../tests/fcbWorkerCache.test.ts`, `.../tests/fcbWorkerTraversal.test.ts`

**Interfaces:**

- Consumes: `@cityjson/navara-core` → `buildCityMeshArrays`, `buildRuleColorsFromArrays`, `matchRule`, `computeRoofMetrics`, `Rule` (all four moved to core by Task A12 — the worker cannot import from the app), `makeEnuFrame`, `projectPositionsToEnu` (Task A13b), `dequantizeAll`, `mapMetadata`, `mergeBBox`, `parseCityObject`, `checkAdmission`, `headerModel`, `openFcb`, `FcbHeaderModel`, `CityJSONRoot`, `CityJSONFeature`; `@cityjson/flatcitybuf` → `FcbReader`, `toCityJSONMetadata`; `proj4`
- Produces: `class WorkerClient { newEpoch(): number; isCurrent(e: number): boolean; send(msg, transfer?): Promise<WorkerResponse>; notify(msg): void; sendStreaming(msg, onMessage): Promise<void>; terminate(): void }`

**Steps:**

- [ ] **Step 1: Move the tests first (B3 lands as a regression test before the code).** Copy `tests/unit/features/streaming/{workerClient,fcbWorkerCache,fcbWorkerTraversal}.test.ts` into `packages/navara-flatcitybuf/tests/`, rewriting imports: `../../../../src/features/streaming/X` → `../src/X`; `../../../../src/domain/citymodel/...` → `@cityjson/navara-core`; `../../../../src/scene/buildCityMesh` → `@cityjson/navara-core`; `../../../../src/scene/applyRuleColors` → `@cityjson/navara-core`. The two B3 cases (`fcbWorkerCache.test.ts:616` "rolls back a cell already added by THIS fetch…" and `:685` "rolls back a same-key REFETCH to the PRIOR value…") move unchanged.
- [ ] **Step 2: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/fcbWorkerCache.test.ts` → `Failed to resolve import "../src/fcb.worker"`.
- [ ] **Step 3: Move `workerClient.ts` verbatim** (`src/features/streaming/workerClient.ts:1-146`), changed lines only:
  - line 8–9 → `import { assertCellGeometry } from "./workerProtocol";` / `import type { WorkerRequest, WorkerResponse } from "./workerProtocol";` (unchanged paths — they resolve inside the package now).
  - line 48 stays `new Worker(new URL("./fcb.worker.ts", import.meta.url), { type: "module" })` **only if Task C4b set `WORKER_URL_FORM_OK = true`**; apply whatever `vite.config.ts` change C4b recorded, and add above the line the comment `// URL form + Vite config validated by the Task C4b bundling spike (dev and production preview).` If C4b chose alternative (b) or (c), implement that instead — the rest of this task is unaffected because `WorkerClient` only needs _a_ `Worker`.
- [ ] **Step 4: Move `fcb.worker.ts` verbatim** (`src/features/streaming/fcb.worker.ts:1-398`), changed lines only — the import block (lines 6–37) becomes:

  ```ts
  import { FcbReader, toCityJSONMetadata } from "@cityjson/flatcitybuf";
  import {
    buildCityMeshArrays,
    buildRuleColorsFromArrays,
    checkAdmission,
    dequantizeAll,
    headerModel,
    mapMetadata,
    mergeBBox,
    openFcb,
    parseCityObject,
    type BBox3,
    type CityJSONFeature,
    type CityJSONObject,
    type CityJSONRoot,
    type CityModel,
    type CityObject,
  } from "@cityjson/navara-core";
  import { bucketFeatures } from "./bucketFeatures";
  import { toObjectRecords } from "./objectRecords";
  import { makeGrid, cellCentre, type CellKey, type Grid } from "./tileGrid";
  import type {
    CellGeometry,
    WorkerRequest,
    WorkerResponse,
  } from "./workerProtocol";
  ```

  Everything from line 39 (`interface CachedCell`) to line 398 is byte-identical **except** the ENU placement addition in Step 4b below, including the `touchedKeys`/`rollbackTouchedKeys` B3 block (lines 149–156, 232, 275–283, 312–315) and the `cellCentre(grid, key, 0)` per-cell origin (line 242) — that origin is what Task C8's cell placement must match.

- [ ] **Step 4b: Place cell vertices in exact ENU inside the worker (the one non-verbatim change).** Today the worker emits vertices as source-CRS deltas from `cellCentre(grid, key, 0)` and the renderer treats them as ENU metres. That is wrong for a projected CRS (scale factor + grid convergence — see Task A13b) and it also ignores the vertical datum. The transform is per-vertex and therefore belongs off the main thread, which is exactly where this code already is. Add to the import block:

  ```ts
  import { makeEnuFrame, projectPositionsToEnu } from "@cityjson/navara-core";
  ```

  In the `open` handler, once `header.epsg` is known, store the layer's vertical offset once:

  ```ts
  // The plugin resolved the geoid undulation (or the caller's override)
  // BEFORE sending `open`, precisely so the worker can bake every cell in the
  // right frame from the first fetch — the worker never samples it itself and
  // never needs network access. See Global Constraints -> Vertical datum.
  const heightOffsetM = msg.heightOffset ?? 0;
  ```

  Then immediately after the `buildCityMeshArrays(...)` call that produces a cell's arrays (the call whose `originOffset` is `cellCentre(grid, key, 0)`), add:

  ```ts
  const centre = cellCentre(grid, key, 0);
  const [cellLng, cellLat] = toLngLat(centre[0], centre[1]);
  // The cell's own frame, identical to what cellMeshes.cellFrame() builds on
  // the main thread (Task C8) — one implementation, one result.
  const frame = makeEnuFrame(cellLng, cellLat, heightOffsetM);
  projectPositionsToEnu(arrays.positions, {
    originOffset: centre,
    epsg: header.epsg,
    frame,
    heightOffset: heightOffsetM,
  });
  ```

  where `toLngLat` is the worker's own `proj4(`EPSG:${header.epsg}`, "WGS84", …)` closure, built once in the `open` handler next to `heightOffsetM`. `WorkerRequest`'s `open` variant gains `readonly heightOffset?: number` in `workerProtocol.ts` (Task C1's file) — add it there and to the `open` message the plugin sends (Task C11). The worker itself performs no geoid lookup: it receives a number.

  Regression net: add one case to `tests/fcbWorkerCache.test.ts` asserting that a cell whose features sit several kilometres from the cell centre comes back with positions matching `sourceToEnuPoint` for the same inputs, rather than raw source deltas. Without it, the transform can silently regress to the shortcut.

- [ ] **Step 5: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/workerClient.test.ts packages/navara-flatcitybuf/tests/fcbWorkerCache.test.ts packages/navara-flatcitybuf/tests/fcbWorkerTraversal.test.ts` → workerClient 12, fcbWorkerCache **16** (15 moved + the Step 4b ENU regression case), fcbWorkerTraversal 4.
- [ ] **Step 6: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "refactor: move the FCB worker and its epoch-guarded client into the streaming plugin (B3 rollback tests move first)" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C6: Move the commit planner (B4 swap budget preserved)

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/commitPlanner.ts`
- Test: `.../packages/navara-flatcitybuf/tests/commitPlanner.test.ts`

**Interfaces:**

- Consumes: `./levelPolicy`, `./tileGrid`, `./cellCache`, `./throttleGates`, `./constants`, `./workerProtocol`
- Produces: `lodToWireLabel(sel): string | null`, `resolveLod(cfg: { lodMode; selectedLod }, ladder, cellSizeM): LodSelection`, `lodSelectionEquals(a,b): boolean`, `ladderEquals(a,b): boolean`, `cellStatsFromGeometry(g: CellGeometry): CellStats`, `PlanCommitInput`, `CommitPlan`, `planCommit(input): CommitPlan`, `FetchedCell`, `commitNormal(cache, desired, fetched): CellKey[]`, `commitSwap(cache, newCover, fetched): CellKey[]`

**Steps:**

- [ ] **Step 1: Extract the planner tests first.** Create `tests/commitPlanner.test.ts` from `tests/unit/features/streaming/useTileStreaming.test.ts` lines 1–95 (helpers `geom`, `fakeEntry`) plus the `describe` blocks `lodToWireLabel` (98–108), `resolveLod` (110–128), `lodSelectionEquals` (129–155), `ladderEquals` (156–173), `cellStatsFromGeometry` (174–188), `planCommit` (229–426), `commitNormal` (427–455) and `commitSwap` (456–495, including the **B4** case at line 474 "also enforces the resident budget on the NEW cover"). Rewrite imports to:
  ```ts
  import { CellCache } from "../src/cellCache";
  import type { CellEntry } from "../src/streamLayer";
  import type { CellGeometry } from "../src/workerProtocol";
  import {
    cellStatsFromGeometry,
    commitNormal,
    commitSwap,
    ladderEquals,
    lodSelectionEquals,
    lodToWireLabel,
    planCommit,
    resolveLod,
  } from "../src/commitPlanner";
  ```
  Drop the `groundYFromBBox` describe block (189–228) entirely — the ENU tangent plane replaced the shared ground-Y (`groundYFromBBox` has no successor).
- [ ] **Step 2: Declare `CellEntry` in `src/streamLayer.ts`** (stub file for now, fleshed out in Tasks C10a/C10b) so the planner test type-checks:

  ```ts
  import type { CellGeometry, ResidentObjectRecord } from "./workerProtocol";
  import type { Rule } from "@cityjson/navara-core";

  /** Moved verbatim from the app's streamStore.ts:46-65 — including the
   *  builtWithRules* snapshot the B2 stale-recolor guard depends on. */
  export interface CellEntry {
    readonly geometry: CellGeometry;
    readonly objects: ReadonlyArray<ResidentObjectRecord>;
    readonly surfaceAttrKeys: ReadonlyArray<string>;
    readonly lodsSeen: ReadonlyArray<string>;
    readonly builtWithRulesEnabled: boolean;
    readonly builtWithRules: ReadonlyArray<Rule>;
  }

  export function emptyCellEntry(
    rulesEnabled: boolean,
    rules: ReadonlyArray<Rule>,
  ): CellEntry {
    return {
      geometry: emptyCellGeometry(),
      objects: [],
      surfaceAttrKeys: [],
      lodsSeen: [],
      builtWithRulesEnabled: rulesEnabled,
      builtWithRules: rules,
    };
  }
  ```

  with `import { emptyCellGeometry } from "./workerProtocol";`.

- [ ] **Step 3: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/commitPlanner.test.ts` → `Failed to resolve import "../src/commitPlanner"`.
- [ ] **Step 4: Create `src/commitPlanner.ts`** by moving `src/features/streaming/useTileStreaming.ts` lines 64–270 verbatim (`lodToWireLabel`, `resolveLod`, `lodSelectionEquals`, `ladderEquals`, `cellStatsFromGeometry`, `PlanCommitInput`, `CommitPlan`, `planCommit`, `FetchedCell`, `commitNormal`, `commitSwap` — the B4 `evictToBudget()` on line 268 included). Changed lines only:
  - The import block becomes:
    ```ts
    import { CellCache, type CellStats } from "./cellCache";
    import {
      chooseLevel,
      cellSize,
      lodForCellSize,
      type LodSelection,
    } from "./levelPolicy";
    import { keysCovering, type CellKey, type Grid } from "./tileGrid";
    import { shouldRefetch, type CommitView } from "./throttleGates";
    import { VIEWPORT_FEATURE_BUDGET } from "./constants";
    import type { CellGeometry } from "./workerProtocol";
    import type { CellEntry } from "./streamLayer";
    import type { Footprint } from "./viewportFootprint";
    ```
  - `resolveLod`'s first parameter type changes from `Pick<Layer, "lodMode" | "selectedLod">` to a local, store-free shape:
    ```ts
    export interface LodConfig {
      readonly lodMode: "auto" | "manual";
      readonly selectedLod: string | null;
    }
    export function resolveLod(
      cfg: LodConfig,
      ladder: ReadonlyArray<string>,
      cellSizeM: number,
    ): LodSelection {
    ```
    (body unchanged; `layer.` → `cfg.`).
  - `groundYFromBBox` (lines 120–135) is **not** moved.
- [ ] **Step 5: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/commitPlanner.test.ts` → 25 passed (the planner/commit subset of the old 90-case file).
- [ ] **Step 6: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "refactor: move the streaming commit planner into the plugin, decoupled from layerStore (B4 budget test moves with it)" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C7: Camera-event settle controller (OrbitControls `change` → Navara `move*`/`idle`)

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/settleController.ts`
- Test: `.../packages/navara-flatcitybuf/tests/settleController.test.ts`

**Interfaces:**

- Consumes: `SETTLE_MS` from `./constants`
- Produces:
  ```ts
  export interface SettleController {
    onMoveStart(): void;
    onMove(): void;
    onMoveEnd(): void;
    onIdle(): void;
    dispose(): void;
  }
  export function createSettleController(opts: {
    readonly settleMs: number;
    readonly onFirstChange: () => void;
    readonly onSettle: () => void;
  }): SettleController;
  ```

**PREREQUISITE — Task B1 Step 7's measured camera trace.** Do not start this task until `docs/superpowers/research/2026-08-01-navara-spike-findings.md` records `CAMERA_BURST_SHAPE` and `PROGRAMMATIC_MOVE_EMITS` from a real browser. The cadence below is a _hypothesis_ the API report does not confirm; B1 measures it for drag-with-inertia, `flyTo`, `setCamera` and `resize`. Reconcile before writing code:

- If `CAMERA_BURST_SHAPE` shows **more than one** `movestart … moveend` pair per user gesture (e.g. inertia emits a second burst after pointer-up), the "settles `settleMs` after moveend" case below must instead treat a new `movestart` inside the armed window as a continuation — add a case `"a second burst arriving inside the armed window defers the settle rather than committing twice"` and make `onMoveStart` clear the armed timer (it already does).
- If `PROGRAMMATIC_MOVE_EMITS` is **true**, add the `suppress()` method described in Step 3b and its test case; Task C20 then brackets its `setCameraState` call with it. If it is false, skip Step 3b entirely and note that in the commit message.

Record which branch was taken at the top of `settleController.ts` as a comment citing the findings doc, so a future reader can tell a measured decision from an assumed one.

**Cadence decision (spec §8 open question):** OrbitControls fired `change` continuously while damping decayed, so the old controller (`useTileStreaming.ts:290-316`) was a pure debounce. Navara emits `movestart` once, `move` per frame of interaction, `moveend` once when interaction ends, and a view-level `idle` after `idleThreshold` (default 100 ms) with `animation: false`. Mapping: `movestart` → `onFirstChange` (abort in-flight work immediately, as before); `move` → keep the debounce timer alive (so a long drag never commits mid-drag); `moveend` → arm the `SETTLE_MS` debounce; `idle` → **flush** an armed debounce immediately (the engine has already proven the camera is at rest, so waiting out the remaining `SETTLE_MS` only adds latency). `idle` with nothing armed is ignored, so idle ticks during a static scene never re-commit — this is what keeps commit cadence at or below the pre-migration rate.

**Steps:**

- [ ] **Step 1: Write the failing test** at `tests/settleController.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { createSettleController } from "../src/settleController";

  describe("createSettleController", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("calls onFirstChange synchronously on movestart, and not onSettle", () => {
      const onFirstChange = vi.fn();
      const onSettle = vi.fn();
      const c = createSettleController({
        settleMs: 350,
        onFirstChange,
        onSettle,
      });
      c.onMoveStart();
      expect(onFirstChange).toHaveBeenCalledTimes(1);
      expect(onSettle).not.toHaveBeenCalled();
    });

    it("does not call onFirstChange again for `move` ticks inside the same interaction", () => {
      const onFirstChange = vi.fn();
      const c = createSettleController({
        settleMs: 350,
        onFirstChange,
        onSettle: vi.fn(),
      });
      c.onMoveStart();
      c.onMove();
      c.onMove();
      expect(onFirstChange).toHaveBeenCalledTimes(1);
    });

    it("never settles while `move` ticks keep arriving — no commit mid-drag", () => {
      const onSettle = vi.fn();
      const c = createSettleController({
        settleMs: 350,
        onFirstChange: vi.fn(),
        onSettle,
      });
      c.onMoveStart();
      for (let i = 0; i < 10; i++) {
        c.onMove();
        vi.advanceTimersByTime(300);
      }
      expect(onSettle).not.toHaveBeenCalled();
    });

    it("settles settleMs after moveend", () => {
      const onSettle = vi.fn();
      const c = createSettleController({
        settleMs: 350,
        onFirstChange: vi.fn(),
        onSettle,
      });
      c.onMoveStart();
      c.onMoveEnd();
      vi.advanceTimersByTime(349);
      expect(onSettle).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onSettle).toHaveBeenCalledTimes(1);
    });

    it("idle FLUSHES an armed settle immediately instead of waiting out settleMs", () => {
      const onSettle = vi.fn();
      const c = createSettleController({
        settleMs: 350,
        onFirstChange: vi.fn(),
        onSettle,
      });
      c.onMoveStart();
      c.onMoveEnd();
      c.onIdle();
      expect(onSettle).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(onSettle).toHaveBeenCalledTimes(1); // the armed timer was cleared
    });

    it("ignores idle when nothing is armed — a static scene's idle ticks never re-commit", () => {
      const onSettle = vi.fn();
      const c = createSettleController({
        settleMs: 350,
        onFirstChange: vi.fn(),
        onSettle,
      });
      c.onIdle();
      c.onIdle();
      expect(onSettle).not.toHaveBeenCalled();
    });

    it("treats the interaction after a settle as a new burst (onFirstChange fires again)", () => {
      const onFirstChange = vi.fn();
      const c = createSettleController({
        settleMs: 350,
        onFirstChange,
        onSettle: vi.fn(),
      });
      c.onMoveStart();
      c.onMoveEnd();
      vi.advanceTimersByTime(350);
      c.onMoveStart();
      expect(onFirstChange).toHaveBeenCalledTimes(2);
    });

    it("dispose cancels an armed settle — onSettle never fires", () => {
      const onSettle = vi.fn();
      const c = createSettleController({
        settleMs: 350,
        onFirstChange: vi.fn(),
        onSettle,
      });
      c.onMoveStart();
      c.onMoveEnd();
      c.dispose();
      vi.advanceTimersByTime(1000);
      expect(onSettle).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/settleController.test.ts` → module not found.
- [ ] **Step 3: Implement `src/settleController.ts`.**

  ```ts
  /**
   * "Interaction has stopped" for the streaming driver.
   *
   * Pre-migration this debounced OrbitControls' `change` event, which fired
   * continuously while damping decayed. Navara instead emits a discrete
   * movestart/move/moveend triple plus a view-level `idle`, so:
   *   movestart -> abort in-flight work (onFirstChange), start a burst
   *   move      -> stay armed but keep pushing the deadline out (no mid-drag commit)
   *   moveend   -> arm the settleMs debounce
   *   idle      -> flush an armed debounce now; ignored when nothing is armed
   */
  export interface SettleController {
    onMoveStart(): void;
    onMove(): void;
    onMoveEnd(): void;
    onIdle(): void;
    dispose(): void;
  }

  export function createSettleController(opts: {
    readonly settleMs: number;
    readonly onFirstChange: () => void;
    readonly onSettle: () => void;
  }): SettleController {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let armed = false;
    let inBurst = false;

    const clear = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const fire = (): void => {
      clear();
      armed = false;
      inBurst = false;
      opts.onSettle();
    };

    return {
      onMoveStart() {
        if (!inBurst) {
          inBurst = true;
          opts.onFirstChange();
        }
        clear();
        armed = false;
      },
      onMove() {
        // A `move` during an armed window means the interaction resumed;
        // disarm so a stale deadline can't commit mid-drag.
        clear();
        armed = false;
        if (!inBurst) {
          inBurst = true;
          opts.onFirstChange();
        }
      },
      onMoveEnd() {
        clear();
        armed = true;
        timer = setTimeout(fire, opts.settleMs);
      },
      onIdle() {
        if (armed) fire();
      },
      dispose() {
        clear();
        armed = false;
        inBurst = false;
      },
    };
  }
  ```

- [ ] **Step 3b: (only if `PROGRAMMATIC_MOVE_EMITS` is true) add `suppress()`**

  A camera restore (`setCameraState`, Task C20) or a `fitAll` must not look like a user gesture, or restoring a share link would immediately fire a streaming commit — the exact "no commits after programmatic camera restoration" property. Add to the interface `suppress<T>(fn: () => T): T` and to the implementation a `suppressed` counter that `onMoveStart`/`onMove`/`onMoveEnd`/`onIdle` check first and ignore while non-zero, decremented in a `finally`. Because `flyTo` is animated, `suppress` also takes an optional trailing quiet window: `suppress(fn, quietMs)` keeps ignoring events for `quietMs` after `fn` returns. Test cases to add:

  ```ts
  it("ignores a programmatic camera burst wrapped in suppress()", () => {
    const onSettle = vi.fn();
    const onFirstChange = vi.fn();
    const c = createSettleController({
      settleMs: 350,
      onFirstChange,
      onSettle,
    });
    c.suppress(() => {
      c.onMoveStart();
      c.onMove();
      c.onMoveEnd();
    });
    vi.advanceTimersByTime(1000);
    expect(onFirstChange).not.toHaveBeenCalled();
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("keeps ignoring for the trailing quiet window, so an animated flyTo cannot leak a commit", () => {
    const onSettle = vi.fn();
    const c = createSettleController({
      settleMs: 350,
      onFirstChange: vi.fn(),
      onSettle,
    });
    c.suppress(() => {}, 2000);
    c.onMoveStart();
    c.onMoveEnd();
    vi.advanceTimersByTime(1000);
    expect(onSettle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    c.onMoveStart();
    c.onMoveEnd();
    vi.advanceTimersByTime(400);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });
  ```

- [ ] **Step 4: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/settleController.test.ts` → 8 passed (10 if Step 3b applied).
- [ ] **Step 5: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "feat: drive the streaming settle machine from Navara movestart/move/moveend/idle" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C8: Per-cell mesh handles + B1 content-changed resync

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/cellMeshes.ts`
- Test: `.../packages/navara-flatcitybuf/tests/cellMeshes.test.ts`

**Interfaces:**

- Consumes: `@cityjson/navara-cityjson` → `addCityMeshArrays(view, opts): CityMeshHandle` (built in Task B7, Step 4), where `CityMeshHandle = { setColors(c: Float32Array): void; setVisible(v: boolean): void; triangleCount(): number; delete(): void; readonly ref: unknown }`; `@cityjson/navara-core` → `makeEnuFrame`, `PickingIndex`; `./tileGrid` → `cellCentre`
- Produces:
  ```ts
  export interface CellMeshFactory {
    create(key: CellKey, entry: CellEntry, frame: EnuFrame): CityMeshHandle;
  }
  export interface CellMesh {
    readonly handle: CityMeshHandle;
    readonly pickingIndex: PickingIndex;
    readonly baseColors: Float32Array;
    ruleColors: Float32Array | null;
    /** Identity of the CellEntry this mesh was built from (B1). */
    sourceEntry: CellEntry;
  }
  export function cellFrame(
    grid: Grid,
    key: CellKey,
    toLngLat: (x: number, y: number) => readonly [number, number],
    heightOffsetM?: number,
  ): EnuFrame;
  export function syncCellMeshes(ctx: SyncCtx): Map<CellKey, CellKey[]>; // -> stale keys needing recolor
  export function rulesStale(
    entry: CellEntry,
    rules: ReadonlyArray<Rule>,
    rulesEnabled: boolean,
  ): boolean;
  ```

**Cell placement decision (amended 2026-08-02 after external review):** the worker no longer emits raw source-CRS deltas. Per Task C5 Step 4b it emits **exact local-ENU metres**: each vertex goes `source (x, y, z) → proj4 (source EPSG → WGS84) → height + heightOffset → geodeticToEcef → inverse ENU frame`, where the frame is `makeEnuFrame(cellLng, cellLat, heightOffset)` at the cell centre. Placement on this side is therefore just that same frame, rebuilt identically by `cellFrame()` here — one implementation (core's `makeEnuFrame`), one result, so the worker's vertices and the main thread's matrix agree bit-for-bit.

The drafted version claimed "because ENU is x=east/y=north/z=up and CityJSON source CRS is x=east/y=north/z=up, no axis swap is applied" and stopped there. Axis _naming_ is not the issue: a projected CRS carries a point scale factor (RD New ≈ 0.9999908) and grid convergence (up to ~0.5° across the Netherlands), so treating source deltas as ENU metres mis-places a vertex a few kilometres out by metres and rotates the whole cell slightly. The absence of an axis swap is still true and is still what retires `meshOffset`/`sceneTransform`; it is simply not sufficient. See `packages/navara-core/src/geo/sourceToEnu.ts` (Task A13b) and its far-from-origin ECEF parity test.

**Vertical datum:** `heightOffset` is the EGM2008 geoid undulation at the layer's extent centre, sampled once by `FlatCityBufPlugin.openStream` with `await geoidHeightAt(centreLng, centreLat)` before the first cell is requested (Task C11), or supplied outright by the caller. The worker bakes every cell's vertices in the matching frame (Task C5 Step 4b) and `cellFrame()` rebuilds the identical frame here. One sample per layer, not per cell: the geoid varies by centimetres over a cell's few hundred metres, so a per-cell sample would cost a request each and change nothing. Residual (EGM2008 vs NAP) is decimetre-level and is the known limitation documented in Task C24. See Global Constraints → Vertical datum.

**Steps:**

- [ ] **Step 1: Write the failing test** at `tests/cellMeshes.test.ts`:

  ```ts
  import { describe, it, expect, vi } from "vitest";
  import { makeEnuFrame } from "@cityjson/navara-core";
  import {
    cellFrame,
    rulesStale,
    syncCellMeshes,
    type CellMesh,
  } from "../src/cellMeshes";
  import { CellCache } from "../src/cellCache";
  import type { CellEntry } from "../src/streamLayer";
  import type { Grid } from "../src/tileGrid";
  import type { Rule } from "@cityjson/navara-core";

  const GRID: Grid = { originX: 0, originY: 0, rootCell: 1000, maxLevel: 4 };

  function entry(tag: string, rules: ReadonlyArray<Rule> = []): CellEntry {
    return {
      geometry: {
        positions: new Float32Array(9),
        normals: new Float32Array(9),
        baseColors: new Float32Array(9).fill(0.5),
        ruleColors: null,
        objectIndices: new Uint32Array(3),
        surfaceIndices: new Uint32Array(3),
        objectKeys: [tag],
        triangleCount: 1,
      },
      objects: [],
      surfaceAttrKeys: [],
      lodsSeen: [],
      builtWithRulesEnabled: rules.length > 0,
      builtWithRules: rules,
    };
  }

  function factory() {
    const created: Array<{ key: string; deleted: boolean }> = [];
    return {
      created,
      create(key: string) {
        const rec = { key, deleted: false };
        created.push(rec);
        return {
          setColors: vi.fn(),
          setVisible: vi.fn(),
          triangleCount: () => 1,
          delete: () => {
            rec.deleted = true;
          },
          ref: null,
        };
      },
    };
  }

  const RULE: Rule = {
    id: "r1",
    name: "n",
    color: "#ff0000",
    conditions: [],
    logic: "AND",
    enabled: true,
  };

  describe("cellFrame", () => {
    it("places the cell at its centre's geodetic position, not the grid origin", () => {
      const toLngLat = (x: number, y: number) =>
        [4.35 + x / 68000, 52.0 + y / 111000] as const;
      const f = cellFrame(GRID, "1/1/0", toLngLat); // centre = (750, 250)
      const want = makeEnuFrame(4.35 + 750 / 68000, 52.0 + 250 / 111000, 0);
      expect(f.lngDeg).toBeCloseTo(want.lngDeg, 12);
      expect(f.latDeg).toBeCloseTo(want.latDeg, 12);
      expect(f.heightM).toBe(0);
    });

    it("carries the layer's vertical-datum offset into the frame, matching what the worker used", () => {
      const toLngLat = (x: number, y: number) =>
        [4.35 + x / 68000, 52.0 + y / 111000] as const;
      const f = cellFrame(GRID, "1/1/0", toLngLat, 43);
      expect(f.heightM).toBe(43);
      // A 43 m lift moves the frame origin ~43 m further from the geocentre.
      const flat = cellFrame(GRID, "1/1/0", toLngLat, 0);
      const d = Math.hypot(
        f.originEcef[0] - flat.originEcef[0],
        f.originEcef[1] - flat.originEcef[1],
        f.originEcef[2] - flat.originEcef[2],
      );
      expect(d).toBeCloseTo(43, 6);
    });
  });

  describe("syncCellMeshes", () => {
    const toLngLat = (x: number, y: number) =>
      [4.35 + x / 68000, 52.0 + y / 111000] as const;

    it("creates a mesh for a newly resident cell", () => {
      const cache = new CellCache<CellEntry>({
        maxTriangles: 1e6,
        maxBytes: 1e9,
      });
      cache.set("1/0/0", entry("a"), { triangles: 1, bytes: 10 });
      const cells = new Map<string, CellMesh>();
      const f = factory();
      syncCellMeshes({
        cache,
        cells,
        grid: GRID,
        toLngLat,
        factory: f,
        visible: true,
        rules: [],
        rulesEnabled: false,
      });
      expect([...cells.keys()]).toEqual(["1/0/0"]);
      expect(f.created).toHaveLength(1);
    });

    it("deletes the mesh of an evicted cell", () => {
      const cache = new CellCache<CellEntry>({
        maxTriangles: 1e6,
        maxBytes: 1e9,
      });
      cache.set("1/0/0", entry("a"), { triangles: 1, bytes: 10 });
      const cells = new Map<string, CellMesh>();
      const f = factory();
      const args = {
        cache,
        cells,
        grid: GRID,
        toLngLat,
        factory: f,
        visible: true,
        rules: [],
        rulesEnabled: false,
      };
      syncCellMeshes(args);
      cache.retain([]);
      syncCellMeshes(args);
      expect(cells.size).toBe(0);
      expect(f.created[0]!.deleted).toBe(true);
    });

    it("REBUILDS a cell whose cache entry changed under an UNCHANGED key — a swap or refetch landing new data (B1)", () => {
      const cache = new CellCache<CellEntry>({
        maxTriangles: 1e6,
        maxBytes: 1e9,
      });
      cache.set("1/0/0", entry("old"), { triangles: 1, bytes: 10 });
      const cells = new Map<string, CellMesh>();
      const f = factory();
      const args = {
        cache,
        cells,
        grid: GRID,
        toLngLat,
        factory: f,
        visible: true,
        rules: [],
        rulesEnabled: false,
      };
      syncCellMeshes(args);
      const fresh = entry("new");
      cache.set("1/0/0", fresh, { triangles: 1, bytes: 10 });
      syncCellMeshes(args);
      expect(f.created).toHaveLength(2);
      expect(f.created[0]!.deleted).toBe(true);
      expect(cells.get("1/0/0")!.sourceEntry).toBe(fresh);
    });

    it("does NOT rebuild a cell whose entry is the same object across repeated syncs", () => {
      const cache = new CellCache<CellEntry>({
        maxTriangles: 1e6,
        maxBytes: 1e9,
      });
      cache.set("1/0/0", entry("a"), { triangles: 1, bytes: 10 });
      const cells = new Map<string, CellMesh>();
      const f = factory();
      const args = {
        cache,
        cells,
        grid: GRID,
        toLngLat,
        factory: f,
        visible: true,
        rules: [],
        rulesEnabled: false,
      };
      syncCellMeshes(args);
      syncCellMeshes(args);
      syncCellMeshes(args);
      expect(f.created).toHaveLength(1);
    });

    it("flags a newly installed cell built with rules that no longer match the current ones (B2)", () => {
      const cache = new CellCache<CellEntry>({
        maxTriangles: 1e6,
        maxBytes: 1e9,
      });
      cache.set("1/0/0", entry("a", [RULE]), { triangles: 1, bytes: 10 });
      const stale = syncCellMeshes({
        cache,
        cells: new Map(),
        grid: GRID,
        toLngLat,
        factory: factory(),
        visible: true,
        rules: [{ ...RULE, color: "#00ff00" }],
        rulesEnabled: true,
      });
      expect(stale).toEqual(["1/0/0"]);
    });

    it("does NOT flag a cell whose fetch already matches the current rules", () => {
      const cache = new CellCache<CellEntry>({
        maxTriangles: 1e6,
        maxBytes: 1e9,
      });
      cache.set("1/0/0", entry("a", [RULE]), { triangles: 1, bytes: 10 });
      const stale = syncCellMeshes({
        cache,
        cells: new Map(),
        grid: GRID,
        toLngLat,
        factory: factory(),
        visible: true,
        rules: [RULE],
        rulesEnabled: true,
      });
      expect(stale).toEqual([]);
    });
  });

  describe("rulesStale", () => {
    it("is false for disabled-vs-disabled regardless of rule content", () => {
      expect(rulesStale(entry("a", [RULE]), [], false)).toBe(false);
    });
    it("is true when enabled-ness itself differs", () => {
      expect(rulesStale(entry("a"), [RULE], true)).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/cellMeshes.test.ts` → module not found.
- [ ] **Step 3: Implement `src/cellMeshes.ts`** (the `sourceEntry`/`rulesStale` logic is moved from `src/scene/CitySceneR3F.tsx:1345-1418` and `:1425-1432`; the mesh construction replaces `buildCellMesh`, `CitySceneR3F.tsx:1247-1296`).

  ```ts
  import {
    makeEnuFrame,
    type EnuFrame,
    type PickingIndex,
    type Rule,
  } from "@cityjson/navara-core";
  import { cellCentre, type CellKey, type Grid } from "./tileGrid";
  import type { CellCache } from "./cellCache";
  import type { CellEntry } from "./streamLayer";

  export interface CityMeshHandle {
    setColors(colors: Float32Array): void;
    setVisible(visible: boolean): void;
    triangleCount(): number;
    delete(): void;
    readonly ref: unknown;
  }

  export interface CellMeshFactory {
    create(key: CellKey, entry: CellEntry, frame: EnuFrame): CityMeshHandle;
  }

  export interface CellMesh {
    readonly handle: CityMeshHandle;
    readonly pickingIndex: PickingIndex;
    readonly baseColors: Float32Array;
    ruleColors: Float32Array | null;
    /** Reference identity of the CellEntry this mesh was built from: how a
     *  same-key content change (level/LoD swap, or a settle refetching an
     *  already-resident key) is detected. CellCache.set() always installs a
     *  fresh object, so `!==` is exact (B1, 2026-07-28 final review). */
    sourceEntry: CellEntry;
  }

  /** The cell's own ENU frame: cell centre in source CRS -> lng/lat -> ENU at
   *  the layer's vertical-datum offset. MUST be built the same way the worker
   *  built it (Task C5 Step 4b) — same function, same arguments — because the
   *  worker's vertices are already exact local-ENU metres in this frame. */
  export function cellFrame(
    grid: Grid,
    key: CellKey,
    toLngLat: (x: number, y: number) => readonly [number, number],
    heightOffsetM = 0,
  ): EnuFrame {
    const c = cellCentre(grid, key, 0);
    const [lng, lat] = toLngLat(c[0], c[1]);
    return makeEnuFrame(lng, lat, heightOffsetM);
  }

  export function rulesStale(
    entry: CellEntry,
    rules: ReadonlyArray<Rule>,
    rulesEnabled: boolean,
  ): boolean {
    if (entry.builtWithRulesEnabled !== rulesEnabled) return true;
    if (!rulesEnabled) return false;
    return JSON.stringify(entry.builtWithRules) !== JSON.stringify(rules);
  }

  export interface SyncCtx {
    readonly cache: CellCache<CellEntry>;
    readonly cells: Map<CellKey, CellMesh>;
    readonly grid: Grid;
    readonly toLngLat: (x: number, y: number) => readonly [number, number];
    readonly factory: CellMeshFactory;
    readonly visible: boolean;
    readonly rules: ReadonlyArray<Rule>;
    readonly rulesEnabled: boolean;
    /** Vertical-datum offset the worker already applied; the frame must match. */
    readonly heightOffsetM?: number;
  }

  /** Returns the keys of cells built (or rebuilt) here whose baked colours no
   *  longer match the current rules — the caller fires a targeted recolor for
   *  exactly those (B2). */
  export function syncCellMeshes(ctx: SyncCtx): CellKey[] {
    const cacheKeys = new Set(ctx.cache.keys());
    const stale: CellKey[] = [];

    // Deleting the current key mid-iteration is well-defined.
    for (const [key, cell] of ctx.cells) {
      if (cacheKeys.has(key)) continue;
      cell.handle.delete();
      ctx.cells.delete(key);
    }

    for (const key of cacheKeys) {
      const entry = ctx.cache.get(key);
      if (!entry) continue; // evicted between keys() and get()
      const existing = ctx.cells.get(key);
      if (existing && existing.sourceEntry === entry) continue;
      if (existing) existing.handle.delete();

      const handle = ctx.factory.create(
        key,
        entry,
        cellFrame(ctx.grid, key, ctx.toLngLat, ctx.heightOffsetM ?? 0),
      );
      handle.setVisible(ctx.visible);
      if (entry.geometry.ruleColors)
        handle.setColors(entry.geometry.ruleColors);
      ctx.cells.set(key, {
        handle,
        pickingIndex: { layerId: "", objectKeys: entry.geometry.objectKeys },
        baseColors: Float32Array.from(entry.geometry.baseColors),
        ruleColors: entry.geometry.ruleColors,
        sourceEntry: entry,
      });
      if (rulesStale(entry, ctx.rules, ctx.rulesEnabled)) stale.push(key);
    }

    return stale;
  }
  ```

  (`pickingIndex.layerId` is filled by `streamLayer.ts`, which knows the id — Task C10a's `syncMeshes()` stamps it on each new `CellMesh`; the injected factory in Task C11 only builds the engine mesh.)

- [ ] **Step 4: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/cellMeshes.test.ts` → 10 passed.
- [ ] **Step 5: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "feat: per-cell ENU mesh handles with source-identity resync (B1) and stale-rule flagging (B2)" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C9: Resident model over the plugin's cache

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/residentModel.ts`
- Test: `.../packages/navara-flatcitybuf/tests/residentModel.test.ts`

**Interfaces:**

- Consumes: `CellCache<CellEntry>`
- Produces: `ResidentModel { objects; cellCount; featureCount; surfaceAttrKeys }`, `buildResidentModel(cache: CellCache<CellEntry>): ResidentModel`, `createResidentModelMemo(): (cache, version) => ResidentModel`

**Steps:**

- [ ] **Step 1: Move + adapt the test.** Copy `tests/unit/features/streaming/residentModel.test.ts` to `packages/navara-flatcitybuf/tests/residentModel.test.ts`, replacing every `useStreamStore.getState().register(...)` set-up with a direct `CellCache` and `buildResidentModel(cache)` call, and add:
  ```ts
  it("returns the identical object (reference equality) for a repeated call at the same version", () => {
    const memo = createResidentModelMemo();
    const cache = new CellCache<CellEntry>({
      maxTriangles: 1e6,
      maxBytes: 1e9,
    });
    cache.set("1/0/0", entry("a"), { triangles: 1, bytes: 10 });
    expect(memo(cache, 3)).toBe(memo(cache, 3));
    expect(memo(cache, 4)).not.toBe(memo(cache, 3));
  });
  ```
- [ ] **Step 2: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/residentModel.test.ts` → module not found.
- [ ] **Step 3: Implement `src/residentModel.ts`** — `buildResidentModel` is the app's `buildResidentModel` (`src/features/streaming/residentModel.ts:61-85`) with `useStreamStore.getState().streams[layerId]` replaced by the `cache` parameter; `createResidentModelMemo` replaces the module-level `memo` Map with a per-handle closure:
  ```ts
  export function createResidentModelMemo(): (
    cache: CellCache<CellEntry>,
    version: number,
  ) => ResidentModel {
    let cached: { version: number; model: ResidentModel } | null = null;
    return (cache, version) => {
      if (cached && cached.version === version) return cached.model;
      const model = buildResidentModel(cache);
      cached = { version, model };
      return model;
    };
  }
  ```
- [ ] **Step 4: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/residentModel.test.ts` → 6 passed.
- [ ] **Step 5: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "refactor: make the resident model a pure function of the cell cache, memoised per layer" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C10a: `FcbStreamLayerHandle` — `entryToArrays`, commit loop, B5 backfill, B1 ladder, B3 timeout evict

The original C10 was one task covering the commit engine, the recolor path, LoD, the resident model and the whole interaction contract. Split in two: **C10a** builds the handle and gets a commit landing meshes on the globe; **C10b** adds recolor/LoD and the interaction parity (`setHighlight`/`resolvePick`/`getBoundsGeodetic`/`triangleCount`). Each half is independently green.

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/entryToArrays.ts`
- Modify: `.../packages/navara-flatcitybuf/src/streamLayer.ts` (created as a stub in Task C6)
- Test: `.../packages/navara-flatcitybuf/tests/entryToArrays.test.ts`, `.../tests/streamLayer.test.ts`

**Interfaces:**

- Consumes: `WorkerClient`, `commitPlanner`, `cellMeshes`, `residentModel`, `viewportFootprint`, `CellCache`, `constants`; `Selection`/`PickMode`/`GeodeticBounds` imported from `@cityjson/navara-cityjson` (Tasks B5/B7) — never redeclared here, so both plugins agree on one selection shape. The mesh factory is **injected** (`FcbStreamLayerHandleOptions.meshFactory`), so this module never imports `addCityMeshArrays` and therefore never reaches `@navaramap/*`; Task C11's plugin supplies the real factory.
- Produces:
  - `entryToArrays(entry: CellEntry): CityMeshArrays`
  - the `FcbStreamLayerHandle` class below (its `setHighlight`/`resolvePick`/`getBoundsGeodetic`/`triangleCount` members land in Task C10b)

  ```ts
  export type StreamStatus =
    | "idle"
    | "probing"
    | "fetching"
    | "too-far"
    | "error";
  export interface StreamLayerEvents {
    onStatus(
      cb: (status: StreamStatus, message: string | null) => void,
    ): () => void;
    onCommit(cb: (version: number) => void): () => void;
    onLadder(cb: (ladder: ReadonlyArray<string>) => void): () => void;
  }
  export class FcbStreamLayerHandle implements StreamLayerEvents {
    readonly id: string;
    readonly grid: Grid;
    readonly header: FcbHeaderModel;
    readonly frame: EnuFrame; // layer origin, for fitLayer
    get level(): number | null;
    get ladder(): ReadonlyArray<string>;
    get version(): number;
    // --- Task C10a ---
    commit(rays: readonly [Ray, Ray, Ray, Ray]): Promise<void>;
    abortInFlight(): void;
    // --- Task C10b ---
    setVisible(v: boolean): void;
    setLod(mode: "auto" | "manual", lod: string | null): void;
    setRules(rules: ReadonlyArray<Rule>, enabled: boolean): void;
    setHighlight(sel: readonly Selection[], hovered?: Selection): void;
    resolvePick(pick: ScreenPoint | PickedFeatureLike): Selection | null;
    getBoundsGeodetic(): GeodeticBounds | null;
    triangleCount(): number;
    getResidentModel(): ResidentModel;
    fetchSurfaces(objectId: string): Promise<readonly Surface[]>;
    delete(): void;
  }

  export interface FcbStreamLayerHandleOptions {
    readonly id: string;
    readonly client: WorkerClient;
    readonly grid: Grid;
    readonly header: FcbHeaderModel;
    readonly cache: CellCache<CellEntry>;
    readonly frame: EnuFrame;
    readonly toSourceXY: (
      lng: number,
      lat: number,
    ) => readonly [number, number];
    readonly toLngLat: (x: number, y: number) => readonly [number, number];
    /** Vertical-datum offset already applied by the worker (Task C5 Step 4b). */
    readonly heightOffsetM: number;
    /** Injected: builds one mesh per resident cell. Keeps this module free of
     *  @navaramap/* — Task C11's plugin supplies the real implementation. */
    readonly meshFactory: CellMeshFactory;
    /** Injected: screen point -> ECEF ray, for resolvePick (Task C4). */
    readonly pickRays: PickRaySource | null;
  }
  ```

  The four members `setHighlight`/`resolvePick`/`getBoundsGeodetic`/`triangleCount` are **declared** here and **implemented in Task C10b** — they are what make a streaming layer a full citizen of the app's interaction registry (Shared Interface Contract → Interaction registries).

**Steps:**

- [ ] **Step 1: Write the failing `entryToArrays` test**

The commit loop's mesh factory needs a `CityMeshArrays` (Task B7's `addCityMeshArrays` signature), but the cache holds a `CellGeometry` (Task C1's `workerProtocol.ts`). The two differ in exactly one field — `CellGeometry` carries `baseColors` **and** `ruleColors`, `CityMeshArrays` carries a single `colors` — and everything else (`positions`, `normals`, `objectIndices`, `surfaceIndices`, `objectKeys`, `triangleCount`) is identical and must survive untouched. Nothing in the drafted plan produced this conversion, so it gets its own module and its own test.

Create `packages/navara-flatcitybuf/tests/entryToArrays.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entryToArrays } from "../src/entryToArrays";
import type { CellEntry } from "../src/streamLayer";

function entry(ruleColors: Float32Array | null): CellEntry {
  return {
    geometry: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      baseColors: new Float32Array(9).fill(0.25),
      ruleColors,
      objectIndices: new Uint32Array([0, 0, 0]),
      surfaceIndices: new Uint32Array([3, 3, 3]),
      objectKeys: ["B1"],
      triangleCount: 1,
    },
    objects: [],
    surfaceAttrKeys: [],
    lodsSeen: [],
    builtWithRulesEnabled: false,
    builtWithRules: [],
  };
}

describe("entryToArrays", () => {
  it("uses baseColors as `colors` when the cell has no rule colors", () => {
    const arrays = entryToArrays(entry(null));
    expect([...arrays.colors]).toEqual(new Array(9).fill(0.25));
  });

  it("prefers ruleColors over baseColors when the worker baked them", () => {
    const rule = new Float32Array(9).fill(0.5);
    const arrays = entryToArrays(entry(rule));
    expect([...arrays.colors]).toEqual(new Array(9).fill(0.5));
  });

  it("passes positions, normals, indices, keys and triangleCount through by reference", () => {
    const e = entry(null);
    const arrays = entryToArrays(e);
    expect(arrays.positions).toBe(e.geometry.positions);
    expect(arrays.normals).toBe(e.geometry.normals);
    expect(arrays.objectIndices).toBe(e.geometry.objectIndices);
    expect(arrays.surfaceIndices).toBe(e.geometry.surfaceIndices);
    expect(arrays.objectKeys).toBe(e.geometry.objectKeys);
    expect(arrays.triangleCount).toBe(1);
  });

  it("does not copy the colour buffer, so a later setColors swap is the only allocation", () => {
    const e = entry(null);
    expect(entryToArrays(e).colors).toBe(e.geometry.baseColors);
  });

  it("keeps the vertex count consistent: 3 floats per vertex, 3 vertices per triangle", () => {
    const arrays = entryToArrays(entry(null));
    expect(arrays.positions.length).toBe(arrays.triangleCount * 9);
    expect(arrays.colors.length).toBe(arrays.positions.length);
    expect(arrays.objectIndices.length).toBe(arrays.triangleCount * 3);
    expect(arrays.surfaceIndices.length).toBe(arrays.objectIndices.length);
  });
});
```

- [ ] **Step 2: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/entryToArrays.test.ts` → `Failed to resolve import "../src/entryToArrays"`.

- [ ] **Step 3: Implement `src/entryToArrays.ts`**

```ts
/**
 * CellEntry (worker wire shape) -> CityMeshArrays (mesh-primitive shape).
 *
 * The only real difference is colour: the worker ships `baseColors` (semantic
 * surface colours) plus an optional `ruleColors` it baked from the layer's
 * rules, while `addCityMeshArrays` takes one `colors` buffer. Rule colours
 * win when present — that is what makes a freshly arrived cell render already
 * rule-coloured instead of flashing semantic colours for one frame.
 *
 * Nothing is copied: every other field is handed through by reference, so a
 * commit does not duplicate a cell's geometry. `CellMesh.baseColors` (Task C8)
 * keeps its own copy for the recolor path, which is where a copy is actually
 * needed.
 */
import type { CityMeshArrays } from "@cityjson/navara-core";
import type { CellEntry } from "./streamLayer";

export function entryToArrays(entry: CellEntry): CityMeshArrays {
  const g = entry.geometry;
  return {
    positions: g.positions,
    normals: g.normals,
    colors: g.ruleColors ?? g.baseColors,
    objectIndices: g.objectIndices,
    surfaceIndices: g.surfaceIndices,
    objectKeys: g.objectKeys,
    triangleCount: g.triangleCount,
  };
}
```

- [ ] **Step 4: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/entryToArrays.test.ts` → 5 passed.

- [ ] **Step 5: Write the failing commit-loop test** at `tests/streamLayer.test.ts`, porting the driver-level regressions from `tests/unit/features/streaming/useTileStreaming.test.ts` (lines 1122, 1202, 1305, 1389, 1489) onto `handle.commit(rays)` instead of a rendered hook. Harness first — `makeFakeClient` is moved verbatim from `useTileStreaming.test.ts:594-641` and extended with the three options the new cases need:

  ```ts
  const FRAME = makeEnuFrame(4.3571, 52.0116, 0);
  const GRID: Grid = {
    originX: -5000,
    originY: -5000,
    rootCell: 10000,
    maxLevel: 8,
  };
  const HEADER: FcbHeaderModel = {
    version: "1.0",
    featuresCount: 100,
    extent: [-5000, -5000, 0, 5000, 5000, 50],
    referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
    epsg: 28992,
  };

  /** Four downward rays from `height` metres up, spanning +-`half` metres —
   *  the ENU equivalent of the old top-down PerspectiveCamera fixture. */
  function raysFrom(
    height: number,
    half: number,
  ): readonly [Ray, Ray, Ray, Ray] {
    const eye: readonly [number, number, number] = [0, 0, height];
    const corner = (x: number, y: number): Ray => {
      const o = enuToEcef(FRAME, eye);
      const t = enuToEcef(FRAME, [x, y, 0]);
      const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]] as const;
      const len = Math.hypot(d[0], d[1], d[2]);
      return { origin: o, direction: [d[0] / len, d[1] / len, d[2] / len] };
    };
    return [
      corner(-half, -half),
      corner(half, -half),
      corner(half, half),
      corner(-half, half),
    ];
  }
  const topDownRays = () => raysFrom(500, 400);
  const farTopDownRays = () => raysFrom(520, 410); // same level, sub-threshold move

  /** Builds a handle over the fake client, with test-only cache accessors so
   *  the regressions can assert residency without reaching into privates. */
  function makeHandle(opts: {
    emptyKeys?: ReadonlySet<string>;
    lodsSeen?: string[];
    probeCount?: number;
    probeDelayMs?: number;
    stallFetchMs?: number;
    partialCells?: string[];
    meshFactory?: CellMeshFactory;
    pickRays?: PickRaySource;
  }) {
    const fake = makeFakeClient(opts);
    const handle = new FcbStreamLayerHandle({
      id: "l1",
      client: fake.client,
      grid: GRID,
      header: HEADER,
      cache: new CellCache<CellEntry>({
        maxTriangles: RESIDENT_TRIANGLE_BUDGET,
        maxBytes: RESIDENT_BYTE_BUDGET,
      }),
      frame: FRAME,
      toSourceXY: (lng, lat) => [
        (lng - FRAME.lngDeg) * 68000,
        (lat - FRAME.latDeg) * 111000,
      ],
      toLngLat: (x, y) => [FRAME.lngDeg + x / 68000, FRAME.latDeg + y / 111000],
      heightOffsetM: 0,
      // Injected, so streamLayer.ts never imports addCityMeshArrays and
      // therefore never reaches @navaramap/*. Task C11 supplies the real one.
      meshFactory: opts.meshFactory ?? {
        create: () => ({
          ref: null,
          mesh: { resolveRaycast: () => null, batchIdMap: () => [] },
          setColors() {},
          setVisible() {},
          triangleCount: () => 1,
          batchIdMap: () => [],
          delete() {},
        }),
      },
      // Injected pick-ray source (Task C4). A fixed downward ray is enough for
      // resolvePick's tests; the mesh fake decides what it hits.
      pickRays: opts.pickRays ?? {
        width: 800,
        height: 600,
        getPickRay: () => ({
          origin: enuToEcef(FRAME, [0, 0, 500]),
          direction: [0, 0, -1],
        }),
      },
    });
    return { handle, client: fake };
  }
  ```

  Cases:

  ```ts
  it("backfills a zero-triangle entry for a requested cell the worker found empty, so it counts as resident (B5)", async () => {
    const { handle, client } = makeHandle({ emptyKeys: new Set(["2/5/5"]) });
    await handle.commit(topDownRays());
    expect(handle.cacheKeysForTest()).toContain("2/5/5");
    const second = client.sendStreamingCalls.length;
    await handle.commit(topDownRays());
    // Hysteresis now applies: no second fetch for an unmoved view.
    expect(client.sendStreamingCalls.length).toBe(second);
  });

  it("folds each commit's observed LoD labels into the persisted ladder (B1)", async () => {
    const { handle } = makeHandle({ lodsSeen: ["1.2", "2.2"] });
    const seen: Array<ReadonlyArray<string>> = [];
    handle.onLadder((l) => seen.push(l));
    await handle.commit(topDownRays());
    expect(handle.ladder).toEqual(["1.2", "2.2"]);
    expect(seen).toHaveLength(1);
  });

  it("does not emit a ladder update when a later commit observes no NEW label", async () => {
    const { handle } = makeHandle({ lodsSeen: ["2.2"] });
    const seen: Array<ReadonlyArray<string>> = [];
    await handle.commit(topDownRays());
    handle.onLadder((l) => seen.push(l));
    await handle.commit(farTopDownRays());
    expect(seen).toHaveLength(0);
  });

  it("on a level-swap timeout, keeps the old cache and evicts the partially-arrived cells from the worker (B3)", async () => {
    const { handle, client } = makeHandle({
      stallFetchMs: LEVEL_SWAP_TIMEOUT_MS + 200,
      partialCells: ["2/5/5"],
    });
    await handle.commit(topDownRays());
    expect(client.notifyCalls).toContainEqual(
      expect.objectContaining({ type: "cancel" }),
    );
    expect(client.notifyCalls).toContainEqual(
      expect.objectContaining({ type: "evict", cells: ["2/5/5"] }),
    );
    expect(handle.cacheKeysForTest()).toEqual([]);
  });

  it("discards a stale commit whose probe response arrives after abortInFlight() bumped the epoch", async () => {
    const { handle, client } = makeHandle({ probeDelayMs: 20 });
    const p = handle.commit(topDownRays());
    handle.abortInFlight();
    await p;
    expect(client.sendStreamingCalls).toHaveLength(0);
  });

  it("reports too-far with a reason when the probe exceeds VIEWPORT_FEATURE_BUDGET", async () => {
    const { handle } = makeHandle({ probeCount: VIEWPORT_FEATURE_BUDGET + 1 });
    const statuses: Array<[string, string | null]> = [];
    handle.onStatus((s, m) => statuses.push([s, m]));
    await handle.commit(topDownRays());
    expect(statuses.at(-1)![0]).toBe("too-far");
    expect(statuses.at(-1)![1]).toMatch(/feature-budget/);
  });

  it("surfaces a worker rejection as an error status instead of an unhandled rejection", async () => {
    const { handle, client } = makeHandle({});
    client.send.mockRejectedValueOnce(new Error("WorkerClient terminated"));
    const statuses: Array<[string, string | null]> = [];
    handle.onStatus((s, m) => statuses.push([s, m]));
    await expect(handle.commit(topDownRays())).resolves.toBeUndefined();
    expect(statuses.at(-1)).toEqual(["error", "WorkerClient terminated"]);
  });
  ```

- [ ] **Step 6: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/streamLayer.test.ts` → `handle.commit is not a function`.
- [ ] **Step 7: Implement `FcbStreamLayerHandle.commit`** by moving `commitStreamingLayer` (`src/features/streaming/useTileStreaming.ts:336-555`) into the class. Changed lines, in order:
  - The store lookups (lines 342–344) are dropped; `this` supplies `client`, `grid`, `cache`, `level`, `lastCommit`, `ladder`, `rules`, `rulesEnabled`, `lodMode`, `selectedLod`, `lastLod`.
  - Line 356 `const footprint = viewportFootprint(camera, groundY, origin);` becomes:
    ```ts
    const footprint = viewportFootprint({
      cornerRays: rays,
      frame: this.frame,
      toSourceXY: this.toSourceXY,
    });
    ```
  - Every `useStreamStore.getState().setStatus(layerId, X, msg)` becomes `this.emitStatus(X, msg ?? null)`.
  - Lines 511–519 (ladder fold, B1) become:
    ```ts
    const observedLods: string[] = [];
    for (const { entry } of fetched.values())
      observedLods.push(...entry.lodsSeen);
    if (observedLods.length > 0) {
      const newLadder = buildLadder([...this._ladder, ...observedLods]);
      if (!ladderEquals(newLadder, this._ladder)) {
        this._ladder = newLadder;
        this.emitLadder(newLadder);
      }
    }
    ```
  - Lines 494–501 (B5 backfill), 442–478 (swap timeout + `cancel`/`evict` notifies, B3), 521–529 (`commitSwap`/`commitNormal` + evict notify, B4) are byte-identical apart from `stream.` → `this.`.
  - Lines 531–543 (store write + `bumpVersion`) become:
    ```ts
    this._lastLod = plan.lod;
    this._level = plan.level;
    this._lastCommit = plan.commitView;
    this.emitStatus("idle", null);
    if (fetched.size > 0 || evicted.length > 0) {
      this._version++;
      this.syncMeshes(); // builds/removes cell meshes + returns stale keys (B1/B2)
      this.emitCommit(this._version);
    }
    ```
  - `syncMeshes()` calls `syncCellMeshes({...})` from Task C8 with `factory: this.meshFactory` (the **injected** factory — see the note below), `heightOffsetM: this.heightOffsetM`, and stamps `pickingIndex.layerId = this.id` on each new `CellMesh`; any returned stale keys are passed to `this.recolorCells(staleKeys)` (implemented in Task C10b — in C10a it is a no-op stub that records the keys so the commit tests can assert on them).

  The factory itself is **not** built here. `FcbStreamLayerHandleOptions.meshFactory` is a constructor option, and Task C11's plugin supplies the real one:

  ```ts
  // packages/navara-flatcitybuf/src/plugin.ts (Task C11) — NOT streamLayer.ts
  meshFactory: {
    create: (key, entry, frame) =>
      addCityMeshArrays(this.view!, {
        id: `${id}:${key}`,
        arrays: entryToArrays(entry),
        frame,
        pickStrategy: this.pickStrategy,
      }),
  },
  ```

  Keeping it there is what lets `streamLayer.ts` — and therefore
  `tests/streamLayer.test.ts` — stay free of `@navaramap/*` (Global
  Constraints → Testing conventions): `addCityMeshArrays` lives in
  `@cityjson/navara-cityjson`, whose barrel re-exports the descriptor modules.

- [ ] **Step 8: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/streamLayer.test.ts packages/navara-flatcitybuf/tests/entryToArrays.test.ts` → 12 passed (7 commit-loop cases + 5 `entryToArrays` cases).
- [ ] **Step 9: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "feat: add FcbStreamLayerHandle's commit loop and entryToArrays (B1 ladder, B3 timeout evict, B5 backfill)" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C10b: `FcbStreamLayerHandle` — recolor, LoD, and full interaction parity

The second half of the split. C10a landed meshes; this task makes a streaming layer behave like a static one everywhere except styling. Three of the four interaction members were **declared** in the drafted plan and never implemented, which is what would have left streamed cells unpickable, unhighlightable and invisible to `fitAll`/`fitLayer` and the triangle readout (and would have made Task C14's FCB-only smoke expectations unsatisfiable).

**Files:**

- Modify: `.../packages/navara-flatcitybuf/src/streamLayer.ts`
- Test: `.../packages/navara-flatcitybuf/tests/streamLayer.test.ts` (extend)

**Interfaces:**

- Consumes: everything C10a consumed, plus `Selection`/`ScreenPoint`/`GeodeticBounds` from `@cityjson/navara-cityjson` and `ecefToGeodetic` from `@cityjson/navara-core`.
- Produces (added to `FcbStreamLayerHandle`):
  - `setRules(rules: ReadonlyArray<Rule>, enabled: boolean): void`
  - `setLod(mode: "auto" | "manual", lod: string | null): void`
  - `setVisible(v: boolean): void`
  - `fetchSurfaces(objectId: string): Promise<readonly Surface[]>`
  - `getResidentModel(): ResidentModel`
  - `delete(): void`
  - `setHighlight(sel: readonly Selection[], hovered?: Selection): void`
  - `resolvePick(pick: ScreenPoint | PickedFeatureLike): Selection | null`
  - `getBoundsGeodetic(): GeodeticBounds | null`
  - `triangleCount(): number`
  - `readonly rays: PickRaySource | null` is **not** added — `resolvePick` takes the ray source through the same `pickRays` option the plugin injects, so this module stays engine-free.

- [ ] **Step 1: Implement `recolorCells(onlyKeys?)`** by moving `recolorStreamingCells` (`src/scene/CitySceneR3F.tsx:1539-1611`) into the class: same `targets` identity snapshot, same `current === target` guard, `current.ruleColors = msg.ruleColors; current.handle.setColors(msg.ruleColors);` in place of the bare field write, same swallowed rejection. This replaces C10a's recording stub.

- [ ] **Step 2: Implement the remaining state members** — `setRules(rules, enabled)` stores them and calls `void this.recolorCells()`; `setLod(mode, lod)` stores them and calls `this.onLodChanged?.()` (the driver's forced-commit hook, B1); `setVisible` fans out to every cell handle and remembers the flag for cells created later; `fetchSurfaces(objectId)` wraps `client.send({ type: "surfaces", objectId })` and resolves `r.surfaces as Surface[]`; `getResidentModel()` uses the Task C9 memo with `this._version`; `delete()` calls `client.notify({ type: "close" })`, `client.terminate()`, and deletes every cell mesh.

- [ ] **Step 3: Write the failing interaction-parity tests** (appended to `tests/streamLayer.test.ts`)

  ```ts
  const RULE_G = {
    id: "r",
    name: "n",
    color: "#0f0",
    conditions: [],
    logic: "AND",
    enabled: true,
  } as const;

  /** A mesh factory whose handles record what they were told, and whose
   *  raycast answers for one nominated cell — enough to drive resolvePick and
   *  setHighlight without a renderer. */
  function recordingFactory(hitKey?: string) {
    const created = new Map<
      string,
      {
        colors: Float32Array | null;
        visible: boolean;
        deleted: boolean;
        objectKeys: readonly string[];
      }
    >();
    return {
      created,
      create(key: string, entry: CellEntry) {
        const rec = {
          colors: null as Float32Array | null,
          visible: true,
          deleted: false,
          objectKeys: entry.geometry.objectKeys,
        };
        created.set(key, rec);
        return {
          ref: null,
          mesh: {
            resolveRaycast: () =>
              key === hitKey ? { objectIndex: 0, surfaceIndex: 4 } : null,
            batchIdMap: () => [{ objectIndex: 0, surfaceIndex: 4 }],
          },
          setColors: (c: Float32Array) => {
            rec.colors = c;
          },
          setVisible: (v: boolean) => {
            rec.visible = v;
          },
          triangleCount: () => 7,
          batchIdMap: () => [{ objectIndex: 0, surfaceIndex: 4 }],
          delete: () => {
            rec.deleted = true;
          },
        };
      },
    };
  }

  describe("FcbStreamLayerHandle interaction parity", () => {
    it("stamps every cached entry — real AND backfilled — with the rules active at dispatch time (B2)", async () => {
      const { handle } = makeHandle({ emptyKeys: new Set(["2/5/5"]) });
      handle.setRules([RULE_G], true);
      await handle.commit(topDownRays());
      for (const key of handle.cacheKeysForTest()) {
        const e = handle.cacheEntryForTest(key)!;
        expect(e.builtWithRulesEnabled).toBe(true);
        expect(e.builtWithRules).toEqual([RULE_G]);
      }
    });

    it("triangleCount sums the RESIDENT cells, so the status bar is non-zero for an FCB-only workspace", async () => {
      const factory = recordingFactory();
      const { handle } = makeHandle({ meshFactory: factory });
      expect(handle.triangleCount()).toBe(0);
      await handle.commit(topDownRays());
      expect(factory.created.size).toBeGreaterThan(0);
      expect(handle.triangleCount()).toBe(factory.created.size * 7);
    });

    it("getBoundsGeodetic returns null before the first commit and the resident extent after", async () => {
      const { handle } = makeHandle({ meshFactory: recordingFactory() });
      expect(handle.getBoundsGeodetic()).toBeNull();
      await handle.commit(topDownRays());
      const b = handle.getBoundsGeodetic()!;
      expect(b.west).toBeLessThan(b.east);
      expect(b.south).toBeLessThan(b.north);
      // Delft-ish, from the HEADER extent reprojected — this is what makes
      // fitLayer work for a streaming layer.
      expect(b.west).toBeGreaterThan(3.5);
      expect(b.east).toBeLessThan(5.5);
    });

    it("resolvePick raycasts the resident cells and returns a surface selection carrying THIS layer's id", async () => {
      // `hitKey` is set on the factory, so the fake mesh for that cell — and
      // only that one — reports a hit. Commit twice is unnecessary: the first
      // commit is deterministic for these rays, so take the key it produces.
      const probe = recordingFactory();
      const first = makeHandle({ meshFactory: probe });
      await first.handle.commit(topDownRays());
      const hitKey = [...probe.created.keys()][0]!;

      const factory = recordingFactory(hitKey);
      const { handle } = makeHandle({ meshFactory: factory });
      await handle.commit(topDownRays());
      expect(handle.resolvePick({ x: 400, y: 300 })).toEqual({
        kind: "surface",
        layerId: "l1",
        objectId: expect.any(String),
        surfaceIndex: 4,
      });
    });

    it("resolvePick returns null when no resident cell is hit", async () => {
      const { handle } = makeHandle({ meshFactory: recordingFactory() });
      await handle.commit(topDownRays());
      expect(handle.resolvePick({ x: 400, y: 300 })).toBeNull();
    });

    it("setHighlight repaints only the cells owning the selected objects", async () => {
      const factory = recordingFactory();
      const { handle } = makeHandle({ meshFactory: factory });
      await handle.commit(topDownRays());
      const key = [...factory.created.keys()][0]!;
      const objectId = factory.created.get(key)!.objectKeys[0]!;
      handle.setHighlight([{ kind: "object", layerId: "l1", objectId }]);
      expect(factory.created.get(key)!.colors).not.toBeNull();
    });

    it("RE-APPLIES the current highlight to a cell that arrives in a LATER commit", async () => {
      const factory = recordingFactory();
      const { handle } = makeHandle({ meshFactory: factory });
      await handle.commit(topDownRays());
      const objectId = [...factory.created.values()][0]!.objectKeys[0]!;
      handle.setHighlight([{ kind: "object", layerId: "l1", objectId }]);
      // Second commit brings new cells; they must not render unhighlighted.
      await handle.commit(raysFrom(500, 900));
      for (const rec of factory.created.values()) {
        if (rec.objectKeys.includes(objectId)) {
          expect(rec.colors).not.toBeNull();
        }
      }
    });

    it("ignores selections belonging to another layer", async () => {
      const factory = recordingFactory();
      const { handle } = makeHandle({ meshFactory: factory });
      await handle.commit(topDownRays());
      handle.setHighlight([
        { kind: "object", layerId: "OTHER", objectId: "whatever" },
      ]);
      for (const rec of factory.created.values()) {
        expect(rec.colors).toBeNull();
      }
    });

    it("setVisible fans out to existing cells AND to cells created afterwards", async () => {
      const factory = recordingFactory();
      const { handle } = makeHandle({ meshFactory: factory });
      await handle.commit(topDownRays());
      handle.setVisible(false);
      for (const rec of factory.created.values())
        expect(rec.visible).toBe(false);
      await handle.commit(raysFrom(500, 900));
      for (const rec of factory.created.values())
        expect(rec.visible).toBe(false);
    });
  });
  ```

- [ ] **Step 4: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/streamLayer.test.ts` → `handle.triangleCount is not a function`.

- [ ] **Step 5: Implement the four interaction members**

  ```ts
  // packages/navara-flatcitybuf/src/streamLayer.ts — added to FcbStreamLayerHandle

  /** Sum over resident cells. `syncLayers` never puts a streaming layer in the
   *  app's `live` map, so this is the ONLY source of a streaming layer's
   *  triangle count — Task B10's `totalTriangles` reads it through the
   *  `InteractionHandle` registry (Task C13). */
  triangleCount(): number {
    let total = 0;
    for (const cell of this.cells.values()) total += cell.handle.triangleCount();
    return total;
  }

  /** The layer's geodetic extent, from the FCB header's source-CRS extent.
   *  Null until the first successful commit, so `fitAll` does not frame a
   *  layer that has not proven it has data. */
  getBoundsGeodetic(): GeodeticBounds | null {
    if (this.cells.size === 0) return null;
    const [minX, minY, minZ, maxX, maxY, maxZ] = this.header.extent;
    const corners: Array<readonly [number, number]> = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [x, y] of corners) {
      const [lng, lat] = this.toLngLat(x, y);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    return {
      west,
      south,
      east,
      north,
      minHeight: minZ + this.heightOffsetM,
      maxHeight: maxZ + this.heightOffsetM,
    };
  }

  /**
   * Pick across resident cells.
   *
   * Mirrors CityModelRegistry.resolvePick (Task B7): a PickedFeature with our
   * indices resolves directly; a batchId resolves through the owning cell's
   * batchIdMap; a screen point is raycast against every resident cell and the
   * nearest hit wins. The ray comes from the INJECTED pickRays source (Task
   * C4), never from @navaramap/*.
   */
  resolvePick(pick: ScreenPoint | PickedFeatureLike): Selection | null {
    if (typeof (pick as ScreenPoint).x !== "number") {
      const f = pick as PickedFeatureLike;
      const cellId = f.properties?.cellKey;
      const cell =
        typeof cellId === "string" ? this.cells.get(cellId) : undefined;
      if (!cell) return null;
      const entry =
        typeof f.batchId === "number"
          ? cell.handle.batchIdMap()[f.batchId]
          : undefined;
      const objectIndex = entry?.objectIndex ?? f.properties?.objectIndex;
      const surfaceIndex = entry?.surfaceIndex ?? f.properties?.surfaceIndex;
      if (typeof objectIndex !== "number" || typeof surfaceIndex !== "number") {
        return null;
      }
      return this.selectionFor(cell, objectIndex, surfaceIndex);
    }

    const point = pick as ScreenPoint;
    const raw = this.pickRays?.getPickRay(point.x, point.y);
    if (!raw) return null;
    const ray = toRay(raw);
    const origin = { x: ray.origin[0], y: ray.origin[1], z: ray.origin[2] };
    const direction = {
      x: ray.direction[0],
      y: ray.direction[1],
      z: ray.direction[2],
    };
    for (const cell of this.cells.values()) {
      const hit = cell.handle.mesh.resolveRaycast({ origin, direction });
      if (hit) return this.selectionFor(cell, hit.objectIndex, hit.surfaceIndex);
    }
    return null;
  }

  private selectionFor(
    cell: CellMesh,
    objectIndex: number,
    surfaceIndex: number,
  ): Selection | null {
    const objectId = cell.pickingIndex.objectKeys[objectIndex];
    if (objectId === undefined) return null;
    return { kind: "surface", layerId: this.id, objectId, surfaceIndex };
  }

  /**
   * Highlight over resident cells.
   *
   * Held as state, not fire-and-forget, because cells arrive asynchronously:
   * `syncMeshes()` calls `applyHighlight()` after every commit so a cell that
   * lands while an object is selected renders highlighted immediately rather
   * than on the next user interaction.
   */
  setHighlight(sel: readonly Selection[], hovered?: Selection): void {
    this.selections = sel.filter((s) => s.layerId === this.id);
    this.hovered = hovered?.layerId === this.id ? hovered : null;
    this.applyHighlight();
  }

  private applyHighlight(): void {
    for (const cell of this.cells.values()) {
      const base = cell.ruleColors ?? cell.baseColors;
      const painted = new Float32Array(base.length);
      // paintLayers writes into `target` and returns void (Task B5).
      paintLayers(
        painted,
        base,
        cell.sourceEntry.geometry.objectIndices,
        cell.sourceEntry.geometry.surfaceIndices,
        cell.pickingIndex.objectKeys,
        this.selections,
        this.hovered,
      );
      cell.handle.setColors(painted);
    }
  }
  ```

  `paintLayers` is Task B5's function, imported from `@cityjson/navara-cityjson`
  — the same base → rule → highlight layering static layers use, so the two
  cannot drift apart. Wire `applyHighlight()` into `syncMeshes()` right after
  `syncCellMeshes(...)` returns, and into `recolorCells` after each cell's
  `setColors`, so a recolor never wipes an active highlight.

- [ ] **Step 6: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf/tests/streamLayer.test.ts` → 16 passed (7 from C10a + 9 here).

- [ ] **Step 7: Commit.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "feat: give streaming layers recolor, LoD and full pick/highlight/fit/triangle parity" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C11: `FlatCityBufPlugin` — openStream + camera-driven driver

**Files:**

- Create: `.../packages/navara-flatcitybuf/src/plugin.ts`
- Modify: `.../packages/navara-flatcitybuf/src/index.ts`
- Test: `.../packages/navara-flatcitybuf/tests/plugin.test.ts`

**Interfaces:**

- Consumes: `Plugin`, `ThreeView`, `ViewContext` from `@navaramap/three` (this file and `engineRays.ts` are the package's only engine bindings); `addCityMeshArrays` from `@cityjson/navara-cityjson`; `entryToArrays` (C10a); `navaraViewRaySource`/`cornerRays`; `createSettleController`; `FcbStreamLayerHandle`; `geoidHeightAt`/`ensureProjDef` from core
- Produces:
  ```ts
  export interface FlatCityBufPluginOptions {
    /** Task B1's PICK_PATH verdict, forwarded to every cell mesh. */
    readonly pickStrategy?: PickStrategy;
    /** Viewport dimensions. Supplied by NavaraViewport, which owns the
     *  container element and its ResizeObserver — ThreeView documents `canvas`
     *  as a constructor option, not a readable property (Task C4). */
    readonly getViewportSize: () => {
      readonly width: number;
      readonly height: number;
    };
  }
  export class FlatCityBufPlugin extends Plugin<ThreeView<unknown>, unknown> {
    constructor(options: FlatCityBufPluginOptions);
    init(view: ThreeView<unknown>, ctx: unknown): Promise<void>;
    openStream(opts: {
      readonly id: string;
      readonly source: { readonly url: string } | { readonly blob: Blob };
      readonly rules?: ReadonlyArray<Rule>;
      readonly rulesEnabled?: boolean;
      readonly visible?: boolean;
      /** Vertical-datum correction in metres; defaults to
       *  `await geoidHeightAt(centreLng, centreLat)` (Global Constraints ->
       *  Vertical datum). Sent to the worker in the `open` message. */
      readonly heightOffset?: number;
    }): Promise<FcbStreamLayerHandle>;
    remove(id: string): void;
    dispose(): void;
  }
  ```

**Steps:**

- [ ] **Step 1: Write the failing test** at `tests/plugin.test.ts` with a fake view (no WASM):

  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { FlatCityBufPlugin } from "../src/plugin";

  class FakeView {
    readonly handlers = new Map<string, Set<(e?: unknown) => void>>();
    // NOTE: no `canvas` property. ThreeView documents `canvas` as a
    // constructor OPTION; the plugin gets its dimensions from the injected
    // getViewportSize() instead (Task C4).
    camera = { positionGeographic: { lng: 4.35, lat: 52, height: 500 } };
    on(type: string, cb: (e?: unknown) => void) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type)!.add(cb);
    }
    off(type: string, cb: (e?: unknown) => void) {
      this.handlers.get(type)?.delete(cb);
    }
    emit(type: string) {
      for (const cb of this.handlers.get(type) ?? []) cb();
    }
    count(type: string) {
      return this.handlers.get(type)?.size ?? 0;
    }
  }

  describe("FlatCityBufPlugin", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const opts = { getViewportSize: () => ({ width: 800, height: 600 }) };

    it("subscribes to movestart/move/moveend/idle on init and unsubscribes on dispose", async () => {
      const view = new FakeView();
      const p = new FlatCityBufPlugin(opts);
      await p.init(view as never, {});
      for (const e of ["movestart", "move", "moveend", "idle"]) {
        expect(view.count(e)).toBe(1);
      }
      p.dispose();
      for (const e of ["movestart", "move", "moveend", "idle"]) {
        expect(view.count(e)).toBe(0);
      }
    });

    it("commits every registered layer once per settle, and none while no layer is open", async () => {
      const view = new FakeView();
      const p = new FlatCityBufPlugin(opts);
      await p.init(view as never, {});
      view.emit("movestart");
      view.emit("moveend");
      vi.advanceTimersByTime(400);
      // No layers registered: nothing to do, and nothing throws.
      const handle = { commit: vi.fn(async () => {}), abortInFlight: vi.fn() };
      (p as never as { layers: Map<string, unknown> }).layers.set("l1", handle);
      view.emit("movestart");
      expect(handle.abortInFlight).toHaveBeenCalledTimes(1);
      view.emit("moveend");
      vi.advanceTimersByTime(400);
      expect(handle.commit).toHaveBeenCalledTimes(1);
    });

    it("forces a commit when a layer's LoD selection changes with no camera movement (B1)", async () => {
      const view = new FakeView();
      const p = new FlatCityBufPlugin(opts);
      await p.init(view as never, {});
      const handle = {
        commit: vi.fn(async () => {}),
        abortInFlight: vi.fn(),
        onLodChanged: undefined as undefined | (() => void),
      };
      (p as never as { register(id: string, h: unknown): void }).register(
        "l1",
        handle,
      );
      handle.onLodChanged!();
      await Promise.resolve();
      expect(handle.commit).toHaveBeenCalledTimes(1);
    });
  });
  ```

- [ ] **Step 2: Run — expect failure.** `pnpm vitest run packages/navara-flatcitybuf/tests/plugin.test.ts` → module not found.
- [ ] **Step 3: Implement `src/plugin.ts`.** `init` stores `view`/`ctx`, builds one `SettleController` shared by all layers (per-layer controllers are unnecessary now that the engine emits a single global camera event stream — a deliberate simplification of `useTileStreaming.ts:600-641`'s per-layer map), and subscribes:
  ```ts
  this.raySource = navaraViewRaySource(view, this.options.getViewportSize);
  this.controller = createSettleController({
    settleMs: SETTLE_MS,
    onFirstChange: () => {
      for (const h of this.layers.values()) h.abortInFlight();
    },
    onSettle: () => {
      const rays = cornerRays(this.raySource!);
      for (const h of this.layers.values()) void h.commit(rays);
    },
  });
  view.on("movestart", this.onMoveStart);
  view.on("move", this.onMove);
  view.on("moveend", this.onMoveEnd);
  view.on("idle", this.onIdle);
  ```
  `openStream` moves `openStreamingLayer.ts:56-135`'s worker/admission/grid logic: spin up a `WorkerClient`, `send({type:"open",...})`, reject on `error`/`admission`/missing extent (terminating the worker, lines 128–134), `makeGrid(header.extent)`, `new CellCache({RESIDENT_TRIANGLE_BUDGET, RESIDENT_BYTE_BUDGET})`, and — new — the **CRS gate**: `ensureProjDef(header.epsg)` must succeed or it throws `` `Cannot georeference "${id}": unsupported CRS (EPSG:${header.epsg ?? "unknown"})` `` (spec §4.3), then builds `toSourceXY`/`toLngLat` via `proj4` and the layer `frame` from the extent centre. It also resolves the vertical-datum offset **once, before any cell is requested**:

```ts
// packages/navara-flatcitybuf/src/plugin.ts — inside openStream, after the
// CRS gate has produced toLngLat and the extent centre.
const [centreLng, centreLat] = toLngLat(centreX, centreY);
// Unlike the static path (Task B7), this is AWAITED rather than applied
// afterwards: the worker bakes each cell's vertices into the cell's ENU frame,
// so the offset has to be known before the first fetch or every resident cell
// would need re-decoding. One request, once per layer, before any tile — and
// geoidHeightAt() resolves 0 on failure, so it can neither reject nor hang the
// open indefinitely beyond its own fetch timeout.
const heightOffsetM =
  opts.heightOffset ?? (await geoidHeightAt(centreLng, centreLat));
```

It sends `heightOffsetM` in the worker's `open` message (so the worker bakes vertices in the matching frame, Task C5 Step 4b) and passes it to the handle, which forwards it to `cellFrame()` (Task C8). It builds the handle's two injected seams here, because this is the one file in the package allowed to touch the engine:

```ts
meshFactory: {
  create: (key, entry, frame) =>
    addCityMeshArrays(this.view!, {
      id: `${opts.id}:${key}`,
      arrays: entryToArrays(entry),
      frame,
      pickStrategy: this.options.pickStrategy,
    }),
},
pickRays: this.raySource,
```

It registers the handle in `this.layers`, wires `handle.onLodChanged = () => void handle.commit(cornerRays(this.raySource!))`, and fires an initial commit.

- [ ] **Step 4: Export from `src/index.ts`:** add `export * from "./plugin"; export * from "./streamLayer"; export * from "./viewportFootprint"; export * from "./residentModel"; export * from "./cellMeshes";`
- [ ] **Step 5: Run — expect pass.** `pnpm vitest run packages/navara-flatcitybuf` → all plugin test files green.
- [ ] **Step 6: Commit + bump the parent pointer.**
  ```bash
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins add -A
  git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins commit -m "feat: add FlatCityBufPlugin with camera-event-driven commits and a CRS admission gate" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  git add packages/cityjson-navara-plugins && git commit -m "feat: bump cityjson-navara-plugins to the FlatCityBuf streaming plugin" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C12: App rewiring — `streamStore` holds a handle

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/src/features/streaming/streamStore.ts`, `.../openStreamingLayer.ts`, `.../residentModel.ts`, `.../useResidentSurfaces.ts`, `/data2/hideba/multiroof-viewer/src/ui/inspector/InspectorPanel.tsx`, `/data2/hideba/multiroof-viewer/src/ui/sidebar/LodSelector.tsx`
- Test: `tests/unit/features/streaming/streamStore.test.ts`, `.../openStreamingLayer.test.ts`, `.../useResidentSurfaces.test.ts`

**Interfaces:**

- Consumes: `@cityjson/navara-flatcitybuf` → `FcbStreamLayerHandle`, `FlatCityBufPlugin`, `ResidentModel`, `StreamStatus`
- Produces:
  ```ts
  export interface StreamState {
    readonly handle: FcbStreamLayerHandle;
    readonly grid: Grid; // handle.grid, mirrored for LodSelector
    readonly header: FcbHeaderModel;
    readonly level: number | null;
    readonly ladder: ReadonlyArray<string>;
    readonly ladderVersion: number;
    readonly status: StreamStatus;
    readonly message: string | null;
    readonly version: number;
  }
  export function openStreamingLayer(
    input: OpenStreamingLayerInput & { plugin: FlatCityBufPlugin },
  ): Promise<string>;
  export function getResidentModel(
    layerId: string,
    version: number,
  ): ResidentModel;
  export function useObjectSurfaces(
    handle: FcbStreamLayerHandle | null,
    objectId: string | null,
  ): SurfacesFetchState;
  ```

**Steps:**

- [ ] **Step 1: Update `streamStore.test.ts` to the new shape** — replace the `client`/`cache`/`lastCommit` fixture fields with `handle: fakeHandle()` (a `{ id, grid, header, delete: vi.fn() }` stub cast through `as never`), and add:
  ```ts
  it("keeps the handle by reference across a version bump — the plugin owns the cache, the store only mirrors counters", () => {
    const handle = fakeHandle();
    useStreamStore.getState().register("l1", { ...BASE, handle });
    useStreamStore.getState().bumpVersion("l1");
    expect(useStreamStore.getState().get("l1")!.handle).toBe(handle);
  });
  ```
- [ ] **Step 2: Run — expect failure.** `npx vitest run tests/unit/features/streaming/streamStore.test.ts` → type/property errors on `handle`.
- [ ] **Step 3: Rewrite `streamStore.ts`.** Keep the module doc comment (lines 1–18) and every action (`register`/`unregister`/`get`/`bumpVersion`/`setStatus`/`setLadder`) byte-identical; replace the `StreamState` interface (lines 67–86) with the shape above; delete `CellEntry` and `emptyCellEntry` (lines 38–65, 172–189) — both now live in `@cityjson/navara-flatcitybuf`; drop the `CellCache`/`WorkerClient`/`workerProtocol`/`Rule` imports.
- [ ] **Step 4: Rewrite `openStreamingLayer.ts`** as the store-registration wrapper:

  ```ts
  export interface OpenStreamingLayerInput {
    readonly plugin: FlatCityBufPlugin;
    readonly source: { readonly url: string } | { readonly blob: Blob };
    readonly name: string;
    readonly modelRef: CityModelReference;
    readonly rules?: ReadonlyArray<Rule>;
    readonly rulesEnabled?: boolean;
    readonly visible?: boolean;
  }

  export async function openStreamingLayer(
    input: OpenStreamingLayerInput,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const handle = await input.plugin.openStream({
      id,
      source: input.source,
      rules: input.rules ?? [],
      rulesEnabled: input.rulesEnabled ?? true,
      visible: input.visible ?? true,
    });

    const model: CityModel = {
      sourceEncoding: "flatcitybuf",
      metadata: { referenceSystem: handle.header.referenceSystem },
      bbox: handle.header.extent ?? null,
      objects: {},
      vertexCount: 0,
    };

    const layerId = useLayerStore.getState().addLayer({
      id,
      name: input.name,
      model,
      modelRef: input.modelRef,
      visible: input.visible ?? true,
      rules: input.rules ?? [],
      rulesEnabled: input.rulesEnabled ?? true,
      isStreaming: true,
    });

    useStreamStore.getState().register(layerId, {
      handle,
      grid: handle.grid,
      header: handle.header,
      level: null,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      version: 0,
    });

    // The plugin owns the streaming state machine and only reports; the store
    // mirrors what the UI reads (LodSelector, LayerPanel, StatusBar).
    handle.onStatus((status, message) =>
      useStreamStore.getState().setStatus(layerId, status, message),
    );
    handle.onLadder((ladder) =>
      useStreamStore.getState().setLadder(layerId, ladder),
    );
    handle.onCommit(() => useStreamStore.getState().bumpVersion(layerId));

    return layerId;
  }
  ```

  (`addLayer` gains an optional `id` so the plugin handle and the layer share one id; if `layerStore.addLayer` does not accept one, add `id?: string` defaulting to `crypto.randomUUID()` — a two-line change in `src/features/layers/layerStore.ts`.)

- [ ] **Step 5: Update `openStreamingLayer.test.ts`** — replace the `FakeWorker` harness with a fake plugin whose `openStream` resolves a stub handle, and keep the four behavioural cases: registers layer + stream state; passes a `Blob` through untouched; rejects and registers nothing when `openStream` rejects (admission); applies rules/rulesEnabled/visible overrides.
- [ ] **Step 6: Reduce `residentModel.ts` to a delegate.**

  ```ts
  import { useStreamStore } from "./streamStore";
  import type { ResidentModel } from "@cityjson/navara-flatcitybuf";

  const EMPTY: ResidentModel = {
    objects: {},
    cellCount: 0,
    featureCount: 0,
    surfaceAttrKeys: [],
  };

  /** Unchanged signature so every consumer (App, InspectorPanel, TablePanel,
   *  LayerPanel, RuleBuilderTab, analytics) keeps compiling; the memo itself
   *  now lives in the plugin handle, keyed by its own commit version. */
  export function getResidentModel(
    layerId: string,
    version: number,
  ): ResidentModel {
    void version; // the handle memoises on its own version counter
    return (
      useStreamStore.getState().streams[layerId]?.handle.getResidentModel() ??
      EMPTY
    );
  }

  export function __resetMemo(): void {
    // No app-side memo remains; kept so existing test teardown still compiles.
  }
  ```

- [ ] **Step 7: Retarget `useResidentSurfaces.ts`** — the parameter type changes from `WorkerClient | null` to `FcbStreamLayerHandle | null`, and the body's `client.send({ type: "surfaces", objectId }).then(r => ...)` becomes `handle.fetchSurfaces(objectId).then((surfaces) => { if (cancelled) return; setState({ status: "ready", surfaces }); })`; the `.catch` (lines 70–81) is preserved verbatim. Update `InspectorPanel.tsx:133` to select `s.streams[id]?.handle` instead of `?.client` and pass it at line 195.
- [ ] **Step 8: Update `useResidentSurfaces.test.ts`** — the fake becomes `{ fetchSurfaces: vi.fn() }`; the "unexpected response type" case is dropped (the handle now types its result) and replaced by:
  ```ts
  it("reports an error when the handle rejects (layer removed mid-request)", async () => {
    const handle = {
      fetchSurfaces: vi
        .fn()
        .mockRejectedValue(new Error("WorkerClient terminated")),
    };
    const { result } = renderHook(() =>
      useObjectSurfaces(handle as never, "b1"),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect((result.current as { message: string }).message).toBe(
      "WorkerClient terminated",
    );
  });
  ```
- [ ] **Step 9: Run — expect pass.** `npx vitest run tests/unit/features/streaming` and `npx tsc -b --noEmit` → green.
- [ ] **Step 10: Commit.**
  ```bash
  git add -A && git commit -m "refactor: back streamStore with the FlatCityBuf plugin handle instead of a worker client" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C13: `NavaraViewport` streaming flow

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/src/scene/NavaraViewport.tsx`, `/data2/hideba/multiroof-viewer/src/app/App.tsx`
- Test: `tests/unit/scene/navaraViewportStreaming.test.tsx`

**Interfaces:**

- Consumes: `FlatCityBufPlugin` (C11), `createNavaraSession`'s ordered plugin list (B8), `interactionHandles`/`syncHighlight`/`totalTriangles` (B10/B15), `InteractionHandle` (B10).
- Produces: `NavaraViewportProps.onPluginsReady?: (plugins: { readonly cityjson: CityJSONPlugin; readonly flatcitybuf: FlatCityBufPlugin }) => void`; `CitySceneHandle.ready: Promise<void>` (unchanged from B11a — resolve-or-reject)

**Three amendments after the 2026-08-02 external review**, all in this task:

1. **Registration.** `NavaraViewport` never sees the view before `createNavaraSession()` has started `init()`, and Navara rejects `addPlugin()` afterwards. So the FCB plugin is **appended to the session's ordered plugin list** (Task B8) — `[DefaultPlugin, CityJSONPlugin, FlatCityBufPlugin]` — not added later. There is no `view.addPlugin` call anywhere in this task.
2. **Interaction registry.** Streaming handles go into `streamsRef` (the map Task B15 already reads), so picking, highlighting, `fitAll`/`fitLayer` and the triangle readout cover streamed cells. The handle's `onCommit` callback re-runs the triangle count and re-applies the highlight as new cells arrive.
3. **Open-before-ready race.** `fcbPluginRef.current!` was a non-null assertion on a ref that is null until the session resolves — a share hash processed on first render would throw. The plugin is handed out through `CitySceneHandle.getStreamingPlugin(): Promise<FlatCityBufPlugin>`, which awaits `ready`, so an early open queues instead of crashing and an engine failure rejects instead of hanging.

**Steps:**

- [ ] **Step 1: Write the failing test** at `tests/unit/scene/navaraViewportStreaming.test.tsx`, mocking `@navaramap/three` and the two plugin packages so no WebGL/WASM is needed:

  ```ts
  import { describe, it, expect, vi } from "vitest";
  import { render, waitFor } from "@testing-library/react";
  import { createRef } from "react";

  const addPlugin = vi.fn();
  const init = vi.fn(async () => {});
  const dispose = vi.fn();
  vi.mock("@navaramap/three", () => ({
    default: vi.fn(() => ({ addPlugin, init, dispose, on: vi.fn(), off: vi.fn(), atmosphere: {}, camera: {} })),
  }));
  const flatPluginInstance = { init: vi.fn(async () => {}), openStream: vi.fn(), remove: vi.fn(), dispose: vi.fn() };
  vi.mock("@cityjson/navara-flatcitybuf", () => ({
    FlatCityBufPlugin: vi.fn(() => flatPluginInstance),
  }));

  const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
  import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";

  describe("NavaraViewport streaming wiring", () => {
    it("registers the FlatCityBuf plugin BEFORE view.init(), as the engine requires", async () => {
      render(<NavaraViewport onTriangleCount={() => {}} />);
      await waitFor(() => expect(init).toHaveBeenCalled());
      const pluginCallOrder = addPlugin.mock.invocationCallOrder[0]!;
      expect(pluginCallOrder).toBeLessThan(init.mock.invocationCallOrder[0]!);
      expect(addPlugin).toHaveBeenCalledWith(flatPluginInstance);
    });

    it("resolves the handle's `ready` promise only after view.init() settles", async () => {
      const ref = createRef<CitySceneHandle>();
      render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
      await waitFor(() => expect(ref.current).not.toBeNull());
      await expect(ref.current!.ready).resolves.toBeUndefined();
      expect(init).toHaveBeenCalled();
    });

    it("removes a streaming layer's plugin state when the layer leaves the store", async () => {
      const del = vi.fn();
      useLayerStore.getState().removeAllLayers();
      const layerId = useLayerStore.getState().addLayer({
        name: "delft.fcb",
        model: { sourceEncoding: "flatcitybuf", metadata: {}, bbox: null, objects: {}, vertexCount: 0 },
        modelRef: { type: "url", url: "https://example.com/delft.fcb" },
        visible: true,
        rules: [],
        rulesEnabled: true,
        isStreaming: true,
      });
      useStreamStore.getState().register(layerId, {
        handle: { id: layerId, delete: del } as never,
        grid: { originX: 0, originY: 0, rootCell: 1000, maxLevel: 4 },
        header: { version: "1.0", featuresCount: 1, extent: [0, 0, 0, 1, 1, 1], referenceSystem: undefined, epsg: 28992 },
        level: null,
        ladder: [],
        ladderVersion: 0,
        status: "idle",
        message: null,
        version: 0,
      });

      render(<NavaraViewport onTriangleCount={() => {}} />);
      await waitFor(() => expect(init).toHaveBeenCalled());
      useLayerStore.getState().removeLayer(layerId);

      await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
      expect(flatPluginInstance.remove).toHaveBeenCalledWith(layerId);
      expect(useStreamStore.getState().get(layerId)).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Add the failing tests for registration order, the registry and the open-race guard**

  Append to the same file:

  ```tsx
  it("passes [DefaultPlugin, CityJSONPlugin, FlatCityBufPlugin] to the session, ALL before init", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    expect(addPlugin).toHaveBeenCalledTimes(3);
    expect(addPlugin.mock.calls[2]![0]).toBe(flatPluginInstance);
    // The engine rejects addPlugin() after init(), so the LAST one still has
    // to precede it. This is the whole reason Task B8 takes an ordered list.
    expect(addPlugin.mock.invocationCallOrder[2]!).toBeLessThan(
      init.mock.invocationCallOrder[0]!,
    );
  });

  it("never calls view.addPlugin after init has resolved", async () => {
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    const afterInit = addPlugin.mock.invocationCallOrder.filter(
      (o) => o > init.mock.invocationCallOrder[0]!,
    );
    expect(afterInit).toEqual([]);
  });

  it("counts a streaming layer's triangles, so an FCB-only workspace is not reported as 0", async () => {
    const onTriangleCount = vi.fn();
    const streamHandle = makeFakeStreamHandle({ triangles: 1234 });
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={onTriangleCount} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(1234));
  });

  it("re-counts and re-highlights when the stream commits new cells", async () => {
    const onTriangleCount = vi.fn();
    const streamHandle = makeFakeStreamHandle({ triangles: 10 });
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={onTriangleCount} />);
    await waitFor(() => expect(init).toHaveBeenCalled());

    streamHandle.triangles = 99;
    streamHandle.emitCommit(1); // the onCommit subscription fires
    await waitFor(() => expect(onTriangleCount).toHaveBeenLastCalledWith(99));
    // A cell that arrives while something is selected must not render
    // unhighlighted: the viewport re-pushes the current selection.
    expect(streamHandle.setHighlight).toHaveBeenCalled();
  });

  it("routes a pick to the streaming handle, not only to static layers", async () => {
    const streamHandle = makeFakeStreamHandle({
      pick: { kind: "surface", layerId: "S1", objectId: "B4", surfaceIndex: 2 },
    });
    registerStreamingLayer("S1", streamHandle);
    render(<NavaraViewport onTriangleCount={() => {}} />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    emitViewEvent("click", { x: 100, y: 100 });
    await waitFor(() =>
      expect(useSelectionStore.getState().selections[0]?.objectId).toBe("B4"),
    );
  });

  it("QUEUES a getStreamingPlugin() call made before the session resolves", async () => {
    // init never settles until we let it, mirroring a share link that opens a
    // stream during the first render.
    let resolveInit!: () => void;
    init.mockImplementationOnce(
      () => new Promise<void>((r) => (resolveInit = r)),
    );
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);

    let settled = false;
    const pending = ref.current!.getStreamingPlugin().then((p) => {
      settled = true;
      return p;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveInit();
    await expect(pending).resolves.toBe(flatPluginInstance);
  });

  it("rejects getStreamingPlugin() if the engine never comes up, instead of hanging", async () => {
    init.mockRejectedValueOnce(new Error("wasm boom"));
    const ref = createRef<CitySceneHandle>();
    render(<NavaraViewport ref={ref} onTriangleCount={() => {}} />);
    await expect(ref.current!.getStreamingPlugin()).rejects.toThrow(
      "wasm boom",
    );
  });
  ```

  (`makeFakeStreamHandle`, `registerStreamingLayer` and `emitViewEvent` are small local helpers in this file: the first returns an object satisfying `InteractionHandle` plus `onCommit`/`onStatus`/`setRules`/`setLod`/`setVisible`/`delete` with `vi.fn()`s and a mutable `triangles`; the second adds a streaming `Layer` to `useLayerStore` and registers the handle in `useStreamStore`; the third invokes the handler the component passed to the mocked `view.on`.)

- [ ] **Step 3: Run — expect failure.** `npx vitest run tests/unit/scene/navaraViewportStreaming.test.tsx` → `addPlugin` called twice, not three times; `openStreamingLayer` is not a function.

- [ ] **Step 4: Append the FCB plugin to the session's ordered plugin list**

  There is no `view.addPlugin` call here — Task B8's list is the only registration point, and `NavaraViewport` never holds the view before `init()` starts. In the lifecycle effect from Task B11a:

  ```tsx
  // src/scene/NavaraViewport.tsx — inside the mount effect
  const defaultPlugin = new DefaultPlugin();
  const cityPlugin = new CityJSONPlugin();
  const flatPlugin = new FlatCityBufPlugin({
    // The component owns the container element, so it — not the plugin —
    // measures the viewport (Task C4: ThreeView documents `canvas` as a
    // constructor option, not a readable property).
    getViewportSize: () => ({
      width: container.clientWidth,
      height: container.clientHeight,
    }),
  });

  const session = createNavaraSession({
    createView: () =>
      new ThreeView({ container, useNormal: true, shadow: true }),
    plugins: [
      {
        key: "default",
        instance: defaultPlugin,
        afterInit: () => defaultPlugin.addDefaultPhotorealScene(),
      },
      { key: "cityjson", instance: cityPlugin },
      { key: "flatcitybuf", instance: flatPlugin },
    ],
  });
  ```

  Declare the ref next to `cityPluginRef` (Task B11a):

  ```tsx
  const flatPluginRef = useRef<FlatCityBufPlugin | null>(null);
  ```

  In `session.ready`'s fulfilment handler set `flatPluginRef.current = flatPlugin` alongside `cityPluginRef.current`, then call `onPluginsReady?.({ cityjson: cityPlugin, flatcitybuf: flatPlugin })`; clear it in the effect's cleanup alongside the others. `CitySceneHandle.ready` is unchanged from Task B11a — one promise, resolve-or-reject; do not add a second.

- [ ] **Step 5: Queue FCB opens behind readiness (the `fcbPluginRef.current!` race)**

  A share hash or a restored workspace can ask for a streaming layer during the first render, when the plugin ref is still null — `fcbPluginRef.current!` would throw. Hand the plugin out through a promise instead, so the wait is the API:

  ```tsx
  // src/scene/NavaraViewport.tsx
  const getStreamingPlugin =
    useCallback(async (): Promise<FlatCityBufPlugin> => {
      // Rejects if the engine failed (Shared Interface Contract -> ready), so a
      // caller gets an error rather than a promise that never settles.
      await readyRef.current!.promise;
      const plugin = flatPluginRef.current;
      if (!plugin) {
        throw new Error(
          "FlatCityBuf plugin unavailable after the viewport reported ready.",
        );
      }
      return plugin;
    }, []);
  ```

  Add `getStreamingPlugin(): Promise<FlatCityBufPlugin>` to `CitySceneHandle` and to the `useImperativeHandle` value. `src/features/streaming/openStreamingLayer.ts` (Task C12) keeps its `{ plugin, ... }` input unchanged — callers just obtain the plugin by awaiting instead of dereferencing a ref, so there is no `!`, no race, and the failure mode is a rejected promise the caller can toast.

- [ ] **Step 6: Register streaming handles in the interaction registry**

  ```tsx
  // src/scene/NavaraViewport.tsx — streaming reconciliation effect
  useEffect(() => {
    if (!engineReady) return;
    const streams = streamsRef.current;
    const store = useStreamStore.getState();
    const unsubscribes: Array<() => void> = [];

    for (const layer of layers) {
      if (!layer.isStreaming) continue;
      const handle = store.get(layer.id)?.handle;
      if (!handle || streams.get(layer.id) === handle) continue;
      streams.set(layer.id, handle);
      // Cells arrive asynchronously, so the triangle readout and the current
      // highlight have to be refreshed on every commit — otherwise an
      // FCB-only workspace reports 0 triangles and newly arrived cells render
      // unhighlighted (Task C14's smoke depends on both).
      unsubscribes.push(
        handle.onCommit(() => {
          onTriangleCount(totalTriangles(layers, liveRef.current, streams));
          const sel = useSelectionStore.getState();
          syncHighlight(
            layers,
            liveRef.current,
            sel.selections,
            sel.hovered,
            streams,
          );
        }),
      );
    }

    onTriangleCount(totalTriangles(layers, liveRef.current, streams));
    return () => {
      for (const off of unsubscribes) off();
    };
  }, [engineReady, layers, onTriangleCount]);
  ```

  Update the B11b layer effect's `onTriangleCount(totalTriangles(layers, liveRef.current))` call to pass `streamsRef.current` as the third argument, and the B15 highlight effect already passes it.

- [ ] **Step 7: Teardown effect.** In the layers-reconciliation effect, when a streaming layer id disappears from `useLayerStore`, call `useStreamStore.getState().get(id)?.handle.delete()`, `flatPluginRef.current?.remove(id)`, `useStreamStore.getState().unregister(id)` and `streamsRef.current.delete(id)` — the successor to `teardownRemovedLayer` (`CitySceneR3F.tsx:1199-1225`). Removing it from `streamsRef` is what keeps `fitAll`, picking and the triangle count from reading a deleted handle.

- [ ] **Step 8: Route rules/LoD/visibility for streaming layers.** In the rules effect, branch: `layer.isStreaming ? stream.handle.setRules(layer.rules, layer.rulesEnabled) : cityHandle.setStyle(compileEvaluator(layer))` — styling is the **only** capability that branches (Shared Interface Contract → Streaming styling); highlight, pick, fit and triangles go through the shared registry. In the LoD effect: `stream.handle.setLod(layer.lodMode, layer.selectedLod)`. In the visibility effect: `stream.handle.setVisible(layer.visible)`.

- [ ] **Step 9: Update `App.tsx`'s open paths.** `App` no longer keeps the plugin in a ref. Every `openStreamingLayer({...})` call site (`App.tsx:391`, `:540`, and `useLayerFileLoader`'s `.fcb` branch) becomes:

  ```tsx
  try {
    const plugin = await sceneRef.current!.getStreamingPlugin();
    await openStreamingLayer({ plugin, source, name, modelRef });
  } catch (e) {
    setToast(e instanceof Error ? e.message : String(e));
    setTimeout(() => setToast(null), 6000);
  }
  ```

  The queueing from Step 5 makes an early call safe, and `onPluginsReady` becomes optional (keep it only if something else still needs the plugin instances).

- [ ] **Step 10: Run — expect pass.** `npx vitest run tests/unit/scene/navaraViewportStreaming.test.tsx && npx tsc -b --noEmit` → 10 passed, no type errors.

- [ ] **Step 11: Commit.**

  ```bash
  git add -A && git commit -m "$(cat <<'EOF'
  feat: mount the FlatCityBuf plugin via the session plugin list and give streaming layers interaction parity

  Registers all three plugins before view.init(), puts streaming handles in the
  shared interaction registry (pick/highlight/fit/triangles), refreshes both on
  every commit, and queues FCB opens behind the ready promise.

  Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task C14: Integration test retarget + streaming browser smoke

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/tests/integration/fcbStreaming.test.ts`

**Interfaces:**

- Consumes: `@cityjson/navara-flatcitybuf` → `cellBBox`, `makeGrid`, `keysCovering`, `chooseLevel`, `bucketFeatures`; `@cityjson/navara-core` → `checkAdmission`, `headerModel`, `dequantizeAll`, `mapMetadata`, `mergeBBox`, `parseCityObject`
- Produces: unchanged test surface (7 cases against `fixtures/delft.fcb`)

**Steps:**

- [ ] **Step 1: Retarget the imports** — `tests/integration/fcbStreaming.test.ts` lines 38–61 collapse to:
  ```ts
  import {
    bucketFeatures,
    cellBBox,
    chooseLevel,
    keysCovering,
    makeGrid,
  } from "@cityjson/navara-flatcitybuf";
  import {
    checkAdmission,
    dequantizeAll,
    headerModel,
    mapMetadata,
    mergeBBox,
    parseCityObject,
    type BBox3,
    type CityJSONFeature,
    type CityJSONObject,
    type CityJSONRoot,
    type CityModel,
    type CityObject,
  } from "@cityjson/navara-core";
  ```
  Everything else (the `CountingRangeReader`, `quarterFootprint`, all 7 cases) is unchanged — this test stays in the app because it owns the 7.6 MB fixture and is genuinely an app-level integration check of the packaged plugin.
- [ ] **Step 2: Run — expect pass.** `npx vitest run tests/integration/fcbStreaming.test.ts` → 7 passed (one traversal per commit, no duplicate/lost features).
- [ ] **Step 3: Browser smoke the streaming path.**

  ```bash
  npm run dev &
  agent-browser open http://localhost:5173
  agent-browser snapshot -i
  agent-browser fill @e2 "https://storage.googleapis.com/cityjson/delft.fcb"
  agent-browser click @e3
  ```

  Expected: status bar reaches `idle` with a **non-zero triangle count** within ~5 s; buildings appear on the globe at Delft (52.01 N, 4.36 E) with no console errors. Then pan/zoom and re-snapshot: the triangle count changes and the status bar cycles `probing → fetching → idle` exactly once per settle, not continuously.

  The non-zero count is only possible because Task C10b implements `triangleCount()` on the streaming handle and Task C13 puts that handle in the interaction registry — `syncLayers` deliberately never puts a streaming layer in `liveRef`. This is an **FCB-only** workspace (no static layer loaded), so it is the sharpest check that the registry is wired.

  Check the rest of the interaction contract in the same FCB-only workspace, since none of it goes through `liveRef` either:

  ```bash
  # Pick a streamed building.
  agent-browser click "canvas" --x-percent 50 --y-percent 55
  sleep 1
  agent-browser get text .inspector-panel
  agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/m75-fcb-pick.png
  # Fit to the streaming layer from the layer panel.
  agent-browser find text "Fit all" click
  sleep 2
  agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/m75-fcb-fit.png
  # Pan so new cells arrive while the selection is still active.
  agent-browser eval "const c=document.querySelector('canvas'); const r=c.getBoundingClientRect(); const p=(t,fx,fy)=>c.dispatchEvent(new PointerEvent(t,{clientX:r.left+r.width*fx,clientY:r.top+r.height*fy,bubbles:true})); p('pointerdown',0.5,0.5); for(let i=1;i<=8;i++) p('pointermove',0.5-i*0.04,0.5); p('pointerup',0.2,0.5);"
  sleep 4
  agent-browser screenshot /tmp/claude-1020/-data2-hideba-multiroof-viewer/7733ee34-be62-4509-ac05-8e6d09eb77f2/scratchpad/m75-fcb-pick-after-pan.png
  ```

  Expected: the inspector shows the picked object's id and attributes and the building highlights (proving `resolvePick`/`setHighlight` reach resident cells); "Fit all" re-frames onto the streamed extent rather than doing nothing (proving `getBoundsGeodetic`); and after the pan the _same_ building is still highlighted while newly arrived cells render at the right colours (proving the `onCommit` re-apply from Task C13 Step 6).

  ```bash
  agent-browser eval "performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.fcb')).length"
  ```

  Expected: a bounded number of range requests (tens, not hundreds) after a single pan.

- [ ] **Step 4: Commit.**
  ```bash
  git add -A && git commit -m "test: point the fcb streaming integration test at the packaged plugin" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

## M7.6 — Solar, Google 3D Tiles, geographic persistence

### Task C15: Solar store on ENU sun direction (suncalc removed)

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/src/features/solar/solarStore.ts`, `/data2/hideba/multiroof-viewer/src/domain/geometry/derived.ts`
- Test: `tests/unit/features/solar/solarStore.test.ts`, `tests/unit/domain/geometry/derived.test.ts` (whichever file covers `computeSolarScore`), `tests/integration/solarPipeline.test.ts`

**Interfaces:**

- Consumes: nothing engine-side (the store stays pure); `proj4` + `ensureProjDef` + `parseEpsgCode` from `@cityjson/navara-core` (both moved there in Task A13)
- Produces:
  ```ts
  export interface SunPosition {
    readonly altitudeDeg: number;
    readonly azimuthDeg: number; // 0=N, 90=E, clockwise
    /** Unit vector toward the sun in local ENU (x=east, y=north, z=up) — the
     *  same axes as CityJSON source coordinates. */
    readonly direction: readonly [number, number, number];
  }
  export function sunPositionFromEnu(
    dir: readonly [number, number, number],
  ): SunPosition;
  export interface SolarActions {
    setSunPosition(sun: SunPosition | null): void; /* ...existing */
  }
  export function computeSolarScore(
    surfaceNormal: Vec3,
    sunDirectionEnu: readonly [number, number, number],
  ): number;
  ```

**Steps:**

- [ ] **Step 1: Rewrite the solar tests.** In `tests/unit/features/solar/solarStore.test.ts`, delete the `describe("sunDirectionThreeJs")` (lines 43–81) and `describe("computeSunPosition")` (82–107) blocks; delete the `describe("parseEpsgCode")` block too (it moved to `packages/navara-core/tests/citymodel/crsProjDefs.test.ts` in Task A13 — do not duplicate it) and drop `parseEpsgCode` from the file's import list; keep `reprojectToLatLon` untouched; replace the store block with:

  ```ts
  describe("sunPositionFromEnu", () => {
    it("reads a straight-up direction as 90 deg altitude", () => {
      const p = sunPositionFromEnu([0, 0, 1]);
      expect(p.altitudeDeg).toBeCloseTo(90, 6);
      expect(p.direction).toEqual([0, 0, 1]);
    });

    it("reads due east on the horizon as altitude 0, azimuth 90", () => {
      const p = sunPositionFromEnu([1, 0, 0]);
      expect(p.altitudeDeg).toBeCloseTo(0, 6);
      expect(p.azimuthDeg).toBeCloseTo(90, 6);
    });

    it("reads due south as azimuth 180 and normalises a non-unit input", () => {
      const p = sunPositionFromEnu([0, -5, 0]);
      expect(p.azimuthDeg).toBeCloseTo(180, 6);
      expect(Math.hypot(...p.direction)).toBeCloseTo(1, 9);
    });

    it("reports a negative altitude for a below-horizon direction", () => {
      expect(sunPositionFromEnu([0, 1, -1]).altitudeDeg).toBeLessThan(0);
    });

    it("wraps a westerly azimuth into [0,360)", () => {
      expect(sunPositionFromEnu([-1, 0, 0]).azimuthDeg).toBeCloseTo(270, 6);
    });
  });

  describe("useSolarStore", () => {
    it("setSunPosition stores what the engine reported, without recomputing anything", () => {
      const sun = sunPositionFromEnu([0, 0, 1]);
      useSolarStore.getState().setSunPosition(sun);
      expect(useSolarStore.getState().sunPosition).toBe(sun);
    });

    it("setDatetime no longer derives a sun position — the atmosphere owns that", () => {
      useSolarStore.getState().setSunPosition(null);
      useSolarStore.getState().setDatetime(new Date("2026-06-21T12:00:00Z"));
      expect(useSolarStore.getState().sunPosition).toBeNull();
      expect(useSolarStore.getState().datetime.toISOString()).toBe(
        "2026-06-21T12:00:00.000Z",
      );
    });

    it("initFromModel still derives lat/lon via proj4 for the atmosphere's site", () => {
      useSolarStore
        .getState()
        .initFromModel(
          "https://www.opengis.net/def/crs/EPSG/0/7415",
          [84000, 446000, 0, 86000, 448000, 20],
        );
      const { latLon } = useSolarStore.getState();
      expect(latLon!.lat).toBeCloseTo(52.0, 1);
      expect(latLon!.lon).toBeCloseTo(4.36, 1);
    });
  });
  ```

  In the `computeSolarScore` test file, replace every Y-up fixture with the ENU equivalent and add:

  ```ts
  it("scores a flat roof under an overhead sun as 1 with an ENU direction (no Y-up conversion left)", () => {
    expect(computeSolarScore([0, 0, 1], [0, 0, 1])).toBeCloseTo(1, 9);
  });
  it("scores a south-facing roof against a southern sun above 0", () => {
    expect(computeSolarScore([0, -1, 0], [0, -0.7071, 0.7071])).toBeCloseTo(
      0.7071,
      4,
    );
  });
  it("clamps a back-facing surface to 0", () => {
    expect(computeSolarScore([0, 0, 1], [0, 0, -1])).toBe(0);
  });
  ```

- [ ] **Step 2: Run — expect failure.** `npx vitest run tests/unit/features/solar tests/unit/domain` → `sunPositionFromEnu is not exported`.
- [ ] **Step 3: Rewrite `solarStore.ts`.** Delete the `suncalc` import (line 12), `sunDirectionThreeJs` (86–107) and `computeSunPosition` (112–126); drop the temporary `export { parseEpsgCode }` re-export added in Task A13 and import the symbol for internal use instead (`import { ensureProjDef, parseEpsgCode } from "@cityjson/navara-core";`); keep `reprojectToLatLon` unchanged; add:
  ```ts
  /** Engine-reported ENU sun direction -> the altitude/azimuth the UI shows.
   *  The atmosphere owns sun position now (spec §4.4); this is only the
   *  presentation transform, so it stays pure and unit-testable. */
  export function sunPositionFromEnu(
    dir: readonly [number, number, number],
  ): SunPosition {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const e = dir[0] / len;
    const n = dir[1] / len;
    const u = dir[2] / len;
    let azimuthDeg = (Math.atan2(e, n) * 180) / Math.PI;
    if (azimuthDeg < 0) azimuthDeg += 360;
    return {
      altitudeDeg: (Math.asin(Math.max(-1, Math.min(1, u))) * 180) / Math.PI,
      azimuthDeg,
      direction: [e, n, u],
    };
  }
  ```
  `setDatetime` becomes `(dt) => set({ datetime: dt })`; `setLatLon` becomes `(latLon) => set({ latLon })`; add `setSunPosition: (sunPosition) => set({ sunPosition })`; `initFromModel` keeps its body minus the sun recomputation.
- [ ] **Step 4: Update `derived.ts`** — `computeSolarScore` (lines 55–79) drops the Y-up→Z-up conversion block entirely:
  ```ts
  /**
   * Compute solar score: cos(angle) between surface normal and sun direction.
   * Both vectors are in CityJSON/ENU Z-up space — since the Navara migration
   * there is no Y-up scene space left to convert from.
   */
  export function computeSolarScore(
    surfaceNormal: Vec3,
    sunDirectionEnu: readonly [number, number, number],
  ): number {
    const dot =
      surfaceNormal[0] * sunDirectionEnu[0] +
      surfaceNormal[1] * sunDirectionEnu[1] +
      surfaceNormal[2] * sunDirectionEnu[2];
    return Math.max(0, dot);
  }
  ```
  `AnalysisTab.tsx:101,164` need no change — they already pass `sunPosition.direction`.
- [ ] **Step 5: Update `tests/integration/solarPipeline.test.ts`** — it asserts the CRS → lat/lon → sun → light chain; replace the suncalc assertions with `sunPositionFromEnu` on a fixed ENU vector and keep the CRS half unchanged.
- [ ] **Step 6: Run — expect pass.** `npx vitest run tests/unit/features/solar tests/unit/domain tests/integration/solarPipeline.test.ts` → green; `grep -rn "suncalc" src/` returns nothing.
- [ ] **Step 7: Commit.**
  ```bash
  git add -A && git commit -m "refactor: derive sun position from an ENU direction instead of suncalc" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C16: Atmosphere date + time animation in `NavaraViewport`

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/src/scene/NavaraViewport.tsx`
- Create: `/data2/hideba/multiroof-viewer/src/scene/timeAnimation.ts`
- Test: `tests/unit/scene/timeAnimation.test.ts`

**Interfaces:**

- Consumes: `view.atmosphere.date`, `view.atmosphere.getSunDirection()`, `view.on("preUpdate")`, `view.atmosphere` event `sunChanged`
- Produces:
  ```ts
  export interface TimeStep {
    readonly next: Date;
    readonly shouldSyncStore: boolean;
  }
  export function advanceTime(
    current: Date,
    deltaSeconds: number,
    speed: number,
    msSinceLastSync: number,
  ): TimeStep;
  ```

**Steps:**

- [ ] **Step 1: Write the failing test** at `tests/unit/scene/timeAnimation.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { advanceTime } from "../../../src/scene/timeAnimation";

  const T0 = new Date("2026-06-21T12:00:00.000Z");

  describe("advanceTime", () => {
    it("advances by delta * speed seconds", () => {
      expect(advanceTime(T0, 0.5, 60, 0).next.toISOString()).toBe(
        "2026-06-21T12:00:30.000Z",
      );
    });

    it("caps a tab-refocus delta at 100 ms so time never jumps", () => {
      expect(advanceTime(T0, 5, 60, 0).next.getTime() - T0.getTime()).toBe(
        100 * 60,
      );
    });

    it("asks for a store sync only once per 100 ms of wall clock", () => {
      expect(advanceTime(T0, 0.016, 60, 40).shouldSyncStore).toBe(false);
      expect(advanceTime(T0, 0.016, 60, 101).shouldSyncStore).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run — expect failure.** `npx vitest run tests/unit/scene/timeAnimation.test.ts` → module not found.
- [ ] **Step 3: Implement `src/scene/timeAnimation.ts`** (extracted from `CitySceneR3F.tsx:461-476` so the arithmetic is testable without a render loop):

  ```ts
  const MAX_DELTA_S = 0.1;
  const STORE_SYNC_MS = 100;

  export interface TimeStep {
    readonly next: Date;
    readonly shouldSyncStore: boolean;
  }

  export function advanceTime(
    current: Date,
    deltaSeconds: number,
    speed: number,
    msSinceLastSync: number,
  ): TimeStep {
    const clamped = Math.min(deltaSeconds, MAX_DELTA_S);
    return {
      next: new Date(current.getTime() + clamped * 1000 * speed),
      shouldSyncStore: msSinceLastSync > STORE_SYNC_MS,
    };
  }
  ```

- [ ] **Step 4: Wire it in `NavaraViewport.tsx`.** A `preUpdate` hook (replacing `useFrame`) drives the atmosphere directly, never React state:
  ```ts
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let last = performance.now();
    let lastSync = 0;
    const onPreUpdate = () => {
      const now = performance.now();
      const delta = (now - last) / 1000;
      last = now;
      if (!useSolarStore.getState().timeAnimating) return;
      const step = advanceTime(
        datetimeRef.current,
        delta,
        useSolarStore.getState().timeSpeed,
        now - lastSync,
      );
      datetimeRef.current = step.next;
      view.atmosphere.date = step.next;
      if (step.shouldSyncStore) {
        lastSync = now;
        useSolarStore.getState().setDatetime(step.next);
      }
    };
    view.on("preUpdate", onPreUpdate);
    return () => view.off("preUpdate", onPreUpdate);
  }, []);
  ```
  A second effect pushes non-animating datetime changes: `useEffect(() => { if (!timeAnimating) view.atmosphere.date = datetime; }, [datetime, timeAnimating])`. A third subscribes `sunChanged` and republishes to the store, converting ECEF→ENU with the active site frame:
  ```ts
  const onSunChanged = () => {
    const frame = siteFrameRef.current;
    if (!frame) return;
    const s = view.atmosphere.getSunDirection();
    const enu = ecefToEnu(frame, [s.x, s.y, s.z]);
    const origin = ecefToEnu(frame, [0, 0, 0]);
    useSolarStore
      .getState()
      .setSunPosition(
        sunPositionFromEnu([
          enu[0] - origin[0],
          enu[1] - origin[1],
          enu[2] - origin[2],
        ]),
      );
  };
  ```
  (`getSunDirection()` is a direction, so the frame origin is subtracted to keep it a pure rotation.)
- [ ] **Step 5: Run — expect pass.** `npx vitest run tests/unit/scene/timeAnimation.test.ts && npx tsc -b --noEmit` → green.
- [ ] **Step 6: Browser smoke.**
  ```bash
  agent-browser open http://localhost:5173
  agent-browser click @e_solar_tab
  agent-browser click @e_play
  agent-browser snapshot
  ```
  Expected: the sun altitude readout in the toolbar changes over ~2 s of playback, shadows on the loaded model rotate, and pausing freezes both.
- [ ] **Step 7: Commit.**
  ```bash
  git add -A && git commit -m "feat: drive atmosphere date and sun readout from the Navara render loop" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C17: Google Photorealistic 3D Tiles as a native Navara layer

**Files:**

- Create: `/data2/hideba/multiroof-viewer/src/scene/googleTiles.ts`
- Create: `/data2/hideba/multiroof-viewer/src/ui/viewport/AttributionOverlay.tsx`
- Modify: `/data2/hideba/multiroof-viewer/src/scene/NavaraViewport.tsx`, `/data2/hideba/multiroof-viewer/src/app/App.css`
- Test: `tests/unit/scene/googleTiles.test.ts`, `tests/unit/ui/viewport/AttributionOverlay.test.tsx`

**Interfaces:**

- Consumes: `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` (same env var `GoogleTilesLayer.tsx:29` reads today)
- Produces:
  ```ts
  export const GOOGLE_TILES_ROOT =
    "https://tile.googleapis.com/v1/3dtiles/root.json";
  export const TILE_CREASE_ANGLE: number; // Math.PI / 6, preserved from TileCreasedNormalsPlugin usage
  export interface GoogleTilesConfig {
    readonly source: { readonly type: "3d-tiles"; readonly url: string };
    readonly layer: {
      readonly type: "3d-tiles";
      readonly model: {
        readonly creaseNormalAngle: number;
        readonly castShadow: boolean;
        readonly receiveShadow: boolean;
        readonly maxSse: number;
      };
    };
  }
  export function googleTilesConfig(
    apiKey: string | undefined,
  ): GoogleTilesConfig | null;
  ```

**Steps:**

- [ ] **Step 1: Write the failing test** at `tests/unit/scene/googleTiles.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import {
    GOOGLE_TILES_ROOT,
    TILE_CREASE_ANGLE,
    googleTilesConfig,
  } from "../../../src/scene/googleTiles";

  describe("googleTilesConfig", () => {
    it("returns null without an API key, so the viewer runs tile-free rather than 401-looping", () => {
      expect(googleTilesConfig(undefined)).toBeNull();
      expect(googleTilesConfig("")).toBeNull();
    });

    it("puts the key in the root URL's query string, not a header", () => {
      const cfg = googleTilesConfig("KEY123")!;
      expect(cfg.source.url).toBe(`${GOOGLE_TILES_ROOT}?key=KEY123`);
      expect(cfg.source.type).toBe("3d-tiles");
    });

    it("URL-encodes a key containing reserved characters", () => {
      expect(googleTilesConfig("a b&c")!.source.url).toBe(
        `${GOOGLE_TILES_ROOT}?key=a%20b%26c`,
      );
    });

    it("carries the crease angle previously applied by TileCreasedNormalsPlugin", () => {
      expect(googleTilesConfig("K")!.layer.model.creaseNormalAngle).toBe(
        TILE_CREASE_ANGLE,
      );
      expect(TILE_CREASE_ANGLE).toBeCloseTo(Math.PI / 6, 12);
    });

    it("receives shadows but does not cast them, matching the old baked-lighting tiles", () => {
      const model = googleTilesConfig("K")!.layer.model;
      expect(model.receiveShadow).toBe(true);
      expect(model.castShadow).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run — expect failure.** `npx vitest run tests/unit/scene/googleTiles.test.ts` → module not found.
- [ ] **Step 3: Implement `src/scene/googleTiles.ts`.**

  ```ts
  /**
   * Google Photorealistic 3D Tiles as a native Navara `3d-tiles` source+layer,
   * replacing the deleted `GoogleTilesLayer.tsx` (3d-tiles-renderer/r3f) and
   * `TileCreasedNormalsPlugin.ts` — Navara's ModelMaterial exposes
   * `creaseNormalAngle` directly, and its own lighting removes the need for the
   * MeshBasicMaterial swap the old component performed.
   */
  export const GOOGLE_TILES_ROOT =
    "https://tile.googleapis.com/v1/3dtiles/root.json";
  export const TILE_CREASE_ANGLE = Math.PI / 6;

  export interface GoogleTilesConfig {
    readonly source: { readonly type: "3d-tiles"; readonly url: string };
    readonly layer: {
      readonly type: "3d-tiles";
      readonly model: {
        readonly creaseNormalAngle: number;
        readonly castShadow: boolean;
        readonly receiveShadow: boolean;
        readonly maxSse: number;
      };
    };
  }

  export function googleTilesConfig(
    apiKey: string | undefined,
  ): GoogleTilesConfig | null {
    if (!apiKey) return null;
    return {
      source: {
        type: "3d-tiles",
        url: `${GOOGLE_TILES_ROOT}?key=${encodeURIComponent(apiKey)}`,
      },
      layer: {
        type: "3d-tiles",
        model: {
          creaseNormalAngle: TILE_CREASE_ANGLE,
          castShadow: false,
          receiveShadow: true,
          maxSse: 8,
        },
      },
    };
  }
  ```

- [ ] **Step 4: Wire it in `NavaraViewport.tsx`,** after `defaultPlugin.addDefaultPhotorealScene()`:
  ```ts
  const tiles = googleTilesConfig(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
  );
  if (tiles) {
    const src = view.addSource(tiles.source);
    view.addLayer({ ...tiles.layer, source: src });
  } else if (import.meta.env.DEV) {
    console.warn(
      "[googleTiles] VITE_GOOGLE_MAPS_API_KEY not set. Tiles disabled.",
    );
  }
  ```
- [ ] **Step 5: Run — expect pass.** `npx vitest run tests/unit/scene/googleTiles.test.ts && npx tsc -b --noEmit` → 5 passed, clean.
- [ ] **Step 5b: Add the attribution overlay (licence obligation, not decoration)**

  `GoogleTilesLayer.tsx` rendered `<TilesAttributionOverlay />` from `3d-tiles-renderer`; that component dies with the R3F stack in Task C21, and the app now has a **second** attribution obligation — the Re:Earth Terrain geoid service is CC BY 4.0 Mapterhorn + ODbL OpenStreetMap (Global Constraints → Vertical datum). Both are licence terms, so neither is optional.

  Write the failing test at `tests/unit/ui/viewport/AttributionOverlay.test.tsx`:

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render } from "@testing-library/react";
  import { GEOID_ATTRIBUTION } from "@cityjson/navara-core";
  import { AttributionOverlay } from "../../../../src/ui/viewport/AttributionOverlay";

  describe("AttributionOverlay", () => {
    it("always credits the geoid service, which is used for every georeferenced layer", () => {
      const { container } = render(<AttributionOverlay googleTiles={false} />);
      for (const line of GEOID_ATTRIBUTION) {
        expect(container.textContent).toContain(line);
      }
    });

    it("adds the Google credit only when the tiles layer is actually enabled", () => {
      expect(
        render(<AttributionOverlay googleTiles={false} />).container
          .textContent,
      ).not.toMatch(/Google/);
      expect(
        render(<AttributionOverlay googleTiles />).container.textContent,
      ).toMatch(/Google/);
    });

    it("links the CC BY 4.0 licence rather than only naming it", () => {
      const { container } = render(<AttributionOverlay googleTiles />);
      expect(
        container.querySelector('a[href*="creativecommons.org"]'),
      ).not.toBeNull();
    });
  });
  ```

  Run it (`npx vitest run tests/unit/ui/viewport/AttributionOverlay.test.tsx` → module not found), then implement:

  ```tsx
  // src/ui/viewport/AttributionOverlay.tsx
  /**
   * Data attributions. These are licence obligations, not credits: the geoid
   * service (Re:Earth Terrain, EGM2008) is CC BY 4.0 Mapterhorn + ODbL
   * OpenStreetMap and is sampled for EVERY georeferenced layer, so its line is
   * unconditional. Replaces `TilesAttributionOverlay` from 3d-tiles-renderer,
   * which is deleted with the R3F stack in Task C21.
   */
  import { GEOID_ATTRIBUTION } from "@cityjson/navara-core";

  export interface AttributionOverlayProps {
    readonly googleTiles: boolean;
  }

  export function AttributionOverlay({
    googleTiles,
  }: AttributionOverlayProps): JSX.Element {
    return (
      <div className="attribution-overlay">
        {googleTiles && <span>Imagery © Google</span>}
        <span>
          Geoid (EGM2008): © Mapterhorn,{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer noopener"
          >
            CC BY 4.0
          </a>
        </span>
        <span>
          ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer noopener"
          >
            OpenStreetMap
          </a>{" "}
          contributors, ODbL
        </span>
        {/* GEOID_ATTRIBUTION is the plain-text form core exports; render it as
            the accessible label so the test above (and any headless check)
            sees exactly the strings the licence requires. */}
        <span className="sr-only">{GEOID_ATTRIBUTION.join(" · ")}</span>
      </div>
    );
  }
  ```

  Render it from `NavaraViewport` inside the container div, next to `ViewAlignButtons`: `<AttributionOverlay googleTiles={tilesEnabled} />`, where `tilesEnabled` is `googleTilesConfig(...) !== null` hoisted into component state by the effect in Step 4. Add the style beside `.navara-viewport` in `src/app/App.css`:

  ```css
  .attribution-overlay {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    background: rgb(0 0 0 / 45%);
    color: #f0f0f0;
    font-size: 0.7rem;
    pointer-events: auto;
  }

  .attribution-overlay a {
    color: inherit;
  }
  ```

  Re-run: `npx vitest run tests/unit/ui/viewport/AttributionOverlay.test.tsx` → 3 passed.

- [ ] **Step 6: Browser smoke.** With `VITE_GOOGLE_MAPS_API_KEY` set in `.env.local`: `agent-browser open http://localhost:5173` then `agent-browser eval "performance.getEntriesByType('resource').filter(r=>r.name.includes('tile.googleapis.com')).length"` → greater than 0, and the snapshot shows photoreal terrain under the city model. Without the key: no `tile.googleapis.com` requests and no console errors. In both cases the attribution overlay is visible bottom-right and reads the Mapterhorn/CC BY 4.0 and OpenStreetMap/ODbL lines, with the Google line present only when the key is set. Also confirm the geoid request actually fires once per layer: `agent-browser eval "performance.getEntriesByType('resource').filter(r=>r.name.includes('terrain.reearth.land')).map(r=>r.name)"` → one `tilejson.json` plus one raster tile per loaded layer, all HTTP 200.
- [ ] **Step 7: Commit.**
  ```bash
  git add -A && git commit -m "feat: add Google Photorealistic 3D Tiles as a native Navara 3d-tiles layer" -m "Also adds the AttributionOverlay replacing TilesAttributionOverlay, carrying the required CC BY 4.0 Mapterhorn and ODbL OpenStreetMap credits for the geoid service." -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C18: Snapshot v3 — geographic camera, no migration shim

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/src/persistence/types.ts`, `.../captureSnapshot.ts`, `.../restoreSnapshot.ts`
- Test: `tests/unit/persistence/captureRestore.test.ts`, `tests/unit/persistence/snapshotV2.test.ts` → renamed `tests/unit/persistence/snapshotV3.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface GeographicCamera {
    readonly lng: number;
    readonly lat: number;
    readonly height: number;
    readonly heading: number;
    readonly pitch: number;
    readonly roll: number;
  }
  export interface ViewState {
    readonly camera: GeographicCamera;
    readonly datetime: string;
  }
  export const SNAPSHOT_VERSION = "3";
  export class UnsupportedSnapshotVersionError extends Error {
    readonly found: string;
  }
  export function captureSnapshot(input: CaptureInput): ProjectSnapshot; // CaptureInput.camera: GeographicCamera
  export function restoreSnapshot(snapshot: ProjectSnapshot): ViewState; // throws UnsupportedSnapshotVersionError
  ```

**Steps:**

- [ ] **Step 1: Rewrite the persistence tests.** In `tests/unit/persistence/captureRestore.test.ts`, replace every `cameraPosition`/`cameraTarget` pair with `camera: CAM` where

  ```ts
  const CAM = {
    lng: 4.3571,
    lat: 52.0116,
    height: 800,
    heading: 30,
    pitch: -45,
    roll: 0,
  } as const;
  ```

  and update the assertions to `expect(snapshot.viewState.camera).toEqual(CAM)` / `expect(snapshot.version).toBe("3")`. Add:

  ```ts
  it("rejects a v2 snapshot with a clear message instead of silently restoring a broken camera", () => {
    const v2 = {
      version: "2",
      savedAt: new Date().toISOString(),
      label: "old",
      layers: [],
      viewState: {
        cameraPosition: [1, 2, 3],
        cameraTarget: [0, 0, 0],
        datetime: new Date().toISOString(),
      },
      pickMode: "object",
    };
    expect(() => restoreSnapshot(v2 as never)).toThrow(
      UnsupportedSnapshotVersionError,
    );
    expect(() => restoreSnapshot(v2 as never)).toThrow(/older version/i);
  });

  it("rejects a snapshot with no version at all", () => {
    expect(() =>
      restoreSnapshot({
        label: "x",
        viewState: { camera: CAM, datetime: "" },
      } as never),
    ).toThrow(UnsupportedSnapshotVersionError);
  });

  it("does NOT mutate the selection or solar stores when it rejects", () => {
    useSelectionStore.setState({
      mode: "surface",
      selections: [],
      hovered: null,
    });
    expect(() => restoreSnapshot({ version: "2" } as never)).toThrow();
    expect(useSelectionStore.getState().mode).toBe("surface");
  });
  ```

  Rename `snapshotV2.test.ts` → `snapshotV3.test.ts` and replace the whole `migrateSnapshot` suite with a `normalizeLayers` suite covering the two behaviours worth keeping (default `lodMode` to `"auto"`; flag a file-backed streaming layer `unavailable`), since cross-version migration is gone.

- [ ] **Step 2: Run — expect failure.** `npx vitest run tests/unit/persistence` → `camera` unknown / `UnsupportedSnapshotVersionError` not exported.
- [ ] **Step 3: Update `types.ts`.** Replace `ViewState` (lines 117–121) with the `GeographicCamera`-based shape; rename `migrateSnapshot` → `normalizeLayers` keeping its body (lines 100–111) but dropping the `version: 2` return field (it returns `MigratedLayerSnapshot[]`); delete the deprecated `modelRef`/`rules`/`rulesEnabled` fields on `ProjectSnapshot` (lines 131–136) — legacy single-model snapshots are v1 and are now rejected outright; add:
  ```ts
  export class UnsupportedSnapshotVersionError extends Error {
    constructor(readonly found: string) {
      super(
        `This saved workspace was created by an older version of MultiRoof Viewer (v${found}) and can no longer be restored. Saved cameras changed from scene coordinates to geographic coordinates; please re-save from the current version.`,
      );
      this.name = "UnsupportedSnapshotVersionError";
    }
  }
  ```
- [ ] **Step 4: Update `captureSnapshot.ts`** — `SNAPSHOT_VERSION = "3"`, `CaptureInput.cameraPosition`/`cameraTarget` collapse to `camera: GeographicCamera`, and `viewState` becomes `{ camera: input.camera, datetime: input.datetime.toISOString() }`.
- [ ] **Step 5: Update `restoreSnapshot.ts`** — the version gate runs **before** any store write:
  ```ts
  export function restoreSnapshot(snapshot: ProjectSnapshot): ViewState {
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new UnsupportedSnapshotVersionError(snapshot.version ?? "unknown");
    }
    useSelectionStore.setState({
      mode: snapshot.pickMode,
      selections: [],
      hovered: null,
    });
    const dt = new Date(snapshot.viewState.datetime);
    if (!isNaN(dt.getTime())) useSolarStore.getState().setDatetime(dt);
    return snapshot.viewState;
  }
  ```
- [ ] **Step 6: Run — expect pass.** `npx vitest run tests/unit/persistence` → green (`captureRestore` 8, `snapshotV3` 4).
- [ ] **Step 7: Commit.**
  ```bash
  git add -A && git commit -m "feat: store a geographic camera in snapshot v3 and reject older snapshots outright" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C19: Share links v3

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/src/persistence/urlShare.ts`
- Test: `tests/unit/persistence/urlShare.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface ShareableViewState {
    readonly v: 3;
    readonly layers: ReadonlyArray<ShareableLayerState>;
    readonly cam: GeographicCamera;
    readonly dt: string;
    readonly pm: PickMode;
  }
  export function encodeShareState(state: ShareableViewState): string;
  export function decodeShareState(hash: string): ShareableViewState | null;
  export function buildShareUrl(state: ShareableViewState): string;
  ```

**Steps:**

- [ ] **Step 1: Rewrite `tests/unit/persistence/urlShare.test.ts`.** `makeState` returns `{ v: 3, layers: [], cam: CAM, dt: "2025-06-21T12:00:00.000Z", pm: "object" }`; keep the base64url/prefix/corruption cases verbatim and replace the legacy ones with:

  ```ts
  it("round-trips the geographic camera exactly", () => {
    const decoded = decodeShareState(encodeShareState(makeState()))!;
    expect(decoded.cam).toEqual(CAM);
  });

  it("returns null for a v2 link (cp/ct tuples) instead of restoring a nonsense camera", () => {
    const legacy =
      "share=" +
      btoa(
        JSON.stringify({
          cp: [1, 2, 3],
          ct: [0, 0, 0],
          dt: "x",
          pm: "object",
          layers: [],
        }),
      );
    expect(decodeShareState(legacy)).toBeNull();
  });

  it("returns null when cam is missing a component", () => {
    const bad =
      "share=" +
      btoa(
        JSON.stringify({
          v: 3,
          cam: { lng: 1, lat: 2 },
          dt: "x",
          pm: "object",
          layers: [],
        }),
      );
    expect(decodeShareState(bad)).toBeNull();
  });

  it("normalises a missing layers array to []", () => {
    const noLayers =
      "share=" +
      btoa(JSON.stringify({ v: 3, cam: CAM, dt: "x", pm: "object" }));
    expect(decodeShareState(noLayers)!.layers).toEqual([]);
  });
  ```

- [ ] **Step 2: Run — expect failure.** `npx vitest run tests/unit/persistence/urlShare.test.ts` → legacy link still decodes.
- [ ] **Step 3: Update `urlShare.ts`.** Delete the `cp`/`ct` fields and the legacy `modelUrl`/`rules`/`re` fields (lines 29–39); add `v: 3` and `cam`; the validation block (lines 71–80) becomes:
  ```ts
  const parsed = JSON.parse(json) as ShareableViewState;
  if (parsed.v !== 3) return null; // v1/v2 links carried scene-space cameras
  const c = parsed.cam as Partial<GeographicCamera> | undefined;
  if (
    !c ||
    ["lng", "lat", "height", "heading", "pitch", "roll"].some(
      (k) => typeof (c as Record<string, unknown>)[k] !== "number",
    )
  ) {
    return null;
  }
  if (typeof parsed.dt !== "string") return null;
  if (!Array.isArray(parsed.layers)) return { ...parsed, layers: [] };
  return parsed;
  ```
- [ ] **Step 4: Run — expect pass.** `npx vitest run tests/unit/persistence/urlShare.test.ts` → 11 passed.
- [ ] **Step 5: Commit.**
  ```bash
  git add -A && git commit -m "feat: encode a geographic camera in share links and reject v1/v2 hashes" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C20: `App.tsx` save/restore/share on geographic camera + `ready` signal

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/src/app/App.tsx`
- Delete: `/data2/hideba/multiroof-viewer/src/scene/cameraStateBridge.ts`, `/data2/hideba/multiroof-viewer/tests/unit/scene/cameraStateBridge.test.ts`
- Test: none new (covered by C18/C19 unit tests plus the browser smoke below)

**Interfaces:**

- Consumes: `CitySceneHandle.getCameraState(): GeographicCamera | null`, `setCameraState(cam: GeographicCamera): void`, `ready: Promise<void>` — resolve-or-reject (Task B11a + Task C13)
- Produces: `handleSave`, `handleRestore`, `handleShare`, share-hash effect — all camera-tuple-free

**Steps:**

- [ ] **Step 1: Rewrite `handleSave` (`App.tsx:264-301`).** `const camera = sceneRef.current?.getCameraState(); if (!camera) return;` and `captureSnapshot({ ..., camera, datetime, pickMode })` — the `cameraPosition`/`cameraTarget` arguments (lines 288–289) are deleted.
- [ ] **Step 2: Rewrite `handleRestore` (`App.tsx:303-452`).**
  - Wrap the `restoreSnapshot(snapshot)` call so the version rejection surfaces as a toast:
    ```ts
    let viewState: ViewState;
    try {
      viewState = restoreSnapshot(snapshot);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to restore workspace.");
      setTimeout(() => setToast(null), 6000); // longer: this one is an explanation, not a status
      return;
    }
    ```
  - `migrateSnapshot({ layers: ... })` becomes `normalizeLayers(legacyLayers as unknown as RawLayerSnapshot[])`, and the legacy single-model fallback (lines 322–334) is deleted along with `snapshot.modelRef`.
  - The trailing `setTimeout` (lines 437–443) is replaced by the explicit ready signal. `ready` is **resolve-or-reject** (Shared Interface Contract), so it is always awaited inside `try`/`catch` — an engine that failed to start must surface as a toast, not as a silently skipped camera restore or an unhandled rejection:
    ```ts
    try {
      await sceneRef.current!.ready;
      sceneRef.current!.setCameraState(viewState.camera);
    } catch (e) {
      setToast(
        `Workspace restored, but the 3D view could not start: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      setTimeout(() => setToast(null), 6000);
    }
    ```
    A geographic camera does not depend on any layer having mounted (unlike the old scene-space camera, which is why the 100 ms hack existed), so no layer-load wait remains. `cameraTimerRef` (declared at `App.tsx:118`) is deleted.
  - `sceneRef.current` may still be `null` here if a restore is triggered before the viewport has mounted. Gate on the ref instead of optional-chaining past it — `sceneRef.current?.ready` on a null ref evaluates to `undefined`, which `await` resolves immediately, silently skipping the restore. Add the ref-mount gate in Step 4b and use it in both flows.
- [ ] **Step 3: Rewrite `handleShare` (`App.tsx:462-496`)** — `const camera = sceneRef.current?.getCameraState(); if (!camera) return;` and the state literal becomes `{ v: 3, layers: [...], cam: camera, dt: datetime.toISOString(), pm: pickMode }`.
- [ ] **Step 4: Rewrite the share-hash effect (`App.tsx:498-578`)** — delete the legacy `modelUrl` fallback (lines 511–527) since `decodeShareState` now rejects v1/v2 outright, open streaming layers through `openStreamingLayer({ plugin: await sceneRef.current!.getStreamingPlugin(), ... })` (Task C13 Step 5 queues that behind readiness, so there is no `fcbPluginRef.current!` to dereference), and replace the trailing `setTimeout` with the same guarded await:

  ```ts
  try {
    await sceneRef.current!.ready;
    sceneRef.current!.setCameraState(shared.cam);
  } catch (e) {
    setToast(
      `Shared view could not be opened: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    setTimeout(() => setToast(null), 6000);
  }
  ```

- [ ] **Step 4b: Gate both flows on the viewport ref actually existing**

  The share-hash effect runs on mount, and `useImperativeHandle` has not necessarily populated `sceneRef` by then. Rather than sprinkling `?.`, hold the pending work until the ref exists:

  ```tsx
  // src/app/App.tsx
  const [sceneReady, setSceneReady] = useState(false);
  const sceneRef = useRef<CitySceneHandle | null>(null);

  /** Ref callback: flips `sceneReady` the moment the viewport publishes its
   *  handle. Effects that need the handle depend on this flag, so a share
   *  hash arriving before mount is applied when the handle appears instead of
   *  being dropped by an optional chain. */
  const setSceneRef = useCallback((handle: CitySceneHandle | null) => {
    sceneRef.current = handle;
    setSceneReady(handle !== null);
  }, []);
  ```

  Render `<NavaraViewport ref={setSceneRef} … />`, and add `sceneReady` to the dependency array of the share-hash effect with an early `if (!sceneReady) return;`. `handleRestore`/`handleSave`/`handleShare` are user-initiated and therefore always run after mount, but they keep their `if (!sceneRef.current) return;` guard for type narrowing.

  Also add a test seam to `tests/unit/persistence/captureRestore.test.ts`: a case asserting that a restore whose `ready` **rejects** still restores the layers and reports the error, rather than throwing out of the handler.

  ```ts
  it("restores layers and surfaces the engine error when the viewport never starts", async () => {
    const scene = {
      ready: Promise.reject(new Error("wasm boom")),
      setCameraState: vi.fn(),
      getCameraState: () => null,
    };
    scene.ready.catch(() => undefined);
    await expect(restoreWorkspace(snapshotV3, scene as never)).resolves.toEqual(
      expect.objectContaining({ cameraApplied: false }),
    );
    expect(scene.setCameraState).not.toHaveBeenCalled();
  });
  ```

  (extract the restore body App.tsx calls into `restoreWorkspace(snapshot, scene)` in `src/persistence/restoreSnapshot.ts` if it is not already separable — the point is that the rejection path is covered by a test, not only by the browser smoke below).

- [ ] **Step 5: Delete the temporary camera bridge.** `src/scene/cameraStateBridge.ts` existed only to squeeze a geographic camera into the v2 snapshot's two 3-tuples (Task B9); snapshot v3 stores the camera directly, so it has no callers left:
  ```bash
  grep -rn "cameraStateBridge\|cameraStateToTuples\|cameraStateFromTuples" src tests
  ```
  Expected after Steps 1–4: no matches (if `App.tsx` still imports `cameraStateFromTuples`/`cameraStateToTuples`, remove those imports — the geographic camera now flows straight from `getCameraState()` into `captureSnapshot`/`encodeShareState` and back through `setCameraState`). Then:
  ```bash
  git rm src/scene/cameraStateBridge.ts tests/unit/scene/cameraStateBridge.test.ts
  ```
- [ ] **Step 6: Run.** `npx tsc -b --noEmit && npx vitest run` → clean, all app suites green.
- [ ] **Step 7: Browser smoke the save/restore round trip.**

  ```bash
  agent-browser open http://localhost:5173
  agent-browser click @e_load_sample
  agent-browser click @e_save
  agent-browser eval "location.reload()"
  agent-browser snapshot -i
  agent-browser click @e_restore_latest
  ```

  Expected: the model reloads and the camera lands at the saved viewpoint (same visible extent as before the reload, verified from the snapshot), with no 100 ms flash of the default camera. Then click Share, paste the copied hash into a new tab, and confirm the same viewpoint — including that a **share hash present on first load** (the ref-not-yet-mounted case Step 4b guards) still restores the camera. Finally, hand-craft a `#share=` hash from an old v2 payload and confirm it is ignored (default view, no crash).

  If Task B1 Step 7 recorded `PROGRAMMATIC_MOVE_EMITS = true`, also confirm the restore does **not** kick off a streaming commit: open the FCB layer, save, reload, restore, and check the status bar goes straight to `idle` without a `probing → fetching` cycle (Task C7 Step 3b's `suppress()` is what makes this hold; wrap the `setCameraState` call in it).

- [ ] **Step 8: Commit.**
  ```bash
  git add -A && git commit -m "refactor: save, restore and share a geographic camera behind an explicit viewport-ready signal" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

## M7.7 — Teardown, dependency pinning, docs

### Task C21: Delete the dead R3F scene modules

**Files:**

- Delete: `src/scene/CitySceneR3F.tsx`, `src/scene/PostProcessingEffects.tsx`, `src/scene/SceneEffectComposer.tsx`, `src/scene/syncEffectComposerCameraSettings.ts`, `src/scene/GoogleTilesLayer.tsx`, `src/scene/TileCreasedNormalsPlugin.ts`, `src/scene/highlightMesh.ts`, `src/scene/applyRuleColors.ts`, `src/scene/resolvePicking.ts`, `src/scene/surfaceColors.ts`, `src/scene/buildCityMesh.ts`, `spike.html`, `src/spike/navaraMrtSpike.ts` (the Task B1 spike page and entry — its findings live on in `docs/superpowers/research/2026-08-01-navara-spike-findings.md`)
- Delete (tests): `tests/unit/scene/sceneEffectComposer.test.tsx`, `tests/unit/scene/postProcessingEffects.test.tsx`, `tests/unit/scene/googleTilesLayer.test.ts`, `tests/unit/scene/buildCityMesh.test.ts`, `tests/unit/scene/buildCityMeshArrays.test.ts`, `tests/unit/scene/ruleColorsWorkerSafe.test.ts`, `tests/unit/scene/highlightMesh.test.ts`, `tests/unit/scene/resolveSelection.test.ts`
- **Not** deleted here (already gone): `tests/unit/scene/layerSceneMap.test.ts` (Task B11b), `tests/unit/scene/cameraStateBridge.test.ts` (Task C20)

**Deletion inventory (corrected 2026-08-02 after external review).** The drafted version expected four test files to be "absent, moved to the plugin repo in M7.2" and then did not delete them. Tracing what the A- and B-tasks actually did to each:

| App test file                                                                                | What actually happened to it                                                                                                                                                                         | Disposition here                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildCityMeshArrays.test.ts`                                                                | Task A11 **reduced** it to the `buildCityMeshArrays -> buildCityMesh wrapper wiring` describe; the oracle describes were copied to the plugin repo. What remains tests `src/scene/buildCityMesh.ts`. | **Delete** — its only subject is deleted in this task                                                                                                                                                       |
| `buildCityMesh.test.ts`                                                                      | Task A11 removed its `computeOriginOffset` describe; the rest still tests `src/scene/buildCityMesh.ts`.                                                                                              | **Delete**                                                                                                                                                                                                  |
| `ruleColorsWorkerSafe.test.ts`                                                               | Task A12 removed the `srgbHexToLinear` describes; the `buildRuleColorsFromArrays` / `buildRuleColors` describes stayed and test `src/scene/applyRuleColors.ts`.                                      | **Delete** — `applyRuleColors.ts` is deleted in this task; the behaviour lives on in `packages/navara-core/tests/styling/buildStyleColors.test.ts` and `tests/unit/features/rules/compileEvaluator.test.ts` |
| `highlightMesh.test.ts`                                                                      | Untouched by A/B. Tests `src/scene/highlightMesh.ts`, whose logic moved to `surfaceColorLayers.ts` in Task B5 (with its own tests).                                                                  | **Delete**                                                                                                                                                                                                  |
| `resolveSelection.test.ts`                                                                   | Untouched by A/B. Tests `src/scene/resolvePicking.ts`, whose logic moved to `cityModelMesh.ts` (B6) and `pickEventHandlers.ts` (B12), both tested.                                                   | **Delete**                                                                                                                                                                                                  |
| `layerSceneMap.test.ts`                                                                      | **Already deleted in Task B11b** (`git rm`), because it imported `CitySceneR3F`.                                                                                                                     | Not here — `git rm` would fail                                                                                                                                                                              |
| `cameraStateBridge.test.ts`                                                                  | **Already deleted in Task C20** with the bridge module.                                                                                                                                              | Not here                                                                                                                                                                                                    |
| `sceneEffectComposer.test.tsx`, `postProcessingEffects.test.tsx`, `googleTilesLayer.test.ts` | Untouched; still test modules deleted in this task. `googleTilesLayer.test.ts`'s replacement is `googleTiles.test.ts` (Task C17).                                                                    | **Delete**                                                                                                                                                                                                  |

Every deletion here is safe because the behaviour it covered is covered elsewhere — the plugin repo's suites, `pickEventHandlers.test.ts`, `handleSync.test.ts`, `compileEvaluator.test.ts`, `googleTiles.test.ts`. No coverage is lost, only duplicated coverage of deleted modules.

**Steps:**

- [ ] **Step 1: Confirm the inventory before touching anything.**

  ```bash
  ls tests/unit/scene/
  ```

  Expect exactly: `buildCityMesh.test.ts`, `buildCityMeshArrays.test.ts`, `cursorCrsReadout.test.ts`, `geographicCamera.test.ts`, `googleTiles.test.ts`, `googleTilesLayer.test.ts`, `handleSync.test.ts`, `highlightMesh.test.ts`, `navaraSession.test.ts`, `navaraViewport.test.tsx`, `navaraViewportStreaming.test.tsx`, `pickEventHandlers.test.ts`, `postProcessingEffects.test.tsx`, `resolveSelection.test.ts`, `ruleColorsWorkerSafe.test.ts`, `sceneEffectComposer.test.tsx`, `timeAnimation.test.ts`.

  `layerSceneMap.test.ts` and `cameraStateBridge.test.ts` must **not** be there (B11b and C20 removed them). If either is still present, the earlier task's `git rm` did not run — fix that first, because the `git rm` below does not name them and would otherwise leave a test importing a deleted module.

- [ ] **Step 2: Prove nothing still imports them.**
  ```bash
  grep -rn "CitySceneR3F\|PostProcessingEffects\|SceneEffectComposer\|syncEffectComposerCameraSettings\|GoogleTilesLayer\|TileCreasedNormalsPlugin\|scene/highlightMesh\|scene/applyRuleColors\|scene/resolvePicking\|scene/surfaceColors\|scene/buildCityMesh" src tests
  ```
  Expected: no matches (if any remain, fix the importer before deleting).
- [ ] **Step 3: Delete.**
  ```bash
  git rm src/scene/CitySceneR3F.tsx src/scene/PostProcessingEffects.tsx src/scene/SceneEffectComposer.tsx src/scene/syncEffectComposerCameraSettings.ts src/scene/GoogleTilesLayer.tsx src/scene/TileCreasedNormalsPlugin.ts src/scene/highlightMesh.ts src/scene/applyRuleColors.ts src/scene/resolvePicking.ts src/scene/surfaceColors.ts src/scene/buildCityMesh.ts
  git rm spike.html src/spike/navaraMrtSpike.ts
  git rm tests/unit/scene/sceneEffectComposer.test.tsx tests/unit/scene/postProcessingEffects.test.tsx tests/unit/scene/googleTilesLayer.test.ts tests/unit/scene/buildCityMesh.test.ts tests/unit/scene/buildCityMeshArrays.test.ts tests/unit/scene/ruleColorsWorkerSafe.test.ts tests/unit/scene/highlightMesh.test.ts tests/unit/scene/resolveSelection.test.ts
  ```
- [ ] **Step 4: Run.** `npx tsc -b --noEmit && npx vitest run` → clean, **0 failed files**.

  `ls src/scene/` must now show exactly: `NavaraViewport.tsx`, `ViewAlignButtons.tsx`, `cursorCrsReadout.ts`, `geographicCamera.ts`, `googleTiles.ts`, `handleSync.ts`, `navaraSession.ts`, `pickEventHandlers.ts`, `timeAnimation.ts`.

  `ls tests/unit/scene/` must show exactly: `cursorCrsReadout.test.ts`, `geographicCamera.test.ts`, `googleTiles.test.ts`, `handleSync.test.ts`, `navaraSession.test.ts`, `navaraViewport.test.tsx`, `navaraViewportStreaming.test.tsx`, `pickEventHandlers.test.ts`, `timeAnimation.test.ts` — nine files, each testing a module that still exists. If `npx vitest run` reports a failure, it will be an import of a just-deleted module: find it with the Step 2 grep rather than restoring the file.

- [ ] **Step 5: Commit.**
  ```bash
  git commit -m "refactor: delete the React Three Fiber scene stack" -m "Also removes the eight tests whose only subjects were these modules; their behaviour is covered by the plugin repo suites and by pickEventHandlers/handleSync/compileEvaluator/googleTiles tests." -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C22: Delete the migrated streaming modules

**Files:**

- Delete: `src/features/streaming/{constants,tileGrid,cellCache,levelPolicy,throttleGates,bucketFeatures,objectRecords,workerProtocol,workerClient,fcb.worker,sceneTransform,viewportFootprint,useTileStreaming}.ts`
- Delete (tests): `tests/unit/features/streaming/{tileGrid,cellCache,levelPolicy,throttleGates,bucketFeatures,objectRecords,residentModel,workerClient,fcbWorkerCache,fcbWorkerTraversal,useTileStreaming,viewportFootprint,sceneTransform}.test.ts`
- Kept: `src/features/streaming/{streamStore,openStreamingLayer,residentModel,useResidentSurfaces}.ts` and `tests/unit/features/streaming/{streamStore,openStreamingLayer,useResidentSurfaces}.test.ts`

**Steps:**

- [ ] **Step 1: Prove nothing app-side still imports them.**
  ```bash
  grep -rn "streaming/\(constants\|tileGrid\|cellCache\|levelPolicy\|throttleGates\|bucketFeatures\|objectRecords\|workerProtocol\|workerClient\|fcb.worker\|sceneTransform\|viewportFootprint\|useTileStreaming\)" src tests
  ```
  Expected: no matches. (`LodSelector.tsx` imports `cellSize` today — it must now import it from `@cityjson/navara-flatcitybuf`; fix that import first if the grep flags it.)
- [ ] **Step 2: Delete.**
  ```bash
  git rm src/features/streaming/{constants,tileGrid,cellCache,levelPolicy,throttleGates,bucketFeatures,objectRecords,workerProtocol,workerClient,fcb.worker,sceneTransform,viewportFootprint,useTileStreaming}.ts
  git rm tests/unit/features/streaming/{tileGrid,cellCache,levelPolicy,throttleGates,bucketFeatures,objectRecords,residentModel,workerClient,fcbWorkerCache,fcbWorkerTraversal,useTileStreaming,viewportFootprint,sceneTransform}.test.ts
  ```
- [ ] **Step 3: Run.** `npx tsc -b --noEmit && npx vitest run` → clean; `tests/unit/features/streaming/` now holds exactly three files.
- [ ] **Step 4: Commit.**
  ```bash
  git commit -m "refactor: remove the streaming engine now owned by @cityjson/navara-flatcitybuf" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C23: Uninstall the R3F stack, pin `three` and `postprocessing`

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/package.json`, `package-lock.json`

**Steps:**

- [ ] **Step 1: Confirm zero remaining importers.**
  ```bash
  grep -rn "@react-three/\|@takram/\|3d-tiles-renderer\|from \"suncalc\"\|from \"three\"" src tests
  ```
  Expected: no matches for `@react-three/*`, `@takram/*`, `3d-tiles-renderer`, `suncalc`. Matches for `three` are allowed **only** if `NavaraViewport.tsx` genuinely needs a Three type; note each one in the commit message.
- [ ] **Step 2: Uninstall.**
  ```bash
  npm uninstall @react-three/fiber @react-three/drei @react-three/postprocessing @takram/three-atmosphere @takram/three-clouds @takram/three-geospatial 3d-tiles-renderer suncalc @types/suncalc
  ```
- [ ] **Step 3: Pin the peer-dep versions exactly** (installed today: `three@0.183.2`, `postprocessing@6.39.0`, `@types/three@0.183.1` — all satisfy Navara's `three >= 0.183.0` / `postprocessing >= 6.38.0`):
  ```bash
  npm install --save-exact three@0.183.2 postprocessing@6.39.0
  npm install --save-exact --save-dev @types/three@0.183.1
  ```
  Verify `package.json` now reads `"three": "0.183.2"`, `"postprocessing": "6.39.0"`, `"@types/three": "0.183.1"` — no carets. This closes the "unpinned three" known issue.
- [ ] **Step 4: Verify the install graph resolves the Navara peers.**
  ```bash
  npm ls three postprocessing @navaramap/three
  ```
  Expected: a single `three@0.183.2` and `postprocessing@6.39.0` at the root with no `UNMET PEER DEPENDENCY` lines.
- [ ] **Step 5: Run the full gate.** `npx tsc -b --noEmit && npx vitest run && npm run build` → all green; the production bundle builds.
- [ ] **Step 6: Commit.**
  ```bash
  git add package.json package-lock.json && git commit -m "refactor: drop the R3F/@takram/3d-tiles-renderer/suncalc dependencies and pin three + postprocessing" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C24: Update `CLAUDE.md`

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/CLAUDE.md`

**Steps:**

- [ ] **Step 1: Tech Stack section** — replace the `3D` and `Geospatial` bullets with:
  ```md
  - **3D**: Navara (`@navaramap/three`, `@navaramap/three-default-plugin`) on a pinned Three.js backend; no React Three Fiber
  - **CityJSON plugins**: `@cityjson/navara-core`, `@cityjson/navara-cityjson`, `@cityjson/navara-flatcitybuf` from the `packages/cityjson-navara-plugins` git submodule (pnpm workspace, consumed via `file:` deps + a Vite alias to `src/` in dev)
  - **Geospatial**: proj4 (CRS), WGS84 ENU frames from `@cityjson/navara-core`
  ```
- [ ] **Step 2: Project Structure** — change `scene/` to list `NavaraViewport.tsx` (imperative ThreeView host + store→handle sync), `googleTiles.ts`, `timeAnimation.ts`, `ViewAlignButtons.tsx`; change `features/streaming/` to "store + open wrapper only — the streaming engine lives in `@cityjson/navara-flatcitybuf`"; add `packages/cityjson-navara-plugins/` to the tree.
- [ ] **Step 3: Key Architecture Decisions** — replace the whole list with:
  ```md
  - **Real georeferencing**: every layer (and every streaming cell) gets its own ENU frame at its centre, and **every vertex is transformed exactly** — source (x, y, z) → proj4 → lng/lat → + `heightOffset` → geodetic-to-ECEF → inverse ENU frame — by `projectPositionsToEnu` in `@cityjson/navara-core`. Source-CRS deltas are _not_ ENU metres (projection scale factor + grid convergence), so treating them as such would mis-place and slightly rotate anything more than a few hundred metres from the origin. ENU is x=east/y=north/z=up, identical to CityJSON, so there is no axis swap and no shared scene origin; the old origin-offset + `-π/2` rotation + `sceneTransform` sign convention are gone. The per-vertex cost is paid once per geometry build (LoD change, or a worker decoding a cell), never per frame.
  - **CRS gate**: a layer whose CRS cannot be resolved to a proj4 def is rejected at load. There is no planar/local viewing mode.
  - **Vertical datum**: source z is an orthometric height above a local datum (NAP for EPSG:7415), not an ellipsoidal height, so `heightOffset` metres are added during the ENU transform. It is sampled from a real geoid model — `geoidHeightAt(lng, lat)` in `@cityjson/navara-core` reads EGM2008 undulation from the Re:Earth Terrain service (global, keyless, Terrain-RGB tiles) — because `ellipsoidal = orthometric + undulation`. Static layers render at 0 and are re-placed when the sample resolves (`CityModelMesh.setHeightOffset`); streaming layers await the sample in `openStream` before the first cell, so the worker bakes every cell in the right frame. `addCityModel`/`openStream` accept an explicit `heightOffset` that wins outright. See Known Issues.
  - **Per-layer rules**: unchanged. Static layers compile to a `SurfaceStyleEvaluator` (`handle.setStyle`); streaming layers send rules to the worker (`handle.setRules`), which bakes vertex colours per cell.
  - **Streaming**: camera-driven commits are triggered by Navara `movestart`/`move`/`moveend` + `idle` (never a render-loop timer); each resident cell is its own mesh in its own ENU frame.
  - **CitySceneHandle**: `fitAll`, `fitLayer`, `alignView`, `getCameraState`, `setCameraState` — camera state is geographic `{lng, lat, height, heading, pitch, roll}` — plus a `ready` promise that resolves after `view.init()`.
  - **Persistence**: snapshot/share version 3. Older snapshots and share links are rejected with an explanatory message; there is no migration shim.
  ```
- [ ] **Step 4: Known Issues** — delete the `three: "latest"` bullet (resolved) and the @takram atmosphere bullet (obsolete); keep the vite-plus test-runner bullet verbatim; add:
  ```md
  - Navara is alpha (`@navaramap/* 0.0.5`, no public changelog). `three` and `postprocessing` are pinned exactly (0.183.2 / 6.39.0) to satisfy its peer ranges; bump them only together with a Navara upgrade.
  - The plugin monorepo is a git submodule: commit inside `packages/cityjson-navara-plugins` first, then commit the parent pointer bump.
  - **Vertical placement depends on a third-party service, and is EGM2008-accurate, not NAP-exact.** `geoidHeightAt()` fetches from `terrain.reearth.land`, which is **best effort with no SLA**. On any failure (offline dev, service down, unexpected tile encoding) it resolves `0` with one `console.warn` per layer and the model renders at its old, geoid-separation-low position — visibly sunk against photoreal terrain, not missing. Even on success the residual is decimetre-level: EGM2008 is a global model and NAP is a national one, and Terrain-RGB quantises to 0.1 m. That is well inside this viewer's tolerance; do not treat placed heights as survey-grade.
  - **Attribution for the geoid service is a licence obligation, not a courtesy.** CC BY 4.0 Mapterhorn and ODbL OpenStreetMap must stay visible; `src/ui/viewport/AttributionOverlay.tsx` renders them unconditionally (the geoid is sampled for every georeferenced layer) and `GEOID_ATTRIBUTION` in `@cityjson/navara-core` is the canonical string list. Do not drop the overlay when disabling Google Tiles.
  - Plugin packages import `@navaramap/*` **only** from named engine-binding modules (`CityJSONPlugin.ts`, `CityModelMeshDesc.ts`, `CityMeshArraysDesc.ts`, `engineRays.ts`, `plugin.ts`). Everything else takes descriptors, pick rays and mesh factories as injected seams, which is what keeps plugin unit tests runnable in Node. Plugin tests import the specific module, never the package barrel.
  ```
- [ ] **Step 5: Milestones** — append `M7.5`, `M7.6`, `M7.7` as Complete, and add `npx vitest run` / `pnpm vitest run` to the Commands block for app vs plugin tests.
- [ ] **Step 6: Verify no stale references.** `grep -n "R3F\|OrbitControls\|takram\|drei\|suncalc\|sceneTransform" CLAUDE.md` → only the historical mentions you intend to keep (ideally none).
- [ ] **Step 7: Commit.**
  ```bash
  git add CLAUDE.md && git commit -m "docs: update CLAUDE.md for the Navara rendering stack and plugin monorepo" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C25: Update `docs/roadmap.md`

**Files:**

- Modify: `/data2/hideba/multiroof-viewer/docs/roadmap.md`

**Steps:**

- [ ] **Step 1: Add a Milestone 8 section** (the existing "Milestone 7" heading is CityGML; the Navara work is numbered M7.1–M7.7 in the spec but belongs under its own heading to avoid colliding with the CityGML M7.x numbering — note the mapping explicitly):

  ```md
  ## Milestone 8: Navara Rendering Migration (spec milestones M7.1–M7.7)

  Goal: replace the Three.js + React Three Fiber rendering layer with the Navara globe engine, and extract the CityJSON rendering pipeline into a reusable plugin monorepo.

  Note: the spec numbers these M7.1–M7.7; that numbering is independent of the CityGML M7.x milestones above.

  Deliverables:

  - `cityjson-navara-plugins` monorepo (submodule): `@cityjson/navara-core`, `@cityjson/navara-cityjson`, `@cityjson/navara-flatcitybuf`, `@cityjson/navara-cityparquet` (scaffold only) ✓
  - `NavaraViewport` replacing `CitySceneR3F`, behind the same `CitySceneHandle` contract ✓
  - Real ENU georeferencing per layer, with an exact per-vertex source-CRS→ENU transform and EGM2008 geoid-sampled vertical placement; CRS gate at load ✓
  - Picking, per-surface rule colouring, highlight, LoD on the plugin handles ✓
  - FlatCityBuf viewport streaming on Navara camera events, with the B1–B5 race fixes carried over as tests ✓
  - Engine-native atmosphere/sun/shadows; Google Photorealistic 3D Tiles as a native `3d-tiles` layer ✓
  - Geographic camera persistence (snapshot/share v3, older versions rejected) ✓
  - R3F/@takram/3d-tiles-renderer/suncalc removed; `three` and `postprocessing` pinned ✓

  Dropped in this migration (spec §9 non-goals): measure tool, box-select, vignette/lens-flare parity, non-georeferenced ("local") viewing mode, CityParquet implementation (`@cityjson/navara-cityparquet` stays a scaffold), a 3D-Tiles-conversion plugin, backward-compatible snapshots/share links, and a React wrapper for Navara (`NavaraViewport` stays a thin imperative host).

  Exit criteria:

  - A user can load CityJSON, CityJSONSeq and streaming FlatCityBuf layers onto the globe, pick and recolour them, animate the sun, and save/restore/share a viewpoint ✓
  - `npx tsc -b --noEmit`, `npx vitest run`, `pnpm vitest run` and `npm run build` are all green ✓

  Status: Complete.
  ```

- [ ] **Step 2: Update the M1/M6 status lines** that claim "Three.js scene bootstrap" / "Scene rendering uses R3F with proper lighting and shadows" — append `(superseded by Milestone 8: Navara)` to each rather than rewriting history.
- [ ] **Step 3: Commit.**
  ```bash
  git add docs/roadmap.md && git commit -m "docs: record the Navara rendering migration in the roadmap" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```

---

### Task C26: Full verification and final submodule pointer bump

**Files:**

- Modify: none (verification only), plus the parent pointer commit

**Steps:**

- [ ] **Step 1: Plugin repo gate.**

  ```bash
  cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
  pnpm -r build && pnpm vitest run
  ```

  Expected: every package builds (ESM + d.ts) and all plugin suites pass, including `enuFrame`, `sourceToEnu` (exact source-CRS→ENU parity), `geoidHeight` (Terrain-RGB decode + offline fallback, all against an injected fetch), `rules/evaluate` and `roofMetrics/*` (moved in A12), `viewportFootprint`, `navaraRays`, `settleController`, `commitPlanner` (B4), `cellMeshes` (B1/B2), `entryToArrays`, `streamLayer` (B1/B2/B3/B5 **plus** the C10b interaction-parity cases), `fcbWorkerCache` (B3 + the C5 ENU regression case).

  Also re-confirm the engine-isolation invariant, which every plugin unit test depends on:

  ```bash
  grep -rln "@navaramap" packages/navara-cityjson/src packages/navara-flatcitybuf/src | sort
  grep -rln "@navaramap" packages/navara-cityjson/test packages/navara-flatcitybuf/tests
  ```

  Expected: the first lists exactly `packages/navara-cityjson/src/CityJSONPlugin.ts`, `.../CityMeshArraysDesc.ts`, `.../CityModelMeshDesc.ts`, `packages/navara-flatcitybuf/src/engineRays.ts`, `.../plugin.ts`; the second prints nothing.

- [ ] **Step 2: App gate.**
  ```bash
  cd /data2/hideba/multiroof-viewer
  npx tsc -b --noEmit && npx vitest run && npm run build
  ```
  Expected: 0 type errors, 0 failed test files, a successful production build.
- [ ] **Step 3: Grep for orphans.**
  ```bash
  grep -rn "OrbitControls\|useThree\|@react-three\|@takram\|3d-tiles-renderer\|suncalc\|sceneTransform\|meshOffset\|worldToECEFMatrix\|LIGHTING_MASK_LAYER" src tests
  ```
  Expected: no matches.
- [ ] **Step 4: Browser smoke — the full parity checklist** against `npm run dev`:

  ```bash
  agent-browser open http://localhost:5173
  agent-browser snapshot -i
  ```

  1. **Load** — click "Load sample" (`delft.city.jsonl`). Expected: buildings render on the globe at Delft; status bar shows a non-zero triangle count.
  2. **Pick** — `agent-browser click @e_viewport_centre` then snapshot. Expected: the inspector shows the picked object's id/attributes; the mesh highlights.
  3. **Recolor** — open the Rules tab, enable the roof-suitability preset, snapshot. Expected: roof surfaces change colour; the legend overlay appears.
  4. **Stream** — add `https://storage.googleapis.com/cityjson/delft.fcb` as a layer, pan and zoom. Expected: cells load per settle, the status bar cycles `probing → fetching → idle` once per settle, and the LoD ladder in the sidebar populates.
  5. **Save/restore** — Save, reload the page, Restore. Expected: layers and camera return with no default-camera flash.
  6. **Console** — `agent-browser eval "window.__errors ?? []"` after installing an `onerror` collector, or read the console panel. Expected: no uncaught errors or unhandled rejections during the whole run.

- [ ] **Step 5: Final pointer bump.**
  ```bash
  git -C /data2/hideba/multiroof-viewer add packages/cityjson-navara-plugins
  git -C /data2/hideba/multiroof-viewer commit -m "feat: complete the Navara migration (M7.5-M7.7) and pin the plugin submodule" -m "Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
  ```
- [ ] **Step 6: Request a code review** per CLAUDE.md before pushing: run the `feature-dev:code-reviewer` agent at high effort over the full Part C diff (`git diff main...HEAD` plus the submodule log), and address any critical findings before the branch is merged.
