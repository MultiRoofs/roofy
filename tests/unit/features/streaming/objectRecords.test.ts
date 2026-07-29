import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "../../../../src/domain/citymodel/cityjson/types";
import { parseCityJSON } from "../../../../src/domain/citymodel/cityjson/parseCityJSON";
import {
  computeArea,
  computeRoofMetrics,
} from "../../../../src/domain/roofMetrics/metrics";
import { toObjectRecords } from "../../../../src/features/streaming/objectRecords";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const model = parseCityJSON(
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        import.meta.dirname!,
        "../../../../fixtures/two-buildings.city.json",
      ),
      "utf-8",
    ),
  ) as CityJSONRoot,
);

// The exact field set of ResidentObjectRecord (workerProtocol.ts). Kept here,
// rather than relying on a string search for "rings", so a rename or an
// accidental extra field is caught structurally instead of by substring
// matching (see "carries no ring geometry" below).
const RESIDENT_OBJECT_RECORD_KEYS = [
  "id",
  "objectType",
  "attributes",
  "bbox",
  "lod",
  "surfaceCount",
  "roofMetrics",
  "footprintAreaSqM",
  "volumeCuM",
  "parents",
  "children",
].sort();

describe("toObjectRecords", () => {
  it("emits one record per object with a surface count", () => {
    const { records } = toObjectRecords(model);
    expect(records.length).toBe(Object.keys(model.objects).length);
    for (const r of records) {
      expect(r.surfaceCount).toBe(model.objects[r.id]!.surfaces.length);
    }
  });

  it("precomputes roof metrics for every RoofSurface, matching computeRoofMetrics", () => {
    const { records } = toObjectRecords(model);
    for (const r of records) {
      const roofs = model.objects[r.id]!.surfaces.filter(
        (s) => s.type === "RoofSurface",
      );
      expect(r.roofMetrics.length).toBe(roofs.length);
      // Not just the count — the values themselves, in surface order, must
      // match what computeRoofMetrics produces directly from the surface.
      expect(r.roofMetrics).toEqual(roofs.map(computeRoofMetrics));
    }
  });

  it("carries only the documented ResidentObjectRecord fields — no ring geometry", () => {
    // A JSON.stringify(...).not.toContain("rings") string search is weak:
    // it passes if the field is merely renamed, and it would false-positive
    // on any attribute value that happens to contain the substring "rings".
    // Asserting the exact key set is a structural check that catches both:
    // a renamed/relocated ring field would still show up as an unexpected
    // key (or a missing documented one), and no string content matters.
    const { records } = toObjectRecords(model);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(Object.keys(r).sort()).toEqual(RESIDENT_OBJECT_RECORD_KEYS);
      for (const rm of r.roofMetrics) {
        expect(Object.keys(rm).sort()).toEqual(
          ["areaSqM", "azimuthDeg", "elevationM", "inclinationDeg"].sort(),
        );
      }
    }
  });

  it("computes footprintAreaSqM as the summed area of GroundSurface exterior rings", () => {
    const { records } = toObjectRecords(model);
    for (const r of records) {
      const grounds = model.objects[r.id]!.surfaces.filter(
        (s) => s.type === "GroundSurface",
      );
      const expected = grounds.reduce(
        (sum, s) => sum + computeArea(s.rings[0] ?? []),
        0,
      );
      expect(r.footprintAreaSqM).toBeCloseTo(expected, 6);
    }
  });

  it("computes volumeCuM as footprint x measuredHeight when that attribute is numeric", () => {
    const { records } = toObjectRecords(model);
    // The fixture gives every object a numeric measuredHeight, so this
    // exercises the "numeric" branch; the "else null" branch is exercised
    // by the synthetic-model test below.
    for (const r of records) {
      const h = model.objects[r.id]!.attributes.measuredHeight;
      expect(typeof h).toBe("number");
      expect(r.volumeCuM).toBeCloseTo(r.footprintAreaSqM * (h as number), 6);
    }
  });

  it("reports volumeCuM as null when measuredHeight is absent or non-numeric", () => {
    const synthetic: CityModel = {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: [0, 0, 0, 10, 10, 5],
      objects: {
        noHeight: {
          id: "noHeight",
          objectType: "Building",
          attributes: { roofType: "flat" }, // no measuredHeight
          bbox: [0, 0, 0, 10, 10, 5],
          children: [],
          parents: [],
          lod: "2.2",
          surfaces: [
            {
              type: "GroundSurface",
              rings: [
                [
                  [0, 0, 0],
                  [10, 0, 0],
                  [10, 10, 0],
                  [0, 10, 0],
                ],
              ],
              attributes: {},
              lod: "2.2",
            },
          ],
        },
      },
      vertexCount: 4,
    };

    const { records } = toObjectRecords(synthetic);
    expect(records).toHaveLength(1);
    expect(records[0]!.footprintAreaSqM).toBeCloseTo(100, 6);
    expect(records[0]!.volumeCuM).toBeNull();
  });

  it("skips an object with no geometry (bbox: null) instead of fabricating one", () => {
    // CityObject.bbox is nullable (an object with no `geometry` at all, e.g.
    // a parent Building that only aggregates BuildingParts, parses to
    // bbox: null — see parseCityObject in parseHelpers.ts). Every real
    // streamed cell model already excludes such objects before
    // toObjectRecords ever sees them (bucketFeatures.ts skips
    // `if (!obj?.bbox) continue`), but ResidentObjectRecord.bbox is
    // non-nullable, so toObjectRecords must not blindly forward one that
    // slips through — e.g. if it is ever called on a whole (non-bucketed)
    // model instead of a per-cell one.
    const synthetic: CityModel = {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {
        parentOnly: {
          id: "parentOnly",
          objectType: "Building",
          attributes: {},
          bbox: null,
          children: ["child"],
          parents: [],
          lod: null,
          surfaces: [],
        },
        child: {
          id: "child",
          objectType: "BuildingPart",
          attributes: { measuredHeight: 5 },
          bbox: [0, 0, 0, 10, 10, 5],
          children: [],
          parents: ["parentOnly"],
          lod: "2.2",
          surfaces: [
            {
              type: "GroundSurface",
              rings: [
                [
                  [0, 0, 0],
                  [10, 0, 0],
                  [10, 10, 0],
                  [0, 10, 0],
                ],
              ],
              attributes: {},
              lod: "2.2",
            },
          ],
        },
      },
      vertexCount: 4,
    };

    const { records } = toObjectRecords(synthetic);
    expect(records.map((r) => r.id)).toEqual(["child"]);
  });

  it("carries parents and children through unchanged", () => {
    const { records } = toObjectRecords(model);
    const byId = new Map(records.map((r) => [r.id, r]));
    expect(byId.get("NL.IMBAG.Pand.0001")!.children).toEqual([
      "NL.IMBAG.Pand.0001-part1",
    ]);
    expect(byId.get("NL.IMBAG.Pand.0001-part1")!.parents).toEqual([
      "NL.IMBAG.Pand.0001",
    ]);
  });

  it("collects the union of surface attribute keys", () => {
    const { surfaceAttrKeys } = toObjectRecords(model);
    expect(Array.isArray(surfaceAttrKeys)).toBe(true);
    // Only the semantic "slope" attribute appears anywhere in the fixture's
    // surfaces (GroundSurface/WallSurface carry no extra keys beyond "type",
    // which extractSemanticAttributes already strips).
    expect([...surfaceAttrKeys].sort()).toEqual(["slope"]);
  });
});
