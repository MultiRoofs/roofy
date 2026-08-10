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
 *
 * A vector layer's colour, point size, line width and fill opacity are NOT
 * decided here any more: they live on the record, as `layer.style`, and this
 * module only converts them into the forms the engine's materials take (CSS
 * hex → `0xRRGGBB`, fill opacity → an opacity plus a `transparent` flag).
 * `features/geoLayers/geoLayerStyle.ts` owns the values and their defaults.
 */
import {
  DEFAULT_GEO_LAYER_STYLE,
  hexColorToNumber,
} from "../features/geoLayers/geoLayerStyle";
import type { GeoLayer } from "../features/geoLayers/geoLayerStore";

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
 * The stored CSS hex as the `0xRRGGBB` number Navara's materials take, falling
 * back to the default accent when the string is not a colour.
 *
 * `normalizeGeoLayerStyle` guards the store's own doors, so an unparsable
 * value reaching here means a record that arrived some other way. The fallback
 * is not belt-and-braces: `hexColorToNumber` answers `null` rather than
 * guessing, and handing the engine `NaN` (or `null`) does not raise anything —
 * it draws the layer black or not at all, which looks like a data problem
 * rather than a style one.
 */
function accentColor(style: GeoLayer["style"]): number {
  return (
    hexColorToNumber(style.color) ??
    // Non-null: `DEFAULT_GEO_LAYER_STYLE.color` is a literal `#rrggbb`, and
    // `geoLayerStyle`'s own tests pin that it parses.
    hexColorToNumber(DEFAULT_GEO_LAYER_STYLE.color)!
  );
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
  const { visible: show, opacity, style } = layer;
  switch (layer.kind) {
    case "geojson": {
      const color = accentColor(style);
      // The fill is the one pass with TWO opacities: the layer's (the whole
      // layer fading, shared with every kind) times the style's (this layer's
      // fills reading as a wash while its outlines stay solid). Multiplying
      // keeps them independent — halving either halves what is drawn — where
      // letting the style's win would make the layer slider do nothing to a
      // polygon layer.
      const fillOpacity = opacity * style.fillOpacity;
      return {
        type: "vector",
        source,
        point: {
          color,
          size: style.pointSizePx,
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
          color,
          width: style.lineWidthPx,
          clampToGround: true,
          show,
          opacity,
        },
        polygon: {
          color,
          clampToGround: true,
          show,
          opacity: fillOpacity,
          transparent: isTranslucent(fillOpacity),
        },
      };
    }
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
