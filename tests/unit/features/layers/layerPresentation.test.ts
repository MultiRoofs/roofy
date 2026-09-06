import { describe, it, expect } from "vitest";
import {
  layerKindOf,
  layerStateLine,
  pluralize,
  countRootObjects,
  type LayerStateInput,
} from "../../../../src/features/layers/layerPresentation";
import type { ActiveLayer } from "../../../../src/features/workspace/activeLayer";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import type {
  CityModel,
  CityObject,
} from "../../../../src/domain/citymodel/types";

function cityObject(
  overrides: Partial<CityObject> & { id: string },
): CityObject {
  return {
    objectType: "Building",
    surfaces: [],
    attributes: {},
    children: [],
    parents: [],
    bbox: null,
    lod: null,
    ...overrides,
  } as CityObject;
}

function cityLayer(overrides: Partial<Layer> = {}): ActiveLayer {
  return {
    kind: "city",
    layer: { isStreaming: false, ...overrides } as unknown as Layer,
  };
}

function geoLayer(kind: GeoLayer["kind"]): ActiveLayer {
  return { kind: "geo", layer: { kind } as unknown as GeoLayer };
}

describe("layerKindOf", () => {
  it("classifies a non-streaming city layer as city", () => {
    expect(layerKindOf(cityLayer({ isStreaming: false }))).toBe("city");
  });

  it("classifies a streaming city layer as streaming", () => {
    expect(layerKindOf(cityLayer({ isStreaming: true }))).toBe("streaming");
  });

  it("classifies a geojson layer as vector", () => {
    expect(layerKindOf(geoLayer("geojson"))).toBe("vector");
  });

  it("classifies a raster-xyz layer as raster", () => {
    expect(layerKindOf(geoLayer("raster-xyz"))).toBe("raster");
  });

  it("classifies a 3d-tiles layer as tiles", () => {
    expect(layerKindOf(geoLayer("3d-tiles"))).toBe("tiles");
  });
});

describe("pluralize", () => {
  it("keeps the unit singular for 1", () => {
    expect(pluralize(1, "building")).toBe("1 building");
  });

  it("pluralizes for anything else, with grouping", () => {
    expect(pluralize(2, "building")).toBe("2 buildings");
    expect(pluralize(1204, "building")).toBe("1,204 buildings");
  });
});

describe("countRootObjects", () => {
  it("counts only root objects, and buildings as a Building-typed subset", () => {
    const model = {
      objects: {
        b1: cityObject({ id: "b1", objectType: "Building", children: ["bp1"] }),
        bp1: cityObject({
          id: "bp1",
          objectType: "BuildingPart",
          parents: ["b1"],
        }),
        br1: cityObject({ id: "br1", objectType: "Bridge" }),
      },
      metadata: { referenceSystem: undefined },
      bbox: null,
    } as unknown as CityModel;

    expect(countRootObjects(model)).toEqual({ buildings: 1, objects: 2 });
  });
});

describe("layerStateLine", () => {
  it('reads "N buildings · LoD X" when every root object is a Building', () => {
    const input: LayerStateInput = {
      kind: "city",
      counts: { buildings: 1204, objects: 1204 },
      lod: "2.2",
    };
    expect(layerStateLine(input)).toBe("1,204 buildings · LoD 2.2");
  });

  it('reads "N objects · LoD X" when root objects include non-Buildings', () => {
    const input: LayerStateInput = {
      kind: "city",
      counts: { buildings: 900, objects: 2231 },
      lod: "2.2",
    };
    expect(layerStateLine(input)).toBe("2,231 objects · LoD 2.2");
  });

  it('reads "Streaming · N currently loaded" for a resident count', () => {
    const input: LayerStateInput = {
      kind: "streaming",
      residentCount: 1240,
      streamStatus: "idle",
    };
    expect(layerStateLine(input)).toBe("Streaming · 1,240 currently loaded");
  });

  it('reads "Streaming · fetching…" while fetching with no count yet', () => {
    const input: LayerStateInput = {
      kind: "streaming",
      streamStatus: "fetching",
    };
    expect(layerStateLine(input)).toBe("Streaming · fetching…");
  });

  it('reads "6 features" for an inline vector layer', () => {
    const input: LayerStateInput = { kind: "vector", featureCount: 6 };
    expect(layerStateLine(input)).toBe("6 features");
  });

  it('reads "GeoJSON" for a URL-sourced vector layer with no known feature count', () => {
    expect(layerStateLine({ kind: "vector" })).toBe("GeoJSON");
  });

  it('reads "Raster" for a raster layer', () => {
    expect(layerStateLine({ kind: "raster" })).toBe("Raster");
  });

  it('reads "3D Tiles" for a tiles layer', () => {
    expect(layerStateLine({ kind: "tiles" })).toBe("3D Tiles");
  });

  it('reads "Error · <message>" when an error is present, for any kind', () => {
    const input: LayerStateInput = {
      kind: "vector",
      error: "could not parse",
    };
    expect(layerStateLine(input)).toBe("Error · could not parse");
  });

  it('reads "Needs re-link" for an unavailable placeholder, for any kind', () => {
    const input: LayerStateInput = { kind: "raster", unavailable: true };
    expect(layerStateLine(input)).toBe("Needs re-link");
  });

  it("prefers an error over an unavailable placeholder when both are set", () => {
    const input: LayerStateInput = {
      kind: "raster",
      unavailable: true,
      error: "x",
    };
    expect(layerStateLine(input)).toBe("Error · x");
  });

  it('reuses the too-far guidance sentence verbatim after "Streaming · "', () => {
    const input: LayerStateInput = {
      kind: "streaming",
      streamStatus: "too-far",
    };
    expect(layerStateLine(input)).toBe("Streaming · Zoom in to load features");
  });
});
