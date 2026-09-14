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
  mergeGeoDocumentProperties,
  restoreGeoDocumentProperties,
  useGeoLayerStore,
  type GeoJsonLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import {
  geoRecordId,
  geoRecords,
} from "../../../../src/features/geoLayers/geoRecords";

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

/** The layer, NARROWED once — a repeated `layers[0]` read neither keeps the
 *  union narrowing nor proves the element is there. */
function geoLayer(id: string): GeoJsonLayer {
  const layer = useGeoLayerStore.getState().layers.find((l) => l.id === id);
  if (layer === undefined || layer.kind !== "geojson") {
    throw new Error(`no GeoJSON layer ${id}`);
  }
  return layer;
}

function prepared(id: string): unknown {
  return geoLayer(id).config.preparedData;
}

function stableIds(id: string): ReadonlyArray<string> {
  return geoRecords(prepared(id)).map(geoRecordId);
}

/** Every DISTINCT config the layer wore while `run` executed. One entry is
 *  "replaced exactly once" — `geoLayerSync.ts` rebuilds the engine pair on
 *  config identity, so a `set` per feature would show up as two. */
function configTransitions(
  id: string,
  run: () => void,
): ReadonlyArray<unknown> {
  const read = () => {
    const layer = useGeoLayerStore.getState().layers.find((l) => l.id === id);
    return layer?.kind === "geojson" ? layer.config : undefined;
  };
  // SEEDED with the config the layer already wears: zustand notifies on every
  // `set`, including one whose reducer returned the same array, so an empty
  // start would count a no-op as a transition.
  let last = read();
  const seen: unknown[] = [];
  const unsubscribe = useGeoLayerStore.subscribe(() => {
    const config = read();
    if (config !== undefined && config !== last) {
      seen.push(config);
      last = config;
    }
  });
  run();
  unsubscribe();
  return seen;
}

/** The record's own STRING keys: `{ x: undefined }` still HAS the key, and the
 *  grid and the export would both still list it. */
function keysOf(record: Readonly<Record<string, unknown>> | undefined) {
  return Object.keys(record ?? {});
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
    const records = geoRecords(prepared(id));
    expect(records[0]).toMatchObject({ zone: "A", bld_buildings_n: 3 });
    expect(records[1]).toEqual(
      expect.not.objectContaining({ bld_buildings_n: 3 }),
    );
    expect(second).not.toBe(first);
  });

  it("replaces the CONFIG exactly once, so the engine rebuilds once", () => {
    const id = addZones();
    const before = geoLayer(id);
    const ids = stableIds(id);
    // BOTH features written, and the store must still publish ONE new config.
    const transitions = configTransitions(id, () =>
      useGeoLayerStore
        .getState()
        .mergeGeoFeatureProperties(
          id,
          new Map(ids.map((sid, i) => [sid, { bld_buildings_n: i }])),
        ),
    );
    expect(transitions).toHaveLength(1);
    const after = geoLayer(id);
    expect(transitions[0]).toBe(after.config);
    expect(after).not.toBe(before);
    expect(after.config).not.toBe(before.config);
    // The style and the visibility are untouched, so the reconciler takes the
    // cheap path for everything but the document.
    expect(after.style).toBe(before.style);
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

  it("leaves the PREPARED input it was handed exactly as it was", () => {
    // Purity over the document the callers actually pass — the prepared clone,
    // envelope and all. Task 23 hands the PARENT's `preparedData` to the same
    // function to build a derived layer from, so a mutation here would edit a
    // layer nobody asked it to touch.
    const id = addZones();
    const input = prepared(id);
    const snapshot = JSON.stringify(input);
    const merged = mergeGeoDocumentProperties(
      input,
      new Map([[stableIds(id)[0]!, { bld_buildings_n: 3 }]]),
    );
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(merged).not.toBe(input);
    expect(geoRecords(merged)[0]).toMatchObject({ bld_buildings_n: 3 });
    // The features that did NOT change keep their identity, so the merge is
    // copy-on-write rather than a clone of the whole document.
    const source = input as { features: ReadonlyArray<unknown> };
    const after = merged as { features: ReadonlyArray<unknown> };
    expect(after.features[1]).toBe(source.features[1]);
    expect(after.features[0]).not.toBe(source.features[0]);
  });

  it("ignores a stable id the layer does not have", () => {
    const id = addZones();
    const before = geoLayer(id);
    const transitions = configTransitions(id, () =>
      useGeoLayerStore
        .getState()
        .mergeGeoFeatureProperties(id, new Map([["index:99", { x: 1 }]])),
    );
    // No feature changed, so nothing is replaced and the engine is not touched.
    expect(transitions).toHaveLength(0);
    expect(geoLayer(id)).toBe(before);
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
    return prepared(id);
  }

  it("undoes ONE run's columns and leaves the other run's alone", () => {
    // The bug a whole-document snapshot has: undoing the count would take the
    // sum with it, while the sum's run still says "undoable".
    const id = addZones();
    const [first] = stableIds(id);
    const document = afterTwoRuns(id);
    const snapshot = JSON.stringify(document);
    const undoneA = restoreGeoDocumentProperties(
      document,
      new Map([[first!, { count_n: GEO_PROPERTY_ABSENT }]]),
    );
    expect(geoRecords(undoneA)[0]).toMatchObject({ zone: "A", sum_m2: 90 });
    // The KEY is gone, not set to `undefined`.
    expect(keysOf(geoRecords(undoneA)[0])).not.toContain("count_n");
    // And the other order undoes the sum, leaving the count — from the SAME
    // document, which is what makes the two Undos independent.
    const undoneB = restoreGeoDocumentProperties(
      document,
      new Map([[first!, { sum_m2: GEO_PROPERTY_ABSENT }]]),
    );
    expect(geoRecords(undoneB)[0]).toMatchObject({ count_n: 3 });
    expect(keysOf(geoRecords(undoneB)[0])).not.toContain("sum_m2");
    // Neither call touched the input it was handed.
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  it("restores a REPLACED value rather than removing the property", () => {
    const id = addZones();
    const [first] = stableIds(id);
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([[first!, { zone: "Z" }]]));
    const restored = restoreGeoDocumentProperties(
      prepared(id),
      new Map([[first!, { zone: "A" }]]),
    );
    expect(geoRecords(restored)[0]).toMatchObject({ zone: "A" });
  });

  it("is null when it would change nothing, so the engine is not rebuilt", () => {
    const id = addZones();
    expect(
      restoreGeoDocumentProperties(
        prepared(id),
        new Map([["index:99", { count_n: GEO_PROPERTY_ABSENT }]]),
      ),
    ).toBeNull();
  });
});

describe("replaceGeoPreparedData", () => {
  it("puts the previous document back, whole — §6.2's Undo for a vector run", () => {
    const id = addZones();
    const original = prepared(id);
    useGeoLayerStore
      .getState()
      .mergeGeoFeatureProperties(id, new Map([[stableIds(id)[0]!, { x: 1 }]]));
    useGeoLayerStore.getState().replaceGeoPreparedData(id, original);
    expect(keysOf(geoRecords(prepared(id))[0])).not.toContain("x");
  });
});
