/**
 * Parser for CityJSON Text Sequences (.city.jsonl).
 *
 * Reads newline-delimited JSON where:
 *   Line 1: CityJSON header with transform, metadata, empty CityObjects/vertices
 *   Line 2+: CityJSONFeature objects, each carrying local vertices
 *
 * Each feature's vertices are dequantized using the header's transform.
 * The output is a single normalized CityModel identical to what parseCityJSON produces.
 */

import type { BBox3, CityModel, CityObject } from "../types";
import type { CityJSONObject, CityJSONRoot } from "../cityjson/types";
import type { CityJSONFeature } from "./types";
import {
  dequantizeAll,
  mapMetadata,
  mergeBBox,
  parseCityObject,
} from "../cityjson/parseHelpers";

export function parseCityJSONSeq(text: string): CityModel {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("Empty CityJSONSeq file.");
  }

  // Line 1: CityJSON header
  const header = JSON.parse(lines[0]!) as CityJSONRoot;

  if (header.type !== "CityJSON") {
    throw new Error(
      `Invalid CityJSONSeq header: expected "type": "CityJSON", got "${String(header.type)}".`,
    );
  }
  if (!header.version.startsWith("2.")) {
    throw new Error(
      `Unsupported CityJSON version "${header.version}". Only v2.x is supported.`,
    );
  }

  const objects: Record<string, CityObject> = {};
  let modelBBox: BBox3 | null = null;
  let totalVertexCount = 0;

  // Lines 2+: CityJSONFeature objects
  for (let i = 1; i < lines.length; i++) {
    const feature = JSON.parse(lines[i]!) as CityJSONFeature;
    if (feature.type !== "CityJSONFeature") continue;

    // Each feature carries its own local vertex array, dequantized with the header's transform
    const realVertices = dequantizeAll(feature.vertices, header.transform);
    totalVertexCount += feature.vertices.length;

    for (const [id, rawObj] of Object.entries(feature.CityObjects) as [
      string,
      CityJSONObject,
    ][]) {
      const obj = parseCityObject(id, rawObj, realVertices);
      objects[id] = obj;
      modelBBox = mergeBBox(modelBBox, obj.bbox);
    }
  }

  return {
    sourceEncoding: "cityjsonseq",
    metadata: mapMetadata(header.metadata),
    bbox: modelBBox,
    objects,
    vertexCount: totalVertexCount,
  };
}
