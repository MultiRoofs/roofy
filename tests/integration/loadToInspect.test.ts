/**
 * Integration test: full load-to-inspect pipeline.
 *
 * Verifies that a CityJSON fixture can be parsed, converted to a
 * pickable mesh, and that picking + inspector data extraction works
 * end-to-end. This covers the M1 exit criterion:
 * "A user can load and inspect a sample city-model fixture end to end."
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../src/domain/citymodel/cityjson/parseCityJSON";
import { buildCityMesh, computeOriginOffset } from "../../src/scene/buildCityMesh";
import { resolveSelection } from "../../src/scene/usePickingControls";
import { applyHighlight, clearHighlight } from "../../src/scene/highlightMesh";

// ---------------------------------------------------------------------------
// Load fixture
// ---------------------------------------------------------------------------

const fixturePath = path.resolve(import.meta.dirname!, "../../fixtures/two-buildings.city.json");
const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as CityJSONRoot;

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

  // Stage 2: Mesh build
  const originOffset = computeOriginOffset(model);
  const meshResult = buildCityMesh(model, originOffset);

  describe("mesh construction", () => {
    it("produces non-zero triangles", () => {
      expect(meshResult.triangleCount).toBeGreaterThan(0);
    });

    it("picking index covers all three objects", () => {
      expect(meshResult.pickingIndex.objectKeys).toHaveLength(3);
      expect(meshResult.pickingIndex.objectKeys).toContain("NL.IMBAG.Pand.0001");
      expect(meshResult.pickingIndex.objectKeys).toContain("NL.IMBAG.Pand.0001-part1");
      expect(meshResult.pickingIndex.objectKeys).toContain("NL.IMBAG.Pand.0002");
    });

    it("objectIndex attribute has same count as position attribute", () => {
      const posCount = meshResult.geometry.getAttribute("position").count;
      const objIdxCount = meshResult.geometry.getAttribute("objectIndex").count;
      const surfIdxCount = meshResult.geometry.getAttribute("surfaceIndex").count;
      expect(objIdxCount).toBe(posCount);
      expect(surfIdxCount).toBe(posCount);
    });

    it("baseColors has same length as color attribute", () => {
      const colorAttr = meshResult.geometry.getAttribute("color");
      expect(meshResult.baseColors.length).toBe(colorAttr.count * 3);
    });
  });

  // Stage 3: Picking resolution
  describe("picking resolution", () => {
    it("resolves a vertex from the first object in object mode", () => {
      // Find the first vertex belonging to object index 0
      const objIdxAttr = meshResult.geometry.getAttribute("objectIndex");
      let vertexIdx = -1;
      for (let i = 0; i < objIdxAttr.count; i++) {
        if (objIdxAttr.getX(i) === 0) {
          vertexIdx = i;
          break;
        }
      }
      expect(vertexIdx).toBeGreaterThanOrEqual(0);

      const selection = resolveSelection(
        vertexIdx,
        meshResult.geometry,
        meshResult.pickingIndex,
        "object",
      );

      expect(selection).not.toBeNull();
      expect(selection!.kind).toBe("object");
      expect(selection!.objectId).toBe(meshResult.pickingIndex.objectKeys[0]);
    });

    it("resolves a vertex from the last object in object mode", () => {
      const lastIdx = meshResult.pickingIndex.objectKeys.length - 1;
      const objIdxAttr = meshResult.geometry.getAttribute("objectIndex");
      let vertexIdx = -1;
      for (let i = 0; i < objIdxAttr.count; i++) {
        if (objIdxAttr.getX(i) === lastIdx) {
          vertexIdx = i;
          break;
        }
      }
      expect(vertexIdx).toBeGreaterThanOrEqual(0);

      const selection = resolveSelection(
        vertexIdx,
        meshResult.geometry,
        meshResult.pickingIndex,
        "object",
      );

      expect(selection).not.toBeNull();
      expect(selection!.objectId).toBe(meshResult.pickingIndex.objectKeys[lastIdx]);
    });

    it("resolves surface index in surface mode", () => {
      // Find a vertex for object 0 with surfaceIndex > 0
      const objIdxAttr = meshResult.geometry.getAttribute("objectIndex");
      const surfIdxAttr = meshResult.geometry.getAttribute("surfaceIndex");
      let vertexIdx = -1;
      for (let i = 0; i < objIdxAttr.count; i++) {
        if (objIdxAttr.getX(i) === 0 && surfIdxAttr.getX(i) > 0) {
          vertexIdx = i;
          break;
        }
      }
      expect(vertexIdx).toBeGreaterThanOrEqual(0);

      const selection = resolveSelection(
        vertexIdx,
        meshResult.geometry,
        meshResult.pickingIndex,
        "surface",
      );

      expect(selection).not.toBeNull();
      expect(selection!.kind).toBe("surface");
      if (selection!.kind === "surface") {
        expect(selection!.surfaceIndex).toBeGreaterThan(0);
        expect(selection!.objectId).toBe(meshResult.pickingIndex.objectKeys[0]);
      }
    });
  });

  // Stage 4: Highlight
  describe("highlight", () => {
    it("applies and clears highlight without errors", () => {
      const firstObjectId = meshResult.pickingIndex.objectKeys[0]!;

      // Apply selection highlight
      applyHighlight(
        meshResult.geometry,
        meshResult.baseColors,
        { kind: "object", objectId: firstObjectId },
        null,
        meshResult.pickingIndex,
      );

      // Verify some vertices were changed
      const colorAttr = meshResult.geometry.getAttribute("color");
      const objIdxAttr = meshResult.geometry.getAttribute("objectIndex");
      let foundHighlighted = false;
      for (let i = 0; i < objIdxAttr.count; i++) {
        if (objIdxAttr.getX(i) === 0) {
          // Should differ from base color
          const base = i * 3;
          if (
            colorAttr.array[base] !== meshResult.baseColors[base] ||
            colorAttr.array[base + 1] !== meshResult.baseColors[base + 1]
          ) {
            foundHighlighted = true;
            break;
          }
        }
      }
      expect(foundHighlighted).toBe(true);

      // Clear and verify restoration
      clearHighlight(meshResult.geometry, meshResult.baseColors);
      const colorArray = colorAttr.array as Float32Array;
      for (let i = 0; i < meshResult.baseColors.length; i++) {
        expect(colorArray[i]).toBe(meshResult.baseColors[i]);
      }
    });
  });

  // Stage 5: Inspector data extraction
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
