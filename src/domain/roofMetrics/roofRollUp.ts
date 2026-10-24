/**
 * Spec §7's roll-ups for one set of roof surfaces.
 *
 * "One set" is deliberately vague about WHOSE: the caller decides whether these
 * are a feature's contributor surfaces or one part's own (spec §8, "a Building
 * shows the aggregated value, a part its own"), and the maths is identical.
 *
 * NOT `src/domain/roofMetrics/aggregate.ts`. That module's azimuth is an
 * area-weighted CIRCULAR MEAN with a hard-coded 1° flat threshold, which is
 * what the Details panel has always shown. §7 asks for something different and
 * simpler — "the azimuth of the largest non-flat roof surface" — at the
 * threshold the user chose. Two answers to one question is the bug here; two
 * functions with different questions is not.
 *
 * Pure: no imports, no engine, no store.
 */

/** One roof surface, already measured, tagged with the LoD it came from. */
export interface RoofSurfaceMetric {
  readonly lod: string | null;
  readonly areaSqM: number;
  readonly inclinationDeg: number;
  /** `null` when the surface has no aspect — core answers that below its own
   *  `FLAT_INCLINATION_DEG`, where the tilt would be the frame's own. */
  readonly azimuthDeg: number | null;
}

/** The six measures of spec §7.1, before they are named and filtered. */
export interface RoofRollUp {
  readonly areaM2: number;
  readonly flatM2: number;
  /** `null` when there is no area to take a share OF. */
  readonly flatShare: number | null;
  /** Area-weighted over ALL surfaces; `null` when the total area is 0. */
  readonly slopeDeg: number | null;
  /** Of the largest non-flat surface; `null` when every surface is flat, or
   *  when that surface itself has no aspect (possible at a threshold under
   *  core's `FLAT_INCLINATION_DEG`, where a horizontal roof counts as
   *  non-flat). */
  readonly azimuthDeg: number | null;
  readonly surfaces: number;
}

/**
 * `null` means "nothing to measure" — the caller writes NULL in every column
 * and counts the feature as skipped (§7.1's "no roof surfaces at LoD 1.2").
 *
 * The threshold is STRICT (`inclinationDeg < flatThresholdDeg`), matching
 * §7.1's word "under". A surface at exactly the threshold is therefore NOT
 * flat, and is a candidate for the dominant azimuth. The visible consequence is
 * at the slider's bottom stop: at 0 a perfectly horizontal roof counts as not
 * flat and the flat area is 0, which is what "slope under 0 degrees" means and
 * is why the default is 5. The non-strict reading (`<=`) would make 0 mean
 * "exactly horizontal counts", a different and unasked-for rule.
 */
export function rollUpRoofSurfaces(
  surfaces: ReadonlyArray<RoofSurfaceMetric>,
  flatThresholdDeg: number,
): RoofRollUp | null {
  if (surfaces.length === 0) return null;

  let areaM2 = 0;
  let flatM2 = 0;
  let weightedSlope = 0;
  let dominant: RoofSurfaceMetric | null = null;

  for (const surface of surfaces) {
    areaM2 += surface.areaSqM;
    weightedSlope += surface.inclinationDeg * surface.areaSqM;
    if (surface.inclinationDeg < flatThresholdDeg) {
      flatM2 += surface.areaSqM;
      continue;
    }
    // Strictly greater, so a tie keeps the FIRST surface in source order —
    // the tie rule this spec uses everywhere.
    if (dominant === null || surface.areaSqM > dominant.areaSqM) {
      dominant = surface;
    }
  }

  return {
    areaM2,
    flatM2,
    flatShare: areaM2 > 0 ? flatM2 / areaM2 : null,
    slopeDeg: areaM2 > 0 ? weightedSlope / areaM2 : null,
    azimuthDeg: dominant === null ? null : dominant.azimuthDeg,
    surfaces: surfaces.length,
  };
}
