### Task 6: LoD-tag the resident roof metrics, and expose the resident geometry LoDs (plugin submodule)

**Files:**

- Modify: `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/workerProtocol.ts:39-51`
- Modify: `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/objectRecords.ts:22-62`
- Modify (it EXISTS — extend it, do not replace it): `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/tests/objectRecords.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-flatcitybuf/tests/streamLayer.test.ts:152-165` (its `objectRecord` helper builds a required-field record)
- Then, in the PARENT repo and in the same pointer-bump step: `tests/unit/ui/drawer/layerSummary.test.ts:79-86`, `tests/unit/insights/computeStats.test.ts:147-179` (and any other hand-built `ResidentObjectRecord` literal `tsc` names)

**Interfaces:**

- Produces, from `@cityjson/navara-flatcitybuf`:
  - `export interface ResidentRoofMetrics extends RoofMetrics { readonly lod: string | null }`
  - `ResidentObjectRecord.roofMetrics: ReadonlyArray<ResidentRoofMetrics>`
  - `ResidentObjectRecord.geometryLods: ReadonlyArray<string>` — the distinct non-null `Surface.lod` values over **all** of the object's surfaces, in the order first seen.
- Task 7 consumes both.

**Why two fields and not one.** §7's contributor rule asks "does this object have GEOMETRY at this LoD" — of any semantic type. `roofMetrics` answers only for roofs; a wall-only BuildingPart at LoD 2.2 has no roof metric and would look like an object with nothing there, which is precisely the case finding 1 is about. `surfaceCount` is a total with no LoD breakdown. `geometryLods` is the smallest honest answer: a handful of short strings per record, computed in the same loop that already visits every surface for `attrKeys` (`objectRecords.ts:36-38`).

**This is a breaking change for WRITERS, not readers.** Widening `roofMetrics`'s element type and adding a required field keeps every consumer working (they read `areaSqM`/`inclinationDeg`/`azimuthDeg`, or pass the array where `ReadonlyArray<RoofMetrics>` is wanted). It does NOT keep hand-built record literals compiling, and two test files have them. Those edits belong to this change; a `tsc` error there is expected, not a sign the type was written wrong.

- [ ] **Step 1: EXTEND the existing suite — do not create it**

`packages/cityjson-navara-plugins/packages/navara-flatcitybuf/tests/objectRecords.test.ts` **already exists** and is the structural pin on this record. Two of its cases reject both additions on purpose and must be UPDATED, not deleted:

- `"carries only the documented ResidentObjectRecord fields — no ring geometry"` asserts `Object.keys(r).sort()` against a `RESIDENT_OBJECT_RECORD_KEYS` constant, and asserts each roof metric's keys are exactly `["areaSqM", "azimuthDeg", "elevationM", "inclinationDeg"]`. Add `"geometryLods"` to the record's key list and `"lod"` to the metric's.
- `"precomputes roof metrics for every RoofSurface, matching computeRoofMetrics"` asserts `r.roofMetrics` **equals** `roofs.map(computeRoofMetrics)`. That equality now fails on the added key; change it to compare against `roofs.map((s) => ({ ...computeRoofMetrics(s), lod: s.lod }))`, which keeps the property the test is for (the values come from `computeRoofMetrics`, in surface order) and adds the tag.

Keep every other case untouched — the footprint, volume, bbox-skip, parents/children and surface-attribute-key cases are unrelated to this change and are the file's real coverage.

Then append the three new cases:

```ts
/** A unit square at height `z`, of `type`, tagged with `lod`. */
function taggedSurface(type: string, lod: string | null, z: number) {
  return {
    type,
    rings: [
      [
        [0, 0, z],
        [1, 0, z],
        [1, 1, z],
        [0, 1, z],
      ],
    ],
    attributes: {},
    lod,
  };
}

function modelWith(surfaces: ReadonlyArray<unknown>): CityModel {
  return {
    sourceEncoding: "flatcitybuf",
    metadata: {},
    bbox: [0, 0, 0, 1, 1, 9],
    vertexCount: 0,
    objects: {
      b1: {
        id: "b1",
        objectType: "Building",
        attributes: {},
        surfaces,
        bbox: [0, 0, 0, 1, 1, 9],
        children: [],
        parents: [],
        lod: "2.2",
      },
    },
  } as unknown as CityModel;
}

describe("toObjectRecords, per-LoD", () => {
  it("tags each roof metric with its OWN surface's LoD", () => {
    // `toObjectRecords` runs on the UNFILTERED cell model (`fcb.worker.ts` —
    // `msg.lod` filters the mesh, not the parse), so one object contributes
    // roof surfaces at every LoD it has, and `record.lod` (the OBJECT's)
    // cannot tell them apart.
    const { records } = toObjectRecords(
      modelWith([
        taggedSurface("RoofSurface", "1.2", 3),
        taggedSurface("RoofSurface", "2.2", 9),
      ]),
    );
    expect(records[0]!.roofMetrics.map((m) => m.lod)).toEqual(["1.2", "2.2"]);
    expect(records[0]!.roofMetrics[0]!.areaSqM).toBeCloseTo(1, 6);
  });

  it("reports the LoDs of EVERY surface, not only the roofs", () => {
    // The case §7's contributor rule turns on: geometry at 2.2 that is not a
    // roof still makes this object a contributor at 2.2.
    const { records } = toObjectRecords(
      modelWith([
        taggedSurface("WallSurface", "2.2", 9),
        taggedSurface("RoofSurface", "1.2", 3),
      ]),
    );
    expect([...records[0]!.geometryLods].sort()).toEqual(["1.2", "2.2"]);
    expect(records[0]!.roofMetrics.map((m) => m.lod)).toEqual(["1.2"]);
  });

  it("de-duplicates the LoD list and drops untagged surfaces", () => {
    const { records } = toObjectRecords(
      modelWith([
        taggedSurface("RoofSurface", "2.2", 9),
        taggedSurface("WallSurface", "2.2", 9),
        taggedSurface("WallSurface", null, 9),
      ]),
    );
    expect(records[0]!.geometryLods).toEqual(["2.2"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/cityjson-navara-plugins
pnpm vitest run packages/navara-flatcitybuf/tests/objectRecords.test.ts
```

Expected: FAIL — `Property 'lod' does not exist on type 'RoofMetrics'`, `geometryLods` is `undefined`, and the two updated key assertions fail on the missing keys.

- [ ] **Step 3: Widen the record type**

In `packages/navara-flatcitybuf/src/workerProtocol.ts`, above `ResidentObjectRecord` (`:39`):

```ts
/**
 * A resident roof surface's metrics plus the LoD of the surface itself.
 *
 * `toObjectRecords` runs on the whole cell model, so an object with geometry at
 * several LoDs contributes roof surfaces at all of them;
 * `ResidentObjectRecord.lod` is the OBJECT's LoD and cannot tell them apart. A
 * widening of `RoofMetrics`, so every existing reader keeps working untouched.
 */
export interface ResidentRoofMetrics extends RoofMetrics {
  readonly lod: string | null;
}
```

and inside `ResidentObjectRecord`, change `:46` and add a field beside it:

```ts
  readonly roofMetrics: ReadonlyArray<ResidentRoofMetrics>;
  /**
   * Distinct non-null `Surface.lod` values over ALL of this object's surfaces,
   * whatever their semantic type, in the order first seen.
   *
   * The main thread's spec §7 contributor rule asks "does this feature's part
   * have GEOMETRY at the chosen LoD" — a wall-only part counts. `roofMetrics`
   * cannot answer that and `surfaceCount` has no LoD breakdown, so the answer
   * is carried explicitly. Short: a handful of labels per record.
   */
  readonly geometryLods: ReadonlyArray<string>;
```

- [ ] **Step 4: Fill both fields in the one loop that already visits the surfaces**

In `packages/navara-flatcitybuf/src/objectRecords.ts`, replace `:33-38`:

```ts
const roofMetrics = obj.surfaces
  .filter((s) => s.type === "RoofSurface")
  .map((s) => ({ ...computeRoofMetrics(s), lod: s.lod }));

// ONE pass over the surfaces for both the attribute keys the cell reports
// and the LoD labels the contributor rule needs.
const lods = new Set<string>();
for (const surface of obj.surfaces) {
  for (const key of Object.keys(surface.attributes)) attrKeys.add(key);
  if (surface.lod) lods.add(surface.lod);
}
```

and add `geometryLods: [...lods],` to the `records.push({ … })` literal (`:47-59`), beside `roofMetrics`. The replacement absorbs the old standalone attribute-key loop; delete that.

- [ ] **Step 5: Run the plugin's checks and commit the submodule**

`geometryLods` is REQUIRED, so every hand-built `ResidentObjectRecord` in the submodule breaks too. The one the reviewer found is `packages/navara-flatcitybuf/tests/streamLayer.test.ts:152-165`'s `objectRecord(id, objectType)` helper — add `geometryLods: []` to its literal. Sweep for others before the gate:

```bash
cd packages/cityjson-navara-plugins
grep -rn "roofMetrics:" packages/navara-flatcitybuf --include=*.ts | grep -v "src/objectRecords.ts"
pnpm typecheck          # the authoritative list; fix every site it names
pnpm vitest run packages/navara-flatcitybuf
git add packages/navara-flatcitybuf/src/workerProtocol.ts \
  packages/navara-flatcitybuf/src/objectRecords.ts \
  packages/navara-flatcitybuf/tests/objectRecords.test.ts \
  packages/navara-flatcitybuf/tests/streamLayer.test.ts
git commit -m "feat(flatcitybuf): tag resident roof metrics by LoD and report every surface's LoD"
git push origin main
```

- [ ] **Step 6: Bump the pointer AND fix the parent's record literals**

The parent's `tsc` will now reject every hand-built `ResidentObjectRecord`. Two files have them:

- `tests/unit/ui/drawer/layerSummary.test.ts:79-86` — the `P1`/`P2` records' `roofMetrics` entries need `lod` (use `"2.2"`, the object lod the `record(...)` helper already sets), and the helper needs a `geometryLods` default. Fix the `record(...)` helper once rather than every literal.
- `tests/unit/insights/computeStats.test.ts:147-179` — two inline records: add `geometryLods: ["2.2"]` / `geometryLods: []` and a `lod` on each `roofMetrics` entry. The assertions (`roofSurfaceCount`, `totalRoofArea`, `avgRoofSlope`, `avgRoofAzimuth`) are unaffected: the new field is additive.

```bash
cd /data2/hideba/multiroof-viewer
npx tsc -b --noEmit     # lists every literal that still needs the two fields
npx vitest run tests/unit/ui/viewport tests/unit/ui/details tests/unit/ui/drawer \
  tests/unit/insights tests/unit/features/streaming
git add packages/cityjson-navara-plugins tests/unit/ui/drawer/layerSummary.test.ts \
  tests/unit/insights/computeStats.test.ts
git commit -m "chore(deps): bump the plugin pin for LoD-tagged resident roof metrics"
```

A `tsc` error at one of the five READER sites (`legendCounts.ts:94-103`, `useResolvedSubject.ts:125`, `DetailsPanel.tsx:263-268`, `computeStats.ts:142,231`, `derivedBuildingColumns.ts:19-20`) would mean the type was written as a REPLACEMENT rather than an extension — re-check Step 3. An error at a test LITERAL is expected and is this step's work.

---
