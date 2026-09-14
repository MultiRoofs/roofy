### Task 3: `solidLodOptions`, and the contributor walk both LoD answers share

**Files:**

- Create: `src/features/processing/solidGeometrySource.ts`
- Modify: `src/features/processing/roofGeometrySource.ts`
- Test: `tests/unit/features/processing/solidGeometrySource.test.ts`, and an addition to `tests/unit/features/processing/roofGeometrySource.test.ts`

**Interfaces:**

- Consumes: `Surface.geometryType` (Task 2), `LodOption { lod, features }` and the tags-only walk in `roofGeometrySource.ts`.
- Produces:

```ts
// src/features/processing/roofGeometrySource.ts
export function lodOptionsBy(
  layer: Layer,
  /**
   * The per-CONTRIBUTOR test, applied AFTER §7's contributor rule has already
   * chosen the contributors by ANY geometry at the LoD. It is NOT the
   * contributor selector. Writing `hasSolidAt` into contributor SELECTION makes
   * a wall-only part fall back to the root's solid, which is the 3D BAG
   * double-count §7's rule exists to prevent.
   */
  qualifies: (objectId: string, lod: string) => boolean,
): ReadonlyArray<LodOption>;

// src/features/processing/solidGeometrySource.ts
export function hasSolidAt(
  layer: Layer,
): (objectId: string, lod: string) => boolean;
export function solidLodOptions(layer: Layer): ReadonlyArray<LodOption>;
```

`roofLodOptions` becomes a one-line wrapper with its behaviour unchanged — its existing suite is the proof, and no assertion in it may be edited.

**The refactor splits the tags walk in two, and that is deliberate.** `lodTagsByObject` currently answers two questions at once (`{ geometry, roof }`). `lodOptionsBy` needs only the GEOMETRY half; a qualifier needs only its own half. So the walk becomes `geometryLodsByObject(layer)` plus one map-builder per qualifier. Reading the model twice for `roofLodOptions` is a second O(surfaces) pass with no measurement in it, behind the `useMemo` in `useLodOptions` — and the alternative (threading a two-field tag map through a generic function) makes `lodOptionsBy` know what its qualifiers are, which is exactly the coupling the shared walk exists to remove.

**A streaming layer has no solids to offer.** `ResidentObjectRecord` carries `geometryLods` and pre-computed `roofMetrics`, and nothing about geometry TYPE (`workerProtocol.ts:39-51`). `hasSolidAt` therefore answers `false` for every resident object and `solidLodOptions` returns `[]`. That is not a gap to fill: the solids tools declare `needsReader: true` and `eligibility.ts:55-63` refuses a streaming layer before the LoD select is reached.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/solidGeometrySource.test.ts`:

```ts
/**
 * "Does this building have a SOLID at LoD X?" — answered from surface TAGS
 * only, for the LoD select (spec §6). Nothing here measures anything: opening
 * a dropdown must not triangulate a city.
 */
import { describe, expect, it, vi } from "vitest";
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

const { hasSolidAt, solidLodOptions } =
  await import("../../../../src/features/processing/solidGeometrySource");

/** A surface tagged with the geometry it came from. */
const surface = (
  type: string,
  lod: string,
  geometryType: string | null | undefined,
) => ({
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
  ...(geometryType === undefined ? {} : { geometryType }),
});

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

/**
 * FOUR features over five rows:
 *  - S1 (Building, Solid at 2.2) with part S1P (Solid at 2.2)
 *  - S2 (Building, Solid at 1.2 only)
 *  - S3 (Building, MultiSurface at 2.2 — geometry, but not a solid)
 *  - S4 (Building, a surface with NO geometryType tag at 2.2)
 */
function staticLayer(): Layer {
  return {
    id: "L1",
    name: "solids",
    isStreaming: false,
    selectedLod: "2.2",
    availableLods: ["2.2", "1.2"],
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects: {
        S1: object(
          "S1",
          "Building",
          [surface("RoofSurface", "2.2", "Solid")],
          [],
          ["S1P"],
        ),
        S1P: object(
          "S1P",
          "BuildingPart",
          [surface("WallSurface", "2.2", "Solid")],
          ["S1"],
        ),
        S2: object("S2", "Building", [surface("RoofSurface", "1.2", "Solid")]),
        S3: object("S3", "Building", [
          surface("RoofSurface", "2.2", "MultiSurface"),
        ]),
        S4: object("S4", "Building", [
          surface("RoofSurface", "2.2", undefined),
        ]),
      },
    },
  } as unknown as Layer;
}

describe("hasSolidAt", () => {
  it("is true for Solid, CompositeSolid and MultiSolid, at that LoD only", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["S2"]!.surfaces = [
      surface("RoofSurface", "1.2", "CompositeSolid"),
      surface("RoofSurface", "0", "MultiSolid"),
    ];
    const has = hasSolidAt(layer);
    expect(has("S1", "2.2")).toBe(true);
    expect(has("S1", "1.2")).toBe(false);
    expect(has("S2", "1.2")).toBe(true);
    expect(has("S2", "0")).toBe(true);
  });

  it("reads a MultiSurface, a missing tag and an unknown object as NOT a solid", () => {
    const has = hasSolidAt(staticLayer());
    expect(has("S3", "2.2")).toBe(false);
    expect(has("S4", "2.2")).toBe(false);
    expect(has("nope", "2.2")).toBe(false);
  });

  it("answers false for every object of a STREAMING layer", () => {
    // A resident record carries `geometryLods` and pre-computed roof metrics
    // and nothing about geometry type, so there is no honest "true" here. The
    // solids tools need a reader, which a streaming layer never has.
    residents.objects = { A: { parents: [], geometryLods: ["2.2"] } };
    const has = hasSolidAt({
      id: "S",
      isStreaming: true,
      model: { objects: {} },
    } as unknown as Layer);
    expect(has("A", "2.2")).toBe(false);
    residents.objects = {};
  });
});

describe("solidLodOptions", () => {
  it("counts FEATURES per LoD, parts folded in, highest detail first", () => {
    // 2.2: S1 (through its part, which has a solid there) — S3 and S4 have
    // geometry but no solid. 1.2: S2.
    expect(solidLodOptions(staticLayer())).toEqual([
      { lod: "2.2", features: 1 },
      { lod: "1.2", features: 1 },
    ]);
  });

  it("applies the CONTRIBUTOR rule, so a non-solid part displaces the root", () => {
    // §7: the PART has geometry at 2.2, so it is the contributor and the
    // root's own solid is ignored. Choosing contributors by "has a solid"
    // instead would silently re-introduce the 3D BAG double count.
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["S1P"]!.surfaces = [surface("WallSurface", "2.2", "MultiSurface")];
    expect(solidLodOptions(layer)).toEqual([{ lod: "1.2", features: 1 }]);
  });

  it("falls back to the ROOT when no part has geometry at that LoD", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["S1P"]!.surfaces = [surface("WallSurface", "1.2", "MultiSurface")];
    expect(solidLodOptions(layer)).toEqual([
      { lod: "2.2", features: 1 }, // S1, through its own solid
      { lod: "1.2", features: 1 }, // S2 — S1 contributes its part, no solid
    ]);
  });

  it("offers nothing for a layer with geometry but no solids", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as { objects: Record<string, unknown> }
    ).objects;
    for (const id of ["S1", "S1P", "S2"]) delete objects[id];
    expect(solidLodOptions(layer)).toEqual([]);
  });

  it("offers nothing for a streaming layer", () => {
    residents.objects = {
      A: { parents: [], geometryLods: ["2.2"], roofMetrics: [] },
    };
    expect(
      solidLodOptions({
        id: "S",
        isStreaming: true,
        model: { objects: {} },
      } as unknown as Layer),
    ).toEqual([]);
    residents.objects = {};
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/solidGeometrySource.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Extract the shared walk in `roofGeometrySource.ts`**

Replace `lodTagsByObject` and the body of `roofLodOptions`. Find the block that begins:

```ts
/** Per object: the LoDs it has ANY geometry at, and the LoDs it has a ROOF at. */
interface LodTags {
```

and runs to the end of the file, and replace it with:

```ts
/**
 * TAGS ONLY: every LoD each object has ANY geometry at.
 *
 * §7's contributor rule is about geometry of ANY semantic type and ANY
 * geometry type, which is why this is the one map {@link lodOptionsBy} reads.
 * A static layer's answer is `surface.lod`; a streaming layer's is the
 * record's `geometryLods`, which the worker filled when the cell landed.
 */
export function geometryLodsByObject(
  layer: Layer,
): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  if (layer.isStreaming) {
    const objects: Readonly<Record<string, ResidentObjectRecord>> =
      getResidentModel(layer.id, 0).objects;
    for (const [id, record] of Object.entries(objects)) {
      out.set(id, new Set(record.geometryLods));
    }
    return out;
  }
  for (const [id, object] of Object.entries(layer.model.objects)) {
    const lods = new Set<string>();
    for (const s of object.surfaces) {
      if (s.lod !== null) lods.add(s.lod);
    }
    out.set(id, lods);
  }
  return out;
}

/** TAGS ONLY: the LoDs each object has a ROOF surface at. */
function roofLodsByObject(
  layer: Layer,
): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  if (layer.isStreaming) {
    const objects: Readonly<Record<string, ResidentObjectRecord>> =
      getResidentModel(layer.id, 0).objects;
    for (const [id, record] of Object.entries(objects)) {
      const roof = new Set<string>();
      for (const metric of record.roofMetrics) {
        if (metric.lod !== null) roof.add(metric.lod);
      }
      out.set(id, roof);
    }
    return out;
  }
  for (const [id, object] of Object.entries(layer.model.objects)) {
    const roof = new Set<string>();
    for (const s of object.surfaces) {
      if (s.lod !== null && s.type === "RoofSurface") roof.add(s.lod);
    }
    out.set(id, roof);
  }
  return out;
}

/**
 * Spec §6: "a select of the LoDs at which the target has geometry of the kind
 * the tool needs, each with the count of FEATURES that have it, parts folded
 * into their building".
 *
 * TAGS ONLY. No geometry is measured, because this fills a dropdown.
 *
 * THE SAME CONTRIBUTOR RULE AS THE RUN (§7). At each LoD, a feature whose PART
 * has GEOMETRY there is answered from its parts alone — a root roof (or a root
 * solid) displaced by a wall-only part does not make the feature count, exactly
 * as it will not make it measurable. A select that promised "2 buildings with a
 * solid" over a run that then measured one would be the same bug printed twice,
 * in the two places the user compares.
 *
 * Sorted highest detail first, matching `computeAvailableLods` and the
 * streaming ladder so no two LoD lists in the app read in opposite directions.
 * A surface with a null LoD contributes to no option: there is no rung to
 * offer the user for it.
 *
 * @param qualifies The per-CONTRIBUTOR test, applied AFTER §7's contributor
 * rule has already chosen the contributors by ANY geometry at the LoD. It is
 * NOT the contributor selector. Writing `hasSolidAt` into contributor
 * SELECTION makes a wall-only part fall back to the root's solid, which is the
 * 3D BAG double-count §7's rule exists to prevent.
 */
export function lodOptionsBy(
  layer: Layer,
  qualifies: (objectId: string, lod: string) => boolean,
): ReadonlyArray<LodOption> {
  const geometry = geometryLodsByObject(layer);
  const featureOf = featureIdsByObject(layer);

  // Every rung anyone mentions, and the members of every feature.
  const rungs = new Set<string>();
  const members = new Map<string, string[]>();
  for (const [id, lods] of geometry) {
    for (const lod of lods) rungs.add(lod);
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
      const partContributors = parts.filter((id) => geometry.get(id)?.has(lod));
      const contributors =
        partContributors.length > 0
          ? partContributors
          : ids.filter((id) => id === featureId && geometry.get(id)?.has(lod));
      if (contributors.some((id) => qualifies(id, lod))) count += 1;
    }
    if (count > 0) options.push({ lod, features: count });
  }

  return options.sort(
    (a, b) => Number.parseFloat(b.lod) - Number.parseFloat(a.lod),
  );
}

/**
 * The LoDs at which the layer has ROOF surfaces (spec §7.1), with the count of
 * FEATURES that have them.
 *
 * A one-line wrapper over {@link lodOptionsBy}: the contributor rule, the
 * ordering and the counting are shared with the solids answer, and the only
 * thing roof-specific is the qualifier.
 */
export function roofLodOptions(layer: Layer): ReadonlyArray<LodOption> {
  const roof = roofLodsByObject(layer);
  return lodOptionsBy(layer, (id, lod) => roof.get(id)?.has(lod) ?? false);
}
```

- [ ] **Step 4: Write `solidGeometrySource.ts`**

Create `src/features/processing/solidGeometrySource.ts`:

```ts
/**
 * "Does this object have a SOLID at LoD X?" — for the LoD select of Measure
 * solids and Validate solids (spec §6, §7.2, §7.3).
 *
 * TAGS ONLY, like its roof sibling: `Surface.geometryType` is stamped by the
 * parser (`buildSurface`) from the CityJSON geometry each surface came from, so
 * the answer is a set lookup and no geometry is ever measured to fill a
 * dropdown. The contributor rule, the FEATURE counting and the ordering are
 * `lodOptionsBy`'s, shared with `roofLodOptions`.
 *
 * The static/streaming split for solids lives HERE and nowhere else.
 */
import type { CityJSONGeometryType } from "@cityjson/navara-core";
import type { Layer } from "../layers/layerStore";
import { lodOptionsBy, type LodOption } from "./roofGeometrySource";

/**
 * The three CityJSON geometry types that carry a solid.
 *
 * `MultiSolid` and `CompositeSolid` are in because §7.2's roll-up sums volume
 * over contributors, which is the right answer for a multi-shell building
 * whether the engine parses it as one solid or the app sums several. Every
 * surface type, `null` (CityParquet, which has no such information) and an
 * absent tag (a hand-built `Surface`) read as NOT a solid.
 */
const SOLID_TYPES: ReadonlySet<CityJSONGeometryType> = new Set([
  "Solid",
  "MultiSolid",
  "CompositeSolid",
]);

/**
 * A per-object solid test for one layer, built once and then O(1) per call.
 *
 * A STREAMING layer answers `false` for everything: `ResidentObjectRecord`
 * carries `geometryLods` and pre-computed roof metrics and NOTHING about
 * geometry type, so there is no honest `true` to give. That costs nothing —
 * the solids tools declare `needsReader: true` and `eligibility.ts` refuses a
 * streaming target before any LoD is offered.
 */
export function hasSolidAt(
  layer: Layer,
): (objectId: string, lod: string) => boolean {
  if (layer.isStreaming) return () => false;
  const byObject = new Map<string, ReadonlySet<string>>();
  for (const [id, object] of Object.entries(layer.model.objects)) {
    const lods = new Set<string>();
    for (const surface of object.surfaces) {
      const geometryType = surface.geometryType;
      if (
        surface.lod !== null &&
        geometryType != null &&
        SOLID_TYPES.has(geometryType)
      ) {
        lods.add(surface.lod);
      }
    }
    byObject.set(id, lods);
  }
  return (objectId, lod) => byObject.get(objectId)?.has(lod) ?? false;
}

/**
 * Spec §6's LoD select for the solids tools: the LoDs at which the target has
 * SOLID geometry, each with the count of FEATURES that have it, parts folded
 * into their building, highest detail first.
 */
export function solidLodOptions(layer: Layer): ReadonlyArray<LodOption> {
  return lodOptionsBy(layer, hasSolidAt(layer));
}
```

- [ ] **Step 5: Add the refactor's own regression test**

Append to `tests/unit/features/processing/roofGeometrySource.test.ts` — import `lodOptionsBy` beside the existing names in the `await import(...)` destructure, then add:

```ts
describe("lodOptionsBy", () => {
  it("applies `qualifies` AFTER the contributor rule, never as the selector", () => {
    // The rule the doc comment states, as an executable fact. B1's part has
    // geometry at 2.2 but does not QUALIFY; B1 must therefore not count at
    // 2.2 — a qualifier used as the contributor SELECTOR would pick the root
    // instead and count it, which is the 3D BAG double count.
    const qualifying = new Set(["B1", "B4"]);
    expect(
      lodOptionsBy(
        staticLayer(),
        (id, lod) => lod === "2.2" && qualifying.has(id),
      ),
    ).toEqual([{ lod: "2.2", features: 1 }]); // B4 only
  });

  it("measures nothing", () => {
    lodOptionsBy(staticLayer(), () => true);
    expect(measured).toEqual([]);
  });
});
```

- [ ] **Step 6: Run both suites**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/solidGeometrySource.test.ts \
  tests/unit/features/processing/roofGeometrySource.test.ts \
  tests/unit/ui/processing/lodSelect.test.tsx
npx tsc -b --noEmit
```

Expected: PASS. `roofGeometrySource.test.ts` must pass with **no assertion edited** — that is what makes the refactor a refactor.

- [ ] **Step 7: Commit**

```bash
git add src/features/processing/solidGeometrySource.ts \
  src/features/processing/roofGeometrySource.ts \
  tests/unit/features/processing/solidGeometrySource.test.ts \
  tests/unit/features/processing/roofGeometrySource.test.ts
git commit -m "feat: answer \"has a solid at this LoD\" from surface tags"
```

---
