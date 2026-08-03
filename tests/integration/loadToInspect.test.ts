/**
 * Integration test: the app-side half of the load-to-inspect pipeline.
 *
 * Verifies that a CityJSON fixture can be parsed into the normalized domain
 * model and that everything the inspector reads off that model is present.
 * This covers the M1 exit criterion: "A user can load and inspect a sample
 * city-model fixture end to end."
 *
 * The mesh / picking / highlight stages this file used to carry were deleted
 * with the React Three Fiber stack in Task C21. Those steps no longer exist in
 * the app at all: `buildCityMeshArrays` and the surface-colour layering live in
 * `@cityjson/navara-cityjson` (with their own suites in the plugin repo), and
 * the app's remaining share of picking is covered by
 * `tests/unit/scene/pickEventHandlers.test.ts`. Parsing is the only pipeline
 * stage still owned here — and these are its only tests.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../src/domain/citymodel/cityjson/parseCityJSON";

// ---------------------------------------------------------------------------
// Load fixture
// ---------------------------------------------------------------------------

const fixturePath = path.resolve(
  import.meta.dirname!,
  "../../fixtures/two-buildings.city.json",
);
const fixtureJson = JSON.parse(
  fs.readFileSync(fixturePath, "utf-8"),
) as CityJSONRoot;

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

describe("load-to-inspect pipeline", () => {
  // Stage 1: Parse
  const model = parseCityJSON(fixtureJson);

  describe("parsing", () => {
    it("parses all three city objects", () => {
      const ids = Object.keys(model.objects);
      expect(ids).toContain("NL.IMBAG.Pand.0001");
      expect(ids).toContain("NL.IMBAG.Pand.0001-part1");
      expect(ids).toContain("NL.IMBAG.Pand.0002");
      expect(ids).toHaveLength(3);
    });

    it("preserves object attributes", () => {
      const building1 = model.objects["NL.IMBAG.Pand.0001"]!;
      expect(building1.attributes.measuredHeight).toBe(8.4);
      expect(building1.attributes.roofType).toBe("gabled");
      expect(building1.attributes.yearOfConstruction).toBe(1923);
      expect(building1.attributes.function).toBe("residential");
    });

    it("preserves parent-child relationships", () => {
      const building1 = model.objects["NL.IMBAG.Pand.0001"]!;
      const part1 = model.objects["NL.IMBAG.Pand.0001-part1"]!;
      expect(building1.children).toContain("NL.IMBAG.Pand.0001-part1");
      expect(part1.parents).toContain("NL.IMBAG.Pand.0001");
    });

    it("extracts semantic surface types", () => {
      const building1 = model.objects["NL.IMBAG.Pand.0001"]!;
      const surfaceTypes = building1.surfaces.map((s) => s.type);
      expect(surfaceTypes).toContain("GroundSurface");
      expect(surfaceTypes).toContain("RoofSurface");
      expect(surfaceTypes).toContain("WallSurface");
    });

    it("preserves surface-level semantic attributes", () => {
      const building1 = model.objects["NL.IMBAG.Pand.0001"]!;
      const slopedRoof = building1.surfaces.find(
        (s) => s.type === "RoofSurface" && s.attributes.slope === 35.0,
      );
      expect(slopedRoof).toBeDefined();
    });

    it("extracts metadata", () => {
      expect(model.metadata.referenceSystem).toBe(
        "https://www.opengis.net/def/crs/EPSG/0/7415",
      );
      expect(model.metadata.title).toBe("Two buildings fixture");
      expect(model.metadata.identifier).toBe("fixture-two-buildings");
    });

    it("computes a model-level bounding box", () => {
      expect(model.bbox).not.toBeNull();
      // Min corner: translate + (0 * scale) = (85000, 446000, 0)
      expect(model.bbox![0]).toBeCloseTo(85000, 0);
      expect(model.bbox![1]).toBeCloseTo(446000, 0);
      expect(model.bbox![2]).toBeCloseTo(0, 0);
    });

    it("records LoD from geometry", () => {
      const building1 = model.objects["NL.IMBAG.Pand.0001"]!;
      expect(building1.lod).toBe("2.2");
    });
  });

  // Stage 2: Inspector data extraction
  describe("inspector data extraction", () => {
    it("can look up a selected object's full data for the inspector", () => {
      const objectId = "NL.IMBAG.Pand.0001";
      const object = model.objects[objectId];

      expect(object).toBeDefined();
      expect(object!.objectType).toBe("Building");
      expect(object!.attributes.measuredHeight).toBe(8.4);
      expect(object!.surfaces.length).toBeGreaterThan(0);
      expect(object!.children).toContain("NL.IMBAG.Pand.0001-part1");
      expect(object!.lod).toBe("2.2");
      expect(object!.bbox).not.toBeNull();
    });

    it("can compute surface type breakdown for the surfaces tab", () => {
      const objectId = "NL.IMBAG.Pand.0001";
      const object = model.objects[objectId]!;

      const counts = new Map<string, number>();
      for (const surface of object.surfaces) {
        counts.set(surface.type, (counts.get(surface.type) ?? 0) + 1);
      }

      expect(counts.get("GroundSurface")).toBe(1);
      expect(counts.get("RoofSurface")).toBe(2);
      expect(counts.get("WallSurface")).toBe(4);
    });

    it("can traverse parent-child to show related objects", () => {
      const objectId = "NL.IMBAG.Pand.0001";
      const object = model.objects[objectId]!;

      for (const childId of object.children) {
        const child = model.objects[childId];
        expect(child).toBeDefined();
        expect(child!.objectType).toBe("BuildingPart");
      }
    });

    it("second building has different attributes", () => {
      const object = model.objects["NL.IMBAG.Pand.0002"]!;
      expect(object.attributes.measuredHeight).toBe(12.1);
      expect(object.attributes.roofType).toBe("flat");
      expect(object.attributes.function).toBe("office");
      expect(object.children).toHaveLength(0);
    });
  });
});
