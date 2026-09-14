import { describe, it, expect } from "vitest";
import {
  countRootObjects,
  countRootObjectsByType,
  crsLabel,
  encodingLabel,
  epsgOf,
  extentLine,
  layerKindLine,
  layerKindOf,
  layerStateLine,
  pluralize,
  truncateMiddle,
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

function modelOf(sourceEncoding: CityModel["sourceEncoding"]): CityModel {
  return {
    sourceEncoding,
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  };
}

function modelWith(objects: ReadonlyArray<CityObject>): CityModel {
  return {
    ...modelOf("cityjson"),
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
  };
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

  it('reads "Streaming · probing…" while probing with no count yet', () => {
    const input: LayerStateInput = {
      kind: "streaming",
      streamStatus: "probing",
    };
    expect(layerStateLine(input)).toBe("Streaming · probing…");
  });

  it('reads "Loading…" for a static city layer with no counts and no LoD yet', () => {
    expect(layerStateLine({ kind: "city" })).toBe("Loading…");
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

describe("encodingLabel", () => {
  it("names every supported encoding the way its format does", () => {
    expect(encodingLabel("cityjson")).toBe("CityJSON");
    expect(encodingLabel("cityjsonseq")).toBe("CityJSONSeq");
    expect(encodingLabel("flatcitybuf")).toBe("FlatCityBuf");
    expect(encodingLabel("citygml")).toBe("CityGML");
    expect(encodingLabel("cityparquet")).toBe("CityParquet");
  });
});

describe("layerKindLine", () => {
  it("names a static city layer with the encoding its model was parsed from", () => {
    expect(
      layerKindLine(
        cityLayer({ isStreaming: false, model: modelOf("cityjson") }),
      ),
    ).toBe("City model · CityJSON");
  });

  it("says a streaming layer streams, and from what", () => {
    expect(
      layerKindLine(
        cityLayer({ isStreaming: true, model: modelOf("flatcitybuf") }),
      ),
    ).toBe("Streaming city model · FlatCityBuf");
  });

  it("names a vector layer's format", () => {
    expect(layerKindLine(geoLayer("geojson"))).toBe("Vector layer · GeoJSON");
  });

  it("names the two geo kinds that carry no second format word", () => {
    expect(layerKindLine(geoLayer("raster-xyz"))).toBe("Raster layer");
    expect(layerKindLine(geoLayer("3d-tiles"))).toBe("3D Tiles");
  });
});

describe("crsLabel", () => {
  it("reads an OGC CRS URI as one EPSG label", () => {
    expect(crsLabel("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(
      "EPSG:7415",
    );
  });

  it("does not double the authority a source already carries", () => {
    expect(crsLabel("EPSG:28992")).toBe("EPSG:28992");
  });

  it("is null when the layer names no reference system", () => {
    expect(crsLabel(undefined)).toBeNull();
    expect(crsLabel("")).toBeNull();
  });
});

describe("epsgOf", () => {
  it("reads the bare integer code", () => {
    expect(epsgOf("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(7415);
  });

  it("is null when there is no positive integer code to read", () => {
    expect(epsgOf(undefined)).toBeNull();
    expect(epsgOf("EPSG:wgs84")).toBeNull();
  });
});

describe("truncateMiddle", () => {
  it("leaves a string that already fits untouched", () => {
    expect(truncateMiddle("short.city.json", 40)).toBe("short.city.json");
  });

  it("keeps both ends of a long source, so the host AND the file survive", () => {
    const url =
      "https://data.3dbag.nl/v20240420/tiles/9/280/560/9-280-560.city.json";
    const out = truncateMiddle(url, 30);
    expect(out).toHaveLength(30);
    expect(out.startsWith("https://data.3")).toBe(true);
    expect(out.endsWith("560.city.json")).toBe(true);
    expect(out).toContain("…");
  });
});

describe("countRootObjectsByType", () => {
  it("groups ROOT objects by type, commonest first", () => {
    const model = modelWith([
      cityObject({ id: "b1" }),
      cityObject({ id: "b2" }),
      cityObject({ id: "r1", objectType: "Road" }),
      // A BuildingPart is not a second building: it has a parent, so it is
      // not a root and counts toward nothing.
      cityObject({ id: "p1", objectType: "BuildingPart", parents: ["b1"] }),
    ]);
    expect(countRootObjectsByType(model)).toEqual([
      { type: "Building", count: 2 },
      { type: "Road", count: 1 },
    ]);
  });

  it("breaks a tie on the type name, so the list has one stable order", () => {
    const model = modelWith([
      cityObject({ id: "r", objectType: "Road" }),
      cityObject({ id: "b", objectType: "Building" }),
    ]);
    expect(countRootObjectsByType(model).map((e) => e.type)).toEqual([
      "Building",
      "Road",
    ]);
  });
});

describe("extentLine", () => {
  it("reads the bbox corners and names the CRS they are in", () => {
    expect(
      extentLine([84616.2, 446548.5, 0, 85084.9, 447017.3, 24.6], "EPSG:7415"),
    ).toBe("84,616.2, 446,548.5 → 85,084.9, 447,017.3 (EPSG:7415)");
  });

  it("drops the parenthetical when the model names no CRS", () => {
    expect(extentLine([0, 0, 0, 1000, 1000, 10], null)).toBe(
      "0, 0 → 1,000, 1,000",
    );
  });

  it("keeps degrees readable: a small extent gets more decimals", () => {
    expect(extentLine([4.35, 52.01, 0, 4.36, 52.02, 5], null)).toBe(
      "4.35, 52.01 → 4.36, 52.02",
    );
  });

  it("is null without a bbox", () => {
    expect(extentLine(null, "EPSG:7415")).toBeNull();
  });
});
