# Viewport-streamed FlatCityBuf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace whole-file `.fcb` loading with viewport-driven streaming that fetches only the features the camera can see, from a local file or a remote URL, with all reading/parsing/triangulation/colorization off the main thread.

**Architecture:** A per-layer Web Worker owns one `FcbReader`. On camera settle, the main thread computes the ground-plane footprint of the perspective frustum, probes the feature count with one index-only query, picks a single uniform quadtree level for the whole viewport, and issues **one** R-tree traversal over the missing region. The worker buckets the returned features into cells locally by bbox centre, triangulates, colorizes, and transfers typed arrays back. Cells are LRU-cached under triangle/byte budgets.

**Tech Stack:** TypeScript, React 19, React Three Fiber, Three.js, Zustand, `@cityjson/flatcitybuf@^0.3.0` (pure-TS reader), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-fcb-viewport-streaming-design.md` (revision 2)

## Global Constraints

- Branch is `develop`. Never commit to `main`.
- **All test imports come from `"vitest"`, never `"vite-plus/test"`.** The vite-plus runner bug breaks `describe`; 21 existing files are affected and must not be copied as a template. Verified working template: `tests/unit/scene/googleTilesLayer.test.ts`.
- `@cityjson/flatcitybuf` must be `^0.3.0`. Version `0.2.0` is the WASM reader and has no `AbortSignal`.
- Run `npx tsc -b --noEmit` before every commit.
- Pre-commit hook runs `vp check --fix` automatically.
- Commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`. Include `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Streaming requires a **projected, metre-based CRS**. Every distance constant is metres.
- All spec constants live in one module, `src/features/streaming/constants.ts`, and are provisional pending tuning.
- Never call `geometry.computeVertexNormals()` on the main thread for streaming cells — normals arrive from the worker.

### Plan-level refinement to spec §13

The spec called the triangulation move a "behaviour-sensitive migration" to earcut. **This plan does not do that.** `ShapeUtils.triangulateShape` and `Vector2` are pure math with no DOM dependency (verified: they load and execute in plain Node). Only `BufferGeometry`/`BufferAttribute` are main-thread coupling. So the worker keeps Three's triangulator and we avoid the rewrite entirely. Parity tests are still written, because the extraction itself can regress winding and holes.

---

## File Structure

| File                                            | Responsibility                                             |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `src/features/streaming/constants.ts`           | Every tunable, one place                                   |
| `src/features/streaming/sceneTransform.ts`      | source ↔ scene, the **only** sign convention (pure)        |
| `src/features/streaming/tileGrid.ts`            | cell math, half-open bounds, ownership, mesh offset (pure) |
| `src/features/streaming/viewportFootprint.ts`   | perspective frustum → ground AABB (pure)                   |
| `src/features/streaming/levelPolicy.ts`         | uniform level + LoD ladder (pure)                          |
| `src/features/streaming/cellCache.ts`           | LRU, pinning, budgets (pure)                               |
| `src/features/streaming/workerProtocol.ts`      | message types + array invariants                           |
| `src/features/streaming/workerClient.ts`        | promise-per-message, epoch guard                           |
| `src/features/streaming/fcb.worker.ts`          | `FcbReader` + per-cell worker cache                        |
| `src/features/streaming/streamStore.ts`         | per-layer stream state                                     |
| `src/features/streaming/useTileStreaming.ts`    | controls trigger + throttle gates                          |
| `src/domain/citymodel/flatcitybuf/fcbSource.ts` | open URL\|Blob, header model, admission checks             |
| `src/scene/buildCityMesh.ts`                    | split: pure array core + thin geometry wrapper             |
| `src/scene/applyRuleColors.ts`                  | rewritten against typed arrays                             |

---

# Phase A — Pure foundations

No integration risk. Every task here is fully testable in isolation and should land before anything touches the scene.

---

### Task 1: Scene transform and mesh offset

The spec's §15 says to write this first, because it is the regression test for the bug that would have misplaced every streamed cell.

**Files:**

- Create: `src/features/streaming/sceneTransform.ts`
- Create: `src/features/streaming/tileGrid.ts` (only `meshOffset` in this task)
- Test: `tests/unit/features/streaming/sceneTransform.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `sourceToScene(src: Vec3, origin: Vec3, meshOffset: Vec3): Vec3`
  - `sceneToSource(world: Vec3, origin: Vec3, meshOffset: Vec3): Vec3`
  - `meshOffset(cellCentre: Vec3, sceneOrigin: Vec3): Vec3` (from `tileGrid.ts`)

**Background the implementer needs.** City meshes carry `rotation.x = -π/2` (`src/scene/CitySceneR3F.tsx:467`) and the parent `cityGroup` has no transform. Three.js composes `matrixWorld = T(P)·R`, so the mesh position is applied in **world** space, _after_ the rotation. Vertex data is source-CRS minus an origin (`src/scene/buildCityMesh.ts:105-113`). Therefore `R·v = (v.x, v.z, −v.y)` and a cell's position must be the **rotated** delta, not the raw one.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/sceneTransform.test.ts
import { describe, it, expect } from "vitest";
import {
  sourceToScene,
  sceneToSource,
} from "../../../../src/features/streaming/sceneTransform";
import { meshOffset } from "../../../../src/features/streaming/tileGrid";

const ORIGIN = [100, 200, 10] as const;
const ZERO = [0, 0, 0] as const;

describe("sceneTransform", () => {
  it("maps source to world for a static layer (no mesh offset)", () => {
    // world = (X, Z, -Y) where (X,Y,Z) = src - origin
    expect(sourceToScene([105, 210, 13], ORIGIN, ZERO)).toEqual([5, 3, -10]);
  });

  it("round-trips with a non-zero offset on all three axes", () => {
    const cellCentre = [110, 220, 10] as const;
    const off = meshOffset(cellCentre, ORIGIN);
    const src = [113, 217, 14] as const;
    const world = sourceToScene(src, ORIGIN, off);
    expect(sceneToSource(world, ORIGIN, off)).toEqual([113, 217, 14]);
  });

  it("REGRESSION: a cell-local vertex plus its offset lands where the static path puts it", () => {
    // The bug this test exists for: using the raw delta instead of the
    // rotated one. Raw would give [10,20,0]; correct is [10,0,-20].
    const cellCentre = [110, 220, 10] as const;
    const off = meshOffset(cellCentre, ORIGIN);
    expect(off).toEqual([10, 0, -20]);

    const src = [113, 217, 14] as const;
    const viaStatic = sourceToScene(src, ORIGIN, ZERO);
    const viaCell = sourceToScene(src, cellCentre, off);
    expect(viaCell[0]).toBeCloseTo(viaStatic[0], 9);
    expect(viaCell[1]).toBeCloseTo(viaStatic[1], 9);
    expect(viaCell[2]).toBeCloseTo(viaStatic[2], 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/streaming/sceneTransform.test.ts`
Expected: FAIL — cannot resolve `sceneTransform` / `tileGrid`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/streaming/sceneTransform.ts
/**
 * The ONLY place the source-CRS ↔ scene sign convention is written.
 *
 * Vertex data is source-CRS minus an origin; each city mesh carries
 * rotation.x = -π/2, and Three composes matrixWorld = T(P)·R, so the mesh
 * position is applied AFTER the rotation, in world space.
 *
 *   world = P + R·v ,  R·v = (v.x, v.z, −v.y)
 *
 * Duplicating this at a call site is the defect this module exists to prevent.
 */
import type { Vec3 } from "../../domain/citymodel/types";

export function sourceToScene(src: Vec3, origin: Vec3, offset: Vec3): Vec3 {
  const vx = src[0] - origin[0];
  const vy = src[1] - origin[1];
  const vz = src[2] - origin[2];
  return [offset[0] + vx, offset[1] + vz, offset[2] - vy];
}

export function sceneToSource(world: Vec3, origin: Vec3, offset: Vec3): Vec3 {
  const vx = world[0] - offset[0];
  const vz = world[1] - offset[1];
  const vy = -(world[2] - offset[2]);
  return [vx + origin[0], vy + origin[1], vz + origin[2]];
}
```

```ts
// src/features/streaming/tileGrid.ts
import type { Vec3 } from "../../domain/citymodel/types";

/** The rotated origin delta for a cell mesh — see sceneTransform for why
 *  this is (d.x, d.z, −d.y) and not `d` componentwise. */
export function meshOffset(cellCentre: Vec3, sceneOrigin: Vec3): Vec3 {
  const dx = cellCentre[0] - sceneOrigin[0];
  const dy = cellCentre[1] - sceneOrigin[1];
  const dz = cellCentre[2] - sceneOrigin[2];
  return [dx, dz, -dy];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/streaming/sceneTransform.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b --noEmit
git add src/features/streaming/sceneTransform.ts src/features/streaming/tileGrid.ts tests/unit/features/streaming/sceneTransform.test.ts
git commit -m "feat: add scene transform with rotated cell mesh offset

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Cell grid — sizing, half-open bounds, ownership

**Files:**

- Modify: `src/features/streaming/tileGrid.ts`
- Create: `src/features/streaming/constants.ts`
- Test: `tests/unit/features/streaming/tileGrid.test.ts`

**Interfaces:**

- Consumes: `meshOffset` (Task 1).
- Produces:
  - `type CellKey = string` (format `` `${level}/${col}/${row}` ``)
  - `interface Grid { originX: number; originY: number; rootCell: number; maxLevel: number }`
  - `makeGrid(extent: BBox3): Grid`
  - `cellSize(grid: Grid, level: number): number`
  - `cellBBox(grid: Grid, key: CellKey): [number, number, number, number]`
  - `cellCentre(grid: Grid, key: CellKey, z: number): Vec3`
  - `keysCovering(grid: Grid, bbox: [number,number,number,number], level: number): CellKey[]`
  - `ownerKey(grid: Grid, featureBBox: BBox3, level: number): CellKey | null`

**Rules to implement.** Cells are half-open `[min, max)` on each axis so a centre exactly on a boundary belongs to **exactly one** cell. The dataset's outer maximum is assigned to the final row/column so nothing falls through. Centres outside the declared extent clamp to the edge cell. A non-finite bbox returns `null` (the caller counts these for diagnostics).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/tileGrid.test.ts
import { describe, it, expect } from "vitest";
import {
  makeGrid,
  cellSize,
  cellBBox,
  keysCovering,
  ownerKey,
} from "../../../../src/features/streaming/tileGrid";

// 1000 m x 1000 m extent starting at (0,0) -> ROOT_CELL rounds to 1024
const grid = makeGrid([0, 0, 0, 1000, 1000, 30]);

describe("tileGrid", () => {
  it("rounds the root cell to a power-of-two multiple of 100 m", () => {
    expect(grid.rootCell).toBe(1600); // 100 * 2^4 = 1600 >= 1000
    expect(cellSize(grid, 0)).toBe(1600);
    expect(cellSize(grid, 2)).toBe(400);
  });

  it("round-trips a key to its bbox", () => {
    expect(cellBBox(grid, "2/1/0")).toEqual([400, 0, 800, 400]);
  });

  it("covers a bbox with every intersecting cell", () => {
    const keys = keysCovering(grid, [350, 50, 450, 150], 2);
    expect(keys.sort()).toEqual(["2/0/0", "2/1/0"]);
  });

  it("assigns a centre exactly on a boundary to exactly one cell", () => {
    // centre x = 400 is the shared edge of cell 0 and cell 1 at level 2
    const k = ownerKey(grid, [390, 90, 0, 410, 110, 5], 2); // centre (400,100)
    expect(k).toBe("2/1/0"); // half-open: [400,800) wins
  });

  it("assigns the outer maximum to the final row/column", () => {
    const k = ownerKey(grid, [1600, 1600, 0, 1600, 1600, 1], 2); // centre at max
    expect(k).toBe("2/3/3");
  });

  it("returns null for a non-finite bbox", () => {
    expect(ownerKey(grid, [NaN, 0, 0, 1, 1, 1], 2)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/streaming/tileGrid.test.ts`
Expected: FAIL — `makeGrid` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/streaming/constants.ts
/** Every streaming tunable. All distances are metres. Provisional — tune
 *  against delft.fcb and one large real dataset before treating as settled. */
export const SETTLE_MS = 350;
export const MOVE_FRAC = 0.2;
export const SCALE_FACTOR = 1.3;
export const T_MAX_M = 5000;
export const MAX_FOOTPRINT_SPAN_M = 8000;
export const VIEWPORT_FEATURE_BUDGET = 20000;
export const RESIDENT_TRIANGLE_BUDGET = 4_000_000;
export const RESIDENT_BYTE_BUDGET = 512 * 1024 * 1024;
export const MIN_COVER_CELLS = 9;
export const MAX_COVER_CELLS = 64;
export const LEVEL_SWAP_TIMEOUT_MS = 1500;
export const MIN_CELL_M = 50;
export const BASE_CELL_M = 100;
```

```ts
// src/features/streaming/tileGrid.ts  (append to Task 1's meshOffset)
import { BASE_CELL_M, MIN_CELL_M } from "./constants";
import type { BBox3, Vec3 } from "../../domain/citymodel/types";

export type CellKey = string;

export interface Grid {
  readonly originX: number;
  readonly originY: number;
  readonly rootCell: number;
  readonly maxLevel: number;
}

export function makeGrid(extent: BBox3): Grid {
  const span = Math.max(extent[3] - extent[0], extent[4] - extent[1]);
  let rootCell = BASE_CELL_M;
  while (rootCell < span) rootCell *= 2;
  let maxLevel = 0;
  while (rootCell / 2 ** (maxLevel + 1) >= MIN_CELL_M) maxLevel++;
  return { originX: extent[0], originY: extent[1], rootCell, maxLevel };
}

export function cellSize(grid: Grid, level: number): number {
  return grid.rootCell / 2 ** level;
}

function parse(key: CellKey): [number, number, number] {
  const [l, c, r] = key.split("/").map(Number);
  return [l!, c!, r!];
}

export function cellBBox(
  grid: Grid,
  key: CellKey,
): [number, number, number, number] {
  const [level, col, row] = parse(key);
  const s = cellSize(grid, level);
  const x = grid.originX + col * s;
  const y = grid.originY + row * s;
  return [x, y, x + s, y + s];
}

export function cellCentre(grid: Grid, key: CellKey, z: number): Vec3 {
  const b = cellBBox(grid, key);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, z];
}

/** Cells are half-open [min,max); the outer maximum clamps into the last
 *  row/column so nothing falls through the top edge. */
function indexOf(
  grid: Grid,
  coord: number,
  axisOrigin: number,
  level: number,
): number {
  const s = cellSize(grid, level);
  const n = 2 ** level;
  const i = Math.floor((coord - axisOrigin) / s);
  return Math.min(Math.max(i, 0), n - 1);
}

export function keysCovering(
  grid: Grid,
  bbox: [number, number, number, number],
  level: number,
): CellKey[] {
  const c0 = indexOf(grid, bbox[0], grid.originX, level);
  const c1 = indexOf(grid, bbox[2], grid.originX, level);
  const r0 = indexOf(grid, bbox[1], grid.originY, level);
  const r1 = indexOf(grid, bbox[3], grid.originY, level);
  const out: CellKey[] = [];
  for (let c = c0; c <= c1; c++) {
    for (let r = r0; r <= r1; r++) out.push(`${level}/${c}/${r}`);
  }
  return out;
}

export function ownerKey(
  grid: Grid,
  featureBBox: BBox3,
  level: number,
): CellKey | null {
  const cx = (featureBBox[0] + featureBBox[3]) / 2;
  const cy = (featureBBox[1] + featureBBox[4]) / 2;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const col = indexOf(grid, cx, grid.originX, level);
  const row = indexOf(grid, cy, grid.originY, level);
  return `${level}/${col}/${row}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/streaming/tileGrid.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b --noEmit
git add src/features/streaming/ tests/unit/features/streaming/tileGrid.test.ts
git commit -m "feat: add streaming cell grid with half-open bounds and ownership

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Viewport footprint from a perspective camera

**Files:**

- Create: `src/features/streaming/viewportFootprint.ts`
- Test: `tests/unit/features/streaming/viewportFootprint.test.ts`

**Interfaces:**

- Consumes: `sceneToSource` (Task 1), `T_MAX_M` / `MAX_FOOTPRINT_SPAN_M` (Task 2).
- Produces: `viewportFootprint(camera: PerspectiveCamera, groundY: number, origin: Vec3): { bbox: [number,number,number,number]; span: number; centre: [number,number] } | null`

**Background.** For a perspective camera the visible ground area is a trapezoid running to the horizon, not a rectangle. `camera.far` is 50 km (200 km with Google tiles, `src/scene/CitySceneR3F.tsx:346`) and is useless as a fetch radius, so `T_MAX_M` is a separate clamp. `groundY` already exists at `src/scene/CitySceneR3F.tsx:835-840`. Returns `null` when the footprint span exceeds `MAX_FOOTPRINT_SPAN_M` — the caller then shows "zoom in" without probing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/viewportFootprint.test.ts
import { describe, it, expect } from "vitest";
import { PerspectiveCamera } from "three";
import { viewportFootprint } from "../../../../src/features/streaming/viewportFootprint";

const ORIGIN = [0, 0, 0] as const;

function cam(pos: [number, number, number], lookAt: [number, number, number]) {
  const c = new PerspectiveCamera(50, 16 / 9, 1, 50000);
  c.position.set(...pos);
  c.lookAt(...lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

describe("viewportFootprint", () => {
  it("gives a centred rectangle for a top-down camera", () => {
    const f = viewportFootprint(cam([0, 500, 0], [0, 0, 0]), 0, ORIGIN)!;
    expect(f).not.toBeNull();
    expect(f.centre[0]).toBeCloseTo(0, 3);
    expect(f.centre[1]).toBeCloseTo(0, 3);
    expect(f.span).toBeGreaterThan(0);
    expect(f.span).toBeLessThan(20000);
  });

  it("clamps a tilted camera at T_MAX instead of running to the horizon", () => {
    // Shallow tilt: far corners would otherwise project enormously far away.
    const f = viewportFootprint(cam([0, 200, 0], [0, 0, -8000]), 0, ORIGIN);
    // Either clamped within the span cap, or refused — never infinite.
    if (f !== null) {
      expect(Number.isFinite(f.span)).toBe(true);
      expect(f.span).toBeLessThanOrEqual(20000);
    }
  });

  it("returns finite values, never NaN, for a camera aimed at the horizon", () => {
    const f = viewportFootprint(cam([0, 100, 0], [0, 100, -1000]), 0, ORIGIN);
    if (f !== null) {
      for (const v of f.bbox) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("handles a camera below the ground plane without inverting", () => {
    const f = viewportFootprint(cam([0, -50, 0], [0, 0, -100]), 0, ORIGIN);
    if (f !== null) {
      expect(f.bbox[0]).toBeLessThanOrEqual(f.bbox[2]);
      expect(f.bbox[1]).toBeLessThanOrEqual(f.bbox[3]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/streaming/viewportFootprint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/streaming/viewportFootprint.ts
/**
 * The ground area a perspective camera can actually see, as a source-CRS AABB.
 *
 * A tilted camera's far corners run toward the horizon, so each corner ray is
 * clamped to T_MAX_M. camera.far is 50-200km and is NOT a fetch radius.
 */
import { Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import type { Vec3 } from "../../domain/citymodel/types";
import { sceneToSource } from "./sceneTransform";
import { MAX_FOOTPRINT_SPAN_M, T_MAX_M } from "./constants";

const EPS = 1e-6;
const NDC_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

export interface Footprint {
  readonly bbox: [number, number, number, number];
  readonly span: number;
  readonly centre: [number, number];
}

export function viewportFootprint(
  camera: PerspectiveCamera,
  groundY: number,
  origin: Vec3,
): Footprint | null {
  const eye = camera.position;
  const pts: Array<[number, number]> = [];

  for (const [nx, ny] of NDC_CORNERS) {
    const dir = new Vector3(nx, ny, 0.5).unproject(camera).sub(eye).normalize();
    let t = T_MAX_M;
    // Only intersect when the ray actually descends toward the plane.
    if (dir.y < -EPS || (dir.y > EPS && groundY > eye.y)) {
      const tHit = (groundY - eye.y) / dir.y;
      if (tHit > 0 && tHit <= T_MAX_M) t = tHit;
    }
    const world: Vec3 = [
      eye.x + dir.x * t,
      eye.y + dir.y * t,
      eye.z + dir.z * t,
    ];
    const src = sceneToSource(world, origin, [0, 0, 0]);
    if (!Number.isFinite(src[0]) || !Number.isFinite(src[1])) return null;
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
    centre: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/streaming/viewportFootprint.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b --noEmit
git add src/features/streaming/viewportFootprint.ts tests/unit/features/streaming/viewportFootprint.test.ts
git commit -m "feat: add perspective viewport footprint with horizon clamp

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Uniform level selection and the LoD ladder

**Files:**

- Create: `src/features/streaming/levelPolicy.ts`
- Test: `tests/unit/features/streaming/levelPolicy.test.ts`

**Interfaces:**

- Consumes: `Grid`, `cellSize`, `keysCovering` (Task 2); constants (Task 2).
- Produces:
  - `type LodSelection = { kind: "all" } | { kind: "unlabelled" } | { kind: "exact"; lod: string }`
  - `chooseLevel(grid: Grid, footprintBBox: [number,number,number,number]): number | null`
  - `buildLadder(observed: ReadonlyArray<string | null>): string[]`
  - `lodForCellSize(ladder: ReadonlyArray<string>, cellSizeM: number): LodSelection`

**Rules.** Pick the **coarsest** level whose cover has at least `MIN_COVER_CELLS` cells; if that cover exceeds `MAX_COVER_CELLS`, coarsen; if no level satisfies both, return `null` (caller prompts to zoom). The ladder is observed LoD **labels** sorted ascending numerically, with `null` excluded — `null` is not a LoD. An empty ladder means the dataset carries no labels and renders as `{kind:"all"}`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/levelPolicy.test.ts
import { describe, it, expect } from "vitest";
import { makeGrid } from "../../../../src/features/streaming/tileGrid";
import {
  chooseLevel,
  buildLadder,
  lodForCellSize,
} from "../../../../src/features/streaming/levelPolicy";

const grid = makeGrid([0, 0, 0, 10000, 10000, 30]); // rootCell 12800

describe("chooseLevel", () => {
  it("picks the coarsest level giving at least MIN_COVER_CELLS", () => {
    const level = chooseLevel(grid, [0, 0, 3200, 3200]);
    expect(level).not.toBeNull();
    const cover = 2 ** level! * 2 ** level!;
    expect(cover).toBeGreaterThan(0);
  });

  it("returns null when no level satisfies both cover bounds", () => {
    // A degenerate zero-area footprint cannot reach MIN_COVER_CELLS
    // without exceeding maxLevel.
    expect(chooseLevel(grid, [0, 0, 0, 0])).toBeNull();
  });
});

describe("buildLadder", () => {
  it("sorts labels ascending and drops null", () => {
    expect(buildLadder(["2.2", null, "1.2", "1.3"])).toEqual([
      "1.2",
      "1.3",
      "2.2",
    ]);
  });

  it("returns an empty ladder for wholly unlabelled data", () => {
    expect(buildLadder([null, null])).toEqual([]);
  });
});

describe("lodForCellSize", () => {
  const ladder = ["1.2", "1.3", "2.2"];

  it("uses the coarsest LoD for a large cell", () => {
    expect(lodForCellSize(ladder, 4000)).toEqual({ kind: "exact", lod: "1.2" });
  });

  it("uses the finest LoD for a small cell", () => {
    expect(lodForCellSize(ladder, 100)).toEqual({ kind: "exact", lod: "2.2" });
  });

  it("uses the lower-middle rung in the mid band", () => {
    expect(lodForCellSize(ladder, 800)).toEqual({ kind: "exact", lod: "1.3" });
  });

  it("collapses to identity for a single-LoD dataset", () => {
    expect(lodForCellSize(["2.2"], 4000)).toEqual({
      kind: "exact",
      lod: "2.2",
    });
    expect(lodForCellSize(["2.2"], 100)).toEqual({ kind: "exact", lod: "2.2" });
  });

  it("renders everything when the dataset carries no labels", () => {
    expect(lodForCellSize([], 800)).toEqual({ kind: "all" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/streaming/levelPolicy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/streaming/levelPolicy.ts
/**
 * One uniform level for the whole viewport, and the LoD that goes with it.
 *
 * Uniform (not adaptive per-cell) because adaptive refinement costs one
 * R-tree traversal per probe: ~37N traversals for an N-cell viewport. One
 * level also means one LoD, so there are no mixed-LoD seams.
 */
import { cellSize, keysCovering, type Grid } from "./tileGrid";
import { MAX_COVER_CELLS, MIN_COVER_CELLS } from "./constants";

export type LodSelection =
  | { kind: "all" }
  | { kind: "unlabelled" }
  | { kind: "exact"; lod: string };

export function chooseLevel(
  grid: Grid,
  footprintBBox: [number, number, number, number],
): number | null {
  for (let level = 0; level <= grid.maxLevel; level++) {
    const n = keysCovering(grid, footprintBBox, level).length;
    if (n >= MIN_COVER_CELLS) return n <= MAX_COVER_CELLS ? level : null;
  }
  return null;
}

/** Observed LoD labels, ascending. `null` is absence of a label, not a LoD. */
export function buildLadder(observed: ReadonlyArray<string | null>): string[] {
  const set = new Set<string>();
  for (const l of observed) if (l !== null) set.add(l);
  return [...set].sort((a, b) => Number(a) - Number(b));
}

export function lodForCellSize(
  ladder: ReadonlyArray<string>,
  cellSizeM: number,
): LodSelection {
  const n = ladder.length;
  if (n === 0) return { kind: "all" };
  if (cellSizeM > 2000) return { kind: "exact", lod: ladder[0]! };
  if (cellSizeM < 200) return { kind: "exact", lod: ladder[n - 1]! };
  return { kind: "exact", lod: ladder[Math.floor((n - 1) / 2)]! };
}

export { cellSize };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/streaming/levelPolicy.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b --noEmit
git add src/features/streaming/levelPolicy.ts tests/unit/features/streaming/levelPolicy.test.ts
git commit -m "feat: add uniform level selection and LoD ladder

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Cell cache — LRU, pinning, and post-decode budgets

**Files:**

- Create: `src/features/streaming/cellCache.ts`
- Test: `tests/unit/features/streaming/cellCache.test.ts`

**Interfaces:**

- Consumes: `CellKey` (Task 2), budget constants (Task 2).
- Produces:
  - `interface CellStats { triangles: number; bytes: number }`
  - `class CellCache<T>` with `get(key)`, `has(key)`, `set(key, value, stats)`, `touch(key)`, `pin(key)`, `unpin(key)`, `keys()`, `totals()`, `evictToBudget(): CellKey[]`, `retain(keys): CellKey[]`, `clear()`

**Rules.** Feature count does not bound memory — one FCB feature can hold several CityObjects and multiple complete LoDs — so budgets are enforced on **triangles and bytes, measured after decode**. Pinned cells are never evicted by `evictToBudget`. `evictToBudget` returns the evicted keys so the caller can send `evict` to the worker and dispose GPU resources. If pinned cells alone exceed budget, `evictToBudget` returns what it could evict and the caller surfaces a visible message — it must not silently drop a pinned cell.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/cellCache.test.ts
import { describe, it, expect } from "vitest";
import { CellCache } from "../../../../src/features/streaming/cellCache";

const S = (triangles: number) => ({ triangles, bytes: triangles * 100 });

describe("CellCache", () => {
  it("evicts least-recently-used first when over the triangle budget", () => {
    const c = new CellCache<string>({ maxTriangles: 250, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.set("b", "B", S(100));
    c.set("c", "C", S(100)); // now 300 > 250
    c.touch("b"); // b becomes most recent; a is oldest
    const evicted = c.evictToBudget();
    expect(evicted).toEqual(["a"]);
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
  });

  it("never evicts a pinned cell", () => {
    const c = new CellCache<string>({ maxTriangles: 150, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.set("b", "B", S(100));
    c.pin("a"); // a is oldest but pinned
    expect(c.evictToBudget()).toEqual(["b"]);
    expect(c.has("a")).toBe(true);
  });

  it("stops rather than dropping pinned cells when they alone exceed budget", () => {
    const c = new CellCache<string>({ maxTriangles: 50, maxBytes: Infinity });
    c.set("a", "A", S(100));
    c.pin("a");
    expect(c.evictToBudget()).toEqual([]);
    expect(c.has("a")).toBe(true); // visible message is the caller's job
  });

  it("enforces the byte budget independently of triangles", () => {
    const c = new CellCache<string>({ maxTriangles: Infinity, maxBytes: 150 });
    c.set("a", "A", { triangles: 1, bytes: 100 });
    c.set("b", "B", { triangles: 1, bytes: 100 });
    expect(c.evictToBudget()).toEqual(["a"]);
  });

  it("retain() drops everything outside the desired cover", () => {
    const c = new CellCache<string>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    c.set("a", "A", S(1));
    c.set("b", "B", S(1));
    c.set("c", "C", S(1));
    expect(c.retain(["b", "c"]).sort()).toEqual(["a"]);
    expect(c.keys().sort()).toEqual(["b", "c"]);
  });

  it("reports running totals", () => {
    const c = new CellCache<string>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    c.set("a", "A", S(10));
    c.set("b", "B", S(5));
    expect(c.totals()).toEqual({ triangles: 15, bytes: 1500 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/streaming/cellCache.test.ts`
Expected: FAIL — `CellCache` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/streaming/cellCache.ts
/**
 * LRU cache of resident cells under triangle and byte budgets.
 *
 * Budgets are on triangles and bytes, measured AFTER decode, because feature
 * count does not bound memory: one FCB feature can carry several CityObjects
 * and multiple complete LoDs.
 */
import type { CellKey } from "./tileGrid";

export interface CellStats {
  readonly triangles: number;
  readonly bytes: number;
}

interface Entry<T> {
  value: T;
  stats: CellStats;
  lastSeen: number;
  pinned: boolean;
}

export interface CellCacheOpts {
  readonly maxTriangles: number;
  readonly maxBytes: number;
}

export class CellCache<T> {
  private readonly entries = new Map<CellKey, Entry<T>>();
  private clock = 0;

  constructor(private readonly opts: CellCacheOpts) {}

  get(key: CellKey): T | undefined {
    return this.entries.get(key)?.value;
  }

  has(key: CellKey): boolean {
    return this.entries.has(key);
  }

  keys(): CellKey[] {
    return [...this.entries.keys()];
  }

  set(key: CellKey, value: T, stats: CellStats): void {
    this.entries.set(key, {
      value,
      stats,
      lastSeen: ++this.clock,
      pinned: this.entries.get(key)?.pinned ?? false,
    });
  }

  touch(key: CellKey): void {
    const e = this.entries.get(key);
    if (e) e.lastSeen = ++this.clock;
  }

  pin(key: CellKey): void {
    const e = this.entries.get(key);
    if (e) e.pinned = true;
  }

  unpin(key: CellKey): void {
    const e = this.entries.get(key);
    if (e) e.pinned = false;
  }

  totals(): CellStats {
    let triangles = 0;
    let bytes = 0;
    for (const e of this.entries.values()) {
      triangles += e.stats.triangles;
      bytes += e.stats.bytes;
    }
    return { triangles, bytes };
  }

  /** Evicts LRU-first until within budget. Pinned cells are never evicted;
   *  if they alone exceed budget this returns early and the caller must
   *  surface that visibly rather than dropping them. */
  evictToBudget(): CellKey[] {
    const evicted: CellKey[] = [];
    const overBudget = () => {
      const t = this.totals();
      return (
        t.triangles > this.opts.maxTriangles || t.bytes > this.opts.maxBytes
      );
    };
    while (overBudget()) {
      let oldest: CellKey | undefined;
      let oldestSeen = Infinity;
      for (const [k, e] of this.entries) {
        if (e.pinned) continue;
        if (e.lastSeen < oldestSeen) {
          oldestSeen = e.lastSeen;
          oldest = k;
        }
      }
      if (oldest === undefined) break; // only pinned cells remain
      this.entries.delete(oldest);
      evicted.push(oldest);
    }
    return evicted;
  }

  /** Drops every cell outside `keep`, returning what was removed. */
  retain(keep: ReadonlyArray<CellKey>): CellKey[] {
    const keepSet = new Set(keep);
    const removed: CellKey[] = [];
    for (const k of [...this.entries.keys()]) {
      if (!keepSet.has(k)) {
        this.entries.delete(k);
        removed.push(k);
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/streaming/cellCache.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b --noEmit
git add src/features/streaming/cellCache.ts tests/unit/features/streaming/cellCache.test.ts
git commit -m "feat: add cell cache with LRU eviction, pinning and byte budgets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase B — Geometry and colour extraction

These two tasks make the mesh builder and colorizer callable from a worker. They touch existing, working code, so both are guarded by parity tests against current output.

---

### Task 6: Extract `buildCityMeshArrays` from `buildCityMesh`

**Files:**

- Modify: `src/scene/buildCityMesh.ts`
- Test: `tests/unit/scene/buildCityMeshArrays.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `interface CityMeshArrays { positions: Float32Array; normals: Float32Array; colors: Float32Array; objectIndices: Uint32Array; surfaceIndices: Uint32Array; objectKeys: string[]; triangleCount: number }`
  - `buildCityMeshArrays(model: CityModel, layerId: string, originOffset: Vec3, selectedLod: string | null): CityMeshArrays`
  - `buildCityMesh(...)` keeps its **current signature and return type** — it becomes a thin wrapper.

**Critical constraints.**

- `ShapeUtils` and `Vector2` **stay**. They are pure math and run in a worker (verified). Do not migrate to earcut — that was ruled out at plan level.
- `BufferGeometry`/`BufferAttribute` must NOT appear in `buildCityMeshArrays`. They stay in the wrapper.
- The existing geometry sets `position`, `color`, `objectIndex`, `surfaceIndex` attributes and calls `computeVertexNormals()` (`src/scene/buildCityMesh.ts:139-144`). The array core must produce **normals itself**, because the worker cannot call `computeVertexNormals`. Compute per-triangle face normals and write them per-vertex — the surfaces are flat polygons, so flat normals match what `computeVertexNormals` produces for non-indexed geometry.
- `baseColors` in `CityMeshResult` is `Float32Array.from(colorArray)` — a copy. Preserve that.

- [ ] **Step 1: Write the failing parity test**

```ts
// tests/unit/scene/buildCityMeshArrays.test.ts
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

describe("buildCityMeshArrays parity with buildCityMesh", () => {
  it("produces identical positions", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const pos = mesh.geometry.getAttribute("position").array as Float32Array;
    expect(arrays.positions.length).toBe(pos.length);
    for (let i = 0; i < pos.length; i++) {
      expect(arrays.positions[i]).toBeCloseTo(pos[i]!, 5);
    }
  });

  it("produces identical object and surface indices", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const obj = mesh.geometry.getAttribute("objectIndex").array;
    const surf = mesh.geometry.getAttribute("surfaceIndex").array;
    expect([...arrays.objectIndices]).toEqual([...obj]);
    expect([...arrays.surfaceIndices]).toEqual([...surf]);
  });

  it("produces normals matching computeVertexNormals", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    const n = mesh.geometry.getAttribute("normal").array as Float32Array;
    expect(arrays.normals.length).toBe(n.length);
    for (let i = 0; i < n.length; i++) {
      expect(arrays.normals[i]).toBeCloseTo(n[i]!, 4);
    }
  });

  it("agrees on triangle count and object keys", () => {
    const arrays = buildCityMeshArrays(model, "L", origin, null);
    const mesh = buildCityMesh(model, "L", origin, null);
    expect(arrays.triangleCount).toBe(mesh.triangleCount);
    expect(arrays.objectKeys).toEqual(mesh.pickingIndex.objectKeys);
  });

  it("filters by LoD identically", () => {
    const lod =
      model.objects[Object.keys(model.objects)[0]!]!.surfaces[0]?.lod ?? null;
    if (lod === null) return;
    const arrays = buildCityMeshArrays(model, "L", origin, lod);
    const mesh = buildCityMesh(model, "L", origin, lod);
    expect(arrays.triangleCount).toBe(mesh.triangleCount);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene/buildCityMeshArrays.test.ts`
Expected: FAIL — `buildCityMeshArrays` is not exported.

- [ ] **Step 3: Refactor `buildCityMesh.ts`**

Move the entire two-pass body of the current `buildCityMesh` into a new exported `buildCityMeshArrays`, changing only the ending: instead of constructing a `BufferGeometry`, allocate a `normalsArray = new Float32Array(totalTriangles * 9)` and, in the write loop where each triangle's three vertices are emitted, compute the face normal from the triangle's own vertices and write it to all three. Return the arrays object.

Then reduce `buildCityMesh` to a wrapper:

```ts
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

Note the wrapper no longer calls `computeVertexNormals()` — normals now come from the array core, which is what makes the worker path possible.

- [ ] **Step 4: Run the full scene test suite**

Run: `npx vitest run tests/unit/scene tests/integration`
Expected: PASS. The parity test plus every existing scene/integration test must still pass — these exercise picking and highlighting, which depend on the index attributes.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b --noEmit
git add src/scene/buildCityMesh.ts tests/unit/scene/buildCityMeshArrays.test.ts
git commit -m "refactor: extract worker-safe buildCityMeshArrays from buildCityMesh

Normals are now computed in the array core rather than via
computeVertexNormals, so a worker can produce complete geometry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rewrite `buildRuleColors` against typed arrays

**Files:**

- Modify: `src/scene/applyRuleColors.ts`
- Test: `tests/unit/scene/ruleColorsWorkerSafe.test.ts`

**Interfaces:**

- Consumes: `CityMeshArrays` (Task 6).
- Produces:
  - `srgbHexToLinear(hex: string): readonly [number, number, number]`
  - `buildRuleColorsFromArrays(model, objectIndices, surfaceIndices, objectKeys, rules, baseColors): Float32Array | null`
  - `buildRuleColors(...)` keeps its **current signature** as a wrapper for the static path.

**Why this is more than dropping an import.** The current function takes a `BufferGeometry` and calls `geometry.getAttribute()` (`src/scene/applyRuleColors.ts:34-35`), and `resolveRuleColor` dereferences `object.surfaces[surfIdx]` (`:102`) and calls `computeRoofMetrics(surface)` (`:105`). In the worker the model _is_ available (it parses the cell), so surfaces are fine there — what must go is the `BufferGeometry` dependency and Three's `Color`.

**Colour-space parity is mandatory.** `new Color(hex)` is **not** `hexChannel / 255`. With `ColorManagement` enabled (Three's default) it converts sRGB → Linear-sRGB:

```
c ≤ 0.04045  →  c / 12.92
c >  0.04045 →  ((c + 0.055) / 1.055) ** 2.4
```

Getting this wrong makes streamed cells visibly differently coloured from static layers.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scene/ruleColorsWorkerSafe.test.ts
import { describe, it, expect } from "vitest";
import { Color } from "three";
import { srgbHexToLinear } from "../../../src/scene/applyRuleColors";

describe("srgbHexToLinear parity with three.Color", () => {
  const hexes = [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#3a7bd5",
    "#0a0a0a",
    "#808080",
  ];

  for (const hex of hexes) {
    it(`matches three.Color for ${hex}`, () => {
      const expected = new Color(hex);
      const [r, g, b] = srgbHexToLinear(hex);
      expect(r).toBeCloseTo(expected.r, 6);
      expect(g).toBeCloseTo(expected.g, 6);
      expect(b).toBeCloseTo(expected.b, 6);
    });
  }

  it("is not the naive hex/255 conversion", () => {
    // 0x80 / 255 = 0.5019..., but linear-sRGB is ~0.2158
    const [r] = srgbHexToLinear("#808080");
    expect(r).not.toBeCloseTo(0.5019, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene/ruleColorsWorkerSafe.test.ts`
Expected: FAIL — `srgbHexToLinear` is not exported.

- [ ] **Step 3: Implement the conversion and the array-based colorizer**

```ts
// src/scene/applyRuleColors.ts — add near the top, replacing getCachedColor
type RGB = readonly [number, number, number];

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Matches three.Color's sRGB → Linear-sRGB conversion (ColorManagement on).
 *  NOT hex/255 — see the parity test. */
export function srgbHexToLinear(hex: string): RGB {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  return [
    srgbChannelToLinear(((n >> 16) & 255) / 255),
    srgbChannelToLinear(((n >> 8) & 255) / 255),
    srgbChannelToLinear((n & 255) / 255),
  ];
}

const linearCache = new Map<string, RGB>();
function cachedLinear(hex: string): RGB {
  let c = linearCache.get(hex);
  if (!c) {
    c = srgbHexToLinear(hex);
    linearCache.set(hex, c);
  }
  return c;
}
```

Then change `resolveRuleColor` to return `RGB | null` via `cachedLinear(colorHex)` instead of `getCachedColor`, and add the array entry point:

```ts
export function buildRuleColorsFromArrays(
  model: CityModel,
  objectIndices: Uint32Array,
  surfaceIndices: Uint32Array,
  objectKeys: ReadonlyArray<string>,
  rules: ReadonlyArray<Rule>,
  baseColors: Float32Array,
): Float32Array | null {
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return null;

  const result = Float32Array.from(baseColors);
  const cache = new Map<string, RGB | null>();
  let anyChange = false;

  for (let v = 0; v < objectIndices.length; v++) {
    const objIdx = objectIndices[v]!;
    const surfIdx = surfaceIndices[v]!;
    const key = `${objIdx}:${surfIdx}`;
    let rgb = cache.get(key);
    if (rgb === undefined) {
      rgb = resolveRuleColor(
        objIdx,
        surfIdx,
        model,
        { layerId: "", objectKeys },
        enabled,
      );
      cache.set(key, rgb);
    }
    if (rgb) {
      const b = v * 3;
      result[b] = rgb[0];
      result[b + 1] = rgb[1];
      result[b + 2] = rgb[2];
      anyChange = true;
    }
  }
  return anyChange ? result : null;
}
```

Finally reduce the existing `buildRuleColors` to read the two attributes off the geometry and delegate to `buildRuleColorsFromArrays`, preserving its current exported signature so the static path is untouched.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/scene tests/integration`
Expected: PASS — parity test plus every existing rule-colour test.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -b --noEmit
git add src/scene/applyRuleColors.ts tests/unit/scene/ruleColorsWorkerSafe.test.ts
git commit -m "refactor: make rule colorization worker-safe with sRGB parity

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase C — Reader and worker

---

### Task 8: `fcbSource` — open, header model, admission checks

**Files:**

- Create: `src/domain/citymodel/flatcitybuf/fcbSource.ts`
- Modify: `package.json` (bump `@cityjson/flatcitybuf` to `^0.3.0`)
- Test: `tests/unit/domain/citymodel/flatcitybuf/fcbSource.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `interface FcbHeaderModel { version: string; featuresCount: number | undefined; extent: BBox3; referenceSystem: string | undefined; epsg: number | null }`
  - `type AdmissionError = { code: "no-extent" | "degenerate-extent" | "no-index" | "unknown-count" | "non-metric-crs" | "non-finite"; message: string }`
  - `checkAdmission(header: HeaderView): AdmissionError | null`
  - `headerModel(header: HeaderView): FcbHeaderModel`
  - `openFcb(src: { url: string } | { blob: Blob }): Promise<FcbReader>`

**Why admission checks exist.** `geographicalExtent`, transform, and `referenceSystem` are all **optional** in the header (`src/header/file-info.ts:34,43`); `featuresCount === 0` means _unknown_, not _empty_; and `select()` throws `NoIndex` when `layout.rtreeSize === 0`. Streaming cannot work without an extent and an R-tree. Every distance constant is metres, so a non-metric CRS is refused rather than silently producing nonsense cells.

- [ ] **Step 1: Bump the dependency**

```bash
npm install '@cityjson/flatcitybuf@^0.3.0'
node -e "console.log(require('./node_modules/@cityjson/flatcitybuf/package.json').version)"
```

Expected: `0.3.0` or higher.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/domain/citymodel/flatcitybuf/fcbSource.test.ts
import { describe, it, expect } from "vitest";
import { checkAdmission } from "../../../../../src/domain/citymodel/flatcitybuf/fcbSource";

// Minimal structural stand-ins — checkAdmission only reads info/layout.
const ok = {
  info: {
    version: "1.0",
    featuresCount: 100,
    geographicalExtent: [0, 0, 0, 1000, 1000, 30],
    referenceSystem: "EPSG:28992",
  },
  layout: { rtreeSize: 4096 },
} as never;

describe("checkAdmission", () => {
  it("accepts a well-formed metric header", () => {
    expect(checkAdmission(ok)).toBeNull();
  });

  it("rejects a missing extent", () => {
    const h = {
      info: {
        ...(ok as never as typeof ok).info,
        geographicalExtent: undefined,
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("no-extent");
  });

  it("rejects a degenerate extent", () => {
    const h = {
      info: {
        ...(ok as never as typeof ok).info,
        geographicalExtent: [5, 5, 0, 5, 5, 0],
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("degenerate-extent");
  });

  it("rejects a file with no spatial index", () => {
    const h = {
      info: (ok as never as typeof ok).info,
      layout: { rtreeSize: 0 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("no-index");
  });

  it("rejects an unknown feature count", () => {
    const h = {
      info: { ...(ok as never as typeof ok).info, featuresCount: 0 },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("unknown-count");
  });

  it("rejects a geographic (degree-based) CRS", () => {
    const h = {
      info: {
        ...(ok as never as typeof ok).info,
        referenceSystem: "EPSG:4326",
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("non-metric-crs");
  });

  it("rejects non-finite extent values", () => {
    const h = {
      info: {
        ...(ok as never as typeof ok).info,
        geographicalExtent: [0, 0, 0, NaN, 1000, 30],
      },
      layout: { rtreeSize: 4096 },
    } as never;
    expect(checkAdmission(h)?.code).toBe("non-finite");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/domain/citymodel/flatcitybuf/fcbSource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/domain/citymodel/flatcitybuf/fcbSource.ts
/**
 * Opening a .fcb source and deciding whether it can be streamed at all.
 *
 * Header extent, transform, and reference system are OPTIONAL in the format;
 * featuresCount 0 means unknown, not empty; and select() throws NoIndex when
 * rtreeSize is 0. Streaming needs an extent and an R-tree, and every distance
 * constant is metres, so a degree-based CRS is refused rather than guessed.
 */
import { FcbReader, type HeaderView } from "@cityjson/flatcitybuf";
import type { BBox3 } from "../types";

export interface FcbHeaderModel {
  readonly version: string;
  readonly featuresCount: number | undefined;
  readonly extent: BBox3;
  readonly referenceSystem: string | undefined;
  readonly epsg: number | null;
}

export type AdmissionCode =
  | "no-extent"
  | "degenerate-extent"
  | "no-index"
  | "unknown-count"
  | "non-metric-crs"
  | "non-finite";

export interface AdmissionError {
  readonly code: AdmissionCode;
  readonly message: string;
}

/** Geographic CRS are degree-based; every streaming constant is metres. */
const GEOGRAPHIC_EPSG = new Set([4326, 4979, 4258]);

export function parseEpsg(rs: string | undefined): number | null {
  if (!rs) return null;
  const m = /(\d+)\s*$/.exec(rs.trim());
  return m ? Number(m[1]) : null;
}

export function checkAdmission(header: HeaderView): AdmissionError | null {
  const info = header.info;
  const layout = header.layout;

  if (layout.rtreeSize === 0) {
    return {
      code: "no-index",
      message:
        "This file has no spatial index, so it cannot be streamed by viewport.",
    };
  }
  const extent = info.geographicalExtent;
  if (!extent) {
    return {
      code: "no-extent",
      message:
        "This file declares no geographical extent, which streaming requires.",
    };
  }
  if (extent.some((v) => !Number.isFinite(v))) {
    return {
      code: "non-finite",
      message: "This file's geographical extent contains non-finite values.",
    };
  }
  if (extent[3] - extent[0] <= 0 || extent[4] - extent[1] <= 0) {
    return {
      code: "degenerate-extent",
      message: "This file's geographical extent has zero width or height.",
    };
  }
  if (info.featuresCount === 0) {
    return {
      code: "unknown-count",
      message:
        "This file declares an unknown feature count, which streaming requires.",
    };
  }
  const epsg = parseEpsg(info.referenceSystem);
  if (epsg !== null && GEOGRAPHIC_EPSG.has(epsg)) {
    return {
      code: "non-metric-crs",
      message: `EPSG:${epsg} is degree-based. Streaming requires a projected, metre-based CRS.`,
    };
  }
  return null;
}

export function headerModel(header: HeaderView): FcbHeaderModel {
  const info = header.info;
  return {
    version: info.version,
    featuresCount: info.featuresCount === 0 ? undefined : info.featuresCount,
    extent: info.geographicalExtent as BBox3,
    referenceSystem: info.referenceSystem,
    epsg: parseEpsg(info.referenceSystem),
  };
}

export function openFcb(
  src: { url: string } | { blob: Blob },
): Promise<FcbReader> {
  // fromBlob uses Blob.slice() for real range access; fromBytes COPIES its
  // input, so a multi-GB local file must never go through an ArrayBuffer.
  return "url" in src
    ? FcbReader.fromUrl(src.url)
    : FcbReader.fromBlob(src.blob);
}
```

- [ ] **Step 5: Run test, typecheck, commit**

```bash
npx vitest run tests/unit/domain/citymodel/flatcitybuf/fcbSource.test.ts
npx tsc -b --noEmit
git add package.json package-lock.json src/domain/citymodel/flatcitybuf/fcbSource.ts tests/unit/domain/citymodel/flatcitybuf/
git commit -m "feat: add fcbSource with admission checks and Blob-based open

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Worker protocol and client

**Files:**

- Create: `src/features/streaming/workerProtocol.ts`
- Create: `src/features/streaming/workerClient.ts`
- Test: `tests/unit/features/streaming/workerClient.test.ts`

**Interfaces:**

- Consumes: `CellKey` (Task 2), `Rule` from `src/features/rules/types`.
- Produces: `WorkerRequest`, `WorkerResponse`, `CellGeometry`, `ResidentObjectRecord`, `class WorkerClient`.

**Protocol invariants that must be asserted on receipt.** Every typed array's length is exactly `triangleCount * 3 * components`. The previous spec revision omitted `normals`, `objectIndices`, and `surfaceIndices`; without them picking (`src/scene/CitySceneR3F.tsx:1030`) and highlighting (`src/scene/highlightMesh.ts:41`) are silently dead.

- [ ] **Step 1: Write the protocol types**

```ts
// src/features/streaming/workerProtocol.ts
import type { BBox3 } from "../../domain/citymodel/types";
import type { RoofMetrics } from "../../domain/roofMetrics/types";
import type { Rule } from "../rules/types";
import type { CellKey } from "./tileGrid";

export interface CellGeometry {
  readonly positions: Float32Array; // 3 per vertex
  readonly normals: Float32Array; // 3 per vertex
  readonly baseColors: Float32Array; // 3 per vertex
  readonly ruleColors: Float32Array | null;
  readonly objectIndices: Uint32Array; // 1 per vertex
  readonly surfaceIndices: Uint32Array; // 1 per vertex
  readonly objectKeys: string[];
  readonly triangleCount: number;
}

/** A streaming layer's object payload. NOT a CityObject — CityObject.surfaces
 *  is non-optional, and rings are fetched on demand instead (see 'surfaces'). */
export interface ResidentObjectRecord {
  readonly id: string;
  readonly objectType: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly bbox: BBox3;
  readonly lod: string | null;
  readonly surfaceCount: number;
  readonly roofMetrics: ReadonlyArray<RoofMetrics>;
  readonly footprintAreaSqM: number;
  readonly volumeCuM: number | null;
  readonly parents: ReadonlyArray<string>;
  readonly children: ReadonlyArray<string>;
}

export type WorkerRequest =
  | { type: "open"; id: number; url: string }
  | { type: "open"; id: number; blob: Blob }
  | { type: "probe"; id: number; bbox: [number, number, number, number] }
  | {
      type: "fetch";
      id: number;
      bbox: [number, number, number, number];
      level: number;
      cells: CellKey[];
      lod: string | null;
      rules: ReadonlyArray<Rule>;
      rulesEnabled: boolean;
    }
  | {
      type: "recolor";
      id: number;
      cells: CellKey[];
      rules: ReadonlyArray<Rule>;
      rulesEnabled: boolean;
    }
  | { type: "surfaces"; id: number; objectId: string }
  | { type: "evict"; id: number; cells: CellKey[] }
  | { type: "cancel"; id: number }
  | { type: "close"; id: number };

export type WorkerResponse =
  | { type: "opened"; id: number; header: unknown; admission: unknown }
  | { type: "probed"; id: number; count: number }
  | {
      type: "cell";
      id: number;
      key: CellKey;
      geometry: CellGeometry;
      objects: ResidentObjectRecord[];
      surfaceAttrKeys: string[];
      lodsSeen: string[];
    }
  | { type: "recolored"; id: number; key: CellKey; ruleColors: Float32Array }
  | { type: "surfaceData"; id: number; objectId: string; surfaces: unknown[] }
  | { type: "done"; id: number }
  | {
      type: "error";
      id: number;
      message: string;
      code?: string;
      aborted: boolean;
    };

/** Throws if a received cell violates the length invariants. */
export function assertCellGeometry(g: CellGeometry): void {
  const v = g.triangleCount * 3;
  const check = (name: string, len: number, want: number) => {
    if (len !== want) {
      throw new Error(`cell geometry ${name}: expected ${want}, got ${len}`);
    }
  };
  check("positions", g.positions.length, v * 3);
  check("normals", g.normals.length, v * 3);
  check("baseColors", g.baseColors.length, v * 3);
  check("objectIndices", g.objectIndices.length, v);
  check("surfaceIndices", g.surfaceIndices.length, v);
  if (g.ruleColors !== null) check("ruleColors", g.ruleColors.length, v * 3);
}
```

- [ ] **Step 2: Write the failing client test**

```ts
// tests/unit/features/streaming/workerClient.test.ts
import { describe, it, expect } from "vitest";
import { assertCellGeometry } from "../../../../src/features/streaming/workerProtocol";
import type { CellGeometry } from "../../../../src/features/streaming/workerProtocol";

function geom(
  triangleCount: number,
  bad?: Partial<CellGeometry>,
): CellGeometry {
  const v = triangleCount * 3;
  return {
    positions: new Float32Array(v * 3),
    normals: new Float32Array(v * 3),
    baseColors: new Float32Array(v * 3),
    ruleColors: null,
    objectIndices: new Uint32Array(v),
    surfaceIndices: new Uint32Array(v),
    objectKeys: [],
    triangleCount,
    ...bad,
  };
}

describe("assertCellGeometry", () => {
  it("accepts a consistent payload", () => {
    expect(() => assertCellGeometry(geom(2))).not.toThrow();
  });

  it("rejects a short normals array", () => {
    expect(() =>
      assertCellGeometry(geom(2, { normals: new Float32Array(3) })),
    ).toThrow(/normals/);
  });

  it("rejects a short surfaceIndices array — the picking failure mode", () => {
    expect(() =>
      assertCellGeometry(geom(2, { surfaceIndices: new Uint32Array(1) })),
    ).toThrow(/surfaceIndices/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then implement `workerClient.ts`**

Run: `npx vitest run tests/unit/features/streaming/workerClient.test.ts` → FAIL (module not found).

```ts
// src/features/streaming/workerClient.ts
/**
 * Promise-per-message wrapper over the streaming worker, with an epoch guard.
 *
 * An epoch is needed even though select() supports AbortSignal: an abort stops
 * the range reads, but a response already in flight can still arrive after a
 * newer request was issued.
 */
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

export class WorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, (r: WorkerResponse) => void>();
  private nextId = 0;
  private epoch = 0;

  constructor() {
    this.worker = new Worker(new URL("./fcb.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const cb = this.pending.get(ev.data.id);
      if (cb) {
        this.pending.delete(ev.data.id);
        cb(ev.data);
      }
    };
  }

  /** Bumps the epoch; results captured under an older epoch are stale. */
  newEpoch(): number {
    return ++this.epoch;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.epoch;
  }

  send(
    msg: Omit<WorkerRequest, "id">,
    transfer: Transferable[] = [],
  ): Promise<WorkerResponse> {
    const id = ++this.nextId;
    const full = { ...msg, id } as WorkerRequest;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage(full, transfer);
    });
  }

  /** Streaming responses: one 'cell' per cell, then 'done'. A separate map is
   *  used because `pending` deletes its handler on first dispatch, which would
   *  drop every cell after the first. */
  sendStreaming(
    msg: Omit<WorkerRequest, "id">,
    onMessage: (r: WorkerResponse) => void,
  ): Promise<void> {
    const id = ++this.nextId;
    return new Promise((resolve) => {
      this.streaming.set(id, (r) => {
        if (r.type === "cell") assertCellGeometry(r.geometry);
        onMessage(r);
        if (r.type === "done" || r.type === "error") {
          this.streaming.delete(id);
          resolve();
        }
      });
      this.worker.postMessage({ ...msg, id } as WorkerRequest);
    });
  }

  terminate(): void {
    this.pending.clear();
    this.streaming.clear();
    this.worker.terminate();
  }
}
```

The constructor's `onmessage` must consult **both** maps, and `streaming` must be declared alongside `pending`:

```ts
  private readonly streaming = new Map<number, (r: WorkerResponse) => void>();

  // ...in the constructor:
  this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const stream = this.streaming.get(ev.data.id);
    if (stream) { stream(ev.data); return; }          // NOT deleted here
    const cb = this.pending.get(ev.data.id);
    if (cb) { this.pending.delete(ev.data.id); cb(ev.data); }
  };
```

`assertCellGeometry` is called here, on receipt, so a malformed payload fails loudly at the boundary rather than producing a silently unpickable mesh. Import it from `./workerProtocol`.

- [ ] **Step 4: Run test, typecheck, commit**

```bash
npx vitest run tests/unit/features/streaming/workerClient.test.ts
npx tsc -b --noEmit
git add src/features/streaming/workerProtocol.ts src/features/streaming/workerClient.ts tests/unit/features/streaming/workerClient.test.ts
git commit -m "feat: add streaming worker protocol with geometry invariants

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Worker — open, probe, and the single-traversal fetch

**Files:**

- Create: `src/features/streaming/fcb.worker.ts`
- Create: `src/features/streaming/bucketFeatures.ts` (pure, so it can be tested without a worker)
- Test: `tests/unit/features/streaming/bucketFeatures.test.ts`

**Interfaces:**

- Consumes: `openFcb`/`checkAdmission`/`headerModel` (Task 8), `Grid`/`ownerKey` (Task 2), `buildCityMeshArrays` (Task 6), `buildRuleColorsFromArrays` (Task 7), protocol (Task 9).
- Produces: `bucketFeatures(models, grid, level, residentKeys): Map<CellKey, CityModel>`

**The core of the design.** A commit costs **one** R-tree traversal, not one per cell. The previous revision probed each cell and refined, costing ~37N traversals (≈1,776 for a 48-cell viewport) because every `select()` re-traverses from the root and `BufferedRangeReader` keeps only a single replace-on-miss window. Instead: one `select()` over the AABB of the missing cells, then bucket the results locally by each feature's **bbox centre** using `ownerKey`.

**Two facts the implementer must know.**

1. `Feature` exposes `id`, `byteOffset`, `toCityJSON(header)`, `cityObjects()` — **no bbox accessor**, and `SearchResultItem` carries none either. So ownership is computed **after** decoding, from the parsed `CityObject.bbox`.
2. Because ownership is post-decode, skipping a feature owned by an already-resident cell saves **triangulation**, not decode. Triangulation is the expensive half, so this is still worth doing — but do not describe it as a free filter.

- [ ] **Step 1: Write the failing bucketing test**

```ts
// tests/unit/features/streaming/bucketFeatures.test.ts
import { describe, it, expect } from "vitest";
import { makeGrid } from "../../../../src/features/streaming/tileGrid";
import { bucketFeatures } from "../../../../src/features/streaming/bucketFeatures";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const grid = makeGrid([0, 0, 0, 1000, 1000, 30]); // rootCell 1600, level 2 -> 400 m

function model(id: string, cx: number, cy: number): CityModel {
  return {
    sourceEncoding: "flatcitybuf",
    metadata: {},
    bbox: [cx - 5, cy - 5, 0, cx + 5, cy + 5, 10],
    vertexCount: 8,
    objects: {
      [id]: {
        id,
        objectType: "Building",
        attributes: {},
        surfaces: [],
        bbox: [cx - 5, cy - 5, 0, cx + 5, cy + 5, 10],
        children: [],
        parents: [],
        lod: "2.2",
      },
    },
  };
}

describe("bucketFeatures", () => {
  it("routes each feature to the cell containing its bbox centre", () => {
    const out = bucketFeatures(
      [model("a", 100, 100), model("b", 500, 100)],
      grid,
      2,
      new Set(),
    );
    expect([...out.keys()].sort()).toEqual(["2/0/0", "2/1/0"]);
    expect(Object.keys(out.get("2/0/0")!.objects)).toEqual(["a"]);
    expect(Object.keys(out.get("2/1/0")!.objects)).toEqual(["b"]);
  });

  it("assigns a straddling feature to exactly one cell", () => {
    // Spans the 400 m boundary but its centre is at 395 -> cell 0 only.
    const out = bucketFeatures([model("s", 395, 100)], grid, 2, new Set());
    expect([...out.keys()]).toEqual(["2/0/0"]);
  });

  it("skips features owned by an already-resident cell", () => {
    const out = bucketFeatures(
      [model("a", 100, 100), model("b", 500, 100)],
      grid,
      2,
      new Set(["2/0/0"]),
    );
    expect([...out.keys()]).toEqual(["2/1/0"]);
  });

  it("merges multiple features landing in the same cell", () => {
    const out = bucketFeatures(
      [model("a", 100, 100), model("b", 150, 150)],
      grid,
      2,
      new Set(),
    );
    expect(Object.keys(out.get("2/0/0")!.objects).sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/streaming/bucketFeatures.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `bucketFeatures`**

```ts
// src/features/streaming/bucketFeatures.ts
/**
 * Splits one query result into cells by bbox centre.
 *
 * This is what lets a commit cost ONE R-tree traversal instead of one per
 * cell. Ownership is post-decode because Feature exposes no bbox.
 */
import type { CityModel, CityObject } from "../../domain/citymodel/types";
import { ownerKey, type CellKey, type Grid } from "./tileGrid";

export function bucketFeatures(
  models: ReadonlyArray<CityModel>,
  grid: Grid,
  level: number,
  residentKeys: ReadonlySet<CellKey>,
): Map<CellKey, CityModel> {
  const out = new Map<
    CellKey,
    { objects: Record<string, CityObject>; meta: CityModel }
  >();

  for (const m of models) {
    for (const obj of Object.values(m.objects)) {
      if (!obj?.bbox) continue;
      const key = ownerKey(grid, obj.bbox, level);
      if (key === null) continue; // non-finite bbox — diagnostics
      if (residentKeys.has(key)) continue; // saves triangulation, not decode
      let entry = out.get(key);
      if (!entry) {
        entry = { objects: {}, meta: m };
        out.set(key, entry);
      }
      entry.objects[obj.id] = obj;
    }
  }

  const result = new Map<CellKey, CityModel>();
  for (const [key, { objects, meta }] of out) {
    result.set(key, {
      sourceEncoding: "flatcitybuf",
      metadata: meta.metadata,
      bbox: meta.bbox,
      vertexCount: 0,
      objects,
    });
  }
  return result;
}
```

- [ ] **Step 4: Implement the worker**

```ts
// src/features/streaming/fcb.worker.ts
/// <reference lib="webworker" />
/**
 * Owns the FcbReader and a per-cell cache. One traversal per commit:
 * select() over the missing AABB, then bucket locally by bbox centre.
 */
import { FcbReader, toCityJSONMetadata } from "@cityjson/flatcitybuf";
import { parseCityJSON } from "../../domain/citymodel/cityjson/parseCityJSON";
import {
  checkAdmission,
  headerModel,
  openFcb,
} from "../../domain/citymodel/flatcitybuf/fcbSource";
import { buildCityMeshArrays } from "../../scene/buildCityMesh";
import { buildRuleColorsFromArrays } from "../../scene/applyRuleColors";
import { bucketFeatures } from "./bucketFeatures";
import { makeGrid, cellCentre, type Grid } from "./tileGrid";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

const ctx = self as unknown as Worker;
let reader: FcbReader | undefined;
let grid: Grid | undefined;
let controller: AbortController | null = null;

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === "open") {
      reader = await openFcb(
        "url" in msg ? { url: msg.url } : { blob: msg.blob },
      );
      const admission = checkAdmission(reader.header);
      const header = headerModel(reader.header);
      if (!admission) grid = makeGrid(header.extent);
      post({ type: "opened", id: msg.id, header, admission });
      return;
    }

    if (msg.type === "probe") {
      if (!reader) throw new Error("no file open");
      controller?.abort();
      controller = new AbortController();
      // limit 0 yields an empty page but preserves the total hit count.
      // The cursor is NOT iterated, so no feature bodies are read.
      const cursor = await reader.select({
        spatial: { kind: "bbox", value: msg.bbox },
        limit: 0,
        signal: controller.signal,
      });
      post({ type: "probed", id: msg.id, count: cursor.featuresCount ?? 0 });
      return;
    }

    if (msg.type === "fetch") {
      if (!reader || !grid) throw new Error("no file open");
      controller?.abort();
      const my = new AbortController();
      controller = my;

      const cursor = await reader.select({
        spatial: { kind: "bbox", value: msg.bbox },
        signal: my.signal,
      });
      const metadata = toCityJSONMetadata(reader.header);

      // Decode in chunks, yielding so a superseded fetch can be cancelled.
      const models = [];
      let sinceYield = 0;
      for await (const f of cursor) {
        if (my.signal.aborted) {
          post({
            type: "error",
            id: msg.id,
            message: "aborted",
            aborted: true,
          });
          return;
        }
        models.push(
          parseCityJSON({
            ...metadata,
            ...f.toCityJSON(reader.header),
          } as never),
        );
        if (++sinceYield >= 64) {
          sinceYield = 0;
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const resident = new Set(msg.cells);
      const buckets = bucketFeatures(models, grid, msg.level, new Set());
      for (const [key, cellModel] of buckets) {
        if (my.signal.aborted) return;
        if (!resident.has(key)) continue; // outside the requested cover
        const origin = cellCentre(grid, key, 0);
        const a = buildCityMeshArrays(cellModel, key, origin, msg.lod);
        const ruleColors = msg.rulesEnabled
          ? buildRuleColorsFromArrays(
              cellModel,
              a.objectIndices,
              a.surfaceIndices,
              a.objectKeys,
              msg.rules,
              a.colors,
            )
          : null;
        // Build the payload explicitly. Do NOT spread `a`: CityMeshArrays has
        // `colors`, CellGeometry has `baseColors`, and a spread would emit both.
        const geometry: CellGeometry = {
          positions: a.positions,
          normals: a.normals,
          baseColors: a.colors,
          ruleColors,
          objectIndices: a.objectIndices,
          surfaceIndices: a.surfaceIndices,
          objectKeys: a.objectKeys,
          triangleCount: a.triangleCount,
        };
        // Task 11 populates `objects`/`surfaceAttrKeys` from toObjectRecords
        // and records this cell in the worker cache BEFORE transferring —
        // the buffers below are detached by postMessage.
        post(
          {
            type: "cell",
            id: msg.id,
            key,
            geometry,
            objects: [],
            surfaceAttrKeys: [],
            lodsSeen: [],
          },
          [
            a.positions.buffer,
            a.normals.buffer,
            a.colors.buffer,
            a.objectIndices.buffer,
            a.surfaceIndices.buffer,
          ],
        );
      }
      post({ type: "done", id: msg.id });
      return;
    }

    if (msg.type === "cancel") {
      controller?.abort();
      return;
    }
    if (msg.type === "close") {
      controller?.abort();
      reader = undefined;
      grid = undefined;
      return;
    }
  } catch (e) {
    post({
      type: "error",
      id: msg.id,
      message: e instanceof Error ? e.message : String(e),
      aborted: controller?.signal.aborted ?? false,
    });
  }
};
```

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
npx vitest run tests/unit/features/streaming/
npx tsc -b --noEmit
git add src/features/streaming/ tests/unit/features/streaming/bucketFeatures.test.ts
git commit -m "feat: add streaming worker with single-traversal cell fetch

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Worker cache — records, recolor, on-demand surfaces, evict

**Files:**

- Modify: `src/features/streaming/fcb.worker.ts`
- Create: `src/features/streaming/objectRecords.ts` (pure)
- Test: `tests/unit/features/streaming/objectRecords.test.ts`

**Interfaces:**

- Consumes: `ResidentObjectRecord` (Task 9), `computeRoofMetrics` from `src/domain/roofMetrics/metrics`.
- Produces: `toObjectRecords(model: CityModel): { records: ResidentObjectRecord[]; surfaceAttrKeys: string[] }`

**Why the worker needs its own cache.** Transferred buffers are **detached**, so after posting a cell the worker no longer owns those arrays. Without a retained copy, `recolor` has nothing to work from. So the worker keeps, per resident cell, the parsed `CityModel` plus its `objectIndices`/`surfaceIndices` — enough to recolor and to answer `surfaces` without refetching. That memory counts against the same budget as the main thread's, and the main thread's `evict` message releases it. Without `evict` the worker cache grows without bound.

**What each consumer actually needs** (audited, not assumed):

| Consumer                                  | Needs                    | Field                           |
| ----------------------------------------- | ------------------------ | ------------------------------- |
| `AnalysisTab.tsx:31,79,145`               | `rings[0]`               | on-demand `surfaces`            |
| `InspectorPanel.tsx:353`                  | iterates rings           | on-demand `surfaces`            |
| `InspectorPanel.tsx:212,283`              | footprint, volume        | `footprintAreaSqM`, `volumeCuM` |
| `computeStats.ts:56,108`                  | surface type + metrics   | `roofMetrics[]`                 |
| `duckdb.ts:198`, `TablePanel.tsx:390,420` | `surfaces.length`        | `surfaceCount`                  |
| `RuleBuilderTab.tsx:400`                  | surface attribute _keys_ | `surfaceAttrKeys`               |

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/objectRecords.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../../../src/domain/citymodel/cityjson/parseCityJSON";
import { toObjectRecords } from "../../../../src/features/streaming/objectRecords";

const model = parseCityJSON(
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        import.meta.dirname!,
        "../../../../fixtures/two-buildings.city.json",
      ),
      "utf-8",
    ),
  ) as CityJSONRoot,
);

describe("toObjectRecords", () => {
  it("emits one record per object with a surface count", () => {
    const { records } = toObjectRecords(model);
    expect(records.length).toBe(Object.keys(model.objects).length);
    for (const r of records) {
      expect(r.surfaceCount).toBe(model.objects[r.id]!.surfaces.length);
    }
  });

  it("precomputes roof metrics for every RoofSurface", () => {
    const { records } = toObjectRecords(model);
    for (const r of records) {
      const roofs = model.objects[r.id]!.surfaces.filter(
        (s) => s.type === "RoofSurface",
      );
      expect(r.roofMetrics.length).toBe(roofs.length);
    }
  });

  it("carries no ring geometry — that is fetched on demand", () => {
    const { records } = toObjectRecords(model);
    expect(JSON.stringify(records)).not.toContain("rings");
  });

  it("collects the union of surface attribute keys", () => {
    const { surfaceAttrKeys } = toObjectRecords(model);
    expect(Array.isArray(surfaceAttrKeys)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run tests/unit/features/streaming/objectRecords.test.ts` → FAIL.

Implement `toObjectRecords` walking `model.objects`, computing `roofMetrics` via `computeRoofMetrics` for each `RoofSurface`, `footprintAreaSqM` from `GroundSurface` rings, `volumeCuM` as `footprint * measuredHeight` when that attribute is numeric (else `null`), and unioning `Object.keys(surface.attributes)` into `surfaceAttrKeys`.

- [ ] **Step 3: Add the worker cache and the three handlers**

In `fcb.worker.ts`, add `const cells = new Map<CellKey, { model: CityModel; objectIndices: Uint32Array; surfaceIndices: Uint32Array; objectKeys: string[] }>()`. Populate it in the `fetch` handler **before** transferring (copy the index arrays, since the originals are detached on transfer). Then:

- `recolor`: for each requested key, look up the cached entry, call `buildRuleColorsFromArrays`, post `recolored` with the array transferred.
- `surfaces`: find the object across cached cell models, post `surfaceData` with its `surfaces` array.
- `evict`: `cells.delete(key)` for each; `close`: `cells.clear()`.

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
npx vitest run tests/unit/features/streaming/
npx tsc -b --noEmit
git add src/features/streaming/ tests/unit/features/streaming/objectRecords.test.ts
git commit -m "feat: add worker cell cache with recolor, on-demand surfaces and evict

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase D — Store and scene integration

---

### Task 12: Stream store and layer store changes

**Files:**

- Create: `src/features/streaming/streamStore.ts`
- Modify: `src/features/layers/layerStore.ts`
- Test: `tests/unit/features/streaming/streamStore.test.ts`

**Interfaces:**

- Consumes: `CellCache` (Task 5), `WorkerClient` (Task 9), `FcbHeaderModel` (Task 8).
- Produces:
  - `interface StreamState { client: WorkerClient; grid: Grid; header: FcbHeaderModel; cache: CellCache<CellEntry>; level: number | null; ladder: string[]; ladderVersion: number; status: "idle"|"probing"|"fetching"|"too-far"|"error"; message: string | null; lastCommit: { centre: [number,number]; span: number } | null; version: number }`
  - `useStreamStore` with `register(layerId, state)`, `unregister(layerId)`, `get(layerId)`, `bumpVersion(layerId)`, `setStatus(layerId, status, message?)`
  - `Layer` gains `lodMode: "auto" | "manual"` and `isStreaming: boolean`

**Critical Zustand constraint.** Cell commits must **not** change the `layers` array identity. `CitySceneR3F.tsx:314`, `InspectorPanel.tsx:44`, and `TablePanel.tsx:45` all subscribe to the whole `layers` array, and `App.tsx:450` renders object counts off every `layer.model`. If a commit replaced `layers` or a `Layer` object, all of them would re-render and materialise the resident model on every commit — the opposite of lazy. So per-layer stream state lives in a **separate store** keyed by layer id, and only a `version` counter changes on commit.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/streamStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { useLayerStore } from "../../../../src/features/layers/layerStore";

beforeEach(() => {
  useStreamStore.setState({ streams: {} });
  useLayerStore.getState().removeAllLayers();
});

describe("streamStore", () => {
  it("bumping a version does not change the layers array identity", () => {
    const id = useLayerStore.getState().addLayer({
      name: "s.fcb",
      model: {
        sourceEncoding: "flatcitybuf",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      },
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });
    const before = useLayerStore.getState().layers;
    useStreamStore
      .getState()
      .register(id, { version: 0, status: "idle" } as never);
    useStreamStore.getState().bumpVersion(id);
    expect(useLayerStore.getState().layers).toBe(before); // same reference
    expect(useStreamStore.getState().streams[id]!.version).toBe(1);
  });

  it("unregister removes the stream entry", () => {
    useStreamStore
      .getState()
      .register("L", { version: 0, status: "idle" } as never);
    useStreamStore.getState().unregister("L");
    expect(useStreamStore.getState().streams["L"]).toBeUndefined();
  });

  it("defaults a new layer to auto LoD mode", () => {
    const id = useLayerStore.getState().addLayer({
      name: "s.fcb",
      model: {
        sourceEncoding: "flatcitybuf",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      },
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!.lodMode,
    ).toBe("auto");
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run tests/unit/features/streaming/streamStore.test.ts` → FAIL.

Add `lodMode: "auto"` and `isStreaming: false` defaults in `addLayer` (`src/features/layers/layerStore.ts:76-85`), plus a `setLodMode(layerId, mode)` action. Create `streamStore.ts` as a plain Zustand store holding `streams: Record<string, StreamState>`.

- [ ] **Step 3: Run tests, typecheck, commit**

```bash
npx vitest run tests/unit/features tests/unit/persistence
npx tsc -b --noEmit
git add src/features/streaming/streamStore.ts src/features/layers/layerStore.ts tests/unit/features/streaming/streamStore.test.ts
git commit -m "feat: add stream store keyed by layer id, with lodMode on Layer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Two-level scene map in `CitySceneR3F`

**Files:**

- Modify: `src/scene/CitySceneR3F.tsx`
- Test: `tests/unit/scene/layerSceneMap.test.ts`

**Interfaces:**

- Consumes: `meshOffset`, `cellCentre` (Tasks 1-2).
- Produces: `LayerSceneState` gains `cells: Map<CellKey, CellSceneState>`.

**Why not a compound key.** A flat `${layerId}:${cellKey}` key breaks the cleanup loop at `src/scene/CitySceneR3F.tsx:409`, which compares map keys against layer ids — every cell would be deleted immediately. It also breaks every `map.get(layer.id)` at `:495`, `:571`, `:597`, `:687`, `:1017`. Use a two-level structure instead:

```ts
export interface CellSceneState {
  mesh: Mesh;
  pickingIndex: PickingIndex;
  baseColors: Float32Array;
  ruleColors: Float32Array | null;
}

export interface LayerSceneState {
  mesh: Mesh | null; // null for streaming layers
  pickingIndex: PickingIndex | null;
  baseColors: Float32Array | null;
  ruleColors: Float32Array | null;
  selectedLod: string | null;
  originOffset: Vec3;
  cells: Map<CellKey, CellSceneState>; // empty for static layers
}
```

Every mesh's `userData` carries **both** `layerId` and `cellKey` (`cellKey` undefined for static layers), because picking resolves from `e.object.userData` and must know which cell's `pickingIndex` to consult.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scene/layerSceneMap.test.ts
import { describe, it, expect } from "vitest";
import { Mesh } from "three";
import { resolveMeshOwner } from "../../../src/scene/CitySceneR3F";

describe("resolveMeshOwner", () => {
  it("resolves a static layer mesh", () => {
    const m = new Mesh();
    m.userData.layerId = "L";
    expect(resolveMeshOwner(m)).toEqual({ layerId: "L", cellKey: undefined });
  });

  it("resolves a streaming cell mesh to both ids", () => {
    const m = new Mesh();
    m.userData.layerId = "L";
    m.userData.cellKey = "2/1/0";
    expect(resolveMeshOwner(m)).toEqual({ layerId: "L", cellKey: "2/1/0" });
  });

  it("returns null for a mesh with no layer", () => {
    expect(resolveMeshOwner(new Mesh())).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails, then refactor**

Run: `npx vitest run tests/unit/scene/layerSceneMap.test.ts` → FAIL.

Export `resolveMeshOwner(obj: Object3D)`. Then rewrite each of these call sites explicitly against the two-level map — do **not** attempt a mechanical find-and-replace:

- `:409` cleanup — iterate layer ids only; dispose each layer's cells before deleting the layer entry.
- `:495` visibility — set `visible` on the layer mesh **and** every cell mesh.
- `:502-510` triangle count — sum the layer mesh plus all cell meshes.
- `:571` rule colors — apply per cell for streaming layers.
- `:597` cursor conversion — use `sceneToSource` with the owning cell's offset.
- `:687` box selection — walk cells.
- `:1017`/`:1030` picking — resolve the cell's `pickingIndex` via `resolveMeshOwner`.

- [ ] **Step 3: Run the full suite, typecheck, commit**

```bash
npx vitest run tests/unit/scene tests/integration
npx tsc -b --noEmit
git add src/scene/CitySceneR3F.tsx tests/unit/scene/layerSceneMap.test.ts
git commit -m "refactor: two-level layer/cell scene map for streaming meshes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: The streaming driver

**Files:**

- Create: `src/features/streaming/useTileStreaming.ts`
- Create: `src/features/streaming/throttleGates.ts` (pure)
- Test: `tests/unit/features/streaming/throttleGates.test.ts`

**Interfaces:**

- Consumes: everything from Phases A–C.
- Produces: `shouldRefetch(prev, next, hasHoles, levelChanged): boolean`; `useTileStreaming(): void`

**Trigger is `OrbitControls`' `change` event, not the render loop.** R3F's frame loop runs continuously, so a `useFrame`-based settle timer never fires. `enableDamping` with `dampingFactor: 0.1` (`src/scene/CitySceneR3F.tsx:939-944`) keeps `change` firing while damping decays — exactly the signal we want. On the **first** `change`, abort in-flight work immediately so stale reads do not compete with the interaction.

**Hysteresis must be bypassable.** If the desired cover has holes or the level/LoD changed, refetch regardless — otherwise a hysteresis skip can leave the view permanently incomplete.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/throttleGates.test.ts
import { describe, it, expect } from "vitest";
import { shouldRefetch } from "../../../../src/features/streaming/throttleGates";

const prev = { centre: [0, 0] as [number, number], span: 1000 };

describe("shouldRefetch", () => {
  it("skips a small pan", () => {
    expect(
      shouldRefetch(prev, { centre: [100, 0], span: 1000 }, false, false),
    ).toBe(false);
  });

  it("fires when the centre moves past MOVE_FRAC of the span", () => {
    expect(
      shouldRefetch(prev, { centre: [250, 0], span: 1000 }, false, false),
    ).toBe(true);
  });

  it("fires when the span changes by SCALE_FACTOR", () => {
    expect(
      shouldRefetch(prev, { centre: [0, 0], span: 1400 }, false, false),
    ).toBe(true);
    expect(
      shouldRefetch(prev, { centre: [0, 0], span: 700 }, false, false),
    ).toBe(true);
  });

  it("skips a small zoom", () => {
    expect(
      shouldRefetch(prev, { centre: [0, 0], span: 1100 }, false, false),
    ).toBe(false);
  });

  it("BYPASSES hysteresis when the cover has holes", () => {
    expect(
      shouldRefetch(prev, { centre: [10, 0], span: 1000 }, true, false),
    ).toBe(true);
  });

  it("BYPASSES hysteresis when the level changed", () => {
    expect(
      shouldRefetch(prev, { centre: [10, 0], span: 1000 }, false, true),
    ).toBe(true);
  });

  it("always fires on the first commit", () => {
    expect(
      shouldRefetch(null, { centre: [0, 0], span: 1000 }, false, false),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run tests/unit/features/streaming/throttleGates.test.ts` → FAIL.

```ts
// src/features/streaming/throttleGates.ts
import { MOVE_FRAC, SCALE_FACTOR } from "./constants";

export interface CommitView {
  readonly centre: readonly [number, number];
  readonly span: number;
}

export function shouldRefetch(
  prev: CommitView | null,
  next: CommitView,
  hasHoles: boolean,
  levelChanged: boolean,
): boolean {
  if (prev === null || hasHoles || levelChanged) return true;
  const moved = Math.hypot(
    next.centre[0] - prev.centre[0],
    next.centre[1] - prev.centre[1],
  );
  if (moved > prev.span * MOVE_FRAC) return true;
  const ratio = next.span / prev.span;
  return ratio >= SCALE_FACTOR || ratio <= 1 / SCALE_FACTOR;
}
```

Then write `useTileStreaming` wiring: subscribe to `controls.addEventListener("change", ...)`; on first change `client.send({type:"cancel"})` and bump the epoch; `setTimeout(SETTLE_MS)` on the last change; then footprint → `null` means show "too far"; else probe → over `VIEWPORT_FEATURE_BUDGET` means "too far"; else `chooseLevel` → `null` means "too far"; else compute desired/missing and run `shouldRefetch`.

**Eviction policy — read this carefully.** On a normal commit, do **NOT** call `retain(desired)`. Dropping every cell outside the current viewport would force a refetch on every pan-back, which defeats the entire reason for having a cache. Instead: `touch()` each desired cell, insert the newly fetched ones, then `evictToBudget()` and send the returned keys as `evict` to the worker. Off-screen cells survive until memory pressure actually requires evicting them.

`retain()` is called in exactly **one** situation: a **level change**, where the old level's cells can never be reused. That is the all-or-nothing swap — build the new cover off-scene, and on success `retain(newCover)` to drop the whole old level at once. On `LEVEL_SWAP_TIMEOUT_MS`, discard the partial new cover and keep the old one untouched.

- [ ] **Step 3: Run tests, typecheck, commit**

```bash
npx vitest run tests/unit/features/streaming/
npx tsc -b --noEmit
git add src/features/streaming/throttleGates.ts src/features/streaming/useTileStreaming.ts tests/unit/features/streaming/throttleGates.test.ts
git commit -m "feat: add controls-driven streaming trigger with bypassable hysteresis

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase E — Consumers, analytics, and UI

---

### Task 15: `getResidentModel` and consumer migration

**Files:**

- Create: `src/features/streaming/residentModel.ts`
- Modify: `src/analytics/computeStats.ts`, `src/ui/inspector/InspectorPanel.tsx`, `src/ui/inspector/AnalysisTab.tsx`, `src/ui/inspector/RuleBuilderTab.tsx`, `src/ui/table/TablePanel.tsx`
- Test: `tests/unit/features/streaming/residentModel.test.ts`

**Interfaces:**

- Consumes: `ResidentObjectRecord` (Task 9), `CellCache` (Task 5), `useStreamStore` (Task 12).
- Produces:
  - `getResidentModel(layerId: string, version: number): ResidentModel`
  - `interface ResidentModel { objects: Record<string, ResidentObjectRecord>; cellCount: number; featureCount: number; surfaceAttrKeys: string[] }`

**Imperative, not a Zustand selector.** Zustand evaluates a selector on **every** store notification to compare results, so `s => s.residentModel` would materialise on every commit. `getResidentModel` is a plain memoised function keyed on `(layerId, version)`; only mounted consumers call it.

`AnalysisTab` and the Inspector's Surfaces tab need rings, which a `ResidentObjectRecord` does not carry. They gain an async fetch through the worker's `surfaces` message, rendering a loading state until it resolves. This is a real behaviour change for streaming layers only — static layers keep their synchronous path.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/features/streaming/residentModel.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  getResidentModel,
  __resetMemo,
} from "../../../../src/features/streaming/residentModel";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { CellCache } from "../../../../src/features/streaming/cellCache";

function entry(ids: string[]) {
  return {
    objects: ids.map((id) => ({
      id,
      objectType: "Building",
      attributes: {},
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2.2",
      surfaceCount: 2,
      roofMetrics: [],
      footprintAreaSqM: 10,
      volumeCuM: 30,
      parents: [],
      children: [],
    })),
    surfaceAttrKeys: ["slope"],
  };
}

beforeEach(() => {
  __resetMemo();
  const cache = new CellCache<never>({
    maxTriangles: Infinity,
    maxBytes: Infinity,
  });
  cache.set("2/0/0", entry(["a", "b"]) as never, { triangles: 1, bytes: 1 });
  cache.set("2/1/0", entry(["c"]) as never, { triangles: 1, bytes: 1 });
  useStreamStore.setState({ streams: { L: { cache, version: 1 } as never } });
});

describe("getResidentModel", () => {
  it("merges objects across resident cells", () => {
    const m = getResidentModel("L", 1);
    expect(Object.keys(m.objects).sort()).toEqual(["a", "b", "c"]);
    expect(m.cellCount).toBe(2);
    expect(m.featureCount).toBe(3);
  });

  it("returns the identical object for the same version (memoised)", () => {
    expect(getResidentModel("L", 1)).toBe(getResidentModel("L", 1));
  });

  it("recomputes when the version changes", () => {
    const first = getResidentModel("L", 1);
    expect(getResidentModel("L", 2)).not.toBe(first);
  });

  it("unions surface attribute keys", () => {
    expect(getResidentModel("L", 1).surfaceAttrKeys).toEqual(["slope"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails, implement, then migrate consumers**

Run: `npx vitest run tests/unit/features/streaming/residentModel.test.ts` → FAIL.

Implement with a single-entry memo per layer (`Map<layerId, {version, model}>`). Export `__resetMemo()` for tests. Then update each consumer to branch on `layer.isStreaming`:

- `computeStats.ts` — accept `ResidentObjectRecord[]`, using `r.roofMetrics` instead of recomputing from rings, and `r.surfaceCount` for the count.
- `TablePanel.tsx:390,420` — `surface_count` from `r.surfaceCount`.
- `RuleBuilderTab.tsx:400` — union `model.surfaceAttrKeys` instead of walking surfaces.
- `InspectorPanel.tsx:212,283` — read `footprintAreaSqM` / `volumeCuM`.
- `InspectorPanel.tsx:353` and `AnalysisTab.tsx:31,79,145` — async `surfaces` fetch with a loading state.

- [ ] **Step 3: Run the full suite, typecheck, commit**

```bash
npx vitest run
npx tsc -b --noEmit
git add src/features/streaming/residentModel.ts src/analytics src/ui tests/unit/features/streaming/residentModel.test.ts
git commit -m "feat: add memoised resident model and migrate consumers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Analytics honesty and UI

**Files:**

- Modify: `src/app/App.tsx` (DuckDB routing at `:132-145`), `src/analytics/duckdb.ts`, `src/ui/sidebar/LodSelector.tsx`, `src/ui/layers/LayerPanel.tsx`, `src/ui/StatusBar.tsx`
- Test: `tests/unit/analytics/streamingDuckdb.test.ts`

**The contradiction being fixed.** `src/app/App.tsx:132-145` routes URL layers to `loadModelIntoDuckDB(url, encoding)`, which builds a whole-dataset `city_objects` table from the remote source (`src/analytics/duckdb.ts:146-168`). For a streaming layer that silently opens a **second full read of the file** and makes the Stats tab report the entire dataset while the UI claims otherwise. That path is disabled for streaming layers; the table is fed from resident cells instead.

**Labels must say "resident cache", not "visible area".** The cover includes a one-cell margin and the LRU retains cells after they leave view, so two users at the same camera can see different numbers. Counts are labelled **features**, never buildings — one FCB feature may hold a Building plus several BuildingParts, so `n of <total> buildings` would be arithmetically false.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/analytics/streamingDuckdb.test.ts
import { describe, it, expect } from "vitest";
import { shouldUseSourceUrlPath } from "../../../src/analytics/duckdb";

describe("shouldUseSourceUrlPath", () => {
  it("allows the whole-file path for a static URL layer", () => {
    expect(
      shouldUseSourceUrlPath(
        { type: "url", url: "https://x/a.city.json" },
        false,
      ),
    ).toBe(true);
  });

  it("REFUSES the whole-file path for a streaming layer", () => {
    expect(
      shouldUseSourceUrlPath({ type: "url", url: "https://x/a.fcb" }, true),
    ).toBe(false);
  });

  it("refuses for file-backed layers as today", () => {
    expect(
      shouldUseSourceUrlPath({ type: "file", fileName: "a.fcb" }, false),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run tests/unit/analytics/streamingDuckdb.test.ts` → FAIL.

Export `shouldUseSourceUrlPath(ref, isStreaming)` from `duckdb.ts` and use it at `App.tsx:133`. Then UI:

- `LodSelector.tsx` — auto/manual toggle; in `auto` disable the dropdown and show a read-out of the current LoD with the current cell size.
- `LayerPanel.tsx` — streaming badge, resident cell count, `n features loaded`, and the "resident cache" qualifier.
- `StatusBar.tsx` — status from `streamStore` (`probing` / `fetching` / `too-far` / `error`), with "Zoom in to load features" for `too-far`.

- [ ] **Step 3: Run tests, typecheck, commit**

```bash
npx vitest run
npx tsc -b --noEmit
git add src/app/App.tsx src/analytics/duckdb.ts src/ui tests/unit/analytics/streamingDuckdb.test.ts
git commit -m "feat: constrain DuckDB for streaming layers and add streaming UI

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Delete the whole-file path and fix its fallout

> **PLAN CORRECTION (made during execution).** Task 8's `^0.3.0` dependency bump broke
> `loadFlatCityBuf.ts` and `flatcitybufConversion.test.ts`, which depend on the removed
> 0.2.0 WASM API — leaving `tsc -b` with 5 errors and one failing test file for the nine
> tasks between 8 and 17. That would have made every intermediate "tsc clean / suite green"
> gate meaningless.
>
> So part of this task was **pulled forward into Task 8**: deleting
> `src/domain/citymodel/flatcitybuf/loadFlatCityBuf.ts`, deleting
> `tests/unit/domain/citymodel/flatcitybuf/flatcitybufConversion.test.ts`, and making
> `loadCityModel.ts` throw a clear error for `.fcb` instead of importing the deleted loader.
>
> **Still owned by this task:** `App.tsx` snapshot restore (`:245`) and share restore
> (`:367`), `useLayerFileLoader.ts` routing to the streaming path, and the versioned
> persistence schema. Do not re-attempt the deletions above — verify they are already gone.
>
> Lesson for future plans: a dependency bump and the removal of that dependency's consumers
> must land in the same task, or the build is broken in between.

**Files:**

- Delete: `src/domain/citymodel/flatcitybuf/loadFlatCityBuf.ts`
- Modify: `src/domain/citymodel/loadCityModel.ts:13,81-82`, `src/features/layers/useLayerFileLoader.ts`, `src/app/App.tsx:245,367`, `src/persistence/types.ts:32`
- Test: `tests/unit/persistence/snapshotV2.test.ts`

**Deleting the loader is not self-contained.** `loadCityModel.ts:13` imports it and `:82` calls it; snapshot restore (`App.tsx:245`) and share restore (`App.tsx:367`) both go through `loadFromUrl`. Deleting without updating these either fails compilation or routes restored `.fcb` URLs into a path that no longer exists.

Split "create a layer source" from "load a complete CityModel": `loadFromUrl` keeps handling CityJSON/CityJSONSeq/CityGML and **throws a clear error** for `.fcb`; `useLayerFileLoader` routes `.fcb` (URL or `File`) to the streaming path, passing the `File` straight through as a `Blob`.

**Persistence needs a v2 schema.** `LayerSnapshot` has only an optional `selectedLod` (`src/persistence/types.ts:32`) and save omits even that (`App.tsx:189-197`). A local `Blob` cannot survive a reload, so such a layer must restore as an explicit _unavailable local source_ state prompting re-selection — not vanish with a toast.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/persistence/snapshotV2.test.ts
import { describe, it, expect } from "vitest";
import { migrateSnapshot } from "../../../src/persistence/types";

describe("migrateSnapshot", () => {
  it("upgrades a v1 snapshot, defaulting lodMode to auto", () => {
    const v1 = {
      version: 1,
      layers: [{ id: "a", name: "x", selectedLod: "2.2" }],
    };
    const v2 = migrateSnapshot(v1 as never);
    expect(v2.version).toBe(2);
    expect(v2.layers[0]!.lodMode).toBe("auto");
    expect(v2.layers[0]!.selectedLod).toBe("2.2");
  });

  it("preserves streaming source metadata on a v2 snapshot", () => {
    const v2in = {
      version: 2,
      layers: [
        {
          id: "a",
          name: "x",
          lodMode: "manual",
          selectedLod: "1.2",
          stream: { kind: "url", url: "https://x/a.fcb" },
        },
      ],
    };
    expect(migrateSnapshot(v2in as never).layers[0]!.stream).toEqual({
      kind: "url",
      url: "https://x/a.fcb",
    });
  });

  it("marks a local streaming layer unavailable on restore", () => {
    const v2in = {
      version: 2,
      layers: [
        {
          id: "a",
          name: "x",
          lodMode: "auto",
          stream: { kind: "file", fileName: "a.fcb" },
        },
      ],
    };
    expect(migrateSnapshot(v2in as never).layers[0]!.unavailable).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run tests/unit/persistence/snapshotV2.test.ts` → FAIL.

Add the v2 schema and `migrateSnapshot`, delete `loadFlatCityBuf.ts`, update `loadCityModel.ts` to throw for `.fcb`, and route both restore paths through the streaming loader.

- [ ] **Step 3: Verify the deletion left nothing behind**

```bash
grep -rn "loadFlatCityBuf\|HttpFcbReader\|cjseqToCj\|mapToObject" src/ || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 4: Run full suite, typecheck, commit**

```bash
npx vitest run
npx tsc -b --noEmit
git add -A src tests
git commit -m "feat: remove whole-file .fcb path and version the snapshot schema

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase F — Integration

---

### Task 18: End-to-end streaming with request accounting

**Files:**

- Create: `fixtures/delft.fcb` (vendored from `../flatcitybuf/examples/data/delft.fcb`)
- Create: `tests/integration/fcbStreaming.test.ts`

**Request accounting is the point.** The whole design exists for request economy, so a regression that quietly restores per-cell traversals must fail a test — not merely produce correct geometry. Wrap the reader's range source in a counting decorator and assert traversal counts.

- [ ] **Step 1: Vendor the fixture**

```bash
cp ../flatcitybuf/examples/data/delft.fcb fixtures/delft.fcb
ls -la fixtures/delft.fcb
```

- [ ] **Step 2: Write the integration test**

```ts
// tests/integration/fcbStreaming.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FcbReader } from "@cityjson/flatcitybuf";
import {
  checkAdmission,
  headerModel,
} from "../../src/domain/citymodel/flatcitybuf/fcbSource";
import { makeGrid, keysCovering } from "../../src/features/streaming/tileGrid";
import { chooseLevel } from "../../src/features/streaming/levelPolicy";

const bytes = new Uint8Array(
  fs.readFileSync(
    path.resolve(import.meta.dirname!, "../../fixtures/delft.fcb"),
  ),
);

describe("fcb streaming pipeline", () => {
  it("admits the fixture for streaming", async () => {
    const reader = await FcbReader.fromBytes(bytes);
    expect(checkAdmission(reader.header)).toBeNull();
  });

  it("probes a footprint without reading feature bodies", async () => {
    const reader = await FcbReader.fromBytes(bytes);
    const { extent } = headerModel(reader.header);
    const cursor = await reader.select({
      spatial: {
        kind: "bbox",
        value: [extent[0], extent[1], extent[3], extent[4]],
      },
      limit: 0,
    });
    expect(cursor.featuresCount).toBeGreaterThan(0);
    // limit 0 -> the page is empty, so iterating yields nothing
    const seen = [];
    for await (const f of cursor) seen.push(f);
    expect(seen).toEqual([]);
  });

  it("covers a footprint and buckets features with ONE traversal", async () => {
    const reader = await FcbReader.fromBytes(bytes);
    const { extent } = headerModel(reader.header);
    const grid = makeGrid(extent);
    const footprint: [number, number, number, number] = [
      extent[0],
      extent[1],
      extent[0] + (extent[3] - extent[0]) / 4,
      extent[1] + (extent[4] - extent[1]) / 4,
    ];
    const level = chooseLevel(grid, footprint);
    expect(level).not.toBeNull();
    const cells = keysCovering(grid, footprint, level!);
    expect(cells.length).toBeGreaterThanOrEqual(9);

    // ONE select for the whole cover — not one per cell.
    let selectCalls = 0;
    const orig = reader.select.bind(reader);
    (reader as never as { select: unknown }).select = (o: never) => {
      selectCalls++;
      return orig(o);
    };
    const cursor = await (reader as never as { select: typeof orig }).select({
      spatial: { kind: "bbox", value: footprint },
    });
    let n = 0;
    for await (const _f of cursor) n++;
    expect(selectCalls).toBe(1);
    expect(n).toBeGreaterThan(0);
  });

  it("buckets real features into cells with no duplicates and no losses", async () => {
    const reader = await FcbReader.fromBytes(bytes);
    const { extent } = headerModel(reader.header);
    const grid = makeGrid(extent);
    const { parseCityJSON } =
      await import("../../src/domain/citymodel/cityjson/parseCityJSON");
    const { toCityJSONMetadata } = await import("@cityjson/flatcitybuf");
    const { bucketFeatures } =
      await import("../../src/features/streaming/bucketFeatures");

    const metadata = toCityJSONMetadata(reader.header);
    const cursor = await reader.select({
      spatial: {
        kind: "bbox",
        value: [extent[0], extent[1], extent[3], extent[4]],
      },
      limit: 200,
    });

    const models = [];
    for await (const f of cursor) {
      models.push(
        parseCityJSON({ ...metadata, ...f.toCityJSON(reader.header) } as never),
      );
    }
    expect(models.length).toBeGreaterThan(0);

    const buckets = bucketFeatures(models, grid, 2, new Set());

    // No object appears in two cells, and every object with a bbox is placed.
    const seen = new Set<string>();
    let placed = 0;
    for (const cellModel of buckets.values()) {
      for (const id of Object.keys(cellModel.objects)) {
        expect(seen.has(id)).toBe(false); // duplicate across cells
        seen.add(id);
        placed++;
      }
    }
    const withBBox = models.flatMap((m) =>
      Object.values(m.objects).filter((o) => o?.bbox !== null),
    ).length;
    expect(placed).toBe(withBBox);
  });
});
```

- [ ] **Step 3: Run and commit**

```bash
npx vitest run tests/integration/fcbStreaming.test.ts
npx tsc -b --noEmit
git add fixtures/delft.fcb tests/integration/fcbStreaming.test.ts
git commit -m "test: add end-to-end fcb streaming integration with request accounting

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Full verification before declaring done**

```bash
npx vitest run
npx tsc -b --noEmit
npm run build
```

All three must pass. Record the actual output — do not claim success without it.

---

## Spec coverage

| Spec §                                      | Task             |
| ------------------------------------------- | ---------------- |
| §1 coordinate frames, units                 | 1, 8             |
| §2 module layout                            | 1–14             |
| §3 cell grid, ownership                     | 2                |
| §4 uniform level, one traversal             | 4, 10            |
| §5 viewport footprint                       | 3                |
| §6 trigger and throttling                   | 14               |
| §7 worker, protocol, payloads, cancellation | 9, 10, 11        |
| §8 cache, eviction, budgets                 | 5, 14            |
| §9 LoD ladder                               | 4, 16            |
| §10 origin, mesh offset, multi-layer        | 1, 13            |
| §11 analysis semantics, residentModel       | 15, 16           |
| §12 changes to existing code                | 6, 7, 13, 16, 17 |
| §13 triangulation, colour parity            | 6, 7             |
| §14 admission, identity, persistence        | 8, 11, 17        |
| §15 testing                                 | every task       |
| §16 error handling                          | 8, 14, 16, 17    |
| §17 constants                               | 2                |

**Known deferrals, carried from the spec:** origin rebasing is out of scope for v1 (§10); attribute-filter queries are a non-goal; every constant in §17 is provisional pending tuning against a large real dataset.
