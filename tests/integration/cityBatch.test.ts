/**
 * The columnar batch against real data: every object, attribute, relation and
 * surface of the whole Delft fixture (`fixtures/delft.fcb`, 1115 features)
 * reads back from the columns exactly, and the batch's byte count is the sum
 * of the buffers it transfers.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FcbReader, toCityJSONMetadata } from "@cityjson/flatcitybuf";
import {
  batchTransferables,
  cityBatchFromModel,
  dequantizeAll,
  mapMetadata,
  mergeBBox,
  parseCityObject,
  type BBox3,
  type CityJSONFeature,
  type CityJSONObject,
  type CityJSONRoot,
  type CityModel,
  type CityObject,
} from "@cityjson/navara-core";
import { expectBatchMatchesModel } from "../../packages/cityjson-navara-plugins/packages/navara-core/tests/columnar/batchOracle";
import { expectRulesMatchGraph } from "../../packages/cityjson-navara-plugins/packages/navara-core/tests/columnar/styleOracle";
import type { Rule } from "@cityjson/navara-core";

let cached: Promise<CityModel> | undefined;
const delftModel = (): Promise<CityModel> => (cached ??= readDelft());

async function readDelft(): Promise<CityModel> {
  const bytes = new Uint8Array(
    fs.readFileSync(
      path.resolve(import.meta.dirname!, "../../fixtures/delft.fcb"),
    ),
  );
  const reader = await FcbReader.fromBytes(bytes);
  const cjHeader = toCityJSONMetadata(reader.header) as unknown as CityJSONRoot;
  const objects: Record<string, CityObject> = {};
  let bbox: BBox3 | null = null;
  let vertexCount = 0;
  for await (const f of await reader.select({})) {
    const feature = f.toCityJSON(reader.header) as unknown as CityJSONFeature;
    const vertices = dequantizeAll(feature.vertices, cjHeader.transform!);
    vertexCount += feature.vertices.length;
    for (const [id, raw] of Object.entries(feature.CityObjects) as [
      string,
      CityJSONObject,
    ][]) {
      const obj = parseCityObject(id, raw, vertices);
      objects[id] = obj;
      bbox = mergeBBox(bbox, obj.bbox);
    }
  }
  return {
    sourceEncoding: "flatcitybuf",
    metadata: mapMetadata(cjHeader.metadata),
    bbox,
    objects,
    vertexCount,
  };
}

describe("CityBatch on Delft", () => {
  it("holds the whole object graph, exactly", async () => {
    const model = await delftModel();
    expect(Object.keys(model.objects).length).toBeGreaterThan(1115);
    const batch = cityBatchFromModel(model);
    expectBatchMatchesModel(batch, model);
  }, 60_000);

  it("counts its bytes exactly and pools vertices across surfaces", async () => {
    const model = await delftModel();
    const batch = cityBatchFromModel(model);
    const sum = batchTransferables(batch).reduce((n, b) => n + b.byteLength, 0);
    expect(batch.byteLength).toBe(sum);
    let ringVertices = 0;
    let pooled = 0;
    for (const block of batch.lods.values()) {
      ringVertices += block.ringVertex.length;
      pooled += block.vertices.length / 3;
    }
    // A shared pool: far fewer coordinates than ring vertices.
    expect(pooled).toBeLessThan(ringVertices / 2);
  }, 60_000);

  it("rules a BuildingPart's roofs by its Building's 3DBAG attributes, as the graph does", async () => {
    const model = await delftModel();
    const rule = (
      id: string,
      conditions: Rule["conditions"],
      logic: Rule["logic"] = "AND",
    ): Rule => ({
      id,
      name: id,
      color: "#ff0000",
      conditions,
      logic,
      enabled: true,
    });
    const { roofs, matched } = expectRulesMatchGraph(model, [
      rule("flat-high", [
        { field: "b3_dak_type", operator: "=", value: "horizontal" },
        { field: "b3_h_dak_50p", operator: ">", value: 10 },
      ]),
      rule(
        "steep-or-big",
        [
          { field: "inclinationDeg", operator: ">=", value: 35 },
          { field: "areaSqM", operator: ">", value: 200 },
        ],
        "OR",
      ),
      rule("old", [
        { field: "oorspronkelijkbouwjaar", operator: "<", value: 1950 },
      ]),
    ]);
    expect(roofs).toBeGreaterThan(1000);
    // Every Delft roof sits on a BuildingPart, so a match is inheritance at work.
    expect(matched).toBeGreaterThan(roofs / 10);
  }, 60_000);
});
