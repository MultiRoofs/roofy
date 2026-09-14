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

  it("drops it when a re-prepare bumped the epoch over the same data", () => {
    // `retryGeoJsonPreparation` keeps `data` and mints a new clone: the stable
    // ids are re-minted with it, so the old subject cannot be trusted.
    const before = layerWith(prepared);
    const reprepared = {
      ...before,
      config: { ...before.config, preparationEpoch: 1 },
    } as GeoLayer;
    expect(
      refreshedGeoSelection({
        selection,
        layer: reprepared,
        previousConfig: before.config,
      }),
    ).toBeNull();
  });

  it("drops a selection that carries no stable id at all", () => {
    const before = layerWith(prepared);
    const merged = mergeGeoDocumentProperties(
      prepared,
      new Map([["id:string:z1", { bld_buildings_n: 3 }]]),
    );
    expect(
      refreshedGeoSelection({
        selection: { ...selection, stableFeatureId: undefined },
        layer: layerWith(merged),
        previousConfig: before.config,
      }),
    ).toBeNull();
  });
});
