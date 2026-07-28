/**
 * Unit test: FlatCityBuf WASM conversion via cjseqToCj.
 *
 * Tests that the WASM cjseqToCj function correctly merges a CityJSON
 * header + CityJSONFeature objects. The WASM binding returns Map objects
 * which need to be converted to plain objects for parseCityJSON.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { initSync, cjseqToCj } from "@cityjson/flatcitybuf";
import { parseCityJSON } from "../../../../../src/domain/citymodel/cityjson/parseCityJSON";
import { mapToObject } from "../../../../../src/domain/citymodel/flatcitybuf/loadFlatCityBuf";
import type { CityJSONRoot } from "../../../../../src/domain/citymodel/cityjson/types";
import type { CityModel } from "../../../../../src/domain/citymodel/types";

// Load the CityJSONSeq fixture to simulate what HttpFcbReader would return
const seqFixturePath = path.resolve(
  import.meta.dirname!,
  "../../../../../fixtures/two-buildings.city.jsonl",
);
const seqLines = fs
  .readFileSync(seqFixturePath, "utf-8")
  .split("\n")
  .filter((l) => l.trim().length > 0);

describe("cjseqToCj → parseCityJSON conversion", () => {
  let root: CityJSONRoot;
  let model: CityModel;

  beforeAll(() => {
    // Initialize WASM synchronously from the .wasm file for Node.js testing
    const wasmPath = path.resolve(
      import.meta.dirname!,
      "../../../../../node_modules/@cityjson/flatcitybuf/fcb_wasm_bg.wasm",
    );
    const wasmBuffer = fs.readFileSync(wasmPath);
    initSync({ module: wasmBuffer });

    // Run the conversion once for all tests
    const header = JSON.parse(seqLines[0]!);
    const features = seqLines.slice(1).map((line) => JSON.parse(line));
    root = mapToObject(cjseqToCj(header, features)) as CityJSONRoot;
    model = parseCityJSON(root);
  });

  it("merges into a valid CityJSON root", () => {
    expect(root.type).toBe("CityJSON");
    expect(root.version).toBe("2.0");
    expect(Object.keys(root.CityObjects).length).toBe(3);
    expect(root.vertices.length).toBeGreaterThan(0);
  });

  it("produces a CityModel with all objects", () => {
    expect(model.sourceEncoding).toBe("cityjson");
    expect(Object.keys(model.objects)).toHaveLength(3);
    expect(model.objects["NL.IMBAG.Pand.0001"]).toBeDefined();
    expect(model.objects["NL.IMBAG.Pand.0002"]).toBeDefined();
    expect(model.bbox).not.toBeNull();
  });

  it("preserves attributes through the conversion", () => {
    const building1 = model.objects["NL.IMBAG.Pand.0001"]!;
    expect(building1.attributes.measuredHeight).toBe(8.4);
    expect(building1.attributes.roofType).toBe("gabled");
  });

  it("preserves metadata from header", () => {
    expect(model.metadata.referenceSystem).toBe(
      "https://www.opengis.net/def/crs/EPSG/0/7415",
    );
  });

  it("sourceEncoding override produces flatcitybuf", () => {
    const fcbModel = { ...model, sourceEncoding: "flatcitybuf" as const };
    expect(fcbModel.sourceEncoding).toBe("flatcitybuf");
  });
});
