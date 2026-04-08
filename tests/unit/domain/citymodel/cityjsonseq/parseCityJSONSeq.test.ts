/**
 * Unit tests for the CityJSONSeq parser.
 *
 * Uses a .city.jsonl fixture derived from the same two-buildings
 * dataset used in CityJSON tests to verify format parity.
 */

import { describe, it, expect } from "vite-plus/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCityJSONSeq } from "../../../../../src/domain/citymodel/cityjsonseq/parseCityJSONSeq";

const fixturePath = path.resolve(
  import.meta.dirname!,
  "../../../../../fixtures/two-buildings.city.jsonl",
);
const fixtureText = fs.readFileSync(fixturePath, "utf-8");

describe("parseCityJSONSeq", () => {
  const model = parseCityJSONSeq(fixtureText);

  it("reports cityjsonseq as sourceEncoding", () => {
    expect(model.sourceEncoding).toBe("cityjsonseq");
  });

  it("parses all three city objects from two features", () => {
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

  it("extracts metadata from header", () => {
    expect(model.metadata.referenceSystem).toBe(
      "https://www.opengis.net/def/crs/EPSG/0/7415",
    );
    expect(model.metadata.title).toBe("Two buildings fixture (seq)");
    expect(model.metadata.identifier).toBe("fixture-two-buildings-seq");
  });

  it("computes a model-level bounding box", () => {
    expect(model.bbox).not.toBeNull();
    expect(model.bbox![0]).toBeCloseTo(85000, 0);
    expect(model.bbox![1]).toBeCloseTo(446000, 0);
    expect(model.bbox![2]).toBeCloseTo(0, 0);
  });

  it("records LoD from geometry", () => {
    const building1 = model.objects["NL.IMBAG.Pand.0001"]!;
    expect(building1.lod).toBe("2.2");
  });

  it("dequantizes vertices correctly for each feature", () => {
    // Building 0002 from the second feature should have its own local vertices
    const building2 = model.objects["NL.IMBAG.Pand.0002"]!;
    expect(building2.bbox).not.toBeNull();
    // translate + vertex * scale: 85000 + 20000*0.001 = 85020
    expect(building2.bbox![0]).toBeCloseTo(85020, 0);
  });

  it("sums vertex count across all features", () => {
    // Feature 1: 17 vertices (0-16), Feature 2: 8 vertices (0-7)
    expect(model.vertexCount).toBe(25);
  });

  it("second building has correct attributes", () => {
    const object = model.objects["NL.IMBAG.Pand.0002"]!;
    expect(object.attributes.measuredHeight).toBe(12.1);
    expect(object.attributes.roofType).toBe("flat");
    expect(object.attributes.function).toBe("office");
    expect(object.children).toHaveLength(0);
  });

  it("throws on empty input", () => {
    expect(() => parseCityJSONSeq("")).toThrow(/Empty CityJSONSeq/);
  });

  it("throws on invalid header type", () => {
    expect(() =>
      parseCityJSONSeq(
        '{"type":"NotCityJSON","version":"2.0","transform":{"scale":[1,1,1],"translate":[0,0,0]},"CityObjects":{},"vertices":[]}',
      ),
    ).toThrow(/Invalid CityJSONSeq header/);
  });

  it("throws on unsupported version", () => {
    expect(() =>
      parseCityJSONSeq(
        '{"type":"CityJSON","version":"1.0","transform":{"scale":[1,1,1],"translate":[0,0,0]},"CityObjects":{},"vertices":[]}',
      ),
    ).toThrow(/Unsupported CityJSON version "1\.0"/);
  });

  it("skips non-CityJSONFeature lines", () => {
    const text = [
      '{"type":"CityJSON","version":"2.0","transform":{"scale":[1,1,1],"translate":[0,0,0]},"CityObjects":{},"vertices":[]}',
      '{"type":"SomethingElse","data":"ignored"}',
    ].join("\n");
    const result = parseCityJSONSeq(text);
    expect(Object.keys(result.objects)).toHaveLength(0);
  });
});
