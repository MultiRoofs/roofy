/**
 * The app's domain vocabulary for a city model.
 *
 * The declarations moved to `@cityjson/navara-core` in M7.2 — the FCB worker
 * and the plugin packages need them and cannot import from the host app — so
 * this file is a re-export. It is KEPT deliberately (Task C22, which deleted
 * every other M7.2 re-export shim): `CityModel`/`CityObject`/`Surface` are the
 * app's own nouns, ~26 modules name this path, and repointing all of them at a
 * package specifier would trade a meaningful `domain/citymodel` import for
 * import churn without removing a concept.
 *
 * Its siblings — the raw CityJSON wire types, the parsers, the parse helpers,
 * the encoding list, the proj4 registration — had a handful of callers each
 * and are gone; import those from `@cityjson/navara-core` directly.
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
