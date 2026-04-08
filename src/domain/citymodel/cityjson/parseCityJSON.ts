/**
 * Parser that converts a raw CityJSON object into a normalized CityModel.
 *
 * Delegates vertex dequantization, surface extraction, and object
 * parsing to shared helpers in parseHelpers.ts.
 */

import type { BBox3, CityModel, CityObject } from "../types";
import type { CityJSONObject, CityJSONRoot } from "./types";
import {
  dequantizeAll,
  mapMetadata,
  mergeBBox,
  parseCityObject,
} from "./parseHelpers";

export function parseCityJSON(root: CityJSONRoot): CityModel {
  if (!root.version.startsWith("2.")) {
    throw new Error(
      `Unsupported CityJSON version "${root.version}". Only v2.x is supported.`,
    );
  }

  const realVertices = dequantizeAll(root.vertices, root.transform);

  const objects: Record<string, CityObject> = {};
  let modelBBox: BBox3 | null = null;

  for (const [id, rawObj] of Object.entries(root.CityObjects) as [
    string,
    CityJSONObject,
  ][]) {
    const obj = parseCityObject(id, rawObj, realVertices);
    objects[id] = obj;
    modelBBox = mergeBBox(modelBBox, obj.bbox);
  }

  return {
    sourceEncoding: "cityjson",
    metadata: mapMetadata(root.metadata),
    bbox: modelBBox,
    objects,
    vertexCount: root.vertices.length,
  };
}
