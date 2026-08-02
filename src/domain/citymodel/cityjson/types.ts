/**
 * Re-export shim — the raw CityJSON wire types now live in
 * `@cityjson/navara-core` (M7.2 of the Navara migration).
 */

export type {
  CityJSONRoot,
  CityJSONTransform,
  CityJSONVertex,
  CityJSONObjectType,
  CityJSONObject,
  CityJSONGeometryType,
  CityJSONGeometryBase,
  CityJSONSurfaceGeometry,
  CityJSONGeometryInstance,
  CityJSONGeometry,
  CityJSONSemanticSurfaceType,
  CityJSONSemanticSurface,
  CityJSONSemantics,
  CityJSONMetadata,
  CityJSONPointOfContact,
  CityJSONGeometryTemplates,
} from "@cityjson/navara-core";
