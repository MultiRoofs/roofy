/**
 * Re-export shim — these types now live in `@cityjson/navara-core`
 * (M7.2 of the Navara migration). App modules keep importing them from this
 * path; the shim is deleted in M7.7 once call sites are repointed.
 */

export type {
  Vec3,
  BBox3,
  BuildingSurfaceType,
  Surface,
  CityObject,
  CityModelMetadata,
  CityModel,
} from "@cityjson/navara-core";
