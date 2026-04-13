/**
 * TypeScript shapes for the fast-xml-parser output of CityGML documents.
 *
 * These describe the raw XML-to-JSON mapping, NOT the domain model.
 * fast-xml-parser is configured with:
 *   - ignoreAttributes: false
 *   - attributeNamePrefix: "@_"
 *   - parseTagValue: false  (all values are strings)
 */

/** Generic XML node — a record whose keys are element/attribute names. */
export type XMLNode = Record<string, unknown>;

export interface GMLEnvelope {
  "@_srsName"?: string;
  "@_srsDimension"?: string;
  "gml:lowerCorner"?: string;
  "gml:upperCorner"?: string;
}

export interface GMLLinearRing {
  "gml:posList"?: string | { "#text": string; "@_srsDimension"?: string };
  "gml:pos"?: string | string[];
}

export interface GMLPolygon {
  "@_gml:id"?: string;
  "@_srsDimension"?: string;
  "gml:exterior"?: { "gml:LinearRing"?: GMLLinearRing };
  "gml:interior"?:
    | { "gml:LinearRing"?: GMLLinearRing }
    | Array<{ "gml:LinearRing"?: GMLLinearRing }>;
}

export interface GMLMultiSurface {
  "gml:surfaceMember"?: GMLSurfaceMemberEntry | GMLSurfaceMemberEntry[];
}

export interface GMLSurfaceMemberEntry {
  "gml:Polygon"?: GMLPolygon;
  "@_xlink:href"?: string;
}

export interface GMLCompositeSurface {
  "gml:surfaceMember"?: GMLSurfaceMemberEntry | GMLSurfaceMemberEntry[];
}

export interface GMLSolid {
  "gml:exterior"?: {
    "gml:CompositeSurface"?: GMLCompositeSurface;
    "gml:Shell"?: {
      "gml:surfaceMember"?: GMLSurfaceMemberEntry | GMLSurfaceMemberEntry[];
    };
  };
}
