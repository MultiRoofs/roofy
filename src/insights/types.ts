/**
 * Statistics types for the analytics module.
 */

export interface OrientationCount {
  readonly band: string;
  readonly count: number;
}

export interface ModelStats {
  readonly buildingCount: number;
  readonly surfaceCount: number;
  readonly roofSurfaceCount: number;
  readonly totalRoofArea: number;
  readonly avgBuildingHeight: number;
  readonly minBuildingHeight: number;
  readonly maxBuildingHeight: number;
  readonly avgRoofSlope: number;
  readonly roofsByOrientation: ReadonlyArray<OrientationCount>;
}

export interface ObjectStats {
  readonly objectId: string;
  readonly objectType: string;
  readonly surfaceCount: number;
  readonly roofSurfaceCount: number;
  readonly totalRoofArea: number;
  readonly height: number | null;
  readonly avgRoofSlope: number;
  readonly avgRoofAzimuth: number;
}
