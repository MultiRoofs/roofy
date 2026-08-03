/**
 * CityGML 2.0 / 3.0 parser.
 *
 * Converts CityGML XML text into the format-neutral CityModel.
 * Uses fast-xml-parser (DOM-based) for XML parsing.
 *
 * Supports:
 *  - CityGML 2.0 (bldg:boundedBy > bldg:RoofSurface, etc.)
 *  - CityGML 3.0 (boundary > con:RoofSurface, etc.)
 *  - LoD 0-4 geometry containers
 *  - Lenient parsing: skips malformed elements, logs warnings
 *
 * Limitations (documented for future work):
 *  - Only Building / BuildingPart object types (other types planned)
 *  - DOM-based: for files >100MB, a SAX streaming parser would be needed
 *  - XLink references in Solid geometry are skipped; only inline polygons
 *    in semantic surfaces are extracted
 *  - No DuckDB/analytics integration for CityGML (CityJSON only for now)
 */

import { XMLParser } from "fast-xml-parser";
import type {
  BBox3,
  CityModel,
  CityModelMetadata,
  CityObject,
  Surface,
  Vec3,
} from "../types";
import { mergeBBox } from "@cityjson/navara-core";
import type {
  GMLEnvelope,
  GMLMultiSurface,
  GMLPolygon,
  GMLSolid,
  XMLNode,
} from "./types";
import {
  collectPolygonsFromMultiSurface,
  collectPolygonsFromSolid,
  detectLodFromElementName,
  findLodGeometryEntries,
  normalizeSrsName,
  parsePolygon,
  resolveGMLSurfaceType,
  stripPrefix,
} from "./xmlHelpers";

// ---------------------------------------------------------------------------
// XML parser configuration
// ---------------------------------------------------------------------------

// Elements that can appear multiple times and must always be parsed as arrays
const ALWAYS_ARRAY_TAGS = new Set([
  "core:cityObjectMember",
  "cityObjectMember",
  "gml:featureMember",
  "featureMember",
  "gml:surfaceMember",
  "surfaceMember",
  "bldg:boundedBy",
  "boundary",
  "gml:interior",
  "bldg:consistsOfBuildingPart",
  "con:consistsOfBuildingPart",
  "consistsOfBuildingPart",
]);

function buildParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false, // keep all values as strings
    trimValues: true,
    processEntities: false, // CityGML never uses custom entities; disabling prevents XML bombs
    isArray: (
      _name: string,
      _jpath: unknown,
      isLeafNode: boolean,
      _isAttribute: boolean,
    ) => {
      if (isLeafNode) return false;
      return ALWAYS_ARRAY_TAGS.has(_name);
    },
  });
}

// ---------------------------------------------------------------------------
// Root element resolution
// ---------------------------------------------------------------------------

function findCityModelNode(root: XMLNode): XMLNode | null {
  // Direct keys: "core:CityModel", "CityModel", "citygml:CityModel", etc.
  for (const [key, value] of Object.entries(root)) {
    if (key.startsWith("@_") || key.startsWith("?")) continue;
    const localName = stripPrefix(key);
    if (
      localName === "CityModel" &&
      typeof value === "object" &&
      value !== null
    ) {
      return value as XMLNode;
    }
  }
  // Maybe the root IS the CityModel (no wrapper)
  if (root["cityObjectMember"] || root["core:cityObjectMember"]) {
    return root;
  }
  return null;
}

// ---------------------------------------------------------------------------
// CRS extraction
// ---------------------------------------------------------------------------

function extractCRS(cityModel: XMLNode): string | undefined {
  const boundedBy = (cityModel["gml:boundedBy"] ?? cityModel["boundedBy"]) as
    | XMLNode
    | undefined;
  if (!boundedBy) return undefined;

  const envelope = (boundedBy["gml:Envelope"] ?? boundedBy["Envelope"]) as
    | GMLEnvelope
    | undefined;
  if (!envelope) return undefined;

  const srsName = envelope["@_srsName"];
  if (typeof srsName !== "string" || srsName.length === 0) return undefined;

  return normalizeSrsName(srsName);
}

// ---------------------------------------------------------------------------
// Member iteration
// ---------------------------------------------------------------------------

function getMembers(cityModel: XMLNode): XMLNode[] {
  const members: XMLNode[] = [];
  for (const key of [
    "core:cityObjectMember",
    "cityObjectMember",
    "gml:featureMember",
    "featureMember",
  ]) {
    const value = cityModel[key];
    if (Array.isArray(value)) {
      members.push(...(value as XMLNode[]));
    } else if (typeof value === "object" && value !== null) {
      members.push(value as XMLNode);
    }
  }
  return members;
}

// ---------------------------------------------------------------------------
// Building types we currently support
// ---------------------------------------------------------------------------

const SUPPORTED_BUILDING_TYPES = new Set(["Building", "BuildingPart"]);

// ---------------------------------------------------------------------------
// BBox helpers
// ---------------------------------------------------------------------------

type MutableBBox = [number, number, number, number, number, number];

function emptyBBox(): MutableBBox {
  return [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
}

function expandBBox(bbox: MutableBBox, v: Vec3): void {
  if (v[0] < bbox[0]) bbox[0] = v[0];
  if (v[1] < bbox[1]) bbox[1] = v[1];
  if (v[2] < bbox[2]) bbox[2] = v[2];
  if (v[0] > bbox[3]) bbox[3] = v[0];
  if (v[1] > bbox[4]) bbox[4] = v[1];
  if (v[2] > bbox[5]) bbox[5] = v[2];
}

function finalizeBBox(bbox: MutableBBox): BBox3 | null {
  return bbox[0] === Infinity ? null : (bbox as BBox3);
}

// ---------------------------------------------------------------------------
// Surface extraction from a building node
// ---------------------------------------------------------------------------

/**
 * Extract surfaces from semantic boundary children.
 *
 * CityGML 2.0: <bldg:boundedBy> <bldg:RoofSurface> <bldg:lod2MultiSurface> ...
 * CityGML 3.0: <boundary> <con:RoofSurface> <lod2MultiSurface> ...
 */
function extractSemanticSurfaces(
  node: XMLNode,
  bbox: MutableBBox,
): { surfaces: Surface[]; vertexCount: number } {
  const surfaces: Surface[] = [];
  let vertexCount = 0;

  // Collect all boundary containers (v2: bldg:boundedBy, v3: boundary)
  const boundaryContainers: XMLNode[] = [];
  for (const key of ["bldg:boundedBy", "boundary"]) {
    const val = node[key];
    if (Array.isArray(val)) {
      boundaryContainers.push(...(val as XMLNode[]));
    } else if (typeof val === "object" && val !== null) {
      boundaryContainers.push(val as XMLNode);
    }
  }

  for (const container of boundaryContainers) {
    // Find the semantic surface element (first non-attribute child)
    for (const [surfaceKey, surfaceValue] of Object.entries(container)) {
      if (surfaceKey.startsWith("@_")) continue;
      if (typeof surfaceValue !== "object" || surfaceValue === null) continue;

      const surfaceType = resolveGMLSurfaceType(surfaceKey);
      const surfaceNode = surfaceValue as XMLNode;

      // Find lod*MultiSurface or lod*Solid geometry containers
      const geomEntries = findLodGeometryEntries(surfaceNode);
      for (const [geomName, geomValue] of geomEntries) {
        if (typeof geomValue !== "object" || geomValue === null) continue;

        const lod = detectLodFromElementName(geomName);
        const geomNode = geomValue as XMLNode;

        // Try MultiSurface
        const ms = (geomNode["gml:MultiSurface"] ?? geomNode["MultiSurface"]) as
          | GMLMultiSurface
          | undefined;
        if (ms) {
          const polygons = collectPolygonsFromMultiSurface(ms);
          for (const poly of polygons) {
            const rings = parsePolygon(poly);
            if (!rings) continue;
            for (const ring of rings) {
              for (const v of ring) {
                expandBBox(bbox, v);
                vertexCount++;
              }
            }
            surfaces.push({ type: surfaceType, rings, attributes: {}, lod });
          }
        }

        // Try Solid
        const solid = (geomNode["gml:Solid"] ?? geomNode["Solid"]) as
          | GMLSolid
          | undefined;
        if (solid) {
          const polygons = collectPolygonsFromSolid(solid);
          for (const poly of polygons) {
            const rings = parsePolygon(poly);
            if (!rings) continue;
            for (const ring of rings) {
              for (const v of ring) {
                expandBBox(bbox, v);
                vertexCount++;
              }
            }
            surfaces.push({ type: surfaceType, rings, attributes: {}, lod });
          }
        }
      }
    }
  }

  return { surfaces, vertexCount };
}

/**
 * Fallback: extract geometry directly from lod*Solid / lod*MultiSurface
 * on the building node itself (no semantic surface type available).
 */
function extractFallbackGeometry(
  node: XMLNode,
  bbox: MutableBBox,
): { surfaces: Surface[]; vertexCount: number } {
  const surfaces: Surface[] = [];
  let vertexCount = 0;

  const geomEntries = findLodGeometryEntries(node);
  for (const [geomName, geomValue] of geomEntries) {
    if (typeof geomValue !== "object" || geomValue === null) continue;

    const lod = detectLodFromElementName(geomName);
    const geomNode = geomValue as XMLNode;

    let polygons: GMLPolygon[] = [];

    const ms = (geomNode["gml:MultiSurface"] ?? geomNode["MultiSurface"]) as
      | GMLMultiSurface
      | undefined;
    if (ms) {
      polygons = collectPolygonsFromMultiSurface(ms);
    }

    const solid = (geomNode["gml:Solid"] ?? geomNode["Solid"]) as
      | GMLSolid
      | undefined;
    if (solid) {
      polygons = polygons.concat(collectPolygonsFromSolid(solid));
    }

    for (const poly of polygons) {
      const rings = parsePolygon(poly);
      if (!rings) continue;
      for (const ring of rings) {
        for (const v of ring) {
          expandBBox(bbox, v);
          vertexCount++;
        }
      }
      surfaces.push({ type: "unknown", rings, attributes: {}, lod });
    }
  }

  return { surfaces, vertexCount };
}

// ---------------------------------------------------------------------------
// Object parsing
// ---------------------------------------------------------------------------

function extractAttributes(node: XMLNode): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) continue;
    // Skip geometry containers and boundary elements
    const localName = stripPrefix(key);
    if (/^lod\d/i.test(localName)) continue;
    if (
      localName === "boundedBy" ||
      key === "bldg:boundedBy" ||
      key === "boundary"
    )
      continue;
    if (
      key === "bldg:consistsOfBuildingPart" ||
      key === "con:consistsOfBuildingPart" ||
      key === "consistsOfBuildingPart"
    )
      continue;
    // Only include simple scalar values
    if (typeof value === "string" || typeof value === "number") {
      attrs[localName] = value;
    }
  }
  return attrs;
}

function parseBuildingNode(
  id: string,
  objectType: string,
  node: XMLNode,
): { object: CityObject; vertexCount: number } {
  const bbox = emptyBBox();

  // Try semantic surface extraction first
  let { surfaces, vertexCount } = extractSemanticSurfaces(node, bbox);

  // Fallback to direct geometry if no semantic surfaces found
  if (surfaces.length === 0) {
    const fallback = extractFallbackGeometry(node, bbox);
    surfaces = fallback.surfaces;
    vertexCount = fallback.vertexCount;
  }

  // Determine highest LoD
  let highestLod: string | null = null;
  for (const s of surfaces) {
    if (
      s.lod !== null &&
      (highestLod === null || parseFloat(s.lod) > parseFloat(highestLod))
    ) {
      highestLod = s.lod;
    }
  }

  return {
    object: {
      id,
      objectType,
      attributes: extractAttributes(node),
      surfaces,
      bbox: finalizeBBox(bbox),
      children: [], // populated by parseMember after parts are parsed
      parents: [],
      lod: highestLod,
    },
    vertexCount,
  };
}

// ---------------------------------------------------------------------------
// Top-level member parsing
// ---------------------------------------------------------------------------

function parseMember(
  member: XMLNode,
  idCounter: { n: number },
): Array<{ object: CityObject; vertexCount: number }> | null {
  // Find the first city object element in the member
  for (const [key, value] of Object.entries(member)) {
    if (key.startsWith("@_")) continue;
    if (typeof value !== "object" || value === null) continue;

    const localName = stripPrefix(key);
    if (!SUPPORTED_BUILDING_TYPES.has(localName)) continue;

    const node = value as XMLNode;
    const id =
      typeof node["@_gml:id"] === "string"
        ? node["@_gml:id"]
        : `citygml_obj_${idCounter.n++}`;

    try {
      const result = parseBuildingNode(id, localName, node);
      const results = [result];
      const childIds: string[] = [];

      // Parse BuildingPart children as separate objects with parent refs
      for (const partKey of [
        "bldg:consistsOfBuildingPart",
        "con:consistsOfBuildingPart",
        "consistsOfBuildingPart",
      ]) {
        const parts = node[partKey];
        if (!parts) continue;
        const partList = Array.isArray(parts) ? parts : [parts];
        for (const partWrapper of partList) {
          if (typeof partWrapper !== "object" || partWrapper === null) continue;
          const pw = partWrapper as XMLNode;
          for (const [pKey, pValue] of Object.entries(pw)) {
            if (pKey.startsWith("@_")) continue;
            const pLocalName = stripPrefix(pKey);
            if (
              pLocalName === "BuildingPart" &&
              typeof pValue === "object" &&
              pValue !== null
            ) {
              const partNode = pValue as XMLNode;
              const partId =
                typeof partNode["@_gml:id"] === "string"
                  ? partNode["@_gml:id"]
                  : `${id}_part_${idCounter.n++}`;
              const partResult = parseBuildingNode(
                partId,
                "BuildingPart",
                partNode,
              );
              partResult.object = {
                ...partResult.object,
                parents: [id],
              };
              childIds.push(partId);
              results.push(partResult);
            }
          }
        }
      }

      // Set children on the parent object
      if (childIds.length > 0) {
        result.object = { ...result.object, children: childIds };
      }

      return results;
    } catch {
      // Lenient: skip objects that fail to parse
      console.warn(`[CityGML] Skipping malformed object "${id}"`);
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse CityGML 2.0 or 3.0 XML text into a CityModel.
 *
 * @throws if the input is not valid XML or not a CityGML document.
 */
export function parseCityGML(xmlText: string): CityModel {
  const parser = buildParser();

  let parsed: XMLNode;
  try {
    parsed = parser.parse(xmlText) as XMLNode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid XML — the file could not be parsed. ${msg}`, {
      cause: err,
    });
  }

  const cityModel = findCityModelNode(parsed);
  if (!cityModel) {
    throw new Error(
      "Not a CityGML file — could not find a CityModel root element.",
    );
  }

  const referenceSystem = extractCRS(cityModel);
  const metadata: CityModelMetadata = {
    referenceSystem,
  };

  const members = getMembers(cityModel);
  const objects: Record<string, CityObject> = {};
  let modelBBox: BBox3 | null = null;
  let totalVertexCount = 0;
  const idCounter = { n: 0 };

  for (const member of members) {
    const results = parseMember(member, idCounter);
    if (!results) continue;
    for (const { object: obj, vertexCount } of results) {
      objects[obj.id] = obj;
      modelBBox = mergeBBox(modelBBox, obj.bbox);
      totalVertexCount += vertexCount;
    }
  }

  return {
    sourceEncoding: "citygml",
    metadata,
    bbox: modelBBox,
    objects,
    vertexCount: totalVertexCount,
  };
}
