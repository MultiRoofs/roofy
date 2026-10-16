import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CITYMODEL_ENCODING_PRIORITY } from "@cityjson/navara-core";
import {
  CITY_FORMATS,
  SNIFF_BYTES,
  cityFormat,
  detectFormat,
  formatFromName,
  sniffFormat,
} from "../../../../../src/domain/citymodel/formats";

const ROOT = resolve(__dirname, "../../../../..");
const fixture = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(ROOT, path))).subarray(0, SNIFF_BYTES);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

const DELFT_FCB = fixture("fixtures/delft.fcb");
const CITYJSON = fixture("fixtures/two-buildings.city.json");
const CITYJSONSEQ = fixture("fixtures/two-buildings.city.jsonl");
const CITYGML = fixture("fixtures/citygml-appearance.gml");
const PARQUET = fixture(
  "packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/two-buildings-cityparquet/building.parquet",
);
const ZIP = zipSync({ "model.gml": text("<CityModel/>") });
const GZIP = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0]);

describe("the format registry", () => {
  it("has exactly one format per encoding the app knows", () => {
    expect(CITY_FORMATS.map((f) => f.id).sort()).toEqual(
      [...CITYMODEL_ENCODING_PRIORITY].sort(),
    );
    for (const id of CITYMODEL_ENCODING_PRIORITY) {
      expect(cityFormat(id).id).toBe(id);
    }
  });

  it("says how each format is read and where its table comes from", () => {
    expect(cityFormat("cityjson")).toMatchObject({
      label: "CityJSON",
      access: "whole",
      adapter: null,
      table: { kind: "reader", reader: "read_cityjson" },
    });
    expect(cityFormat("cityjsonseq").table).toEqual({
      kind: "reader",
      reader: "read_cityjsonseq",
      extension: "city.jsonl",
    });
    expect(cityFormat("citygml").table).toEqual({ kind: "model" });
    expect(cityFormat("flatcitybuf")).toMatchObject({
      access: "stream",
      adapter: "flatcitybuf",
      table: { kind: "cells" },
    });
    expect(cityFormat("cityparquet")).toMatchObject({
      access: "by-size",
      adapter: "cityparquet",
      table: { kind: "parquet" },
    });
  });
});

describe("formatFromName", () => {
  it.each([
    ["model.city.json", "cityjson"],
    ["model.json", "cityjson"],
    ["model.city.jsonl", "cityjsonseq"],
    ["data.jsonl", "cityjsonseq"],
    ["buildings.fcb", "flatcitybuf"],
    ["buildings.gml", "citygml"],
    ["buildings.citygml", "citygml"],
    ["archive.zip", "citygml"],
    ["model.parquet", "cityparquet"],
    ["https://x/y/building.parquet", "cityparquet"],
    ["https://x/pkg/", "cityparquet"],
    ["gs://bucket/tiles/*.parquet", "cityparquet"],
    ["https://example.com/data.city.jsonl?token=abc", "cityjsonseq"],
    ["https://example.com/model.fcb#section", "flatcitybuf"],
    ["/data/model.city.jsonl", "cityjsonseq"],
    ["Model.CITY.JSON", "cityjson"],
    ["Buildings.FCB", "flatcitybuf"],
    ["tile.city.json.gz", "cityjson"],
    ["tile.city.jsonl.gz", "cityjsonseq"],
    ["model.gml.gz", "citygml"],
    ["model.parquet.gz", "cityparquet"],
  ])("reads %s as %s", (name, expected) => {
    expect(formatFromName(name)).toBe(expected);
  });

  it.each([
    "",
    "modelfile",
    "model.xyz",
    "https://example.com/data?file=model.city.jsonl",
  ])("says nothing about %j", (name) => {
    expect(formatFromName(name)).toBeNull();
  });
});

describe("sniffFormat", () => {
  it("recognises every fixture from its first bytes", () => {
    expect(sniffFormat(DELFT_FCB)).toBe("flatcitybuf");
    expect(sniffFormat(PARQUET)).toBe("cityparquet");
    expect(sniffFormat(CITYGML)).toBe("citygml");
    expect(sniffFormat(ZIP)).toBe("citygml");
    expect(sniffFormat(CITYJSONSEQ)).toBe("cityjsonseq");
    expect(sniffFormat(CITYJSON)).toBe("cityjson");
  });

  it("reads past a byte-order mark and leading whitespace", () => {
    expect(sniffFormat(text("﻿  <?xml version='1.0'?>"))).toBe("citygml");
    expect(sniffFormat(text('\n {"type":"CityJSON"}'))).toBe("cityjson");
  });

  it("does not call a hand-formatted CityJSON document a sequence", () => {
    // The second line opens an object, but the first line is not a whole one.
    const allman = text(
      '{"type":"CityJSON","version":"2.0","transform":\n{"scale":[1,1,1]}}',
    );
    expect(sniffFormat(allman)).toBe("cityjson");
    expect(detectFormat({ name: "a.city.json", head: allman })).toBe(
      "cityjson",
    );
    const braceAlone = text('{\n  "type": "CityJSON",\n  "x": {\n');
    expect(sniffFormat(braceAlone)).toBe("cityjson");
  });

  it("cannot see through gzip, and says so", () => {
    expect(sniffFormat(GZIP)).toBeNull();
    expect(sniffFormat(new Uint8Array())).toBeNull();
    expect(sniffFormat(text("hello"))).toBeNull();
  });
});

describe("detectFormat", () => {
  it("takes the user's choice over everything", () => {
    expect(
      detectFormat({ name: "a.fcb", head: CITYJSON, override: "cityjsonseq" }),
    ).toBe("cityjsonseq");
  });

  it("believes magic bytes over a name that lies", () => {
    expect(detectFormat({ name: "tile.json", head: DELFT_FCB })).toBe(
      "flatcitybuf",
    );
    expect(detectFormat({ name: "tile.city.json", head: CITYJSONSEQ })).toBe(
      "cityjsonseq",
    );
    expect(detectFormat({ name: "download", head: PARQUET })).toBe(
      "cityparquet",
    );
  });

  it("corrects a name whose bytes rule it out", () => {
    expect(detectFormat({ name: "tile.fcb", head: CITYJSON })).toBe("cityjson");
  });

  it("keeps the name when the head cannot tell the two JSON formats apart", () => {
    // A sequence whose first line is longer than the head: one `{`, no second
    // line yet. The name is the better witness.
    const longFirstLine = text(
      `{"type":"CityJSON","metadata":{"title":"${"x".repeat(200)}"`,
    );
    expect(detectFormat({ name: "t.city.jsonl", head: longFirstLine })).toBe(
      "cityjsonseq",
    );
    expect(detectFormat({ name: "t.city.json", head: longFirstLine })).toBe(
      "cityjson",
    );
  });

  it("falls back to the name, then to CityJSON, when the bytes say nothing", () => {
    expect(detectFormat({ name: "t.city.jsonl.gz", head: GZIP })).toBe(
      "cityjsonseq",
    );
    expect(detectFormat({ name: "https://x/t.gml" })).toBe("citygml");
    expect(detectFormat({ name: "endpoint" })).toBe("cityjson");
    expect(detectFormat({ name: "endpoint", head: CITYGML })).toBe("citygml");
  });
});
