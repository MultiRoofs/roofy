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
  /** The area-weighted circular mean of the object's roof azimuths, or `null`
   *  when it has none to average — every roof flat, or no roof at all. NOT 0
   *  for that: 0 is due north, and a gate that cannot tell the two apart hides
   *  the row for a north-facing building (the same collision
   *  `computeRoofMetrics` and `aggregateRoofMetrics` removed). */
  readonly avgRoofAzimuth: number | null;
}
