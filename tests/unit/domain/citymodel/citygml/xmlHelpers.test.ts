import { describe, it, expect } from "vitest";
import {
  parsePosList,
  parseLinearRing,
  parsePolygon,
  collectPolygonsFromMultiSurface,
  collectPolygonsFromSolid,
  detectLodFromElementName,
  resolveGMLSurfaceType,
  normalizeSrsName,
  stripPrefix,
  findLodGeometryEntries,
} from "../../../../../src/domain/citymodel/citygml/xmlHelpers";

// ---------------------------------------------------------------------------
// parsePosList
// ---------------------------------------------------------------------------

describe("parsePosList", () => {
  it("parses a standard 3D posList", () => {
    const result = parsePosList("1.0 2.0 3.0 4.0 5.0 6.0");
    expect(result).toEqual([
      [1.0, 2.0, 3.0],
      [4.0, 5.0, 6.0],
    ]);
  });

  it("handles extra whitespace", () => {
    const result = parsePosList("  1 2 3   4 5 6  ");
    expect(result).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("skips incomplete trailing triple", () => {
    const result = parsePosList("1 2 3 4 5");
    expect(result).toEqual([[1, 2, 3]]);
  });

  it("returns empty for empty string", () => {
    expect(parsePosList("")).toEqual([]);
  });

  it("skips NaN values", () => {
    const result = parsePosList("1 2 3 abc def ghi 4 5 6");
    expect(result).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("returns empty for srsDimension=2 (3D domain model)", () => {
    const result = parsePosList("1 2 3 4 5 6", 2);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseLinearRing
// ---------------------------------------------------------------------------

describe("parseLinearRing", () => {
  it("parses from gml:posList string", () => {
    const result = parseLinearRing({
      "gml:posList": "0 0 0 10 0 0 10 10 0 0 10 0 0 0 0",
    });
    expect(result.length).toBe(4); // closing duplicate dropped
    expect(result[0]).toEqual([0, 0, 0]);
  });

  it("parses from gml:posList object with #text", () => {
    const result = parseLinearRing({
      "gml:posList": { "#text": "0 0 0 10 0 0 10 10 0", "@_srsDimension": "3" },
    });
    expect(result.length).toBe(3);
  });

  it("falls back to gml:pos array", () => {
    const result = parseLinearRing({
      "gml:pos": ["0 0 0", "10 0 0", "10 10 0"],
    });
    expect(result.length).toBe(3);
    expect(result[0]).toEqual([0, 0, 0]);
  });

  it("falls back to gml:pos single string", () => {
    const result = parseLinearRing({ "gml:pos": "5 5 5" });
    expect(result).toEqual([[5, 5, 5]]);
  });

  it("returns empty for missing data", () => {
    expect(parseLinearRing({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parsePolygon
// ---------------------------------------------------------------------------

describe("parsePolygon", () => {
  it("parses a polygon with exterior ring", () => {
    const result = parsePolygon({
      "gml:exterior": {
        "gml:LinearRing": {
          "gml:posList": "0 0 0 10 0 0 10 10 0 0 10 0 0 0 0",
        },
      },
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1); // 1 ring (exterior)
    expect(result![0]!.length).toBe(4); // closing duplicate dropped
  });

  it("parses polygon with interior ring", () => {
    const result = parsePolygon({
      "gml:exterior": {
        "gml:LinearRing": {
          "gml:posList": "0 0 0 10 0 0 10 10 0 0 10 0 0 0 0",
        },
      },
      "gml:interior": {
        "gml:LinearRing": {
          "gml:posList": "2 2 0 8 2 0 8 8 0 2 8 0 2 2 0",
        },
      },
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2); // exterior + 1 hole
  });

  it("parses polygon with multiple interior rings", () => {
    const result = parsePolygon({
      "gml:exterior": {
        "gml:LinearRing": {
          "gml:posList": "0 0 0 10 0 0 10 10 0 0 10 0 0 0 0",
        },
      },
      "gml:interior": [
        { "gml:LinearRing": { "gml:posList": "1 1 0 2 1 0 2 2 0 1 1 0" } },
        { "gml:LinearRing": { "gml:posList": "5 5 0 6 5 0 6 6 0 5 5 0" } },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3); // exterior + 2 holes
  });

  it("returns null for missing exterior", () => {
    expect(parsePolygon({})).toBeNull();
  });

  it("returns null for too-few-point exterior", () => {
    const result = parsePolygon({
      "gml:exterior": {
        "gml:LinearRing": {
          "gml:posList": "0 0 0 10 0 0",
        },
      },
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// collectPolygonsFromMultiSurface
// ---------------------------------------------------------------------------

describe("collectPolygonsFromMultiSurface", () => {
  it("collects inline polygons", () => {
    const ms = {
      "gml:surfaceMember": [
        {
          "gml:Polygon": {
            "gml:exterior": {
              "gml:LinearRing": { "gml:posList": "0 0 0 1 0 0 1 1 0 0 0 0" },
            },
          },
        },
        {
          "gml:Polygon": {
            "gml:exterior": {
              "gml:LinearRing": { "gml:posList": "2 2 0 3 2 0 3 3 0 2 2 0" },
            },
          },
        },
      ],
    };
    const polygons = collectPolygonsFromMultiSurface(ms);
    expect(polygons.length).toBe(2);
  });

  it("skips xlink-only members", () => {
    const ms = {
      "gml:surfaceMember": [
        { "@_xlink:href": "#some_polygon" },
        {
          "gml:Polygon": {
            "gml:exterior": {
              "gml:LinearRing": { "gml:posList": "0 0 0 1 0 0 1 1 0 0 0 0" },
            },
          },
        },
      ],
    };
    const polygons = collectPolygonsFromMultiSurface(ms);
    expect(polygons.length).toBe(1);
  });

  it("handles single surfaceMember (not array)", () => {
    const ms = {
      "gml:surfaceMember": {
        "gml:Polygon": {
          "gml:exterior": {
            "gml:LinearRing": { "gml:posList": "0 0 0 1 0 0 1 1 0 0 0 0" },
          },
        },
      },
    };
    const polygons = collectPolygonsFromMultiSurface(ms);
    expect(polygons.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// collectPolygonsFromSolid
// ---------------------------------------------------------------------------

describe("collectPolygonsFromSolid", () => {
  it("collects from CompositeSurface path", () => {
    const solid = {
      "gml:exterior": {
        "gml:CompositeSurface": {
          "gml:surfaceMember": [
            {
              "gml:Polygon": {
                "gml:exterior": {
                  "gml:LinearRing": {
                    "gml:posList": "0 0 0 1 0 0 1 1 0 0 0 0",
                  },
                },
              },
            },
          ],
        },
      },
    };
    const polygons = collectPolygonsFromSolid(solid);
    expect(polygons.length).toBe(1);
  });

  it("collects from Shell path", () => {
    const solid = {
      "gml:exterior": {
        "gml:Shell": {
          "gml:surfaceMember": {
            "gml:Polygon": {
              "gml:exterior": {
                "gml:LinearRing": {
                  "gml:posList": "0 0 0 1 0 0 1 1 0 0 0 0",
                },
              },
            },
          },
        },
      },
    };
    const polygons = collectPolygonsFromSolid(solid);
    expect(polygons.length).toBe(1);
  });

  it("returns empty for no exterior", () => {
    expect(collectPolygonsFromSolid({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectLodFromElementName
// ---------------------------------------------------------------------------

describe("detectLodFromElementName", () => {
  it("detects lod2MultiSurface -> '2'", () => {
    expect(detectLodFromElementName("lod2MultiSurface")).toBe("2");
  });

  it("detects lod1Solid -> '1'", () => {
    expect(detectLodFromElementName("lod1Solid")).toBe("1");
  });

  it("detects lod0FootPrint -> '0'", () => {
    expect(detectLodFromElementName("lod0FootPrint")).toBe("0");
  });

  it("detects lod3MultiCurve -> '3'", () => {
    expect(detectLodFromElementName("lod3MultiCurve")).toBe("3");
  });

  it("returns null for non-lod names", () => {
    expect(detectLodFromElementName("boundedBy")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveGMLSurfaceType
// ---------------------------------------------------------------------------

describe("resolveGMLSurfaceType", () => {
  it("resolves bldg:RoofSurface -> RoofSurface", () => {
    expect(resolveGMLSurfaceType("bldg:RoofSurface")).toBe("RoofSurface");
  });

  it("resolves con:WallSurface -> WallSurface", () => {
    expect(resolveGMLSurfaceType("con:WallSurface")).toBe("WallSurface");
  });

  it("resolves bare GroundSurface", () => {
    expect(resolveGMLSurfaceType("GroundSurface")).toBe("GroundSurface");
  });

  it("returns unknown for unrecognized types", () => {
    expect(resolveGMLSurfaceType("bldg:InteriorWallSurface")).toBe("unknown");
  });

  it("resolves Window and Door", () => {
    expect(resolveGMLSurfaceType("bldg:Window")).toBe("Window");
    expect(resolveGMLSurfaceType("bldg:Door")).toBe("Door");
  });
});

// ---------------------------------------------------------------------------
// normalizeSrsName
// ---------------------------------------------------------------------------

describe("normalizeSrsName", () => {
  it("normalizes URN format", () => {
    expect(normalizeSrsName("urn:ogc:def:crs:EPSG::28992")).toBe(
      "https://www.opengis.net/def/crs/EPSG/0/28992",
    );
  });

  it("normalizes compound URN (takes first EPSG code)", () => {
    expect(
      normalizeSrsName("urn:ogc:def:crs,crs:EPSG::25832,crs:EPSG::5783"),
    ).toBe("https://www.opengis.net/def/crs/EPSG/0/25832");
  });

  it("normalizes bare EPSG format", () => {
    expect(normalizeSrsName("EPSG:28992")).toBe(
      "https://www.opengis.net/def/crs/EPSG/0/28992",
    );
  });

  it("passes through OGC HTTP URI", () => {
    const uri = "https://www.opengis.net/def/crs/EPSG/0/28992";
    expect(normalizeSrsName(uri)).toBe(uri);
  });

  it("passes through unrecognized format", () => {
    const custom = "urn:adv:crs:DE_DHDN_3GK4";
    expect(normalizeSrsName(custom)).toBe(custom);
  });

  it("maps AdV ETRS89/UTM URNs to their horizontal EPSG code", () => {
    // The German Länder publish CityGML with compound AdV URNs; the suffix
    // after `*` names the vertical datum, which the app handles via the
    // geoid, not the planar CRS.
    expect(normalizeSrsName("urn:adv:crs:ETRS89_UTM33*DE_DHHN2016_NH")).toBe(
      "https://www.opengis.net/def/crs/EPSG/0/25833",
    );
    expect(normalizeSrsName("urn:adv:crs:ETRS89_UTM32*DE_DHHN92_NH")).toBe(
      "https://www.opengis.net/def/crs/EPSG/0/25832",
    );
    // Bare zone URN with no height suffix still maps.
    expect(normalizeSrsName("urn:adv:crs:ETRS89_UTM32")).toBe(
      "https://www.opengis.net/def/crs/EPSG/0/25832",
    );
    // Gauss-Krüger AdV URNs stay pass-through: no metric UTM zone to name.
    expect(normalizeSrsName("urn:adv:crs:ETRS89_UTM31")).toBe(
      "urn:adv:crs:ETRS89_UTM31",
    );
  });
});

// ---------------------------------------------------------------------------
// stripPrefix
// ---------------------------------------------------------------------------

describe("stripPrefix", () => {
  it("strips namespace prefix", () => {
    expect(stripPrefix("bldg:Building")).toBe("Building");
  });

  it("returns bare name unchanged", () => {
    expect(stripPrefix("Building")).toBe("Building");
  });
});

// ---------------------------------------------------------------------------
// findLodGeometryEntries
// ---------------------------------------------------------------------------

describe("findLodGeometryEntries", () => {
  it("finds lod entries and skips non-lod keys", () => {
    const node = {
      "@_gml:id": "b1",
      "bldg:boundedBy": [],
      "bldg:lod2MultiSurface": { "gml:MultiSurface": {} },
      "bldg:lod1Solid": { "gml:Solid": {} },
      "bldg:function": "residential",
    };
    const entries = findLodGeometryEntries(node);
    expect(entries.length).toBe(2);
    expect(entries.map(([name]) => name)).toContain("lod2MultiSurface");
    expect(entries.map(([name]) => name)).toContain("lod1Solid");
  });
});
