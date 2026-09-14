### Task 2: Tag every surface with the geometry type it came from (plugin submodule)

**Files:**

- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/types.ts` (the `Surface` interface), `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/cityjson/parseHelpers.ts` (`buildSurface`'s object literal), `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/decodeTable.ts` (the `surfaces.push({…})` literal)
- Test: `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/geometryType.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `Surface.geometryType?: CityJSONGeometryType | null` (`citymodel/types.ts`) — OPTIONAL as well as nullable (Decisions item 6 (vi)) — set in `buildSurface`'s literal as `geometryType: geom.type`. Consumed by Task 3 only.

**The field is OPTIONAL as well as nullable — `geometryType?: CityJSONGeometryType | null`.** The index's own rejection criterion is "a reviewer rejects it for … making the field required", and the cost of required is concrete: `grep -rln 'type: "RoofSurface"\|type: "WallSurface"\|type: "GroundSurface"' src tests packages/*/packages/*/{src,tests}` finds **21 files** of hand-built `Surface` literals in this repo (10 app test files, 11 submodule test files), every one of which would stop compiling. Absent and `null` mean the same thing to the one consumer (Task 3's `hasSolidAt`, which asks `=== "Solid" | "CompositeSolid" | "MultiSolid"`), so the distinction buys nothing and costs a 21-file sweep in a task whose Files list has three source files.

`decodeTable.ts` still sets `geometryType: null` EXPLICITLY rather than omitting it: CityParquet has genuinely lost the information (its `GeometryColumnRef` carries `{ name, lod }` and its faces are flat across shells and solid members), and writing that down is what stops a later reader assuming the omission was an oversight.

**Submodule-first.** The submodule commit is pushed before the parent's pointer bump. Never `git mv` across the boundary; `pnpm` is always run from inside the submodule directory.

- [ ] **Step 1: Write the failing test**

Create `packages/cityjson-navara-plugins/packages/navara-core/tests/citymodel/geometryType.test.ts`:

```ts
/**
 * Spec §6 (processing toolbox): "every surface is tagged with its LoD and its
 * geometry type", which is what lets the LoD select answer "has a SOLID at
 * LoD X" from the in-memory model, before any source is re-read, on every
 * layer kind.
 *
 * The tag is the geometry's OWN `type`, copied once in `buildSurface`. It is
 * not derived from the semantic surface type (a RoofSurface can come from a
 * MultiSurface or from a Solid) and it is not derived from the boundary
 * nesting (a CompositeSurface and a MultiSurface nest identically).
 */
import { describe, expect, it } from "vitest";
import type { CityJSONRoot } from "../../src/citymodel/cityjson/types";
import { parseCityJSON } from "../../src/citymodel/cityjson/parseCityJSON";

/** One unit square, as a boundary index list into `vertices`. */
const SQUARE = [0, 1, 2, 3];

function model(
  geometries: ReadonlyArray<Record<string, unknown>>,
): CityJSONRoot {
  return {
    type: "CityJSON",
    version: "2.0",
    transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
    CityObjects: {
      b: { type: "Building", geometry: geometries },
    },
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  } as unknown as CityJSONRoot;
}

const typesOf = (root: CityJSONRoot) =>
  parseCityJSON(root).objects["b"]?.surfaces.map((s) => s.geometryType);

describe("Surface.geometryType", () => {
  it("tags a MultiSurface's surfaces", () => {
    expect(
      typesOf(
        model([{ type: "MultiSurface", lod: "2", boundaries: [[SQUARE]] }]),
      ),
    ).toEqual(["MultiSurface"]);
  });

  it("tags a CompositeSurface, which nests identically to a MultiSurface", () => {
    expect(
      typesOf(
        model([{ type: "CompositeSurface", lod: "2", boundaries: [[SQUARE]] }]),
      ),
    ).toEqual(["CompositeSurface"]);
  });

  it("tags every face of a Solid, through its shells", () => {
    expect(
      typesOf(
        model([
          { type: "Solid", lod: "2.2", boundaries: [[[SQUARE], [SQUARE]]] },
        ]),
      ),
    ).toEqual(["Solid", "Solid"]);
  });

  it("tags a MultiSolid and a CompositeSolid", () => {
    expect(
      typesOf(
        model([
          { type: "MultiSolid", lod: "2", boundaries: [[[[SQUARE]]]] },
          { type: "CompositeSolid", lod: "2", boundaries: [[[[SQUARE]]]] },
        ]),
      ),
    ).toEqual(["MultiSolid", "CompositeSolid"]);
  });

  it("keeps the LoD tag beside it, so the two answer together", () => {
    const surfaces = parseCityJSON(
      model([
        { type: "Solid", lod: "2.2", boundaries: [[[SQUARE]]] },
        { type: "MultiSurface", lod: "0", boundaries: [[SQUARE]] },
      ]),
    ).objects["b"]?.surfaces;
    expect(surfaces?.map((s) => [s.lod, s.geometryType])).toEqual([
      ["2.2", "Solid"],
      ["0", "MultiSurface"],
    ]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
pnpm vitest run packages/navara-core/tests/citymodel/geometryType.test.ts
```

Expected: FAIL — every case reads `undefined`, because `Surface` has no `geometryType` and `buildSurface` writes none. (TypeScript also reports `Property 'geometryType' does not exist on type 'Surface'`.)

- [ ] **Step 3: Add the field to `Surface`**

In `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/types.ts`, add the import beside the existing one at the top of the file:

```ts
import type { CityJSONGeometryType } from "./cityjson/types";
```

(`cityjson/types.ts` imports nothing, so this cannot cycle.)

Then, inside `interface Surface`, immediately after the `lod` field (`/** LoD of the source geometry that produced this surface (e.g. "2", "2.2"). */`):

```ts
  /**
   * The CityJSON geometry TYPE this surface was extracted from — "Solid",
   * "MultiSurface", "CompositeSolid" and so on.
   *
   * Semantically distinct from `type`, which is the surface's own role
   * (RoofSurface, WallSurface): a RoofSurface can come from a MultiSurface at
   * LoD 0 and from a Solid at LoD 2.2, and only this field can tell them
   * apart. It is what lets the processing toolbox answer "does this building
   * have a SOLID at LoD 2.2?" from the in-memory model, with no geometry
   * measured and no source re-read (spec §6).
   *
   * OPTIONAL AND NULLABLE, and the two mean the same thing to every reader:
   * "no geometry-type information here". `null` is written by a producer that
   * genuinely has none (CityParquet's flat face list); absent is a `Surface`
   * literal built by hand. Neither is a solid.
   */
  readonly geometryType?: CityJSONGeometryType | null;
```

- [ ] **Step 4: Set it in the ONE place that builds a parsed surface**

In `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/cityjson/parseHelpers.ts`, inside `buildSurface`, the local object's TYPE annotation and its literal both gain the field. Find:

```ts
const surface: {
  type: BuildingSurfaceType;
  rings: Vec3[][];
  attributes: Record<string, unknown>;
  lod: string | null;
  material?: Readonly<Record<string, number>>;
  texture?: Readonly<Record<string, SurfaceTexture>>;
} = {
  type: resolveSemanticType(sem),
  rings,
  attributes: extractSemanticAttributes(sem),
  lod,
};
```

and replace it with:

```ts
const surface: {
  type: BuildingSurfaceType;
  rings: Vec3[][];
  attributes: Record<string, unknown>;
  lod: string | null;
  geometryType: CityJSONGeometryType;
  material?: Readonly<Record<string, number>>;
  texture?: Readonly<Record<string, SurfaceTexture>>;
} = {
  type: resolveSemanticType(sem),
  rings,
  attributes: extractSemanticAttributes(sem),
  lod,
  // ONE site for all five of `extractSurfaces`' surface-producing cases:
  // they all funnel through here and `geom` is already the first parameter,
  // so nothing about the boundary walk changes. A `switch` added there would
  // be a second place for the same fact to be wrong in.
  geometryType: geom.type,
};
```

`geom` is a `CityJSONSurfaceGeometry`, whose `type` is `Exclude<CityJSONGeometryType, "GeometryInstance">` — assignable to the field without a cast. Add `CityJSONGeometryType` to the existing `import type { … } from "./types";` at the top of `parseHelpers.ts` if it is not already there.

- [ ] **Step 5: State CityParquet's `null` explicitly**

In `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/decodeTable.ts`, in the `surfaces.push({…})` literal inside the face loop, after `lod: column.lod,`:

```ts
        // CityParquet has no geometry-type information to give: the table's
        // `faces` are flat across every shell and every solid member, and the
        // `GeometryColumnRef` behind them carries only `{ name, lod }`. NULL
        // is the honest answer, and it reads as "not a solid" everywhere —
        // which is correct: a CityParquet layer has no reader, so the solids
        // tools refuse it on eligibility long before any LoD is offered.
        geometryType: null,
```

- [ ] **Step 6: Run the submodule's suites and its typecheck**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
pnpm vitest run packages/navara-core/tests packages/navara-cityparquet/tests
pnpm typecheck
```

Expected: PASS. Nothing else in the submodule reads `geometryType`, and the field is optional, so no existing `Surface` literal changes.

- [ ] **Step 7: Commit inside the submodule and push it FIRST**

```bash
cd /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins
git add packages/navara-core/src/citymodel/types.ts \
  packages/navara-core/src/citymodel/cityjson/parseHelpers.ts \
  packages/navara-core/tests/citymodel/geometryType.test.ts \
  packages/navara-cityparquet/src/decodeTable.ts
git commit -m "feat: tag each surface with its CityJSON geometry type"
git -C /data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins push origin main
```

- [ ] **Step 8: Check the app against the new submodule commit, then bump the pointer**

```bash
cd /data2/hideba/multiroof-viewer
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx tsc -b --noEmit
# Global Constraints: a full-suite run goes to a FILE in the BACKGROUND.
npx vitest run tests/unit > /tmp/m3-t2-unit.log 2>&1 &
wait
tail -5 /tmp/m3-t2-unit.log
```

Expected: PASS (report the exit status) — the app consumes `Surface` through `src/domain/citymodel/types.ts`'s re-export and the new field is optional, so nothing app-side changes yet.

```bash
git add packages/cityjson-navara-plugins
git commit -m "chore: bump cityjson-navara-plugins for surface geometry types"
```

---
