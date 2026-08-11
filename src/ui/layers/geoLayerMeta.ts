/**
 * Presentation vocabulary for a geospatial layer, shared by the layer-panel
 * row and the inspector's geo view: what a kind is called, where the layer
 * came from, and the 6-digit colour `<input type="color">` needs.
 */
import type { GeoLayer } from "../../features/geoLayers/geoLayerStore";
import {
  DEFAULT_GEO_LAYER_STYLE,
  hexColorToNumber,
} from "../../features/geoLayers/geoLayerStyle";

/** Short, uppercase, and the words a user of these formats would use — the
 *  row is 240 px wide, so "Cesium 3D Tiles tileset" is not an option. */
export const KIND_BADGE: Record<GeoLayer["kind"], string> = {
  geojson: "GEOJSON",
  "raster-xyz": "XYZ",
  "3d-tiles": "3D TILES",
};

export const KIND_LABEL: Record<GeoLayer["kind"], string> = {
  geojson: "GeoJSON",
  "raster-xyz": "XYZ raster tiles",
  "3d-tiles": "3D Tiles tileset",
};

/** The layer's own source, for the row's tooltip. User-supplied sources carry
 *  no automatic attribution, so showing the URL is what keeps their
 *  provenance inspectable (design §4). */
export function sourceOf(layer: GeoLayer): string {
  switch (layer.kind) {
    case "geojson":
      return layer.config.url ?? "loaded from a local file";
    case "raster-xyz":
      return layer.config.urlTemplate;
    case "3d-tiles":
      return layer.config.url;
  }
}

/**
 * The 6-digit form, because that is the only one `<input type="color">` reads:
 * handed `"#f53"` it silently shows BLACK, i.e. a colour the layer is not drawn
 * in. Shorthand is a legitimate stored value — `normalizeGeoLayerStyle` accepts
 * both spellings, and a share link may carry either — so it is expanded for the
 * swatch only, and the store keeps whatever the user's source said until they
 * pick a new colour.
 */
export function colorInputValue(hex: string): string {
  const numeric = hexColorToNumber(hex);
  return numeric === null
    ? DEFAULT_GEO_LAYER_STYLE.color
    : `#${numeric.toString(16).padStart(6, "0")}`;
}
