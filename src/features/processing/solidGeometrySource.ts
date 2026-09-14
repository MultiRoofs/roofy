/**
 * "Does this object have a SOLID at LoD X?" — for the LoD select of Measure
 * solids and Validate solids (spec §6, §7.2, §7.3).
 *
 * TAGS ONLY, like its roof sibling: `Surface.geometryType` is stamped by the
 * parser (`buildSurface`) from the CityJSON geometry each surface came from, so
 * the answer is a set lookup and no geometry is ever measured to fill a
 * dropdown. The contributor rule, the FEATURE counting and the ordering are
 * `lodOptionsBy`'s, shared with `roofLodOptions`.
 *
 * The static/streaming split for solids lives HERE and nowhere else.
 */
import type { Layer } from "../layers/layerStore";
import { lodOptionsBy, type LodOption } from "./roofGeometrySource";
// The three CityJSON geometry types that carry a solid come from the ONE place
// that spells them (`solidRollUp.ts`, which the executors read the reader's
// `geometry_properties_lod*.type` against). The MODEL's tags and the READER's
// properties struct answer the same question about the same file, so two lists
// would be two answers: a type added there and not here would offer the user an
// LoD whose every feature the run then skipped as "not a solid". Every surface
// type, `null` (CityParquet, which has no such information) and an absent tag
// (a hand-built `Surface`) read as NOT a solid.
import { SOLID_GEOMETRY_TYPES } from "./solidRollUp";

/**
 * A per-object solid test for one layer, built once and then O(1) per call.
 *
 * A STREAMING layer answers `false` for everything: `ResidentObjectRecord`
 * carries `geometryLods` and pre-computed roof metrics and NOTHING about
 * geometry type, so there is no honest `true` to give. That costs nothing —
 * the solids tools declare `needsReader: true` and `eligibility.ts` refuses a
 * streaming target before any LoD is offered.
 */
export function hasSolidAt(
  layer: Layer,
): (objectId: string, lod: string) => boolean {
  if (layer.isStreaming) return () => false;
  const byObject = new Map<string, ReadonlySet<string>>();
  for (const [id, object] of Object.entries(layer.model.objects)) {
    const lods = new Set<string>();
    for (const surface of object.surfaces) {
      const geometryType = surface.geometryType;
      if (
        surface.lod !== null &&
        geometryType != null &&
        SOLID_GEOMETRY_TYPES.has(geometryType)
      ) {
        lods.add(surface.lod);
      }
    }
    byObject.set(id, lods);
  }
  return (objectId, lod) => byObject.get(objectId)?.has(lod) ?? false;
}

/**
 * Spec §6's LoD select for the solids tools: the LoDs at which the target has
 * SOLID geometry, each with the count of FEATURES that have it, parts folded
 * into their building, highest detail first.
 */
export function solidLodOptions(layer: Layer): ReadonlyArray<LodOption> {
  return lodOptionsBy(layer, hasSolidAt(layer));
}
