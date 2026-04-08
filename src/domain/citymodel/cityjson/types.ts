/**
 * TypeScript types for the CityJSON v2.0 specification.
 *
 * These model the raw JSON structure of a .city.json file.
 * They are NOT the normalized domain model — see ../types.ts for that.
 *
 * Reference: https://www.cityjson.org/specs/
 */

// ---------------------------------------------------------------------------
// Root object
// ---------------------------------------------------------------------------

export interface CityJSONRoot {
  readonly type: "CityJSON";
  readonly version: string;
  readonly transform: CityJSONTransform;
  readonly CityObjects: Readonly<Record<string, CityJSONObject>>;
  readonly vertices: ReadonlyArray<CityJSONVertex>;
  readonly metadata?: CityJSONMetadata;
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly appearance?: unknown;
  readonly "geometry-templates"?: CityJSONGeometryTemplates;
}

// ---------------------------------------------------------------------------
// Transform (quantization)
// ---------------------------------------------------------------------------

export interface CityJSONTransform {
  readonly scale: readonly [number, number, number];
  readonly translate: readonly [number, number, number];
}

// ---------------------------------------------------------------------------
// Vertices (integer-quantized)
// ---------------------------------------------------------------------------

export type CityJSONVertex = readonly [number, number, number];

// ---------------------------------------------------------------------------
// City objects
// ---------------------------------------------------------------------------

export type CityJSONObjectType =
  | "Building"
  | "BuildingPart"
  | "BuildingInstallation"
  | "BuildingConstructiveElement"
  | "BuildingFurniture"
  | "BuildingStorey"
  | "BuildingRoom"
  | "BuildingUnit"
  | "Bridge"
  | "BridgePart"
  | "BridgeInstallation"
  | "BridgeConstructiveElement"
  | "BridgeRoom"
  | "BridgeFurniture"
  | "Tunnel"
  | "TunnelPart"
  | "TunnelInstallation"
  | "TunnelConstructiveElement"
  | "TunnelHollowSpace"
  | "TunnelFurniture"
  | "CityFurniture"
  | "CityObjectGroup"
  | "GenericCityObject"
  | "LandUse"
  | "OtherConstruction"
  | "PlantCover"
  | "SolitaryVegetationObject"
  | "TINRelief"
  | "Road"
  | "Railway"
  | "Waterway"
  | "TransportSquare"
  | "WaterBody";

export interface CityJSONObject {
  readonly type: CityJSONObjectType | (string & {});
  readonly geometry?: ReadonlyArray<CityJSONGeometry>;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly geographicalExtent?: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  readonly children?: ReadonlyArray<string>;
  readonly parents?: ReadonlyArray<string>;
  readonly address?: ReadonlyArray<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type CityJSONGeometryType =
  | "MultiPoint"
  | "MultiLineString"
  | "MultiSurface"
  | "CompositeSurface"
  | "Solid"
  | "MultiSolid"
  | "CompositeSolid"
  | "GeometryInstance";

export interface CityJSONGeometryBase {
  readonly type: CityJSONGeometryType;
  readonly lod: string;
  readonly semantics?: CityJSONSemantics;
  readonly material?: unknown;
  readonly texture?: unknown;
}

/** Surface-based geometry (everything except GeometryInstance). */
export interface CityJSONSurfaceGeometry extends CityJSONGeometryBase {
  readonly type: Exclude<CityJSONGeometryType, "GeometryInstance">;
  readonly boundaries: ReadonlyArray<unknown>;
}

/** An instanced geometry referencing a template. */
export interface CityJSONGeometryInstance extends CityJSONGeometryBase {
  readonly type: "GeometryInstance";
  readonly template: number;
  readonly boundaries: ReadonlyArray<number>;
  readonly transformationMatrix: ReadonlyArray<number>;
}

export type CityJSONGeometry =
  | CityJSONSurfaceGeometry
  | CityJSONGeometryInstance;

// ---------------------------------------------------------------------------
// Semantics
// ---------------------------------------------------------------------------

export type CityJSONSemanticSurfaceType =
  | "RoofSurface"
  | "GroundSurface"
  | "WallSurface"
  | "ClosureSurface"
  | "OuterCeilingSurface"
  | "OuterFloorSurface"
  | "Window"
  | "Door"
  | "InteriorWallSurface"
  | "CeilingSurface"
  | "FloorSurface"
  | "WaterSurface"
  | "WaterGroundSurface"
  | "WaterClosureSurface"
  | "TrafficArea"
  | "AuxiliaryTrafficArea"
  | "TransportationMarking"
  | "TransportationHole";

export interface CityJSONSemanticSurface {
  readonly type: CityJSONSemanticSurfaceType | (string & {});
  readonly parent?: number;
  readonly children?: ReadonlyArray<number>;
  readonly [key: string]: unknown;
}

export interface CityJSONSemantics {
  readonly surfaces: ReadonlyArray<CityJSONSemanticSurface>;
  readonly values: ReadonlyArray<unknown>;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface CityJSONMetadata {
  readonly geographicalExtent?: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  readonly identifier?: string;
  readonly pointOfContact?: CityJSONPointOfContact;
  readonly referenceDate?: string;
  readonly referenceSystem?: string;
  readonly title?: string;
}

export interface CityJSONPointOfContact {
  readonly contactName: string;
  readonly emailAddress: string;
  readonly role?: string;
  readonly website?: string;
  readonly contactType?: "individual" | "organization";
  readonly phone?: string;
  readonly organization?: string;
  readonly address?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Geometry templates
// ---------------------------------------------------------------------------

export interface CityJSONGeometryTemplates {
  readonly templates: ReadonlyArray<CityJSONSurfaceGeometry>;
  readonly "vertices-templates": ReadonlyArray<
    readonly [number, number, number]
  >;
}
