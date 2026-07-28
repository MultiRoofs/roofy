import { describe, expect, it } from "vitest";
import type { CityJSONRoot } from "../../../../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../../../../src/domain/citymodel/cityjson/parseCityJSON";

// ---------------------------------------------------------------------------
// Inline test fixtures
// ---------------------------------------------------------------------------

/** Minimal valid CityJSON with no city objects. */
const EMPTY_CITYJSON: CityJSONRoot = {
  type: "CityJSON",
  version: "2.0",
  transform: {
    scale: [1.0, 1.0, 1.0],
    translate: [0.0, 0.0, 0.0],
  },
  CityObjects: {},
  vertices: [],
};

/**
 * A single building as a MultiSurface box (6 faces).
 * Vertices form a 10x10x5 box starting at (100, 200, 0).
 * Transform: scale 0.01, translate [100, 200, 0].
 * Integer vertices: (0,0,0), (1000,0,0), (1000,1000,0), (0,1000,0),
 *                   (0,0,500), (1000,0,500), (1000,1000,500), (0,1000,500)
 * Real-world: (100,200,0) to (110,210,5)
 */
const SINGLE_BUILDING_CITYJSON: CityJSONRoot = {
  type: "CityJSON",
  version: "2.0",
  transform: {
    scale: [0.01, 0.01, 0.01],
    translate: [100, 200, 0],
  },
  metadata: {
    referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415",
    title: "Test building",
  },
  CityObjects: {
    "building-1": {
      type: "Building",
      attributes: {
        measuredHeight: 5.0,
        roofType: "flat",
      },
      geometry: [
        {
          type: "MultiSurface",
          lod: "2",
          boundaries: [
            [[0, 3, 2, 1]], // ground
            [[4, 5, 6, 7]], // roof
            [[0, 1, 5, 4]], // wall 1
            [[1, 2, 6, 5]], // wall 2
            [[2, 3, 7, 6]], // wall 3
            [[3, 0, 4, 7]], // wall 4
          ],
          semantics: {
            surfaces: [
              { type: "GroundSurface" },
              { type: "RoofSurface", slope: 0.0 },
              { type: "WallSurface" },
            ],
            values: [0, 1, 2, 2, 2, 2],
          },
        },
      ],
    },
  },
  vertices: [
    [0, 0, 0],
    [1000, 0, 0],
    [1000, 1000, 0],
    [0, 1000, 0],
    [0, 0, 500],
    [1000, 0, 500],
    [1000, 1000, 500],
    [0, 1000, 500],
  ],
};

/**
 * A building with a child BuildingPart — tests parent/child relationships.
 */
const PARENT_CHILD_CITYJSON: CityJSONRoot = {
  type: "CityJSON",
  version: "2.0",
  transform: {
    scale: [1.0, 1.0, 1.0],
    translate: [0.0, 0.0, 0.0],
  },
  CityObjects: {
    "parent-building": {
      type: "Building",
      children: ["child-part"],
    },
    "child-part": {
      type: "BuildingPart",
      parents: ["parent-building"],
    },
  },
  vertices: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseCityJSON", () => {
  describe("empty model", () => {
    it("parses a minimal CityJSON with no objects", () => {
      const model = parseCityJSON(EMPTY_CITYJSON);

      expect(model.sourceEncoding).toBe("cityjson");
      expect(model.vertexCount).toBe(0);
      expect(Object.keys(model.objects)).toHaveLength(0);
      expect(model.bbox).toBeNull();
    });

    it("preserves metadata fields", () => {
      const model = parseCityJSON(EMPTY_CITYJSON);

      expect(model.metadata.referenceSystem).toBeUndefined();
      expect(model.metadata.title).toBeUndefined();
    });
  });

  describe("metadata extraction", () => {
    it("extracts referenceSystem and title from metadata", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);

      expect(model.metadata.referenceSystem).toBe(
        "https://www.opengis.net/def/crs/EPSG/0/7415",
      );
      expect(model.metadata.title).toBe("Test building");
    });
  });

  describe("vertex dequantization", () => {
    it("applies transform to produce real-world coordinates", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"];
      expect(building).toBeDefined();

      // The roof surface (index 1 in semantics) should have vertices at z=5
      const roofSurfaces = building!.surfaces.filter(
        (s) => s.type === "RoofSurface",
      );
      expect(roofSurfaces.length).toBeGreaterThan(0);

      // Check that roof vertices are at z = 500*0.01+0 = 5
      const roofRing = roofSurfaces[0]!.rings[0]!;
      for (const vertex of roofRing) {
        expect(vertex[2]).toBeCloseTo(5.0, 5);
      }
    });

    it("produces correct real-world x,y coordinates", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"]!;
      const groundSurfaces = building.surfaces.filter(
        (s) => s.type === "GroundSurface",
      );
      const groundRing = groundSurfaces[0]!.rings[0]!;

      // Vertex 0: (0*0.01+100, 0*0.01+200, 0*0.01+0) = (100, 200, 0)
      expect(groundRing[0]![0]).toBeCloseTo(100.0, 5);
      expect(groundRing[0]![1]).toBeCloseTo(200.0, 5);
      expect(groundRing[0]![2]).toBeCloseTo(0.0, 5);

      // Vertex 1: (1000*0.01+100, 0*0.01+200, 0) = (110, 200, 0)
      expect(groundRing[3]![0]).toBeCloseTo(110.0, 5);
      expect(groundRing[3]![1]).toBeCloseTo(200.0, 5);
    });
  });

  describe("surface extraction with semantics", () => {
    it("extracts surfaces with correct semantic types", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"]!;

      const surfaceTypes = building.surfaces.map((s) => s.type);
      expect(surfaceTypes).toContain("GroundSurface");
      expect(surfaceTypes).toContain("RoofSurface");
      expect(surfaceTypes).toContain("WallSurface");
    });

    it("has 6 surfaces for the box geometry", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"]!;

      expect(building.surfaces).toHaveLength(6);
    });

    it("preserves semantic surface attributes", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"]!;
      const roof = building.surfaces.find((s) => s.type === "RoofSurface");

      expect(roof).toBeDefined();
      expect(roof!.attributes["slope"]).toBe(0.0);
    });

    it("marks surfaces without semantics as unknown", () => {
      const noSemantics: CityJSONRoot = {
        ...SINGLE_BUILDING_CITYJSON,
        CityObjects: {
          b1: {
            type: "Building",
            geometry: [
              {
                type: "MultiSurface",
                lod: "1",
                boundaries: [[[0, 1, 2]]],
              },
            ],
          },
        },
        vertices: [
          [0, 0, 0],
          [100, 0, 0],
          [0, 100, 0],
        ],
      };

      const model = parseCityJSON(noSemantics);
      const b = model.objects["b1"]!;
      expect(b.surfaces[0]!.type).toBe("unknown");
    });
  });

  describe("city object attributes", () => {
    it("carries over source attributes to the normalized object", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"]!;

      expect(building.attributes["measuredHeight"]).toBe(5.0);
      expect(building.attributes["roofType"]).toBe("flat");
    });

    it("preserves the object type", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"]!;

      expect(building.objectType).toBe("Building");
    });

    it("stores the LoD from the geometry", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"]!;

      expect(building.lod).toBe("2");
    });
  });

  describe("parent-child relationships", () => {
    it("preserves children references", () => {
      const model = parseCityJSON(PARENT_CHILD_CITYJSON);
      const parent = model.objects["parent-building"]!;

      expect(parent.children).toEqual(["child-part"]);
    });

    it("preserves parent references", () => {
      const model = parseCityJSON(PARENT_CHILD_CITYJSON);
      const child = model.objects["child-part"]!;

      expect(child.parents).toEqual(["parent-building"]);
    });
  });

  describe("bounding box", () => {
    it("computes bbox for a building from dequantized vertices", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      const building = model.objects["building-1"]!;

      expect(building.bbox).not.toBeNull();
      // min: (100, 200, 0), max: (110, 210, 5)
      expect(building.bbox![0]).toBeCloseTo(100.0, 5);
      expect(building.bbox![1]).toBeCloseTo(200.0, 5);
      expect(building.bbox![2]).toBeCloseTo(0.0, 5);
      expect(building.bbox![3]).toBeCloseTo(110.0, 5);
      expect(building.bbox![4]).toBeCloseTo(210.0, 5);
      expect(building.bbox![5]).toBeCloseTo(5.0, 5);
    });

    it("computes model-level bbox from all objects", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);

      expect(model.bbox).not.toBeNull();
      expect(model.bbox![0]).toBeCloseTo(100.0, 5);
      expect(model.bbox![3]).toBeCloseTo(110.0, 5);
    });

    it("returns null bbox for objects without geometry", () => {
      const model = parseCityJSON(PARENT_CHILD_CITYJSON);
      const parent = model.objects["parent-building"]!;

      expect(parent.bbox).toBeNull();
    });
  });

  describe("vertex count", () => {
    it("reports the source vertex count", () => {
      const model = parseCityJSON(SINGLE_BUILDING_CITYJSON);
      expect(model.vertexCount).toBe(8);
    });
  });

  describe("version validation", () => {
    it("rejects CityJSON v1.x files", () => {
      const v1: CityJSONRoot = {
        ...EMPTY_CITYJSON,
        version: "1.1",
      };
      expect(() => parseCityJSON(v1)).toThrow(
        /Unsupported CityJSON version "1.1"/,
      );
    });

    it("accepts CityJSON v2.0", () => {
      expect(() => parseCityJSON(EMPTY_CITYJSON)).not.toThrow();
    });

    it("accepts CityJSON v2.1", () => {
      const v21: CityJSONRoot = {
        ...EMPTY_CITYJSON,
        version: "2.1",
      };
      expect(() => parseCityJSON(v21)).not.toThrow();
    });
  });
});
