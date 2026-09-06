/**
 * The geospatial-layer store: what it defaults, what it replaces, and what it
 * refuses to touch.
 *
 * IDENTITY is the load-bearing property here, not just the values: the scene
 * reconciler (`geoLayerSync.ts`) decides "rebuild the pair" from
 * `config` identity and "push a new description" from the record's own fields,
 * so an edit that mutated a record in place — or replaced one it did not need
 * to — would either miss a change or tear a live layer down for nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GEO_LAYER_OPACITY,
  isGeoLayerUnavailable,
  useGeoLayerStore,
  type GeoLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { DEFAULT_GEO_LAYER_STYLE } from "../../../../src/features/geoLayers/geoLayerStyle";

afterEach(() => {
  useGeoLayerStore.setState({ layers: [] });
});

const store = () => useGeoLayerStore.getState();

function addRaster(name = "XYZ"): string {
  return store().addGeoLayer({
    name,
    kind: "raster-xyz",
    config: { urlTemplate: "https://tiles.example/{z}/{x}/{y}.png" },
  });
}

it("does not carry an active id (the workspace store owns it)", () => {
  expect("activeGeoLayerId" in useGeoLayerStore.getState()).toBe(false);
});

describe("addGeoLayer", () => {
  it("appends a layer with a unique id, visible and fully opaque by default", () => {
    const first = addRaster("A");
    const second = addRaster("B");

    const { layers } = store();
    expect(layers.map((l) => l.name)).toEqual(["A", "B"]);
    expect(first).not.toBe(second);
    expect(layers[0]!.visible).toBe(true);
    expect(layers[0]!.opacity).toBe(DEFAULT_GEO_LAYER_OPACITY);
  });

  it("honours an explicit visibility and opacity", () => {
    const id = store().addGeoLayer({
      name: "faded",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tiles.example/{z}/{x}/{y}.png" },
      visible: false,
      opacity: 0.25,
    });

    const layer = store().layers.find((l) => l.id === id)!;
    expect(layer.visible).toBe(false);
    expect(layer.opacity).toBe(0.25);
  });

  it("clamps an out-of-range opacity into [0, 1]", () => {
    const low = store().addGeoLayer({
      name: "low",
      kind: "3d-tiles",
      config: { url: "https://x/tileset.json" },
      opacity: -3,
    });
    const high = store().addGeoLayer({
      name: "high",
      kind: "3d-tiles",
      config: { url: "https://x/tileset.json" },
      opacity: 12,
    });

    const byId = (id: string) => store().layers.find((l) => l.id === id)!;
    expect(byId(low).opacity).toBe(0);
    expect(byId(high).opacity).toBe(1);
  });

  it("gives a layer added without a style the shared default", () => {
    addRaster("A");

    expect(store().layers[0]!.style).toEqual(DEFAULT_GEO_LAYER_STYLE);
  });

  it("keeps an explicit, valid style verbatim", () => {
    const style = {
      color: "#00aaff",
      pointSizePx: 8,
      lineWidthPx: 5,
      fillOpacity: 0.4,
    };
    const id = store().addGeoLayer({
      name: "styled",
      kind: "geojson",
      config: { url: "https://x/a.geojson" },
      style,
    });

    expect(store().layers.find((l) => l.id === id)!.style).toEqual(style);
  });

  it("NORMALIZES a style on add — these values reach the engine, and a restored snapshot is not the only caller", () => {
    const id = store().addGeoLayer({
      name: "junk",
      kind: "geojson",
      config: { url: "https://x/a.geojson" },
      style: {
        color: "nope",
        pointSizePx: -3,
        lineWidthPx: Number.POSITIVE_INFINITY,
        fillOpacity: 2,
      } as unknown as GeoLayer["style"],
    });

    expect(store().layers.find((l) => l.id === id)!.style).toEqual({
      ...DEFAULT_GEO_LAYER_STYLE,
      fillOpacity: 1,
    });
  });
});

describe("removeGeoLayer", () => {
  it("removes only the named layer", () => {
    const a = addRaster("A");
    addRaster("B");

    store().removeGeoLayer(a);

    expect(store().layers.map((l) => l.name)).toEqual(["B"]);
  });

  it("leaves the array identity alone for an unknown id", () => {
    addRaster("A");
    const before = store().layers;

    store().removeGeoLayer("nope");

    expect(store().layers).toBe(before);
  });

  it("removeAllGeoLayers empties the list", () => {
    addRaster("A");
    addRaster("B");

    store().removeAllGeoLayers();

    expect(store().layers).toEqual([]);
  });
});

describe("updateGeoLayer", () => {
  it("REPLACES the edited record and leaves its neighbours identical", () => {
    const a = addRaster("A");
    addRaster("B");
    const before = store().layers;

    store().updateGeoLayer(a, { visible: false });

    const after = store().layers;
    expect(after).not.toBe(before);
    expect(after[0]).not.toBe(before[0]);
    expect(after[0]!.visible).toBe(false);
    // The untouched neighbour keeps its identity, so a reconciler memoised on
    // record identity does not re-push it.
    expect(after[1]).toBe(before[1]);
  });

  it("renames, and clamps an opacity edit", () => {
    const a = addRaster("A");

    store().updateGeoLayer(a, { name: "Renamed", opacity: 2 });

    const layer = store().layers[0]!;
    expect(layer.name).toBe("Renamed");
    expect(layer.opacity).toBe(1);
  });

  it("keeps the config OBJECT identical across a visibility edit", () => {
    const a = addRaster("A");
    const configBefore = store().layers[0]!.config;

    store().updateGeoLayer(a, { visible: false });

    // The reconciler rebuilds the source+layer pair when this identity moves,
    // so a visibility toggle must never disturb it.
    expect(store().layers[0]!.config).toBe(configBefore);
  });

  it("is a no-op for an unknown id", () => {
    addRaster("A");
    const before = store().layers;

    store().updateGeoLayer("nope", { visible: false });

    expect(store().layers).toBe(before);
  });

  it("REPLACES the style object wholesale, normalizing it, and touches no neighbour", () => {
    const a = addRaster("A");
    addRaster("B");
    const before = store().layers;

    store().updateGeoLayer(a, {
      style: {
        color: "#00aaff",
        pointSizePx: 8,
        lineWidthPx: -1,
        fillOpacity: 5,
      } as unknown as GeoLayer["style"],
    });

    const after = store().layers;
    expect(after[0]!.style).not.toBe(before[0]!.style);
    expect(after[0]!.style).toEqual({
      color: "#00aaff",
      pointSizePx: 8,
      lineWidthPx: DEFAULT_GEO_LAYER_STYLE.lineWidthPx,
      fillOpacity: 1,
    });
    // The other layer's style object is the very one it had, so a reconciler
    // memoised on style identity leaves it alone.
    expect(after[1]!.style).toBe(before[1]!.style);
  });

  it("keeps the style OBJECT identical across a patch that does not mention it", () => {
    const a = addRaster("A");
    const styleBefore = store().layers[0]!.style;

    store().updateGeoLayer(a, { visible: false });

    expect(store().layers[0]!.style).toBe(styleBefore);
  });
});

describe("relinkGeoJsonLayer", () => {
  const data = { type: "FeatureCollection", features: [] };

  it("gives an unavailable GeoJSON layer a new inline document", () => {
    const id = store().addGeoLayer({
      name: "restored",
      kind: "geojson",
      config: {},
    });
    expect(isGeoLayerUnavailable(store().layers[0] as GeoLayer)).toBe(true);

    store().relinkGeoJsonLayer(id, data);

    const layer = store().layers[0]!;
    expect(layer.config).toEqual({ data });
    expect(isGeoLayerUnavailable(layer)).toBe(false);
  });

  it("refuses to rewrite a layer of another kind", () => {
    const id = addRaster("A");
    const before = store().layers;

    store().relinkGeoJsonLayer(id, data);

    expect(store().layers).toBe(before);
  });
});

describe("isGeoLayerUnavailable", () => {
  const base = {
    id: "g",
    name: "n",
    visible: true,
    opacity: 1,
    style: DEFAULT_GEO_LAYER_STYLE,
  } as const;

  it("is true only for a GeoJSON layer with neither inline data nor a URL", () => {
    expect(
      isGeoLayerUnavailable({ ...base, kind: "geojson", config: {} }),
    ).toBe(true);
    expect(
      isGeoLayerUnavailable({
        ...base,
        kind: "geojson",
        config: { url: "https://x/a.geojson" },
      }),
    ).toBe(false);
    expect(
      isGeoLayerUnavailable({
        ...base,
        kind: "geojson",
        config: { data: { type: "FeatureCollection", features: [] } },
      }),
    ).toBe(false);
    expect(
      isGeoLayerUnavailable({
        ...base,
        kind: "raster-xyz",
        config: { urlTemplate: "https://t/{z}/{x}/{y}.png" },
      }),
    ).toBe(false);
  });
});
