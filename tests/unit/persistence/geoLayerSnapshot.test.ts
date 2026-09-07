/**
 * Geospatial layers across the save/restore round trip.
 *
 * The rule worth a test of its own: a file-loaded GeoJSON layer's INLINE
 * DOCUMENT is never persisted. A city extract is megabytes and localStorage is
 * a handful, so writing it would fail the whole save — and it is the same
 * reason a file-backed city model comes back as a row waiting for its file.
 * What survives is everything the user chose (name, kind, visibility,
 * opacity), which is what makes re-linking worth offering.
 */
import { describe, expect, it } from "vitest";
import {
  geoLayerSnapshot,
  normalizeGeoLayers,
  type GeoLayerSnapshot,
} from "../../../src/persistence/types";
import { captureSnapshot } from "../../../src/persistence/captureSnapshot";
import type { GeoLayer } from "../../../src/features/geoLayers/geoLayerStore";
import {
  DEFAULT_GEO_LAYER_STYLE,
  type GeoLayerStyle,
} from "../../../src/features/geoLayers/geoLayerStyle";

const CUSTOM_STYLE: GeoLayerStyle = {
  color: "#00c2ff",
  pointSizePx: 8,
  lineWidthPx: 5,
  fillOpacity: 0.35,
};

/** A layer the user recoloured per attribute: the categories are as much a
 *  user choice as the base colour, so they ride the same snapshot field. */
const CATEGORIZED_STYLE: GeoLayerStyle = {
  ...DEFAULT_GEO_LAYER_STYLE,
  colorByAttribute: {
    attribute: "zone",
    categories: [
      { value: "residential", color: "#8fd020" },
      { value: "retail", color: "#4b8ef7" },
      { value: null, color: "#8a93a0" },
    ],
  },
};

const CAMERA = {
  lng: 4.35,
  lat: 52.01,
  height: 800,
  heading: 0,
  pitch: -60,
  roll: 0,
};

function capture(geoLayers?: ReadonlyArray<GeoLayerSnapshot>) {
  return captureSnapshot({
    label: "test",
    layers: [],
    camera: CAMERA,
    datetime: new Date("2026-08-05T12:00:00Z"),
    pickMode: "object",
    ...(geoLayers === undefined ? {} : { geoLayers }),
  });
}

describe("geoLayerSnapshot", () => {
  it("drops the inline GeoJSON document but keeps every choice around it", () => {
    const layer: GeoLayer = {
      id: "g1",
      name: "parcels",
      kind: "geojson",
      visible: false,
      opacity: 0.6,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { data: { type: "FeatureCollection", features: [] } },
    };

    expect(geoLayerSnapshot(layer)).toEqual({
      name: "parcels",
      kind: "geojson",
      visible: false,
      opacity: 0.6,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: {},
    });
  });

  it("writes the layer's own style, which is a user choice like any other", () => {
    const layer: GeoLayer = {
      id: "g1",
      name: "parcels",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: CUSTOM_STYLE,
      config: { url: "https://x/parcels.geojson" },
    };

    expect(geoLayerSnapshot(layer).style).toEqual(CUSTOM_STYLE);
  });

  it("keeps a GeoJSON URL, which costs nothing and restores completely", () => {
    const layer: GeoLayer = {
      id: "g1",
      name: "roads",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { url: "https://x/roads.geojson" },
    };

    expect(geoLayerSnapshot(layer).config).toEqual({
      url: "https://x/roads.geojson",
    });
  });

  it("keeps a raster template with its tile bounds", () => {
    const layer: GeoLayer = {
      id: "r1",
      name: "osm",
      kind: "raster-xyz",
      visible: true,
      opacity: 0.5,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: {
        urlTemplate: "https://t/{z}/{x}/{y}.png",
        minZoom: 1,
        maxZoom: 19,
        tms: false,
      },
    };

    expect(geoLayerSnapshot(layer).config).toEqual(layer.config);
  });
});

describe("normalizeGeoLayers", () => {
  it("round-trips a URL-backed layer into an addGeoLayer input", () => {
    const layer: GeoLayer = {
      id: "r1",
      name: "osm",
      kind: "raster-xyz",
      visible: false,
      opacity: 0.25,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { urlTemplate: "https://t/{z}/{x}/{y}.png" },
    };

    expect(normalizeGeoLayers([geoLayerSnapshot(layer)])).toEqual([
      {
        name: "osm",
        kind: "raster-xyz",
        visible: false,
        opacity: 0.25,
        style: DEFAULT_GEO_LAYER_STYLE,
        config: { urlTemplate: "https://t/{z}/{x}/{y}.png" },
      },
    ]);
  });

  it("carries a custom style all the way back out of the round trip", () => {
    const layer: GeoLayer = {
      id: "g1",
      name: "roads",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: CUSTOM_STYLE,
      config: { url: "https://x/roads.geojson" },
    };

    // Through JSON, the way a snapshot store actually stores it.
    const saved = JSON.parse(
      JSON.stringify(geoLayerSnapshot(layer)),
    ) as unknown;

    expect(normalizeGeoLayers([saved])[0]?.style).toEqual(CUSTOM_STYLE);
  });

  it("round-trips a colorByAttribute without a schema bump", () => {
    const layer: GeoLayer = {
      id: "g1",
      name: "parcels",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: CATEGORIZED_STYLE,
      config: { url: "https://x/parcels.geojson" },
    };

    // The FULL path a workspace save takes: capture -> JSON -> restore.
    const snapshot = capture([geoLayerSnapshot(layer)]);
    const reread = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;

    expect(normalizeGeoLayers(reread.geoLayers)[0]?.style).toEqual(
      CATEGORIZED_STYLE,
    );
  });

  it("drops a hand-edited colorByAttribute rather than a whole layer", () => {
    const [restored] = normalizeGeoLayers([
      {
        name: "parcels",
        kind: "geojson",
        visible: true,
        opacity: 1,
        style: {
          color: "#00c2ff",
          colorByAttribute: { attribute: 5, categories: "junk" },
        },
        config: { url: "https://x/parcels.geojson" },
      },
    ]);

    expect(restored).toEqual({
      name: "parcels",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_GEO_LAYER_STYLE, color: "#00c2ff" },
      config: { url: "https://x/parcels.geojson" },
    });
  });

  it("defaults the style of a snapshot saved before styles existed", () => {
    const [restored] = normalizeGeoLayers([
      {
        name: "osm",
        kind: "raster-xyz",
        visible: true,
        opacity: 1,
        config: { urlTemplate: "https://t/{z}/{x}/{y}.png" },
      },
    ]);

    expect(restored?.style).toEqual(DEFAULT_GEO_LAYER_STYLE);
  });

  it("repairs a hand-edited style per field, keeping the layer", () => {
    const [restored] = normalizeGeoLayers([
      {
        name: "roads",
        kind: "geojson",
        visible: true,
        opacity: 1,
        style: { color: 5, lineWidthPx: 7 },
        config: { url: "https://x/roads.geojson" },
      },
    ]);

    expect(restored).toEqual({
      name: "roads",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: { ...DEFAULT_GEO_LAYER_STYLE, lineWidthPx: 7 },
      config: { url: "https://x/roads.geojson" },
    });
  });

  it("restores a file-loaded GeoJSON layer as an empty, re-linkable record", () => {
    const layer: GeoLayer = {
      id: "g1",
      name: "parcels",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { data: { type: "FeatureCollection", features: [] } },
    };

    const [restored] = normalizeGeoLayers([geoLayerSnapshot(layer)]);

    expect(restored).toEqual({
      name: "parcels",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: {},
    });
  });

  it("defaults an absent visibility and opacity", () => {
    const [restored] = normalizeGeoLayers([
      {
        name: "n",
        kind: "3d-tiles",
        config: { url: "https://x/tileset.json" },
      },
    ]);

    expect(restored).toMatchObject({ visible: true, opacity: 1 });
  });

  it("drops entries whose kind or config a hand-edited document broke", () => {
    expect(
      normalizeGeoLayers([
        { name: "n", kind: "wms", config: { url: "https://x" } },
        { name: "n", kind: "raster-xyz", config: {} },
        { name: "n", kind: "3d-tiles", config: {} },
        "not an object",
        null,
      ]),
    ).toEqual([]);
  });

  it("answers an empty list for an absent field", () => {
    expect(normalizeGeoLayers(undefined)).toEqual([]);
  });
});

describe("captureSnapshot — geoLayers", () => {
  it("omits the field entirely when there are none", () => {
    expect("geoLayers" in capture()).toBe(false);
    expect("geoLayers" in capture([])).toBe(false);
  });

  it("writes the layers it was given", () => {
    const snapshot = capture([
      {
        name: "osm",
        kind: "raster-xyz",
        visible: true,
        opacity: 1,
        config: { urlTemplate: "https://t/{z}/{x}/{y}.png" },
      },
    ]);

    expect(snapshot.geoLayers).toHaveLength(1);
    // ...and survives the JSON trip a snapshot store puts it through.
    const reread = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(normalizeGeoLayers(reread.geoLayers)).toHaveLength(1);
  });
});
