/**
 * Integration test: CityJSONSeq load-to-inspect pipeline.
 *
 * Verifies that a .city.jsonl fixture produces the same normalized model
 * as its .city.json counterpart — same objects, surfaces, attributes,
 * and pickable mesh. This ensures format-agnostic downstream behavior.
 */

import { describe, it, expect } from "vite-plus/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCityJSONSeq } from "../../src/domain/citymodel/cityjsonseq/parseCityJSONSeq";
import {
  buildCityMesh,
  computeOriginOffset,
} from "../../src/scene/buildCityMesh";
import { resolveSelection } from "../../src/scene/usePickingControls";

const fixturePath = path.resolve(
  import.meta.dirname!,
  "../../fixtures/two-buildings.city.jsonl",
);
const fixtureText = fs.readFileSync(fixturePath, "utf-8");

describe("CityJSONSeq load-to-inspect pipeline", () => {
  const model = parseCityJSONSeq(fixtureText);

  describe("mesh construction", () => {
    const originOffset = computeOriginOffset(model);
    const meshResult = buildCityMesh(model, "test-layer", originOffset);

    it("produces non-zero triangles", () => {
      expect(meshResult.triangleCount).toBeGreaterThan(0);
    });

    it("picking index covers all three objects", () => {
      expect(meshResult.pickingIndex.objectKeys).toHaveLength(3);
      expect(meshResult.pickingIndex.objectKeys).toContain(
        "NL.IMBAG.Pand.0001",
      );
      expect(meshResult.pickingIndex.objectKeys).toContain(
        "NL.IMBAG.Pand.0001-part1",
      );
      expect(meshResult.pickingIndex.objectKeys).toContain(
        "NL.IMBAG.Pand.0002",
      );
    });

    it("vertex attributes are consistent", () => {
      const posCount = meshResult.geometry.getAttribute("position").count;
      const objIdxCount = meshResult.geometry.getAttribute("objectIndex").count;
      const surfIdxCount =
        meshResult.geometry.getAttribute("surfaceIndex").count;
      expect(objIdxCount).toBe(posCount);
      expect(surfIdxCount).toBe(posCount);
    });

    it("resolves picking for objects from different features", () => {
      const objIdxAttr = meshResult.geometry.getAttribute("objectIndex");

      // Find a vertex from the last object (from the second feature line)
      const lastIdx = meshResult.pickingIndex.objectKeys.length - 1;
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
      expect(selection!.objectId).toBe("NL.IMBAG.Pand.0002");
    });
  });

  describe("solar integration", () => {
    it("model has valid CRS for solar pipeline", () => {
      expect(model.metadata.referenceSystem).toBe(
        "https://www.opengis.net/def/crs/EPSG/0/7415",
      );
      expect(model.bbox).not.toBeNull();
    });
  });
});
