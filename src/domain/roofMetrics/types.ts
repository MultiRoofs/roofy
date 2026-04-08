/**
 * Computed geometric metrics for a single roof surface.
 * Derived from Surface.rings polygon geometry.
 */

export interface RoofMetrics {
  /** Polygon area in model units squared (typically m²). */
  readonly areaSqM: number;
  /** Inclination from horizontal in degrees. 0=flat roof, 90=vertical wall. */
  readonly inclinationDeg: number;
  /** Compass bearing the surface faces in degrees. 0=N, 90=E, 180=S, 270=W. */
  readonly azimuthDeg: number;
  /** Minimum elevation (Z coordinate) of the surface in model units. */
  readonly elevationM: number;
}
