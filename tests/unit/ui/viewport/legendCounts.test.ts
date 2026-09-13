import { describe, expect, it } from "vitest";
import type {
  CityModel,
  Surface,
} from "../../../../src/domain/citymodel/types";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import { normalizeGeoJsonDocument } from "../../../../src/features/geoLayers/geoJsonRecords";
import {
  countedLegendGroups,
  geoLegendCounts,
} from "../../../../src/ui/viewport/legendCounts";
import {
  CATEGORY_OTHER_HEX,
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

function surface(type: Surface["type"], slope = 0): Surface {
  return {
    type,
    rings: [
      [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, Math.tan((slope * Math.PI) / 180) * 10],
      ],
    ],
    attributes: {},
    lod: "2",
  };
}

const model: CityModel = {
  sourceEncoding: "cityjson",
  metadata: {},
  bbox: null,
  vertexCount: 0,
  objects: {
    building: {
      id: "building",
      objectType: "Building",
      attributes: {},
      bbox: null,
      children: [],
      parents: [],
      lod: "2",
      surfaces: [
        surface("RoofSurface", 5),
        surface("RoofSurface", 60),
        surface("WallSurface"),
        surface("GroundSurface"),
      ],
    },
  },
};

function city(patch: Partial<Layer> = {}): Layer {
  return {
    id: "city",
    name: "City",
    model,
    modelRef: { type: "url", url: "https://x/city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    singleColor: SINGLE_COLOR_HEX,
    unmatchedColor: UNMATCHED_COLOR_HEX,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    derivedFrom: null,
    isStreaming: false,
    ...patch,
  };
}

function counts(layer: Layer) {
  return countedLegendGroups([layer], [], new Map(), new Map())[0]!.rows.map(
    (row) => row.count,
  );
}

describe("legend surface counts", () => {
  it("counts static semantic surfaces rather than buildings", () => {
    expect(counts(city())).toEqual([2, 1, 1, 0]);
    expect(counts(city({ colorBy: "single" }))).toEqual([4]);
  });

  it("assigns overlapping roof rules only to the first match and leaves unmatched roofs", () => {
    const layer = city({
      colorBy: "rules",
      rules: [
        {
          id: "first",
          name: "Any roof",
          color: "#111111",
          enabled: true,
          logic: "AND",
          conditions: [],
        },
        {
          id: "later",
          name: "Steep",
          color: "#222222",
          enabled: true,
          logic: "AND",
          conditions: [{ field: "inclinationDeg", operator: ">", value: 45 }],
        },
      ],
    });
    expect(counts(layer)).toEqual([2, 0, 0]);
  });

  it("marks streaming roof and rule counts unavailable when metrics are absent", () => {
    const layer = city({
      isStreaming: true,
      colorBy: "rules",
      rules: [
        {
          id: "r",
          name: "All",
          color: "#111",
          enabled: true,
          logic: "AND",
          conditions: [],
        },
      ],
    });
    const residents = new Map([
      [
        "city",
        {
          objects: {
            one: {
              id: "one",
              objectType: "Building",
              attributes: {},
              bbox: [0, 0, 0, 1, 1, 1] as [
                number,
                number,
                number,
                number,
                number,
                number,
              ],
              lod: null,
              surfaceCount: 1,
              roofMetrics: undefined,
              footprintAreaSqM: 0,
              volumeCuM: null,
              parents: [],
              children: [],
            },
          },
          cellCount: 1,
          featureCount: 1,
          surfaceAttrKeys: [],
        },
      ],
    ]);
    expect(
      countedLegendGroups(
        [layer],
        [],
        residents as never,
        new Map(),
      )[0]!.rows.map((row) => row.count),
    ).toEqual([null, null]);
  });

  it("qualifies partial streaming counts and never invents wall or ground values", () => {
    const layer = city({ isStreaming: true, colorBy: "surface" });
    const residents = new Map([
      [
        "city",
        {
          objects: {
            one: {
              id: "one",
              objectType: "Building",
              attributes: {},
              bbox: [0, 0, 0, 1, 1, 1] as [
                number,
                number,
                number,
                number,
                number,
                number,
              ],
              lod: null,
              surfaceCount: 3,
              roofMetrics: [
                {
                  areaSqM: 1,
                  inclinationDeg: 20,
                  azimuthDeg: 0,
                  elevationM: 0,
                  lod: "2.2",
                },
              ],
              geometryLods: ["2.2"],
              footprintAreaSqM: 0,
              volumeCuM: null,
              parents: [],
              children: [],
            },
          },
          cellCount: 1,
          featureCount: 1,
          surfaceAttrKeys: [],
        },
      ],
    ]);
    const rows = countedLegendGroups([layer], [], residents, new Map())[0]!
      .rows;
    expect(rows.map((row) => row.count)).toEqual([1, null, null, null]);
    expect(rows.every((row) => row.currentlyLoaded)).toBe(true);
  });
});

describe("vector legend categories", () => {
  it("counts features in renderer categories and supports an allowed-ID scope", () => {
    const geo: Extract<GeoLayer, { kind: "geojson" }> = {
      id: "geo",
      name: "Parcels",
      visible: true,
      opacity: 1,
      kind: "geojson",
      config: { data: null },
      style: {
        color: "#000000",
        pointSizePx: 1,
        lineWidthPx: 1,
        fillOpacity: 1,
        colorByAttribute: {
          attribute: "zone",
          categories: [
            { value: "A", color: "#111111" },
            { value: null, color: CATEGORY_OTHER_HEX },
          ],
        },
      },
    };
    const source = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "a", properties: { zone: "A" }, geometry: null },
        { type: "Feature", id: "b", properties: { zone: "B" }, geometry: null },
        { type: "Feature", id: "c", properties: {}, geometry: null },
      ],
    };
    const prepared = normalizeGeoJsonDocument(source);
    // Legend filtering follows renderer-facing stable ids, not mutable source
    // `Feature.id` values. The initial category totals remain unscoped.
    expect(geoLegendCounts(geo, prepared.data)).toEqual([1, 2]);
    expect(
      geoLegendCounts(
        geo,
        prepared.data,
        new Set([prepared.featureIds[0]!, prepared.featureIds[1]!]),
      ),
    ).toEqual([1, 1]);
    // Clearing the scope restores the complete typed-category totals.
    expect(geoLegendCounts(geo, prepared.data)).toEqual([1, 2]);
  });
});
