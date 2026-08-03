/**
 * Integration test: CityJSONSeq load-to-inspect pipeline.
 *
 * Verifies that a `.city.jsonl` fixture produces the same normalized model as
 * its `.city.json` counterpart — same objects, surfaces, attributes and LoDs —
 * which is what makes every downstream consumer (inspector, rules, analytics,
 * the mesh builder in `@cityjson/navara-cityjson`) format-agnostic.
 *
 * Until Task C21 the "same model" claim was made indirectly, by building a
 * three `BufferGeometry` from the seq model and reading object ids back out of
 * its picking index. That mesh builder is gone from the app (it lives in the
 * plugin package now, with its own suite), so the claim is made against the
 * domain model itself — which is both the actual subject and a stricter check
 * than the mesh ever was.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "@cityjson/navara-core";
import { parseCityJSON } from "@cityjson/navara-core";
import { parseCityJSONSeq } from "@cityjson/navara-core";

const fixtureDir = path.resolve(import.meta.dirname!, "../../fixtures");
const seqModel = parseCityJSONSeq(
  fs.readFileSync(path.join(fixtureDir, "two-buildings.city.jsonl"), "utf-8"),
);
const jsonModel = parseCityJSON(
  JSON.parse(
    fs.readFileSync(path.join(fixtureDir, "two-buildings.city.json"), "utf-8"),
  ) as CityJSONRoot,
);

describe("CityJSONSeq load-to-inspect pipeline", () => {
  describe("parity with the CityJSON fixture", () => {
    it("yields the same three city objects", () => {
      expect(Object.keys(seqModel.objects).sort()).toEqual(
        Object.keys(jsonModel.objects).sort(),
      );
      expect(Object.keys(seqModel.objects)).toHaveLength(3);
    });

    it("yields the same type, attributes, LoD and hierarchy per object", () => {
      for (const [id, expected] of Object.entries(jsonModel.objects)) {
        const actual = seqModel.objects[id];
        expect(actual, id).toBeDefined();
        expect(actual!.objectType, id).toBe(expected.objectType);
        expect(actual!.attributes, id).toEqual(expected.attributes);
        expect(actual!.lod, id).toBe(expected.lod);
        expect([...actual!.children].sort(), id).toEqual(
          [...expected.children].sort(),
        );
        expect([...actual!.parents].sort(), id).toEqual(
          [...expected.parents].sort(),
        );
      }
    });

    it("yields the same surfaces, in the same order, with the same semantics", () => {
      for (const [id, expected] of Object.entries(jsonModel.objects)) {
        const actual = seqModel.objects[id]!;
        expect(
          actual.surfaces.map((s) => s.type),
          id,
        ).toEqual(expected.surfaces.map((s) => s.type));
        expect(
          actual.surfaces.map((s) => s.attributes),
          id,
        ).toEqual(expected.surfaces.map((s) => s.attributes));
        // Same polygon rings, vertex for vertex. Each feature line in a
        // CityJSONSeq file carries its OWN `vertices` array and transform, so
        // equal real-world ring coordinates here is the real proof that the
        // per-feature de-indexing is correct.
        for (const [i, surface] of expected.surfaces.entries()) {
          expect(actual.surfaces[i]!.rings, `${id}#${i}`).toEqual(
            surface.rings,
          );
          expect(actual.surfaces[i]!.lod, `${id}#${i}`).toBe(surface.lod);
        }
      }
    });

    it("yields the same model bounding box", () => {
      expect(seqModel.bbox).not.toBeNull();
      expect(jsonModel.bbox).not.toBeNull();
      for (let i = 0; i < 6; i++) {
        expect(seqModel.bbox![i]).toBeCloseTo(jsonModel.bbox![i]!, 3);
      }
    });
  });

  describe("solar integration", () => {
    it("model has valid CRS for solar pipeline", () => {
      expect(seqModel.metadata.referenceSystem).toBe(
        "https://www.opengis.net/def/crs/EPSG/0/7415",
      );
      expect(seqModel.bbox).not.toBeNull();
    });
  });
});
