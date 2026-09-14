### Task 18: Vector results surface everywhere a city layer's do

**Files:**

- Create: `src/features/geoLayers/geoSelectionRefresh.ts`
- Modify: `src/features/geoLayers/geoLayerStore.ts`, `src/features/geoLayers/geoJsonRecords.ts` (one reader, `findGeoFeatureProperties`), `src/ui/table/GeoRecordsPanel.tsx`, `src/ui/details/GeoFeatureDetails.tsx`, `src/ui/layers/GeoStyleControls.tsx`, `src/app/App.tsx` (the geo-selection effect), `src/features/processing/runQueue.ts` (the vector publication and its Undo)
- Test: `tests/unit/features/geoLayers/mergeGeoProperties.test.ts`, `tests/unit/features/geoLayers/geoSelectionRefresh.test.ts`, `tests/unit/ui/table/geoComputedBadge.test.tsx`, additions to `tests/unit/features/geoLayers/geoExport.test.ts` (the geo export's own suite — it drives `geoExportText` directly and takes no render) and to `tests/unit/ui/layers/StyleSection.test.tsx` (where "Color by attribute" is covered) and to `tests/unit/features/processing/crossLayerRun.test.ts`

**Interfaces:**

- Consumes: `ToolTarget` (`kind: "vector"`), `undoState`/`patch`/`canonicalise` (Task 11's queue), `useComputedColumnStore`/`formatProvenance` (`computedColumns.ts:253-365`), `readGeoStableFeatureId`/`GEO_STABLE_FEATURE_KEY`/`publicGeoProperties` (`geoJsonRecords.ts:2-21, 98-114`), `ComputedAttributeBadge` (`ui/table/ComputedAttributeBadge`), `attributeKeys` (`geoLayers/categorize.ts`).
- Produces, on `useGeoLayerStore`:

```ts
  mergeGeoFeatureProperties(
    layerId: string,
    byStableId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  ): void;
  replaceGeoPreparedData(layerId: string, data: unknown): void;   // Undo's door
```

and, EXPORTED from the same module beside the store (commander's ruling,
Decisions item 6 (iv)), the pure merge both destinations share:

```ts
/** A prepared document with `byStableId`'s values merged into the matching
 *  features' properties, or `null` when nothing matched. Pure, copy-on-write,
 *  never mutating its input. The store action wraps it; Task 23's derived
 *  VECTOR copy imports it — there is no second copy of this merge. */
export function mergeGeoDocumentProperties(
  document: unknown,
  byStableId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): unknown | null;

/** The value a property had before a run wrote it, when it had none at all.
 *  A sentinel and not `undefined`, because `{ x: undefined }` spread into a
 *  properties bag leaves the KEY behind, which the grid and the export would
 *  both still show. */
export const GEO_PROPERTY_ABSENT: unique symbol;
export type GeoPreviousValues = ReadonlyMap<
  string,
  Readonly<Record<string, unknown | typeof GEO_PROPERTY_ABSENT>>
>;
/** §6.2's Undo for a vector run: `previous`'s values put back into the CURRENT
 *  document — a key with the ABSENT sentinel is REMOVED — or `null` when
 *  nothing changed. Only this run's own columns are touched, so a later run's
 *  results on the same layer survive an earlier run's Undo. */
export function restoreGeoDocumentProperties(
  document: unknown,
  previous: GeoPreviousValues,
): unknown | null;

/** The PUBLIC properties of the feature with that stable id, or null when the
 *  document no longer has it. `App.tsx` re-points a geo selection with it after
 *  a property-only update (§8: the picked feature keeps showing its values). */
export function findGeoFeatureProperties(
  document: unknown,
  stableId: string,
): Readonly<Record<string, unknown>> | null;

// src/features/geoLayers/geoSelectionRefresh.ts  (Task 18)
/**
 * What a geo selection becomes when its layer's `config` identity moves: the
 * SAME selection with refreshed properties (a run's results, or its Undo), or
 * `null` when the subject can no longer be trusted (the layer is gone, the
 * document was replaced, the feature is not in it any more).
 *
 * Pure, so §8's "the picked feature's Details show the new values" is a unit
 * test rather than a render of the whole shell.
 */
export function refreshedGeoSelection(input: {
  readonly selection: GeoFeatureSelection;
  readonly layer: GeoLayer | undefined;
  readonly previousConfig: unknown;
}): GeoFeatureSelection | null;
```

plus `GeoRecordsPanel` passing `layerId` to `DataGrid`, `GeoFeatureDetails`' COMPUTED group, `GeoStyleControls`' `preparedData`-first attribute source, and `runQueue`'s vector publication (replacing Task 11's `"Not available yet"` guard) and its `undoState` vector variant.

- Task 19 calls the store action `mergeGeoFeatureProperties` (through the queue's publication); Task 23 calls the exported `mergeGeoDocumentProperties` for the New-layer copy. Neither writes its own merge.

**Why the results go into `config.preparedData` and never into `config.data`** (Design decision (c), restated so the implementer does not have to look it up): `preparedData` is documented "Engine-only normalized clone; **never persisted**" (`geoLayerStore.ts:42-43`) and it is what the engine (`geoLayerDescriptions.ts:55-57`, which hands `preparedData` to the source description when it is there), the records panel (`GeoRecordsPanel.tsx:25`) and the GeoJSON export (`GeoLayerExport.tsx:24`) all read — which is exactly §8's "nothing new is saved". Writing `config.data` would materialise a URL-backed layer's whole fetched document into the layer row and thence into the snapshot, persisting results the spec says are session-only.

**ONE config replacement per run.** `geoLayerSync.ts:524` tears down and rebuilds the engine pair when `entry.config !== layer.config`, so the merge must be ONE `set` producing ONE new config object. A `set` per feature would rebuild the engine pair once per area.

**The one leak, and its fix.** "Color by attribute" reads the RAW document (`GeoStyleControls.tsx:190-193`), so §7.6's "Style by result opens Color by attribute set to the first output column" would find nothing there. Reading `preparedData` first is strictly more correct anyway — it is the document every other reader uses — and it must filter `GEO_STABLE_FEATURE_KEY` out, because the prepared clone carries the renderer's envelope and the select would otherwise offer it as an attribute.

**Provenance needs no second registry.** `useComputedColumnStore.byLayer` is `Record<layerId, Record<column, Provenance>>` with nothing city-specific (`computedColumns.ts:265-274`); a geo layer id is a string like any other. So the badge and the tooltip need only a CONSUMER on the geo side.

**Undo restores this run's PROPERTIES, not the whole document — and it runs on the FIFO.** Two corrections the review forced, and both are about the same thing: a vector layer is shared state, and a document snapshot says more than one run's Undo is entitled to say.

- _Only the affected properties._ Undo steals the Undo of an earlier run only where the two share a COLUMN (`runQueue.ts:783-800`), so run A (a count) and run B (a sum) are both undoable at once. If A's Undo restored the whole `preparedData` it captured, B's results would vanish with it while B stayed "Undone"-less and undoable — the layer and the run history disagreeing about what is on screen. So the Undo state carries, per feature, the value each of THIS run's columns had before it wrote (with an explicit ABSENT marker for a property that was not there at all), and the Undo merges those back into the CURRENT document. Exactly the shape `previousModelValues` has for a city run, which is why the city half needs no rethinking.
- _Inside the table FIFO._ The city Undo already runs on `runOnTableQueue` (`runQueue.ts:936`) and re-validates at the head. A vector Undo writes no table, so the first draft skipped the queue — and could then replace the document of a layer that a cross-layer run is at that moment computing against, invalidating the records it captured and the preflight it built from them. It goes through the same queue, and re-reads the layer at the head: gone or no longer a GeoJSON layer, and there is nothing to put back (commander's ruling).

- [ ] **Step 1: Write the failing store test**

Create `tests/unit/features/geoLayers/mergeGeoProperties.test.ts`:

```ts
/**
 * §7.6's "Vector results": a run's values merged into the vector layer's
 * feature properties, which is what the app holds for a vector layer.
 *
 * The two invariants the engine depends on are asserted directly: ONE new
 * config per merge (`geoLayerSync.ts:524` rebuilds the engine pair on config
 * identity) and no mutation of the document that was handed in.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  GEO_PROPERTY_ABSENT,
  restoreGeoDocumentProperties,
  useGeoLayerStore,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { geoRecords } from "../../../../src/features/geoLayers/geoRecords";
import { readGeoStableFeatureId } from "../../../../src/features/geoLayers/geoJsonRecords";

function zones(): unknown {
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", id: "z1", properties: { zone: "A" }, geometry: null },
      { type: "Feature", id: "z2", properties: { zone: "B" }, geometry: null },
    ],
  };
}

function addZones(): string {
  return useGeoLayerStore
    .getState()
    .addGeoLayer({ name: "Zones", kind: "geojson", config: { data: zones() } });
}

function stableIds(layerId: string): ReadonlyArray<string> {
  const layer = useGeoLayerStore
    .getState()
    .layers.find((l) => l.id === layerId);
  const document =
    layer?.kind === "geojson" ? layer.config.preparedData : undefined;
  const features = (
    document as { features: Array<{ properties: Record<string, unknown> }> }
  ).features;
  return features.map((f) => readGeoStableFeatureId(f.properties) ?? "");
}

beforeEach(() => {
  useGeoLayerStore.setState({ layers: [] });
});

describe("mergeGeoFeatureProperties", () => {
  it("writes a value onto the feature with that stable id, and no other", () => {
    const id = addZones();
    const [first, second] = stableIds(id);
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(
        id,
        new Map([[first!, { bld_buildings_n: 3 }]]),
      );
    const records = geoRecords(
      useGeoLayerStore.getState().layers[0]?.kind === "geojson"
        ? useGeoLayerStore.getState().layers[0].config.preparedData
        : undefined,
    );
    expect(records[0]).toMatchObject({ zone: "A", bld_buildings_n: 3 });
    expect(records[1]).toEqual(
      expect.not.objectContaining({ bld_buildings_n: 3 }),
    );
    expect(second).not.toBe(first);
  });

  it("replaces the CONFIG exactly once, so the engine rebuilds once", () => {
    const id = addZones();
    const before = useGeoLayerStore.getState().layers[0];
    const ids = stableIds(id);
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(
        id,
        new Map(ids.map((sid, i) => [sid, { bld_buildings_n: i }])),
      );
    const after = useGeoLayerStore.getState().layers[0];
    expect(after).not.toBe(before);
    expect(after?.kind === "geojson" && after.config).not.toBe(
      before?.kind === "geojson" ? before.config : null,
    );
    // The style and the visibility are untouched, so the reconciler takes the
    // cheap path for everything but the document.
    expect(after?.style).toBe(before?.style);
  });

  it("does not mutate the document it was handed", () => {
    const document = zones();
    const id = useGeoLayerStore.getState().addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: { data: document },
    });
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([[stableIds(id)[0]!, { x: 1 }]]));
    const features = (
      document as { features: Array<{ properties: Record<string, unknown> }> }
    ).features;
    expect(features[0]?.properties).toEqual({ zone: "A" });
  });

  it("ignores a stable id the layer does not have", () => {
    const id = addZones();
    const before = useGeoLayerStore.getState().layers[0];
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([["index:99", { x: 1 }]]));
    // No feature changed, so nothing is replaced and the engine is not touched.
    expect(useGeoLayerStore.getState().layers[0]).toBe(before);
  });

  it("leaves a raster or tiles layer alone", () => {
    const id = useGeoLayerStore.getState().addGeoLayer({
      name: "Basemap",
      kind: "raster-xyz",
      config: { urlTemplate: "https://x/{z}/{x}/{y}.png" },
    });
    const before = useGeoLayerStore.getState().layers[0];
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([["a", { x: 1 }]]));
    expect(useGeoLayerStore.getState().layers[0]).toBe(before);
  });
});

describe("restoreGeoDocumentProperties", () => {
  /** The document after two runs wrote disjoint columns onto the same area. */
  function afterTwoRuns(id: string): unknown {
    const [first] = stableIds(id);
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([[first!, { count_n: 3 }]]));
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([[first!, { sum_m2: 90 }]]));
    const layer = useGeoLayerStore.getState().layers[0];
    return layer?.kind === "geojson" ? layer.config.preparedData : undefined;
  }

  it("undoes ONE run's columns and leaves the other run's alone", () => {
    // The bug a whole-document snapshot has: undoing the count would take the
    // sum with it, while the sum's run still says "undoable".
    const id = addZones();
    const [first] = stableIds(id);
    const document = afterTwoRuns(id);
    const undoneA = restoreGeoDocumentProperties(
      document,
      new Map([[first!, { count_n: GEO_PROPERTY_ABSENT }]]),
    );
    expect(geoRecords(undoneA)[0]).toMatchObject({ zone: "A", sum_m2: 90 });
    expect(geoRecords(undoneA)[0]).toEqual(
      expect.not.objectContaining({ count_n: 3 }),
    );
    // And the other order undoes the sum, leaving the count.
    const undoneB = restoreGeoDocumentProperties(
      document,
      new Map([[first!, { sum_m2: GEO_PROPERTY_ABSENT }]]),
    );
    expect(geoRecords(undoneB)[0]).toMatchObject({ count_n: 3 });
    expect(geoRecords(undoneB)[0]).toEqual(
      expect.not.objectContaining({ sum_m2: 90 }),
    );
  });

  it("restores a REPLACED value rather than removing the property", () => {
    const id = addZones();
    const [first] = stableIds(id);
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([[first!, { zone: "Z" }]]));
    const layer = useGeoLayerStore.getState().layers[0];
    const restored = restoreGeoDocumentProperties(
      layer?.kind === "geojson" ? layer.config.preparedData : undefined,
      new Map([[first!, { zone: "A" }]]),
    );
    expect(geoRecords(restored)[0]).toMatchObject({ zone: "A" });
  });

  it("is null when it would change nothing, so the engine is not rebuilt", () => {
    addZones();
    const layer = useGeoLayerStore.getState().layers[0];
    expect(
      restoreGeoDocumentProperties(
        layer?.kind === "geojson" ? layer.config.preparedData : undefined,
        new Map([["index:99", { count_n: GEO_PROPERTY_ABSENT }]]),
      ),
    ).toBeNull();
  });
});

describe("replaceGeoPreparedData", () => {
  it("puts the previous document back, whole — §6.2's Undo for a vector run", () => {
    const id = addZones();
    const original =
      useGeoLayerStore.getState().layers[0]?.kind === "geojson"
        ? useGeoLayerStore.getState().layers[0].config.preparedData
        : undefined;
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([[stableIds(id)[0]!, { x: 1 }]]));
    useGeoLayerStore.getState().replaceGeoPreparedData(id, original);
    const records = geoRecords(
      useGeoLayerStore.getState().layers[0]?.kind === "geojson"
        ? useGeoLayerStore.getState().layers[0].config.preparedData
        : undefined,
    );
    expect(records[0]).toEqual(expect.not.objectContaining({ x: 1 }));
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/geoLayers/mergeGeoProperties.test.ts
```

Expected: FAIL — `mergeGeoFeatureProperties` is not a function.

- [ ] **Step 3: The two store actions**

In `src/features/geoLayers/geoLayerStore.ts`, add to `GeoLayerActions`:

```ts
  /**
   * Spec §7.6: a run's results, merged onto the vector layer's FEATURE
   * PROPERTIES — which is what the app holds for a vector layer (it has no
   * DuckDB table and no model).
   *
   * Into `preparedData`, never `config.data`: `preparedData` is the document the
   * engine, the records panel and the GeoJSON export all read, and it is
   * documented "never persisted" — which is exactly §8's "nothing new is
   * saved". Writing `data` would put a URL-backed layer's whole fetched
   * document into the snapshot.
   *
   * ONE new config, whatever the number of features: `geoLayerSync.ts:524`
   * rebuilds the engine pair on config identity, so a `set` per feature would
   * rebuild it once per area. A merge that changes nothing leaves the record's
   * identity alone.
   */
  mergeGeoFeatureProperties: (
    layerId: string,
    byStableId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  ) => void;
  /** §6.2's Undo for a vector run: the previous document, restored whole. */
  replaceGeoPreparedData: (layerId: string, data: unknown) => void;
```

and above the store, the pure merge — **exported**, because Task 23's derived
vector copy calls the same function rather than writing a second one (Decisions
item 6 (iv)):

```ts
/**
 * A prepared document with `byStableId`'s values merged into the matching
 * features' properties, or `null` when nothing matched.
 *
 * Copy-on-write, feature by feature: the features that change are replaced and
 * the rest keep their identity, so a merge over 6 of 6,000 areas clones 6
 * objects. `null` rather than an unchanged clone, so the caller can leave the
 * layer record — and the engine pair — untouched.
 *
 * PURE and non-mutating, which is what lets Task 23 hand it the PARENT's
 * `preparedData` to build a derived layer's document from: §6's "the run leaves
 * the target untouched" is a property of this function, not of its callers.
 */
export function mergeGeoDocumentProperties(
  document: unknown,
  byStableId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): unknown | null {
  if (byStableId.size === 0) return null;
  const source = document as {
    type?: unknown;
    features?: unknown[];
    properties?: unknown;
  } | null;
  const mergeFeature = (feature: unknown): unknown => {
    const record = feature as { properties?: unknown } | null;
    const properties =
      record?.properties && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : null;
    if (properties === null) return feature;
    const stableId = readGeoStableFeatureId(properties);
    const values = stableId === null ? undefined : byStableId.get(stableId);
    if (values === undefined) return feature;
    return { ...record, properties: { ...properties, ...values } };
  };
  if (source?.type === "FeatureCollection" && Array.isArray(source.features)) {
    const features = source.features.map(mergeFeature);
    const changed = features.some((f, i) => f !== source.features?.[i]);
    return changed ? { ...source, features } : null;
  }
  if (source?.type === "Feature") {
    const merged = mergeFeature(source);
    return merged === source ? null : merged;
  }
  return null;
}

/**
 * What a property was before a run wrote it, when it was not there at all.
 *
 * A SENTINEL and not `undefined`: `{ ...properties, bld_buildings_n: undefined }`
 * leaves the KEY in the bag, and the records grid, Details and the GeoJSON
 * export would all still list it — an Undo that visibly did not undo.
 */
export const GEO_PROPERTY_ABSENT: unique symbol = Symbol("absent");

export type GeoPreviousValues = ReadonlyMap<
  string,
  Readonly<Record<string, unknown | typeof GEO_PROPERTY_ABSENT>>
>;

/**
 * §6.2's Undo for a vector run: this run's OWN columns put back, feature by
 * feature, into the CURRENT document.
 *
 * NOT a stored snapshot of the whole document. Two runs can be undoable on one
 * layer at the same time — Undo is stolen only where two runs share a COLUMN
 * (`runQueue.ts:783-800`) — so restoring a snapshot taken before run A would
 * also erase run B's results while B still read "undoable". Touching only the
 * keys the run wrote makes the two Undos independent in either order, which is
 * what §6.2 promises.
 *
 * Copy-on-write like {@link mergeGeoDocumentProperties}, and `null` when
 * nothing changed so the caller can leave the layer record — and the engine
 * pair — alone.
 */
export function restoreGeoDocumentProperties(
  document: unknown,
  previous: GeoPreviousValues,
): unknown | null {
  if (previous.size === 0) return null;
  const source = document as { type?: unknown; features?: unknown[] } | null;
  const restoreFeature = (feature: unknown): unknown => {
    const record = feature as { properties?: unknown } | null;
    const properties =
      record?.properties && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : null;
    if (properties === null) return feature;
    const stableId = readGeoStableFeatureId(properties);
    const values = stableId === null ? undefined : previous.get(stableId);
    if (values === undefined) return feature;
    const next: Record<string, unknown> = { ...properties };
    let changed = false;
    for (const [key, value] of Object.entries(values)) {
      if (value === GEO_PROPERTY_ABSENT) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
        continue;
      }
      if (!(key in next) || next[key] !== value) changed = true;
      next[key] = value;
    }
    return changed ? { ...record, properties: next } : feature;
  };
  if (source?.type === "FeatureCollection" && Array.isArray(source.features)) {
    const features = source.features.map(restoreFeature);
    const changed = features.some((f, i) => f !== source.features?.[i]);
    return changed ? { ...source, features } : null;
  }
  if (source?.type === "Feature") {
    const restored = restoreFeature(source);
    return restored === source ? null : restored;
  }
  return null;
}
```

And in `src/features/geoLayers/geoJsonRecords.ts`, the one reader §8 needs for a picked feature — beside `publicGeoProperties`, which it uses:

```ts
/**
 * The PUBLIC properties of the feature carrying `stableId`, or null.
 *
 * A geo selection holds a SNAPSHOT of the properties it was made with
 * (`domain/selection/types.ts:35-43`), so after a run merges its results the
 * Details panel would still show the values from before the run. This is how
 * `App.tsx` re-reads them for the same feature without a new pick.
 */
export function findGeoFeatureProperties(
  document: unknown,
  stableId: string,
): Readonly<Record<string, unknown>> | null {
  const source = document as { type?: unknown; features?: unknown[] } | null;
  const features =
    source?.type === "FeatureCollection" && Array.isArray(source.features)
      ? source.features
      : source?.type === "Feature"
        ? [source]
        : [];
  for (const feature of features) {
    const properties = (feature as { properties?: unknown } | null)?.properties;
    if (properties === null || typeof properties !== "object") continue;
    const bag = properties as Record<string, unknown>;
    if (readGeoStableFeatureId(bag) === stableId)
      return publicGeoProperties(bag);
  }
  return null;
}
```

with `import { normalizeGeoJsonDocument, readGeoStableFeatureId } from "./geoJsonRecords";` (the import already exists for `normalizeGeoJsonDocument`), and the two implementations inside the store:

```ts
  mergeGeoFeatureProperties: (layerId, byStableId) =>
    set((state) => ({
      layers: replaceLayer(state.layers, layerId, (layer) => {
        if (layer.kind !== "geojson") return null;
        const merged = mergeGeoDocumentProperties(
          layer.config.preparedData,
          byStableId,
        );
        return merged === null
          ? null
          : { ...layer, config: { ...layer.config, preparedData: merged } };
      }),
    })),

  replaceGeoPreparedData: (layerId, data) =>
    set((state) => ({
      layers: replaceLayer(state.layers, layerId, (layer) =>
        layer.kind === "geojson"
          ? { ...layer, config: { ...layer.config, preparedData: data } }
          : null,
      ),
    })),
```

- [ ] **Step 4: The queue publishes a vector target's results**

In `src/features/processing/runQueue.ts`, extend the two geo imports Task 11 and Task 13 already added — `useGeoLayerStore` gains `GEO_PROPERTY_ABSENT`, `restoreGeoDocumentProperties` and the type `GeoPreviousValues`, and `geoRecords` gains `geoRecordId` — then replace the `UndoState` interface with the discriminated pair:

```ts
/**
 * What an Undo needs to put a layer back, per destination kind.
 *
 * A CITY run's Undo is a transaction over a table plus the model values it
 * overwrote. A VECTOR run's is one object: the `preparedData` document as it was
 * before the merge (§7.6). Two shapes and one Map, because §6.2's Undo is one
 * button whichever kind of layer it is about.
 */
type UndoState =
  | {
      readonly kind: "city";
      readonly table: string;
      readonly backupTable: string | null;
      readonly created: ReadonlyArray<string>;
      readonly replaced: ReadonlyArray<string>;
      readonly ids: ReadonlyArray<string> | null;
      /** The model attributes the run overwrote; `undefined` for "was not there". */
      readonly previousModelValues: ReadonlyMap<
        string,
        Record<string, unknown>
      >;
    }
  | {
      readonly kind: "vector";
      readonly layerId: string;
      /**
       * Per feature, what THIS run's columns held before it wrote — with
       * `GEO_PROPERTY_ABSENT` for a property the feature did not have.
       *
       * Not the document: two runs writing disjoint columns onto one layer are
       * both undoable (Undo is stolen only where they share a column), so a
       * snapshot-restore of run A would erase run B's results behind its back.
       * This is `previousModelValues`' exact analogue for a vector layer.
       */
      readonly previousValues: GeoPreviousValues;
      readonly created: ReadonlyArray<string>;
      readonly replaced: ReadonlyArray<string>;
    };
```

The existing city literal gains the tag the union now discriminates on — one
line, at the one existing `undoState.set` (`runQueue.ts:802-813`). Find:

```ts
    undoState.set(id, {
      table: table.table,
```

and make it:

```ts
    undoState.set(id, {
      kind: "city",
      table: table.table,
```

`tsc` finds it if it is missed: `UndoState` has no member without a `kind`.

`discardUndo` only has a table to drop for the city variant:

```ts
function discardUndo(id: string): void {
  const state = undoState.get(id);
  if (!state) return;
  undoState.delete(id);
  // A VECTOR run's Undo holds no database resource at all — its copy is one
  // JavaScript object, which the Map delete above has already released.
  if (state.kind !== "city") return;
  const backup = state.backupTable;
  if (!backup) return;
  /* …the existing raced DROP, unchanged… */
}
```

Task 11 made §6.1's "belongs to the source data" pre-flight city-only, and said the vector analogue was "Task 15's form validation plus Task 18's head re-check". This is that re-check: give the `if (target.kind === "city") { … }` block an `else`, right where it stands (`execute`, just after `target` is resolved):

```ts
} else {
  // The same rule for a vector target, against its OWN attributes: the
  // document's public property keys. The form checked them at Run, but a
  // queued run can wait minutes and a re-linked source may have brought a
  // `bld_buildings_n` of its own — and the merge would then overwrite a
  // property of the file under a "computed" badge. The registry's own
  // columns are excluded, exactly as on the city side: replacing a column a
  // previous run wrote is what a re-run IS.
  const owned = new Set(
    [...computedColumnsOf(request.targetLayerId)].map((c) => c.toLowerCase()),
  );
  const keys = new Set(
    target.records.flatMap((record) => Object.keys(record)),
  );
  const clash = [...keys].find(
    (key) =>
      !owned.has(key.toLowerCase()) &&
      request.columns.some(
        (out) => out.name.toLowerCase() === key.toLowerCase(),
      ),
  );
  if (clash !== undefined) {
    patch(id, {
      status: "failed",
      error: `'${clash}' belongs to the source data; choose another prefix`,
      elapsedMs: elapsed(),
    });
    return;
  }
}
```

Then replace Task 11's vector guard in `execute` (the `if (target.kind !== "city") { … "Not available yet" … }` block) with §7.6's publication:

```ts
if (target.kind === "vector") {
  // §7.6: the durable copy of a vector layer's results is its FEATURE
  // PROPERTIES. So no table, no transaction and no model — but the same
  // canonical spelling, the same provenance, the same Undo-stealing and the
  // same card as a city run.
  const existingProperties = [
    ...new Set(target.records.flatMap((record) => Object.keys(record))),
  ].map((name) => ({ name }));
  const result = canonicalise(raw, existingProperties);
  if (result.rows.size === 0) {
    const summary = summarise(result, elapsed(), {
      streaming: layer.isStreaming,
    });
    patch(id, {
      status: "done",
      phase: null,
      elapsedMs: elapsed(),
      summary,
      log: [...log],
      undoable: false,
    });
    if (runById(id)?.status === "done") {
      useProcessingStore.getState().pushNotice(summary.line);
    }
    return;
  }
  patch(id, { phase: "write" });
  const onDocument = new Set(
    existingProperties.map((c) => c.name.toLowerCase()),
  );
  const existing = new Set(
    result.columns
      .map((c) => c.name)
      .filter((name) => onDocument.has(name.toLowerCase())),
  );
  // Captured BEFORE the merge, per feature and per COLUMN — §6.2's Undo puts
  // this run's own values back into whatever the document is by then, so a
  // later run's results on the same layer survive it. `target.records` is the
  // document as it was read for this run, which is the state being overwritten.
  const before = new Map(
    target.records.map((record) => [geoRecordId(record), record]),
  );
  const previousValues = new Map<
    string,
    Record<string, unknown | typeof GEO_PROPERTY_ABSENT>
  >();
  for (const stableId of result.rows.keys()) {
    const record = before.get(stableId);
    const prior: Record<string, unknown | typeof GEO_PROPERTY_ABSENT> = {};
    for (const column of result.columns) {
      prior[column.name] =
        record !== undefined && column.name in record
          ? record[column.name]
          : GEO_PROPERTY_ABSENT;
    }
    previousValues.set(stableId, prior);
  }
  useGeoLayerStore
    .getState()
    .mergeGeoFeatureProperties(target.layer.id, result.rows);
  log.push({
    label: "Writing results",
    sql: null,
    ms: 0,
    rows: result.rows.size,
  });
  publishProvenance(id, target.layer.id, result, tool.name, request, scope);
  stealUndo(id, target.layer.id, result);
  undoState.set(id, {
    kind: "vector",
    layerId: target.layer.id,
    previousValues,
    created: result.columns
      .map((c) => c.name)
      .filter((name) => !existing.has(name)),
    replaced: result.columns
      .map((c) => c.name)
      .filter((name) => existing.has(name)),
  });
  if (!runById(id)) discardUndo(id);
  const summary = summarise(result, elapsed(), {
    streaming: layer.isStreaming,
  });
  patch(id, {
    status: "done",
    phase: null,
    elapsedMs: elapsed(),
    summary,
    log: [...log],
    columns: result.columns.map((c) => c.name),
    undoable: true,
    note: signal.aborted ? "finished before the cancel arrived" : null,
  });
  if (runById(id)?.status !== "done") {
    discardUndo(id);
    return;
  }
  useProcessingStore.getState().pushNotice(summary.line);
  return;
}
const result = canonicalise(raw, table.columns);
```

The two shared steps are lifted out of the city path so both destinations use the same code — `publishProvenance` is the existing `for (const col of result.columns) { … setProvenance … }` loop (`runQueue.ts:759-778`) with `layer.id` replaced by its `layerId` parameter, and `stealUndo` is the existing "only ONE run can own a column's Undo" loop (`:783-800`) with the same substitution:

```ts
/** Spec §7's provenance, for whichever layer the results landed on. */
function publishProvenance(
  runId: string,
  layerId: string,
  result: ToolResult,
  toolName: string,
  request: FrozenRequest,
  scope: {
    readonly featureIds: ReadonlyArray<string> | null;
    readonly count: number;
    readonly total: number;
  },
): void {
  for (const col of result.columns) {
    const registry = useComputedColumnStore.getState();
    const previous = registry.byLayer[layerId]?.[col.name] ?? null;
    registry.setProvenance(layerId, col.name, {
      runId,
      toolName,
      summary: `${request.lod ? `LoD ${request.lod} · ` : ""}${scopeLabel(
        request.scope,
        scope.count,
      )}`,
      at: Date.now(),
      partial:
        scope.featureIds === null
          ? null
          : { count: scope.count, total: scope.total },
      previous,
    });
  }
}

/** Spec §6.2: only ONE run can own a column's Undo. */
function stealUndo(runId: string, layerId: string, result: ToolResult): void {
  for (const other of useProcessingStore.getState().runs) {
    if (
      other.id !== runId &&
      other.targetLayerId === layerId &&
      other.undoable &&
      other.columns.some((name) =>
        result.columns.some((c) => c.name.toLowerCase() === name.toLowerCase()),
      )
    ) {
      patch(other.id, { undoable: false });
      discardUndo(other.id);
    }
  }
}
```

The city path's own two loops are replaced by calls to these, so there is one copy of each rule.

Finally, `undoRun` grows the vector branch at the top, and the provenance rollback becomes shared:

```ts
export async function undoRun(id: string): Promise<void> {
  const run = runById(id);
  const state = undoState.get(id);
  if (!run || !run.undoable || !state) return;
  if (state.kind === "vector") {
    // ON THE FIFO, like the city Undo (`runQueue.ts:936`), although it writes
    // no table: a cross-layer run holds that queue for its whole life and has
    // CAPTURED this layer's records and built its preflight from them, so
    // replacing the document underneath it would leave the run computing
    // against a document nothing on screen shows. Serialising is the whole fix
    // and it costs one queue slot.
    await runOnTableQueue(async () => {
      // Re-validated at the head, as the city Undo is: the layer may have been
      // removed, or replaced by one of another kind, while this waited. There
      // is then nothing to put back and nothing to report.
      const layer = useGeoLayerStore
        .getState()
        .layers.find((l) => l.id === state.layerId);
      if (layer === undefined || layer.kind !== "geojson") {
        undoState.delete(id);
        patch(id, { undoable: false });
        return;
      }
      // This run's OWN columns, back into whatever the document is NOW — never
      // a stored snapshot, or a later run's disjoint results would go with it.
      const restored = restoreGeoDocumentProperties(
        layer.config.preparedData,
        state.previousValues,
      );
      if (restored !== null) {
        useGeoLayerStore
          .getState()
          .replaceGeoPreparedData(state.layerId, restored);
      }
      rollBackProvenance(state.layerId, state.created, state.replaced);
      undoState.delete(id);
      patch(id, { undoable: false, note: "Undone" });
    });
    return;
  }
  /* …the existing queued city Undo, unchanged, with its tail replaced by… */
  useLayerStore
    .getState()
    .mergeAttributes(run.targetLayerId, state.previousModelValues);
  rollBackProvenance(run.targetLayerId, state.created, state.replaced);
  undoState.delete(id);
  patch(id, { undoable: false, note: "Undone" });
}

/** The registry half of §6.2's Undo: created columns go, replaced ones go back
 *  to the provenance they had. The same for both destinations. */
function rollBackProvenance(
  layerId: string,
  created: ReadonlyArray<string>,
  replaced: ReadonlyArray<string>,
): void {
  const registry = useComputedColumnStore.getState();
  registry.removeColumns(layerId, created);
  for (const col of replaced) {
    const provenance = registry.byLayer[layerId]?.[col];
    if (provenance?.previous) {
      registry.setProvenance(layerId, col, provenance.previous);
    } else {
      registry.removeColumns(layerId, [col]);
    }
  }
}
```

- [ ] **Step 5: The badge, Details and Color by attribute**

In `src/ui/table/GeoRecordsPanel.tsx`, the grid gets the layer whose registry names its computed columns:

```tsx
      <DataGrid
        columns={columns}
        rows={pageRows}
        layerId={layer.id}
        sort={query.sort}
```

In `src/ui/details/GeoFeatureDetails.tsx`, the COMPUTED group, exactly as `LayerAttributesSection.tsx:62-82` has it:

```tsx
/**
 * A picked geospatial feature's details.
 *
 * Spec §8 splits the attribute list by PROVENANCE, and §7.6 says a vector
 * layer's computed properties behave "like any other attribute": so the columns
 * a tool wrote for THIS layer move into a COMPUTED group with the badge and the
 * provenance tooltip, exactly as they do for a city layer. The split is the
 * registry's answer and never a guess from the key's name — a source document
 * may carry a `bld_buildings_n` of its own.
 */
import type { GeoFeatureSelection } from "../../domain/selection/types";
import {
  formatProvenance,
  useComputedColumnStore,
} from "../../insights/computedColumns";
import { ComputedAttributeBadge } from "../table/ComputedAttributeBadge";
import { AttrRow } from "../inspector/attrDisplay";
import { formatValue } from "../inspector/formatAttrValue";
import { geoSummary } from "./subject";
import { SummarySection } from "./SummarySection";

export function GeoFeatureDetails({
  selection,
}: {
  readonly selection: GeoFeatureSelection;
}) {
  // The store's own object, not `computedColumnsOf`: that builds a fresh Set
  // per call, which as a selector snapshot would re-render forever.
  const computed = useComputedColumnStore(
    (state) => state.byLayer[selection.geoLayerId],
  );
  const entries = Object.entries(selection.properties);
  const fileEntries = entries.filter(([key]) => computed?.[key] === undefined);
  const computedKeys = entries
    .filter(([key]) => computed?.[key] !== undefined)
    .map(([key]) => key);
  return (
    <>
      <SummarySection rows={geoSummary(selection.properties)} />
      <section className="details-section">
        <h3 className="details-section-title">Attributes</h3>
        {entries.length === 0 ? (
          <div className="details-placeholder">No attributes</div>
        ) : (
          fileEntries.map(([key, value]) => (
            <AttrRow key={key} label={key} value={formatValue(value)} />
          ))
        )}
        {computedKeys.length > 0 && (
          <div role="group" aria-label="Computed attributes">
            <h4 className="details-section-title details-computed-title">
              COMPUTED
            </h4>
            {computedKeys.map((key) => (
              <AttrRow
                key={key}
                label={key}
                value={formatValue(selection.properties[key])}
                badge={
                  <ComputedAttributeBadge
                    title={formatProvenance(computed![key]!)}
                  />
                }
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
```

In `src/ui/layers/GeoStyleControls.tsx`, BOTH halves of "Color by attribute" read the prepared document first — the key list AND the categories. The key list alone would put `bld_buildings_n` in the select and then colour by a document that does not have it, which is worse than not offering it:

```tsx
// `preparedData` FIRST: it is the document the engine, the records panel and
// the GeoJSON export all read, and §7.6's computed properties live only
// there. Reading `config.data` would offer the file's own attributes only, so
// "Color by attribute" could not offer `bld_buildings_n` — which is exactly
// what §7.6's Style by result opens. The renderer's own envelope key is
// filtered out: the prepared clone carries it and it is not an attribute.
const inlineKeys = useMemo(() => {
  const document = layer.config.preparedData ?? layer.config.data;
  return document === undefined
    ? null
    : attributeKeys(document).filter((key) => key !== GEO_STABLE_FEATURE_KEY);
}, [layer.config.preparedData, layer.config.data]);
```

and in `pickAttribute`, the same order — LIVE, because a run may have merged its results since this render (`GeoStyleControls.tsx:218-260`):

```tsx
const apply = (fallback: unknown) => {
  // Read the LIVE record at write time: an async resolve may land after
  // another edit, and spreading the render-time style would drop it.
  const current = useGeoLayerStore
    .getState()
    .layers.find((l) => l.id === layer.id);
  if (current === undefined || current.kind !== "geojson") return;
  // The SAME preference as the key list above. `categoriesFor` over
  // `config.data` would find no `bld_buildings_n` and prefill an empty
  // category list for a column the select is offering — §7.6's Style by
  // result opens exactly that column.
  const document = current.config.preparedData ?? fallback;
  updateGeoLayer(layer.id, {
    style: {
      ...current.style,
      colorByAttribute: {
        attribute,
        categories: categoriesFor(document, attribute),
      },
    },
  });
};
const inline = layer.config.preparedData ?? layer.config.data;
if (inline !== undefined) {
  apply(inline);
  return;
}
```

(the `resolveGeoJsonDocument` fallback below it is unchanged — it is the URL-backed case, where there is no prepared clone yet.)

with `import { GEO_STABLE_FEATURE_KEY } from "../../features/geoLayers/geoJsonRecords";`.

- [ ] **Step 6: The picked feature keeps its selection, and shows the new values**

`App.tsx:768-795` drops a geo selection whenever the layer's `config` identity
moves, because `geoLayerSync` rebuilds the engine pair on that identity and the
retained `batchId` would then name a different feature. A property merge IS a
config replacement, so as it stands §7.6's run un-picks whatever the user had
selected — and §8 says the opposite: a picked feature shows its computed values
in Details. The rule needs one more case rather than a different rule, and it is
pure, so it goes in its own module.

Create `src/features/geoLayers/geoSelectionRefresh.ts`:

```ts
/**
 * What a geo selection becomes when its layer's `config` identity moves.
 *
 * TWO different events wear the same clothes. A RE-LINK replaces the document:
 * the batch ids are re-minted, the feature the selection names may not exist,
 * and the selection has to go (that is why `App.tsx` compares config identity
 * at all). A PROPERTY MERGE — a run's results, or its Undo — replaces the
 * config over the SAME document: the feature is still there, still has its
 * stable id, and §8 wants its new values in Details. Telling them apart is one
 * comparison of the source fields, and re-reading the properties by stable id
 * is what makes the selection correct afterwards rather than merely alive.
 *
 * The engine highlight survives on its own: `geoLayerSync` highlights by
 * `highlightedStableFeatureId` when the selection carries one and falls back to
 * the batch id only when it does not (`geoLayerSync.ts:236-240`), and every
 * normalized document's features carry one.
 */
import type { GeoFeatureSelection } from "../../domain/selection/types";
import { findGeoFeatureProperties } from "./geoJsonRecords";
import type { GeoLayer, GeoJsonLayerConfig } from "./geoLayerStore";

function isGeoJsonConfig(config: unknown): config is GeoJsonLayerConfig {
  return typeof config === "object" && config !== null;
}

export function refreshedGeoSelection(input: {
  readonly selection: GeoFeatureSelection;
  readonly layer: GeoLayer | undefined;
  /** The config the layer had when the feature was picked. */
  readonly previousConfig: unknown;
}): GeoFeatureSelection | null {
  const { selection, layer, previousConfig } = input;
  if (layer === undefined || layer.kind !== "geojson") return null;
  if (layer.config === previousConfig) return selection;
  // A property-only update keeps the SOURCE the selection was made on: the
  // same inline document, the same url, the same preparation epoch. Anything
  // else is a new document and the old subject is gone.
  const previous = isGeoJsonConfig(previousConfig) ? previousConfig : null;
  const sameSource =
    previous !== null &&
    layer.config.data === previous.data &&
    layer.config.url === previous.url &&
    layer.config.preparationEpoch === previous.preparationEpoch;
  if (!sameSource || selection.stableFeatureId === undefined) return null;
  const properties = findGeoFeatureProperties(
    layer.config.preparedData,
    selection.stableFeatureId,
  );
  // The feature itself can be gone even from the same source — a re-prepare
  // that dropped it — and then there is nothing to show.
  return properties === null ? null : { ...selection, properties };
}
```

In `src/app/App.tsx`, the effect asks it instead of deciding for itself, and
keeps the ref in step so the NEXT change is measured from the config the
selection now belongs to:

```tsx
useEffect(() => {
  if (geoSelection === null) return;
  const layer = geoLayers.find((l) => l.id === geoSelection.geoLayerId);
  const next = refreshedGeoSelection({
    selection: geoSelection,
    layer,
    previousConfig: geoSelectionConfigRef.current,
  });
  if (next === null) {
    selectGeoFeature(null);
    return;
  }
  if (next === geoSelection) return;
  // A run's results (or its Undo) landed on the picked feature: same feature,
  // new properties, and the ref moves with it so this does not re-fire.
  geoSelectionConfigRef.current = layer?.config ?? null;
  selectGeoFeature(next);
}, [geoLayers, geoSelection, selectGeoFeature]);
```

- [ ] **Step 7: Write the UI and lifecycle tests**

Create `tests/unit/ui/table/geoComputedBadge.test.tsx`:

```tsx
/**
 * §7.6: a vector layer's computed properties "show in the vector layer's
 * records panel with the computed badge and provenance".
 *
 * The badge reads the REGISTRY, never a name pattern: a source document may
 * carry a `bld_buildings_n` of its own and it has to keep reading as the file's.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GeoRecordsPanel } from "../../../../src/ui/table/GeoRecordsPanel";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import { useComputedColumnStore } from "../../../../src/insights/computedColumns";

function addZones(): string {
  return useGeoLayerStore.getState().addGeoLayer({
    name: "Zones",
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "z1",
            properties: { zone: "A", bld_buildings_n: 3 },
            geometry: null,
          },
        ],
      },
    },
  });
}

beforeEach(() => {
  useGeoLayerStore.setState({ layers: [] });
  useComputedColumnStore.setState({ byLayer: {} });
});

describe("the geo records grid", () => {
  it("badges a column the registry knows, and not the file's own", () => {
    const id = addZones();
    useComputedColumnStore.getState().setProvenance(id, "bld_buildings_n", {
      runId: "run_1",
      toolName: "Aggregate buildings per area",
      summary: "All 3 buildings",
      at: Date.parse("2026-09-12T14:02:00"),
      partial: null,
      previous: null,
    });
    const layer = useGeoLayerStore.getState().layers[0];
    render(
      <GeoRecordsPanel
        layer={layer as Extract<typeof layer, { kind: "geojson" }>}
      />,
    );
    const badges = screen.getAllByTitle(/Aggregate buildings per area/);
    expect(badges).toHaveLength(1);
  });

  it("badges nothing when the registry has nothing for this layer", () => {
    addZones();
    const layer = useGeoLayerStore.getState().layers[0];
    render(
      <GeoRecordsPanel
        layer={layer as Extract<typeof layer, { kind: "geojson" }>}
      />,
    );
    expect(screen.queryByTitle(/Aggregate/)).not.toBeInTheDocument();
  });
});
```

Append to the geo export's own suite, `tests/unit/features/geoLayers/geoExport.test.ts`. That file drives `geoExportText(document, format, scope, matching, selected)` directly over a `normalizeGeoJsonDocument(...).data` fixture, so the case needs no render and no store — it merges through the exported pure function and exports the result:

```ts
it("carries a run's computed properties into the GeoJSON it writes (§7.6)", () => {
  const merged = mergeGeoDocumentProperties(
    data,
    new Map([["id:string:a", { bld_buildings_n: 3 }]]),
  );
  const text = geoExportText(merged, "geojson", "all", matching, selected);
  expect(text).toContain('"bld_buildings_n":3');
  // The renderer's own bookkeeping is still not exported.
  expect(text).not.toContain("__roofy_stable_feature_id");
});
```

(`data`, `matching` and `selected` are that file's own module-level fixtures; add `mergeGeoDocumentProperties` to its `geoLayerStore` import.)

Append to `tests/unit/features/processing/crossLayerRun.test.ts` — the publication and the Undo through the real queue:

```ts
describe("a vector target's publication", () => {
  it("merges the results into the layer's properties and offers Undo", async () => {
    const zones = addZones();
    registerExecutor("aggregate-per-area", async (run, ctx) => ({
      columns: [{ name: `${run.prefix}buildings_n`, type: "DOUBLE" as const }],
      // Keyed by the STABLE FEATURE ID, which is what the merge matches on.
      rows: new Map(
        ctx.target.kind === "vector"
          ? ctx.target.records.map((record, i) => [
              geoRecordId(record),
              { [`${run.prefix}buildings_n`]: i },
            ])
          : [],
      ),
      measured: 2,
      skipped: [],
    }));
    const id = submitRun({
      toolId: "aggregate-per-area",
      targetLayerId: zones,
      sourceLayerId: "CITY",
      scope: "all",
      lod: null,
      params: {},
      prefix: "bld_",
      columns: [{ name: "bld_buildings_n", type: "DOUBLE" }],
    });
    await settle();
    expect(runById(id)).toMatchObject({ status: "done", undoable: true });
    const records = geoRecords(
      (
        useGeoLayerStore.getState().layers[0] as {
          config: { preparedData: unknown };
        }
      ).config.preparedData,
    );
    expect(records[0]).toMatchObject({ bld_buildings_n: 0 });
    // §7: provenance under the GEO layer's id, in the one registry.
    expect(computedColumnsOf(zones).has("bld_buildings_n")).toBe(true);
    // And nothing reached the city layer's table.
    expect(sql.some((s) => s.startsWith("ALTER TABLE"))).toBe(false);

    await undoRun(id);
    const after = geoRecords(
      (
        useGeoLayerStore.getState().layers[0] as {
          config: { preparedData: unknown };
        }
      ).config.preparedData,
    );
    expect(after[0]).toEqual(
      expect.not.objectContaining({ bld_buildings_n: 0 }),
    );
    expect(computedColumnsOf(zones).has("bld_buildings_n")).toBe(false);
    expect(runById(id)?.note).toBe("Undone");
  });
});
```

```ts
it("undoes one run without taking a later run's disjoint columns", async () => {
  // §6.2 steals Undo only where two runs share a COLUMN, so both of these are
  // undoable at once — and undoing the first must leave the second's results
  // on the layer, which a whole-document restore could not do.
  const zones = addZones();
  const writer =
    (column: string, value: number) =>
    async (
      run: import("../../../../src/features/processing/types").RunRecord,
      ctx: Ctx,
    ) => ({
      columns: [{ name: column, type: "DOUBLE" as const }],
      rows: new Map(
        ctx.target.kind === "vector"
          ? ctx.target.records.map((record) => [
              geoRecordId(record),
              { [column]: value },
            ])
          : [],
      ),
      measured: 2,
      skipped: [],
      line: run.prefix,
    });
  registerExecutor("aggregate-per-area", writer("bld_buildings_n", 3));
  const first = submitRun({
    toolId: "aggregate-per-area",
    targetLayerId: zones,
    sourceLayerId: "CITY",
    scope: "all",
    lod: null,
    params: {},
    prefix: "bld_",
    columns: [{ name: "bld_buildings_n", type: "DOUBLE" }],
  });
  await settle();
  registerExecutor("aggregate-per-area", writer("bld_sum_m2", 90));
  const second = submitRun({
    toolId: "aggregate-per-area",
    targetLayerId: zones,
    sourceLayerId: "CITY",
    scope: "all",
    lod: null,
    params: {},
    prefix: "bld_",
    columns: [{ name: "bld_sum_m2", type: "DOUBLE" }],
  });
  await settle();
  expect(runById(second)?.status).toBe("done");

  await undoRun(first);
  await settle();
  const records = geoRecords(
    (
      useGeoLayerStore.getState().layers[0] as {
        config: { preparedData: unknown };
      }
    ).config.preparedData,
  );
  expect(records[0]).toMatchObject({ bld_sum_m2: 90 });
  expect(records[0]).toEqual(
    expect.not.objectContaining({ bld_buildings_n: 3 }),
  );
  expect(runById(second)?.undoable).toBe(true);
});

it("refuses an output that would overwrite one of the layer's OWN properties", async () => {
  // §6.1's "belongs to the source data", for a vector target: the document
  // already carries `zone`, and no run may write over it under a computed
  // badge. The city branch has had this since M1; this is its vector half.
  const zones = addZones();
  capturing();
  const id = submitRun({
    toolId: "aggregate-per-area",
    targetLayerId: zones,
    sourceLayerId: "CITY",
    scope: "all",
    lod: null,
    params: {},
    prefix: "",
    columns: [{ name: "zone", type: "DOUBLE" }],
  });
  await settle();
  expect(runById(id)?.error).toBe(
    "'zone' belongs to the source data; choose another prefix",
  );
});
```

(import `undoRun` from `runQueue`, `computedColumnsOf` from
`insights/computedColumns`, and `geoRecordId` + `geoRecords` from
`features/geoLayers/geoRecords` at the top of that file.)

Create `tests/unit/features/geoLayers/geoSelectionRefresh.test.ts`:

```ts
/**
 * §8: a picked vector feature shows its computed values — so a run's results
 * must not un-pick it, and a re-link still must.
 *
 * Pure, over the two configs and the selection: `App.tsx` does nothing but ask
 * this and obey.
 */
import { describe, expect, it } from "vitest";
import { refreshedGeoSelection } from "../../../../src/features/geoLayers/geoSelectionRefresh";
import {
  mergeGeoDocumentProperties,
  type GeoLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { normalizeGeoJsonDocument } from "../../../../src/features/geoLayers/geoJsonRecords";

const data = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", id: "z1", properties: { zone: "A" }, geometry: null },
  ],
};
const prepared = normalizeGeoJsonDocument(data).data;

function layerWith(preparedData: unknown): GeoLayer {
  return {
    id: "GEO",
    name: "Zones",
    kind: "geojson",
    visible: true,
    opacity: 1,
    style: { kind: "flat" },
    config: { data, preparedData, preparation: "ready" },
  } as unknown as GeoLayer;
}

const selection = {
  geoLayerId: "GEO",
  batchId: 4,
  stableFeatureId: "id:string:z1",
  properties: { zone: "A" },
};

describe("refreshedGeoSelection", () => {
  it("keeps the selection and REFRESHES it after a property merge", () => {
    const before = layerWith(prepared);
    const merged = mergeGeoDocumentProperties(
      prepared,
      new Map([["id:string:z1", { bld_buildings_n: 3 }]]),
    );
    const after = layerWith(merged);
    expect(
      refreshedGeoSelection({
        selection,
        layer: after,
        previousConfig: before.config,
      }),
    ).toEqual({
      ...selection,
      properties: { zone: "A", bld_buildings_n: 3 },
    });
  });

  it("returns the SAME object when the config did not move", () => {
    const layer = layerWith(prepared);
    expect(
      refreshedGeoSelection({
        selection,
        layer,
        previousConfig: layer.config,
      }),
    ).toBe(selection);
  });

  it("drops it when the layer is gone, or is not a GeoJSON layer", () => {
    expect(
      refreshedGeoSelection({
        selection,
        layer: undefined,
        previousConfig: null,
      }),
    ).toBeNull();
  });

  it("drops it when the DOCUMENT was replaced, which is the original rule", () => {
    const relinked = {
      ...layerWith(prepared),
      config: {
        data: { type: "FeatureCollection", features: [] },
        preparedData: normalizeGeoJsonDocument({
          type: "FeatureCollection",
          features: [],
        }).data,
        preparation: "ready",
      },
    } as unknown as GeoLayer;
    expect(
      refreshedGeoSelection({
        selection,
        layer: relinked,
        previousConfig: layerWith(prepared).config,
      }),
    ).toBeNull();
  });

  it("drops it when the feature itself is no longer in the document", () => {
    const without = layerWith(
      normalizeGeoJsonDocument({ type: "FeatureCollection", features: [] })
        .data,
    );
    expect(
      refreshedGeoSelection({
        selection,
        layer: { ...without, config: { ...without.config, data } } as GeoLayer,
        previousConfig: layerWith(prepared).config,
      }),
    ).toBeNull();
  });
});
```

Append to the `describe("StyleSection — a vector layer's Color by attribute")` block of `tests/unit/ui/layers/StyleSection.test.tsx`, using that block's own helpers — `addParcels()` (three inline features, none with a feature `id`, so `normalizeGeoJsonDocument` mints `index:0`…`index:2`), `<GeoHost id={…} />`, `attributeSelect()` and `readStyle(id)`:

```tsx
it("offers a computed property and colours by its real values (§7.6)", () => {
  const id = addParcels();
  useGeoLayerStore.getState().mergeGeoFeatureProperties(
    id,
    new Map([
      ["index:0", { bld_buildings_n: 3 }],
      ["index:1", { bld_buildings_n: 7 }],
      ["index:2", { bld_buildings_n: 3 }],
    ]),
  );
  render(<GeoHost id={id} />);

  // The select reads the PREPARED document, so the run's column is offered —
  // and the renderer's own envelope key still never is.
  expect([...attributeSelect().options].map((o) => o.textContent)).toEqual([
    "None",
    "zone",
    "name",
    "bld_buildings_n",
  ]);

  fireEvent.change(attributeSelect(), { target: { value: "bld_buildings_n" } });

  // The VALUES, not an empty list: `categoriesFor` read the prepared document
  // too. Without that half, §7.6's Style by result would open Color by
  // attribute on a column whose categories are empty.
  expect(readStyle(id).colorByAttribute).toEqual({
    attribute: "bld_buildings_n",
    categories: [
      { value: "3", color: CATEGORY_PALETTE_HEX[0] },
      { value: "7", color: CATEGORY_PALETTE_HEX[1] },
    ],
  });
});
```

- [ ] **Step 8: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features tests/unit/ui
npx tsc -b --noEmit
npx vp check
```

Expected: PASS, `tsc` clean, `vp check` at the baseline.

- [ ] **Step 9: Commit**

```bash
git add src/features/geoLayers/geoLayerStore.ts src/features/geoLayers/geoJsonRecords.ts \
  src/features/geoLayers/geoSelectionRefresh.ts src/features/processing/runQueue.ts \
  src/ui/table/GeoRecordsPanel.tsx src/ui/details/GeoFeatureDetails.tsx \
  src/ui/layers/GeoStyleControls.tsx src/app/App.tsx \
  tests/unit/features/geoLayers/mergeGeoProperties.test.ts \
  tests/unit/features/geoLayers/geoSelectionRefresh.test.ts \
  tests/unit/features/geoLayers/geoExport.test.ts \
  tests/unit/ui/table/geoComputedBadge.test.tsx \
  tests/unit/ui/layers/StyleSection.test.tsx \
  tests/unit/features/processing/crossLayerRun.test.ts
git commit -m "feat: a vector layer's computed properties behave like any other attribute"
```

---
