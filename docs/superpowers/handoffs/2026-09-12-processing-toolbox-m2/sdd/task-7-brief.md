### Task 7: One geometry source for both layer kinds, and LoD counts that measure nothing

**Files:**

- Create: `src/features/processing/roofGeometrySource.ts`
- Test: `tests/unit/features/processing/roofGeometrySource.test.ts`

**Interfaces:**

- Consumes: `RoofSurfaceMetric` (Task 5); `ResidentObjectRecord`/`ResidentRoofMetrics` (Task 6); `computeRoofMetrics` from `@cityjson/navara-core`; `getResidentModel` (`residentModel.ts:46`); `parentsIndexOf`/`rootFeatureId` (`featureId.ts:19,46`).
- Produces:
  - `export interface RoofGeometrySource { has(objectId: string): boolean; hasGeometryAt(objectId: string, lod: string): boolean; roofSurfacesAt(objectId: string, lod: string): ReadonlyArray<RoofSurfaceMetric> }`
  - `export function roofGeometrySource(layer: Layer): RoofGeometrySource`
  - `export function featureIdsByObject(layer: Layer): ReadonlyMap<string, string>`
  - `export interface LodOption { readonly lod: string; readonly features: number }`
  - `export function roofLodOptions(layer: Layer): ReadonlyArray<LodOption>`
- Task 9 consumes the source; Task 11 consumes `roofLodOptions`.

**The CPU contract, which is the reason this module has the shape it has.**

- `roofLodOptions` reads **tags only** — `Surface.type` and `Surface.lod` for a static layer, the already-computed `ResidentRoofMetrics.lod` plus `geometryLods` for a streaming one. It calls `computeRoofMetrics` **never**. Opening the LoD select must not measure a roof.
- `roofLodOptions` applies the **same contributor rule as execution** (§7, geometry-keyed): at each LoD, a feature whose PART has geometry there is counted from its parts only, so a root roof displaced by a wall-only part does NOT make the feature count. A select that promised "2 buildings with roof surfaces" and a run that then measured one would be the same bug twice, in the two places a user compares.
- `roofSurfacesAt(id, lod)` measures on demand and memoises per `(id, lod)`, so a run touches only the features in its scope, at the one LoD it was given, once each.
- `hasGeometryAt(id, lod)` is §7's contributor question, about surfaces of every semantic type, and is also tags only.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/roofGeometrySource.test.ts`:

```ts
/**
 * The one place that knows where a layer's geometry lives — the parsed model
 * for a static layer, the resident set for a streaming one — and the one place
 * that decides how much of it is measured.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../../../src/features/layers/layerStore";

const residents: {
  objects: Record<string, unknown>;
  cellCount: number;
  featureCount: number;
  surfaceAttrKeys: string[];
} = { objects: {}, cellCount: 0, featureCount: 0, surfaceAttrKeys: [] };

vi.mock("../../../../src/features/streaming/residentModel", () => ({
  getResidentModel: vi.fn(() => residents),
}));

/** Counts the calls the CPU contract is about. */
const measured: string[] = [];
vi.mock("@cityjson/navara-core", async () => {
  const actual = await vi.importActual<typeof import("@cityjson/navara-core")>(
    "@cityjson/navara-core",
  );
  return {
    ...actual,
    computeRoofMetrics: vi.fn((surface: { lod: string | null }) => {
      measured.push(String(surface.lod));
      return actual.computeRoofMetrics(
        surface as Parameters<typeof actual.computeRoofMetrics>[0],
      );
    }),
  };
});

const { featureIdsByObject, roofGeometrySource, roofLodOptions } =
  await import("../../../../src/features/processing/roofGeometrySource");

/** A unit square of `type` at `lod`; area 1, inclination 0. */
const surface = (type: string, lod: string) => ({
  type,
  rings: [
    [
      [0, 0, 3],
      [1, 0, 3],
      [1, 1, 3],
      [0, 1, 3],
    ],
  ],
  attributes: {},
  lod,
});

/**
 * TWO roof-bearing features, not one:
 *  - B1 (Building) roof at 2.2, with part B1P (roof + wall at 2.2)
 *  - B4 (Building) roof at 2.2, no parts
 *  - B2 (Building) roof at 1.2, no parts
 *  - B3 (Building) WALL only at 2.2 — geometry, but no roof
 */
function staticLayer(): Layer {
  const object = (
    id: string,
    objectType: string,
    surfaces: unknown[],
    parents: string[] = [],
    children: string[] = [],
  ) => ({
    id,
    objectType,
    attributes: {},
    surfaces,
    bbox: null,
    children,
    parents,
    lod: null,
  });
  return {
    id: "L1",
    name: "roofs",
    isStreaming: false,
    selectedLod: "2.2",
    availableLods: ["2.2", "1.2"],
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects: {
        B1: object(
          "B1",
          "Building",
          [surface("RoofSurface", "2.2")],
          [],
          ["B1P"],
        ),
        B1P: object(
          "B1P",
          "BuildingPart",
          [surface("RoofSurface", "2.2"), surface("WallSurface", "2.2")],
          ["B1"],
        ),
        B4: object("B4", "Building", [surface("RoofSurface", "2.2")]),
        B2: object("B2", "Building", [surface("RoofSurface", "1.2")]),
        B3: object("B3", "Building", [surface("WallSurface", "2.2")]),
      },
    },
  } as unknown as Layer;
}

afterEach(() => {
  residents.objects = {};
  measured.length = 0;
});

describe("roofLodOptions", () => {
  it("counts FEATURES per LoD, parts folded into their building", () => {
    // 2.2: B1 (through its part, which has a roof there) and B4 — TWO
    // features. 1.2: B2.
    expect(roofLodOptions(staticLayer())).toEqual([
      { lod: "2.2", features: 2 },
      { lod: "1.2", features: 1 },
    ]);
  });

  it("applies the CONTRIBUTOR rule, so a displaced root roof does not count", () => {
    // B1's part keeps its wall at 2.2 but loses its roof. §7 still makes the
    // PART the contributor (it has geometry there), so B1 has no roof at 2.2
    // and must not appear in the count — the same answer the run will give.
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["B1P"]!.surfaces = [surface("WallSurface", "2.2")];
    expect(roofLodOptions(layer)).toEqual([
      { lod: "2.2", features: 1 }, // B4 only
      { lod: "1.2", features: 1 },
    ]);
    expect(measured).toEqual([]);
  });

  it("counts the ROOT when no part has geometry at that LoD", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["B1P"]!.surfaces = [surface("RoofSurface", "1.2")];
    // At 2.2 the part contributes nothing, so B1 falls back to its own roof.
    expect(roofLodOptions(layer)).toEqual([
      { lod: "2.2", features: 2 }, // B1 (root) and B4
      { lod: "1.2", features: 2 }, // B1 (through its part) and B2
    ]);
  });

  it("measures NOTHING — it reads the surfaces' tags only", () => {
    roofLodOptions(staticLayer());
    expect(measured).toEqual([]);
  });

  it("offers no LoD for a layer whose only geometry is walls", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as { objects: Record<string, unknown> }
    ).objects;
    for (const id of ["B1", "B1P", "B4", "B2"]) delete objects[id];
    expect(roofLodOptions(layer)).toEqual([]);
  });

  it("reads a streaming layer's RESIDENT records, which are pre-measured", () => {
    residents.objects = {
      r1: {
        id: "r1",
        parents: [],
        children: [],
        geometryLods: ["2"],
        roofMetrics: [
          {
            lod: "2",
            areaSqM: 12,
            inclinationDeg: 30,
            azimuthDeg: 180,
            elevationM: 4,
          },
        ],
      },
      r2: {
        id: "r2",
        parents: [],
        children: [],
        geometryLods: ["2"],
        roofMetrics: [],
      },
    };
    const layer = {
      id: "S1",
      name: "delft",
      isStreaming: true,
      model: { sourceEncoding: "flatcitybuf", objects: {} },
    } as unknown as Layer;
    expect(roofLodOptions(layer)).toEqual([{ lod: "2", features: 1 }]);
    expect(measured).toEqual([]);
  });
});

describe("roofGeometrySource", () => {
  it("answers hasGeometryAt from TAGS, for surfaces of every type", () => {
    const source = roofGeometrySource(staticLayer());
    // The case §7's contributor rule turns on.
    expect(source.hasGeometryAt("B3", "2.2")).toBe(true);
    expect(source.roofSurfacesAt("B3", "2.2")).toEqual([]);
    expect(source.hasGeometryAt("B2", "2.2")).toBe(false);
    expect(source.hasGeometryAt("B2", "1.2")).toBe(true);
  });

  it("distinguishes an object it has never heard of from one with nothing", () => {
    const source = roofGeometrySource(staticLayer());
    expect(source.has("B3")).toBe(true);
    expect(source.has("gone")).toBe(false);
    expect(source.hasGeometryAt("gone", "2.2")).toBe(false);
    expect(source.roofSurfacesAt("gone", "2.2")).toEqual([]);
  });

  it("measures only the object and LoD it is asked for, once", () => {
    const source = roofGeometrySource(staticLayer());
    const first = source.roofSurfacesAt("B1P", "2.2");
    expect(first).toHaveLength(1);
    expect(first[0]!.areaSqM).toBeCloseTo(1, 6);
    expect(measured).toEqual(["2.2"]);
    source.roofSurfacesAt("B1P", "2.2");
    source.roofSurfacesAt("B1P", "2.2");
    expect(measured).toEqual(["2.2"]); // memoised
    source.roofSurfacesAt("B1P", "1.2");
    expect(measured).toEqual(["2.2"]); // nothing of B1P's is tagged 1.2
  });

  it("filters a streaming record's pre-measured metrics by LoD", () => {
    residents.objects = {
      r1: {
        id: "r1",
        parents: [],
        children: [],
        geometryLods: ["1.2", "2"],
        roofMetrics: [
          {
            lod: "2",
            areaSqM: 12,
            inclinationDeg: 30,
            azimuthDeg: 180,
            elevationM: 4,
          },
          {
            lod: "1.2",
            areaSqM: 3,
            inclinationDeg: 0,
            azimuthDeg: 0,
            elevationM: 1,
          },
        ],
      },
    };
    const layer = {
      id: "S1",
      name: "delft",
      isStreaming: true,
      model: { sourceEncoding: "flatcitybuf", objects: {} },
    } as unknown as Layer;
    const source = roofGeometrySource(layer);
    expect(source.roofSurfacesAt("r1", "2")).toEqual([
      { lod: "2", areaSqM: 12, inclinationDeg: 30, azimuthDeg: 180 },
    ]);
    expect(source.hasGeometryAt("r1", "1.2")).toBe(true);
    expect(measured).toEqual([]);
  });
});

describe("featureIdsByObject", () => {
  it("resolves a part to its building and a root to itself", () => {
    const features = featureIdsByObject(staticLayer());
    expect(features.get("B1")).toBe("B1");
    expect(features.get("B1P")).toBe("B1");
    expect(features.get("B4")).toBe("B4");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/features/processing/roofGeometrySource.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write it**

Create `src/features/processing/roofGeometrySource.ts`:

```ts
/**
 * Where a layer's geometry is, for BOTH kinds of city layer — and how much of
 * it any one question is allowed to touch.
 *
 * A static layer's geometry is parsed into `layer.model.objects[id].surfaces`,
 * each surface carrying its semantic type and the LoD it came from. A STREAMING
 * layer's `model` is a stub with no objects (`openStreamingLayer.ts`); its
 * geometry is the resident set, whose records carry roof metrics the worker
 * already computed (LoD-tagged) plus `geometryLods`, the LoDs of ALL their
 * surfaces.
 *
 * THE CPU CONTRACT, and the reason the halves are separate functions:
 *
 *  - `roofLodOptions` fills a dropdown. It reads TAGS ONLY and never calls
 *    `computeRoofMetrics`. Opening a select must not triangulate a city.
 *  - `RoofGeometrySource.roofSurfacesAt` measures, on demand, memoised per
 *    (object, LoD) — so a run touches only its scoped features' contributors at
 *    the one LoD it was given, once each.
 *  - `RoofGeometrySource.hasGeometryAt` is §7's contributor question, about
 *    surfaces of EVERY semantic type, and is also tags only.
 */
import { computeRoofMetrics } from "@cityjson/navara-core";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import type { Surface } from "../../domain/citymodel/types";
import type { RoofSurfaceMetric } from "../../domain/roofMetrics/roofRollUp";
import {
  parentsIndexOf,
  rootFeatureId,
} from "../../domain/citymodel/featureId";
import { getResidentModel } from "../streaming/residentModel";
import type { Layer } from "../layers/layerStore";

/** Whatever the layer's objects are, reduced to what the feature index needs. */
interface ObjectLike {
  readonly parents?: ReadonlyArray<string>;
}

/**
 * The resident objects, or the model's.
 *
 * The `0` is not a version we are pinning: `getResidentModel`'s second
 * parameter is a SUBSCRIPTION MARKER for React callers and the function itself
 * ignores it (`residentModel.ts`). This reads whatever is resident when it is
 * called, which is what every caller here wants.
 */
function objectsOf(layer: Layer): Readonly<Record<string, ObjectLike>> {
  return layer.isStreaming
    ? (getResidentModel(layer.id, 0).objects as Readonly<
        Record<string, ObjectLike>
      >)
    : (layer.model.objects as Readonly<Record<string, ObjectLike>>);
}

export interface RoofGeometrySource {
  /** Is this object in the layer at all? (Distinct from "has nothing here".) */
  has(objectId: string): boolean;
  /** Spec §7's contributor question: ANY surface, of any type, tagged `lod`. */
  hasGeometryAt(objectId: string, lod: string): boolean;
  /** This object's ROOF surfaces at `lod`, measured on first ask. */
  roofSurfacesAt(
    objectId: string,
    lod: string,
  ): ReadonlyArray<RoofSurfaceMetric>;
}

export function roofGeometrySource(layer: Layer): RoofGeometrySource {
  const cache = new Map<string, ReadonlyArray<RoofSurfaceMetric>>();

  if (layer.isStreaming) {
    const objects = getResidentModel(layer.id, 0).objects as Readonly<
      Record<string, ResidentObjectRecord>
    >;
    return {
      has: (id) => objects[id] !== undefined,
      hasGeometryAt: (id, lod) =>
        objects[id]?.geometryLods.includes(lod) ?? false,
      roofSurfacesAt: (id, lod) => {
        const key = `${id} ${lod}`;
        const hit = cache.get(key);
        if (hit) return hit;
        // Nothing is MEASURED here: the worker computed these when the cell
        // landed. This is a filter, and the memo only saves the allocation.
        const out = (objects[id]?.roofMetrics ?? [])
          .filter((m) => m.lod === lod)
          .map((m) => ({
            lod: m.lod,
            areaSqM: m.areaSqM,
            inclinationDeg: m.inclinationDeg,
            azimuthDeg: m.azimuthDeg,
          }));
        cache.set(key, out);
        return out;
      },
    };
  }

  const objects = layer.model.objects;
  const surfacesOf = (id: string): ReadonlyArray<Surface> =>
    objects[id]?.surfaces ?? [];
  return {
    has: (id) => objects[id] !== undefined,
    hasGeometryAt: (id, lod) => surfacesOf(id).some((s) => s.lod === lod),
    roofSurfacesAt: (id, lod) => {
      const key = `${id} ${lod}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const out = surfacesOf(id)
        .filter((s) => s.type === "RoofSurface" && s.lod === lod)
        .map((s) => {
          const metrics = computeRoofMetrics(s);
          return {
            lod: s.lod,
            areaSqM: metrics.areaSqM,
            inclinationDeg: metrics.inclinationDeg,
            azimuthDeg: metrics.azimuthDeg,
          };
        });
      cache.set(key, out);
      return out;
    },
  };
}

/** Every object of the layer to the id of the FEATURE it belongs to. */
export function featureIdsByObject(layer: Layer): ReadonlyMap<string, string> {
  const objects = objectsOf(layer);
  const parents = parentsIndexOf(objects);
  const out = new Map<string, string>();
  for (const id of Object.keys(objects))
    out.set(id, rootFeatureId(id, parents));
  return out;
}

/** One row of the LoD select (spec §6). */
export interface LodOption {
  readonly lod: string;
  /** FEATURES with at least one ROOF surface at this LoD, parts folded in. */
  readonly features: number;
}

/** Per object: the LoDs it has ANY geometry at, and the LoDs it has a ROOF at. */
interface LodTags {
  readonly geometry: ReadonlySet<string>;
  readonly roof: ReadonlySet<string>;
}

/** TAGS ONLY: `Surface.type`/`Surface.lod`, or the record's two LoD lists. */
function lodTagsByObject(layer: Layer): ReadonlyMap<string, LodTags> {
  const out = new Map<string, LodTags>();
  if (layer.isStreaming) {
    const objects = getResidentModel(layer.id, 0).objects as Readonly<
      Record<string, ResidentObjectRecord>
    >;
    for (const [id, record] of Object.entries(objects)) {
      const roof = new Set<string>();
      for (const metric of record.roofMetrics) {
        if (metric.lod !== null) roof.add(metric.lod);
      }
      out.set(id, { geometry: new Set(record.geometryLods), roof });
    }
    return out;
  }
  for (const [id, object] of Object.entries(layer.model.objects)) {
    if (!object) continue;
    const geometry = new Set<string>();
    const roof = new Set<string>();
    for (const s of object.surfaces) {
      if (s.lod === null) continue;
      geometry.add(s.lod);
      if (s.type === "RoofSurface") roof.add(s.lod);
    }
    out.set(id, { geometry, roof });
  }
  return out;
}

/**
 * Spec §6: "a select of the LoDs at which the target has geometry of the kind
 * the tool needs, each with the count of FEATURES that have it, parts folded
 * into their building".
 *
 * TAGS ONLY. A static layer's answer is `surface.type` and `surface.lod`; a
 * streaming layer's is `geometryLods` plus the LoD already on each pre-computed
 * roof metric. No geometry is measured, because this fills a dropdown.
 *
 * THE SAME CONTRIBUTOR RULE AS THE RUN (§7). At each LoD, a feature whose PART
 * has geometry there is answered from its parts alone — a root roof displaced
 * by a wall-only part does not make the feature count, exactly as it will not
 * make it measurable. A select that promised "2 buildings with roof surfaces"
 * over a run that then measured one would be the same bug printed twice, in the
 * two places the user compares.
 *
 * Sorted highest detail first, matching `computeAvailableLods` and the
 * streaming ladder so no two LoD lists in the app read in opposite directions.
 * A surface with a null LoD contributes to no option: there is no rung to
 * offer the user for it.
 */
export function roofLodOptions(layer: Layer): ReadonlyArray<LodOption> {
  const tags = lodTagsByObject(layer);
  const featureOf = featureIdsByObject(layer);

  // Every rung anyone mentions, and the members of every feature.
  const rungs = new Set<string>();
  const members = new Map<string, string[]>();
  for (const [id, tag] of tags) {
    for (const lod of tag.geometry) rungs.add(lod);
    const feature = featureOf.get(id) ?? id;
    const list = members.get(feature);
    if (list) list.push(id);
    else members.set(feature, [id]);
  }

  const options: LodOption[] = [];
  for (const lod of rungs) {
    let count = 0;
    for (const [featureId, ids] of members) {
      const parts = ids.filter((id) => id !== featureId);
      const partContributors = parts.filter((id) =>
        tags.get(id)?.geometry.has(lod),
      );
      const contributors =
        partContributors.length > 0
          ? partContributors
          : ids.filter(
              (id) => id === featureId && tags.get(id)?.geometry.has(lod),
            );
      if (contributors.some((id) => tags.get(id)?.roof.has(lod))) count += 1;
    }
    if (count > 0) options.push({ lod, features: count });
  }

  return options.sort(
    (a, b) => Number.parseFloat(b.lod) - Number.parseFloat(a.lod),
  );
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run tests/unit/features/processing/roofGeometrySource.test.ts
npx tsc -b --noEmit
```

Expected: PASS (12 tests), with `measured` empty in every LoD-options assertion.

- [ ] **Step 5: Commit**

```bash
git add src/features/processing/roofGeometrySource.ts \
  tests/unit/features/processing/roofGeometrySource.test.ts
git commit -m "feat(processing): one geometry source for static and streaming roof metrics"
```

---
