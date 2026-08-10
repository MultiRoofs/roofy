/**
 * The engine descriptions a {@link GeoLayer} becomes: one source, one layer.
 *
 * ENGINE-FREE, exactly like `basemaps.ts`, `terrain.ts` and `googleTiles.ts`:
 * plain data, importable under Node (where `@navaramap/three` cannot even be
 * loaded — NODE_IMPORT_SAFE = false), so every default below is pinned by a
 * unit test rather than by a screenshot. `geoLayerSync.ts` is the only caller.
 *
 * The one non-obvious rule the shapes encode: `Layer.update()` REPLACES the
 * whole description, so {@link geoLayerDescription} always builds a COMPLETE
 * one from the store record. There is no "patch" form, deliberately — a patch
 * would silently drop every field it did not mention.
 */
import type { GeoLayer } from "../features/geoLayers/geoLayerStore";

/**
 * One accent for every user-supplied vector layer, in the `0xRRGGBB` form
 * Navara's materials take.
 *
 * THEME-AGNOSTIC on purpose. The app's own accent follows the light/dark
 * toggle, but a geospatial layer is drawn on the globe, over imagery whose
 * brightness has nothing to do with the chrome — a colour that flipped with
 * the UI theme would be legible over Esri imagery in one theme and lost in it
 * in the other. This orange-red reads against the Esri basemap, the default
 * photoreal globe and the city meshes' grey alike, and it is deliberately not
 * a hue the roof rule palettes use, so a styled roof is never mistaken for
 * imported data.
 */
export const GEO_ACCENT_COLOR = 0xff5a3c;

/**
 * Point size, in PIXELS (`sizeInMeters: false`).
 *
 * Navara's `PointMaterial` defaults `sizeInMeters` to true, which is the wrong
 * default for imported data: a 24 m sprite is a blot from a rooftop camera and
 * a sub-pixel speck from a city-wide one. In pixels a point is a map symbol —
 * the same size at every altitude, which is what a POI layer wants.
 */
export const GEOJSON_POINT_SIZE_PX = 24;

/** Line width in pixels for imported polylines. Two, so a road network reads
 *  as lines rather than as a smear at city zoom. */
export const GEOJSON_LINE_WIDTH_PX = 2;

/**
 * Screen-space error budget for an imported 3D tileset.
 *
 * The same value `googleTiles.ts` runs the photorealistic tiles at: this is a
 * city viewer whose own geometry is the subject, and a third-party tileset
 * that out-refines it would spend the frame budget on the backdrop.
 */
export const TILES3D_MAX_SSE = 16;

/** Only meaningful with `transparent`, on the engine's own materials — an
 *  opacity below 1 on an opaque material is silently ignored. */
function isTranslucent(opacity: number): boolean {
  return opacity < 1;
}

/**
 * Where a layer's data comes from, or `null` when there is nothing to fetch.
 *
 * `null` is a real state, not a failure: a GeoJSON layer restored from a
 * snapshot has neither its inline document (never persisted) nor a URL, and
 * must sit in the panel waiting to be re-linked rather than being added to the
 * engine as an empty source.
 */
export function geoSourceDescription(
  layer: GeoLayer,
): Record<string, unknown> | null {
  switch (layer.kind) {
    case "geojson": {
      // No `tiled: true` here although the engine documents it as a GeoJSON-VT
      // index for large files: on 0.0.5 a tiled geojson source renders NOTHING
      // (browser-verified against the Delft fixture; the engine's own examples
      // only ever use the bare form). Re-test before reintroducing it.
      const { url, data } = layer.config;
      if (url !== undefined && url !== "") {
        return { type: "geojson", url };
      }
      if (data !== undefined) return { type: "geojson", data };
      return null;
    }
    case "raster-xyz": {
      const { urlTemplate, minZoom, maxZoom, tms } = layer.config;
      return {
        type: "raster-tile",
        url: urlTemplate,
        // Written only when given: `Source.update()` MERGES, so an explicit
        // `undefined` is a field the engine would have to interpret, where an
        // absent one is unambiguously "the default".
        ...(minZoom === undefined ? {} : { minZoom }),
        ...(maxZoom === undefined ? {} : { maxZoom }),
        ...(tms === undefined ? {} : { tms }),
      };
    }
    case "3d-tiles":
      return { type: "3d-tiles", url: layer.config.url };
  }
}

/**
 * The COMPLETE layer description for a record, referencing an already-added
 * source.
 *
 * `source` is passed as the opaque handle `addSource` returned (the engine
 * accepts either the handle or its id string), typed `unknown` so this module
 * stays engine-free.
 */
export function geoLayerDescription(
  layer: GeoLayer,
  source: unknown,
): Record<string, unknown> {
  const { visible: show, opacity } = layer;
  switch (layer.kind) {
    case "geojson":
      return {
        type: "vector",
        source,
        point: {
          color: GEO_ACCENT_COLOR,
          size: GEOJSON_POINT_SIZE_PX,
          sizeInMeters: false,
          // Imported data rarely carries a height, and when it does it is
          // rarely an ellipsoidal one — clamping is what puts a road on the
          // road rather than 43 m under the terrain (the geoid separation
          // this app spends a whole module correcting for city models).
          clampToGround: true,
          show,
          opacity,
        },
        polyline: {
          color: GEO_ACCENT_COLOR,
          width: GEOJSON_LINE_WIDTH_PX,
          clampToGround: true,
          show,
          opacity,
        },
        polygon: {
          color: GEO_ACCENT_COLOR,
          clampToGround: true,
          show,
          opacity,
          transparent: isTranslucent(opacity),
        },
      };
    case "raster-xyz":
      return {
        type: "raster",
        source,
        raster: { opacity, show },
      };
    case "3d-tiles":
      return {
        type: "3d-tiles",
        source,
        model: {
          // Does NOT cast: an imported tileset is usually photogrammetry with
          // its own baked lighting, and casting from it doubles every shadow
          // already in the texture. It receives, so the city's shadows land on
          // it.
          castShadow: false,
          receiveShadow: true,
          maxSse: TILES3D_MAX_SSE,
          show,
          opacity,
          transparent: isTranslucent(opacity),
        },
      };
  }
}
