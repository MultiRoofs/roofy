### Task 23: Derived vector layers

**Files:**

- Modify: `src/features/processing/deriveLayer.ts`, `src/features/processing/runQueue.ts`, `src/features/processing/toolRegistry.ts`, `src/features/geoLayers/geoLayerStore.ts` (`GeoLayerBase.derivedFrom`, `GeoLayerInput`'s `Omit` and `insertAfterId`).
- Test: additions to `tests/unit/features/processing/deriveLayer.test.ts` and `tests/unit/features/processing/derivedRun.test.ts`.

**Interfaces:**

- Consumes: `DerivedPlan` (Task 21), `ToolTarget` with `kind: "vector"` (Task 11), `GEO_STABLE_FEATURE_KEY` (`features/geoLayers/geoJsonRecords.ts`), `aggregateColumns` (Task 15), **`mergeGeoDocumentProperties` (Task 18 — imported and called, never re-implemented)**, and `mergeGeoFeatureProperties` only as the THIS-LAYER door this task does NOT use.
- Produces:

  ```ts
  // src/features/processing/deriveLayer.ts
  export async function prepareDerivedVectorLayer(input: {
    readonly runId: string;
    readonly parent: GeoLayer;
    readonly name: string;
    readonly columns: ReadonlyArray<OutputColumn>;
    readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  }): Promise<DerivedPlan>;

  // src/features/geoLayers/geoLayerStore.ts
  //   GeoLayerBase gains: derivedFrom: DerivedFrom | null   (REQUIRED)
  //   GeoLayerInput's Omit gains "derivedFrom", with optional
  //     derivedFrom?: DerivedFrom | null  and  insertAfterId?: string
  ```

  **Three additions to the ledger, deliberate and reported at the gate.** The ledger gives `derivedFrom` to `Layer` only, and Task 24's marker, its state line and the snapshot filter all have to be able to see a derived VECTOR layer too — §6.2 and §8 do not distinguish them. So: (1) `GeoLayerBase.derivedFrom: DerivedFrom | null`, the SAME shape, imported as a **type-only** import from `layerStore` (`import type { DerivedFrom } from "../layers/layerStore";`) — erased at compile time, so the two stores stay runtime-independent, which is what `geoLayerStore`'s header is about; (2) `"derivedFrom"` in `GeoLayerInput`'s `Omit` with an optional input defaulting to `null`, exactly as `visible` and `opacity` are done, so no existing `addGeoLayer` caller changes; (3) `insertAfterId?: string` on the same input, because §6.2's "inserted directly under its target in the layer list" is not a city-only sentence and `addGeoLayer` appends today (`geoLayerStore.ts:245`).

**Intent:** Scenario 11: Aggregate with destination New layer on scope Selected (2) creates a vector layer holding ALL the target's areas with `bld_buildings_n` (scenario 11's bare `buildings_n` is the un-prefixed shorthand — Decisions item 6 (v)) counting only the two selected buildings, and Zones itself unchanged. §6's rule that Aggregate's copy holds every target area, not the scoped ones, is the thing to get right. A reviewer rejects it for copying only the matched areas, for mutating the parent, or for a derived vector layer that is persisted.

- [ ] **Step 1: Write the failing test for `prepareDerivedVectorLayer`**

Add to `tests/unit/features/processing/deriveLayer.test.ts`:

```ts
/** Two plain areas. NO stable id is written here: `addGeoLayer` runs
 *  `normalizeGeoJsonDocument` over `config.data` and mints `preparedData`
 *  itself, so a pre-stamped envelope would be a guess about that function's
 *  behaviour rather than a fact about this one. */
function zonesDocument(): unknown {
  const feature = (name: string) => ({
    type: "Feature",
    properties: { name },
    geometry: { type: "Polygon", coordinates: [[]] },
  });
  return {
    type: "FeatureCollection",
    features: [feature("North"), feature("South")],
  };
}

function zonesLayer(): string {
  return useGeoLayerStore.getState().addGeoLayer({
    kind: "geojson",
    name: "Zones",
    config: { data: zonesDocument() },
  });
}

/** The stable id the store actually stamped on the Nth prepared feature —
 *  read BACK rather than assumed, because it is the key the run's rows are
 *  keyed by and the only honest source of it is the document itself. */
function stableIdOf(layer: GeoLayer, index: number): string {
  if (layer.kind !== "geojson") throw new Error("not a geojson layer");
  const doc = layer.config.preparedData as {
    features: Array<{ properties: Record<string, unknown> }>;
  };
  const id = readGeoStableFeatureId(doc.features[index]?.properties ?? {});
  if (id === null) throw new Error("no stable id on the prepared feature");
  return id;
}

describe("prepareDerivedVectorLayer", () => {
  it("copies EVERY target area, not only the ones with a value (§6, §10.11)", async () => {
    const parentId = zonesLayer();
    const parent = useGeoLayerStore.getState().layers[0]!;
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [{ name: "bld_buildings_n", type: "DOUBLE" }],
      // Only ONE area was counted; the other still belongs in the copy.
      rows: new Map([[stableIdOf(parent, 0), { bld_buildings_n: 2 }]]),
    });
    const id = plan.publish();
    const copy = useGeoLayerStore.getState().layers.find((l) => l.id === id);
    if (copy?.kind !== "geojson") throw new Error("not a geojson layer");
    const doc = copy.config.preparedData as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(doc.features).toHaveLength(2);
    expect(doc.features[0]?.properties["bld_buildings_n"]).toBe(2);
    // §6.2's value rule: an area that was not evaluated gets no value, and a
    // count that WAS evaluated and found nothing is 0 — which is the
    // executor's business, not the copy's.
    expect(doc.features[1]?.properties).not.toHaveProperty("bld_buildings_n");
    expect(copy.derivedFrom).toEqual({
      layerId: parentId,
      layerName: "Zones",
      runId: "run_9",
    });
  });

  it("leaves the PARENT's document untouched", async () => {
    zonesLayer();
    const parent = useGeoLayerStore.getState().layers[0]!;
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [{ name: "bld_buildings_n", type: "DOUBLE" }],
      rows: new Map([[stableIdOf(parent, 0), { bld_buildings_n: 2 }]]),
    });
    plan.publish();
    const original = useGeoLayerStore.getState().layers[0];
    if (original?.kind !== "geojson") throw new Error("not a geojson layer");
    const doc = original.config.preparedData as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(doc.features[0]?.properties).not.toHaveProperty("bld_buildings_n");
  });

  it("publishes nothing before publish(), and inserts under the parent", async () => {
    const first = zonesLayer();
    useGeoLayerStore.getState().addGeoLayer({
      kind: "raster-xyz",
      name: "Basemap",
      config: { urlTemplate: "https://x/{z}/{x}/{y}.png" },
    });
    const parent = useGeoLayerStore.getState().layers[0]!;
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [],
      rows: new Map(),
    });
    expect(useGeoLayerStore.getState().layers).toHaveLength(2);
    plan.publish();
    expect(useGeoLayerStore.getState().layers.map((l) => l.name)).toEqual([
      "Zones",
      "Zones · buildings",
      "Basemap",
    ]);
    expect(first).toBe(parent.id);
  });

  it("re-checks the name at publication, like a city copy does", async () => {
    zonesLayer();
    const parent = useGeoLayerStore.getState().layers[0]!;
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones",
      columns: [],
      rows: new Map(),
    });
    const id = plan.publish();
    expect(
      useGeoLayerStore.getState().layers.find((l) => l.id === id)?.name,
    ).toBe("Zones (2)");
  });

  it("discard() is a no-op that publishes nothing", async () => {
    zonesLayer();
    const parent = useGeoLayerStore.getState().layers[0]!;
    const plan = await prepareDerivedVectorLayer({
      runId: "run_9",
      parent,
      name: "Zones · buildings",
      columns: [],
      rows: new Map(),
    });
    await plan.discard();
    expect(useGeoLayerStore.getState().layers).toHaveLength(1);
  });
});
```

with `useGeoLayerStore`, `readGeoStableFeatureId` (`features/geoLayers/geoJsonRecords`) and the `GeoLayer` type added to the file's imports, and `useGeoLayerStore.setState({ layers: [] })` added to its `beforeEach`.

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/deriveLayer.test.ts -t "prepareDerivedVectorLayer"
```

Expected: FAIL — `prepareDerivedVectorLayer is not a function`.

- [ ] **Step 3: Give a geo layer a `derivedFrom` and an `insertAfterId`**

In `src/features/geoLayers/geoLayerStore.ts`:

1. `import type { DerivedFrom } from "../layers/layerStore";` at the top. **Type-only**: the two stores share a shape, not a runtime dependency, which is what this file's own header ("A SEPARATE store from `layerStore`, not a variant of it") is protecting.

2. `GeoLayerBase` gains the field. Find:

```ts
  readonly style: GeoLayerStyle;
}
```

and insert above the brace:

```ts
  /**
   * Null for every ordinary layer; set on a layer a New-layer run created
   * (§6.2). The SAME shape a city layer's carries, because §6.2's state line
   * and marker and §8's snapshot filter do not distinguish the two kinds.
   */
  readonly derivedFrom: DerivedFrom | null;
```

3. `GeoLayerInput` gains the two optional fields. Find:

```ts
export type GeoLayerInput = GeoLayer extends infer L
  ? L extends GeoLayer
    ? Omit<L, "id" | "visible" | "opacity" | "style"> & {
        readonly visible?: boolean;
        readonly opacity?: number;
        readonly style?: GeoLayerStyle;
      }
    : never
  : never;
```

and replace with:

```ts
export type GeoLayerInput = GeoLayer extends infer L
  ? L extends GeoLayer
    ? Omit<L, "id" | "visible" | "opacity" | "style" | "derivedFrom"> & {
        readonly visible?: boolean;
        readonly opacity?: number;
        readonly style?: GeoLayerStyle;
        /** Defaults to null. Supplied only by a New-layer run's publication. */
        readonly derivedFrom?: DerivedFrom | null;
        /** §6.2: "inserted directly under its target in the layer list". An id
         *  that is not in the list appends, as it always did. */
        readonly insertAfterId?: string;
      }
    : never
  : never;
```

4. `addGeoLayer` defaults the field and splices. Find:

```ts
    const base = {
      id,
      name: input.name,
      visible: input.visible ?? true,
```

and insert `derivedFrom: input.derivedFrom ?? null,` under `name`. Then find:

```ts
set((state) => ({ layers: [...state.layers, layer] }));
return id;
```

and replace with:

```ts
set((state) => {
  // ONE splice site, and `insertAfterId` is the only way this is not an
  // append — so every existing caller's ordering is unchanged.
  const at =
    input.insertAfterId === undefined
      ? -1
      : state.layers.findIndex((l) => l.id === input.insertAfterId);
  if (at < 0) return { layers: [...state.layers, layer] };
  const next = [...state.layers];
  next.splice(at + 1, 0, layer);
  return { layers: next };
});
return id;
```

`tsc` then names every `GeoLayer` literal in `tests/` that needs `derivedFrom: null` — the ones built through `addGeoLayer` need nothing.

- [ ] **Step 4: Add `prepareDerivedVectorLayer`**

Append to `src/features/processing/deriveLayer.ts`:

```ts
/**
 * Build a derived VECTOR layer: a plain GeoJSON layer whose document is the
 * target's `preparedData` with the run's properties merged in (§6, "A derived
 * vector layer is a plain GeoJSON layer").
 *
 * It holds EVERY area of the target, not only the ones the run wrote to: §6 is
 * explicit that "for Aggregate buildings per area the copy holds ALL target
 * areas (the scope selects the source buildings that are counted, §7.6)", and
 * §10 scenario 11 is exactly that case — 6 areas in, 6 areas out, with
 * `bld_buildings_n` counting only the 2 selected buildings.
 *
 * `async` with nothing to await, matching `prepareDerivedCityLayer`: a vector
 * copy touches no database (a geo layer has no table — §8's "nothing new is
 * saved" is what makes `preparedData` the right home), and the caller must not
 * have to know which of the two it is holding.
 */
export async function prepareDerivedVectorLayer(input: {
  readonly runId: string;
  readonly parent: GeoLayer;
  readonly name: string;
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}): Promise<DerivedPlan> {
  const parent = input.parent;
  // The ENGINE's document, not `config.data`: `preparedData` is what the
  // engine, the records panel and the GeoJSON export all read, and it is the
  // one every feature's stable id has been stamped into.
  const source =
    parent.kind === "geojson" ? parent.config.preparedData : undefined;
  // ONE merge for both destinations (Decisions item 6 (iv)): Task 18's exported
  // pure helper, not a second copy of it. `null` means no feature matched, and
  // the copy is then the parent's document as it stands — safe to share,
  // because every writer of `preparedData` REPLACES the object rather than
  // mutating it (`setPreparedGeoJson`, `geoLayerStore.ts:294-309`). A parent
  // whose `preparedData` is not a FeatureCollection cannot reach here: only a
  // `kind: "geojson"` layer is a vector target, and its `preparedData` came
  // from `normalizeGeoJsonDocument`.
  const document = mergeGeoDocumentProperties(source, input.rows) ?? source;

  return {
    name: input.name,
    publish(): string {
      const geo = useGeoLayerStore.getState();
      // §6: re-checked HERE, synchronously, inside the run's own FIFO slot —
      // exactly as the city copy does it, so nothing can take the name between
      // the check and the add.
      const final = disambiguate(
        input.name,
        useLayerStore.getState().layers,
        geo.layers,
      );
      // `addGeoLayer` MINTS the id, so unlike the city path there is nothing to
      // pre-mint: no table is adopted here, so nothing needs the id before the
      // row exists. Everything that keys on it therefore comes after.
      const id = geo.addGeoLayer({
        kind: "geojson",
        name: final.name,
        // `data` as well as `preparedData`: a geo layer with neither reads as
        // "needs re-link" (`isGeoLayerUnavailable`), and the copy is not
        // waiting for a file. It is never persisted — §8 omits a derived
        // layer from the snapshot entirely — so nothing reaches disk by
        // carrying it.
        config: {
          data: document,
          preparedData: document,
          preparation: "ready",
        },
        style: parent.style,
        visible: true,
        opacity: parent.opacity,
        insertAfterId: parent.id,
        derivedFrom: {
          layerId: parent.id,
          layerName: parent.name,
          runId: input.runId,
        },
      });
      // §6: "inherited computed columns keep their provenance". The run's OWN
      // columns are given theirs by `execute` (Task 22), which knows the tool
      // name and the scope sentence.
      const registry = useComputedColumnStore.getState();
      for (const [column, provenance] of Object.entries(
        registry.byLayer[parent.id] ?? {},
      )) {
        registry.setProvenance(id, column, provenance);
      }
      activateLayer(id);
      return id;
    },
    // Nothing was created outside this closure — no table, no store write — so
    // there is nothing to undo. Present because the caller holds a
    // `DerivedPlan` and must not have to branch on which kind it is.
    async discard(): Promise<void> {},
  };
}
```

There is NO local merge in this module. The merge is Task 18's exported
`mergeGeoDocumentProperties(document, byStableId)` — the same function the
THIS-LAYER path uses inside `mergeGeoFeatureProperties`'s single `setState`, so
the two destinations can never disagree about what a merged feature looks like
(commander's ruling, Decisions item 6 (iv)).

Add `import { mergeGeoDocumentProperties, useGeoLayerStore } from "../geoLayers/geoLayerStore";`
at the top; `readGeoStableFeatureId` is NOT needed here — the helper reads the
stable id itself.

- [ ] **Step 5: Run it and watch it pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/deriveLayer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the failing test for the vector destination branch**

Add to `tests/unit/features/processing/derivedRun.test.ts` — Aggregate's target is a vector layer, so its `ctx.target.kind` is `"vector"` and the copy is the geo one:

```ts
/** The Zones layer, and an Aggregate executor that writes one value onto its
 *  first area. Both cases below start from it. */
function seedAggregate(): string {
  const zones = useGeoLayerStore.getState().addGeoLayer({
    kind: "geojson",
    name: "Zones",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "North" },
            geometry: { type: "Polygon", coordinates: [[]] },
          },
        ],
      },
    },
  });
  registerExecutor("aggregate-per-area", async (_run, ctx) => {
    // §7.6's reversed direction: the TARGET is the vector layer, and its
    // records are keyed by the GeoJSON stable feature id.
    if (ctx.target.kind !== "vector") throw new Error("wrong target kind");
    const stableId = ctx.target.records[0]?.[GEO_RECORD_ID] ?? "";
    return {
      columns: [{ name: "bld_buildings_n", type: "DOUBLE" as const }],
      rows: new Map([[String(stableId), { bld_buildings_n: 2 }]]),
      measured: 1,
      skipped: [],
    };
  });
  return zones;
}

function aggregateRequest(
  zones: string,
  overrides: Record<string, unknown> = {},
) {
  return newLayerRequest({
    toolId: "aggregate-per-area" as const,
    targetLayerId: zones,
    sourceLayerId: "L1",
    prefix: "bld_",
    newLayerName: "Zones · buildings",
    columns: [{ name: "bld_buildings_n", type: "DOUBLE" as const }],
    ...overrides,
  });
}

describe("destination: New layer, with a VECTOR target", () => {
  it("creates a GeoJSON copy of the target and leaves it untouched (§10.11)", async () => {
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    const layers = useGeoLayerStore.getState().layers;
    expect(layers.map((l) => l.name)).toEqual(["Zones", "Zones · buildings"]);
    expect(runById(id)?.newLayerId).toBe(layers[1]?.id);
    // No city layer was created, and the source city layer is untouched.
    expect(useLayerStore.getState().layers).toHaveLength(1);
    const original = layers[0];
    if (original?.kind !== "geojson") throw new Error("not a geojson layer");
    const doc = original.config.preparedData as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(doc.features[0]?.properties).not.toHaveProperty("bld_buildings_n");
  });

  it("names the copy on the card and keeps §7.6's own line whole", async () => {
    // NOT "Created Zones · buildings · 1 building · …": that count is the
    // SOURCE's scoped buildings and the copy holds AREAS. §7.6's head segment
    // already says both ("6 areas aggregated over 1,204 buildings"), so it
    // survives intact — asserted against the SAME tool's This-layer card
    // rather than against a copy of Task 19's wording.
    const zones = seedAggregate();
    const created = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(created)?.status).toBe("done"));
    const onLayer = submitRun(
      aggregateRequest(zones, { destination: "layer", newLayerName: null }),
    );
    await vi.waitFor(() => expect(runById(onLayer)?.status).toBe("done"));

    const prefix = "Created Zones · buildings · ";
    const line = runById(created)?.summary?.line ?? "";
    expect(line.startsWith(prefix)).toBe(true);
    expect(line.slice(prefix.length)).toBe(runById(onLayer)?.summary?.line);
  });

  it("reads the name publication actually gave the copy", async () => {
    // The same " (2)" re-check a city copy gets (§10.12) — and the card's name
    // is read back from the GEO store, which is where a vector copy's row is.
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones, { newLayerName: "Zones" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(runById(id)?.summary?.line).toContain("Created Zones (2)");
    expect(runById(id)?.note).toBe(
      'Renamed to "Zones (2)": a layer already had that name',
    );
  });

  it("offers Undo immediately, and Undo removes the derived VECTOR layer", async () => {
    const zones = seedAggregate();
    const id = submitRun(aggregateRequest(zones));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
    expect(newLayerUndoBlock(runById(id) as RunRecord)).toBeNull();
    await undoRun(id);
    expect(useGeoLayerStore.getState().layers.map((l) => l.name)).toEqual([
      "Zones",
    ]);
  });
});
```

(`GEO_RECORD_ID` comes from `src/features/geoLayers/geoRecords.ts`; `useGeoLayerStore` and `useGeoLayerStore.setState({ layers: [] })` join the suite's imports and its `beforeEach`, and `newLayerUndoBlock` is already imported there by Task 22.)

- [ ] **Step 7: Branch on the target kind in `execute`**

In `src/features/processing/runQueue.ts`, inside Task 22's `destination === "new"` block, find:

```ts
      try {
        plan = await prepareDerivedCityLayer({
```

and replace with (`target` is `execute`'s own binding from Task 11 — the same object `ctx.target` wraps, and the one that is certainly in scope here):

```ts
      try {
        plan =
          target.kind === "vector"
            ? // §7.6's reversed direction: the TARGET is the vector layer and
              // its copy holds every one of its areas, whatever the scope
              // selected on the SOURCE city layer (§6, §10.11).
              await prepareDerivedVectorLayer({
                runId: id,
                parent: target.layer,
                name:
                  request.newLayerName ??
                  derivedLayerName(
                    target.layer.name,
                    request.toolId,
                    layer.name,
                  ),
                columns: result.columns,
                rows: result.rows,
              })
            : await prepareDerivedCityLayer({
```

and close the ternary after the city call's argument object.

**The card's count follows the same branch.** Task 22's call passes the scoped BUILDING count, which for a vector copy would put the SOURCE's number on the created layer. Find:

```ts
const summary = summariseCreated(result, elapsed(), name, scope.count, {
  streaming: layer.isStreaming,
});
```

and replace with:

```ts
const summary = summariseCreated(
  result,
  elapsed(),
  name,
  // §7.6's own head segment already names what the copy holds — "6 areas
  // aggregated over 1,204 buildings", where the 6 are the target's areas
  // and the 1,204 are the source's buildings. `null` keeps it; a count
  // here would replace it with the SOURCE's number (§6.2's "312
  // buildings" is a CITY copy's, and a city copy holds the scope).
  target.kind === "vector" ? null : scope.count,
  { streaming: layer.isStreaming },
);
```

Extend the import:

```ts
import {
  derivedLayerName,
  prepareDerivedCityLayer,
  prepareDerivedVectorLayer,
  type DerivedPlan,
} from "./deriveLayer";
```

**`undoRun`'s `kind: "layer"` branch needs ONE line**, and that is worth checking rather than assuming: it calls `useLayerStore.getState().removeLayer(state.layerId)`, which does nothing for a geo id. Add the geo removal beside it — find:

```ts
useLayerStore.getState().removeLayer(state.layerId);
useComputedColumnStore.getState().clearLayer(state.layerId);
```

and replace with:

```ts
// ONE of the two stores holds it; a `removeLayer` for an id the other
// store owns is a no-op, so both are called rather than branched on.
useLayerStore.getState().removeLayer(state.layerId);
useGeoLayerStore.getState().removeGeoLayer(state.layerId);
useComputedColumnStore.getState().clearLayer(state.layerId);
```

`useGeoLayerStore` needs no import line here: Task 11 already brought it into `runQueue.ts` (for the vector target lookup) and Task 22 uses it for the published-name lookup. A second import fails `vp check`'s no-duplicate-imports rule.

- [ ] **Step 8: Turn Aggregate's destination on**

In `src/features/processing/toolRegistry.ts`, the `aggregate-per-area` entry's

```ts
    destinations: ["layer"],
```

becomes

```ts
    destinations: ["layer", "new"],
```

All seven tools now offer both destinations, and the `withNewLayer` helper Task 20's test added can be deleted along with its uses.

- [ ] **Step 9: Run and commit**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/features/geoLayers tests/unit/ui/processing
npx tsc -b --noEmit
npx vp check
npx vitest run > /tmp/m3-task23.log 2>&1 &
wait $!; echo "suite: $?"
```

Expected: PASS throughout; `suite: 0`.

```bash
git add src/features/processing/deriveLayer.ts \
  src/features/processing/runQueue.ts \
  src/features/processing/toolRegistry.ts \
  src/features/geoLayers/geoLayerStore.ts \
  tests/
git commit -m "feat: Aggregate can write its results to a new vector layer"
```
