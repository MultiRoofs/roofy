/**
 * The two drawing controls a geospatial layer has: its opacity, and — for a
 * vector layer — the flat per-layer style.
 *
 * Extracted from `GeoLayerInspector` so the active layer's Style section
 * (Task 18) and the inspector's geo view can render the SAME form while both
 * exist; Task 20 deletes the inspector's copy and this becomes the only one.
 * Extracting rather than copying is the whole point: two forms writing the
 * same `GeoLayerStyle` would be two places for the "spread the WHOLE style"
 * contract below to be got wrong.
 *
 * Each control owns its store write and takes only the live layer, so a host
 * needs no callbacks of its own — and both are unwrapped: the caller supplies
 * whatever section, heading or hairline its own panel dresses them in.
 */
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../features/geoLayers/geoLayerStore";
import type { GeoLayerStyle } from "../../features/geoLayers/geoLayerStyle";
import { colorInputValue } from "./geoLayerMeta";

/**
 * Layer opacity, for the two kinds that have a handle for it.
 *
 * A 3D tileset gets none: its appearance IS the tiles' own materials, and the
 * descriptor's `opacity` is a slider over someone else's photogrammetry that
 * was judged not worth the row. Callers gate on the kind themselves.
 */
export function GeoOpacityControl({ layer }: { readonly layer: GeoLayer }) {
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);
  return (
    <input
      className="geo-opacity-slider"
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={layer.opacity}
      aria-label="Opacity"
      title={`Opacity — ${Math.round(layer.opacity * 100)}%`}
      onChange={(e) =>
        updateGeoLayer(layer.id, { opacity: Number(e.target.value) })
      }
    />
  );
}

/**
 * Colour, point size, line width and fill opacity — a VECTOR layer only: a
 * raster tile's pixels arrive already drawn, and a 3D tileset carries its own
 * materials.
 *
 * The numbers commit on `change` with a bare `Number(...)`: the store
 * normalizes on write (a NaN or a zero falls back to the default rather than
 * reaching the engine), so the input does not need its own validation branch.
 * The ONE guarded case is the empty field, which is a user mid-edit rather
 * than a value — `Number("")` is 0, so committing it would jump a layer
 * sitting at 8 px to the app default the moment its box was cleared for
 * retyping.
 */
export function GeoVectorStyleFields({ layer }: { readonly layer: GeoLayer }) {
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);

  /** One edited field at a time, but the store takes the WHOLE style — see
   *  `GeoLayerPatch.style`. */
  const editStyle = (patch: Partial<GeoLayerStyle>) =>
    updateGeoLayer(layer.id, { style: { ...layer.style, ...patch } });

  return (
    <div className="geo-style-fields">
      <label className="geo-style-field">
        <span>Color</span>
        <input
          className="geo-style-color"
          type="color"
          aria-label="Layer color"
          value={colorInputValue(layer.style.color)}
          onChange={(e) => editStyle({ color: e.target.value })}
        />
      </label>

      <label className="geo-style-field">
        <span>Point size</span>
        <input
          className="geo-style-number"
          type="number"
          min={1}
          step={1}
          aria-label="Point size"
          title="Point size, in pixels"
          value={layer.style.pointSizePx}
          onChange={(e) => {
            if (e.target.value !== "")
              editStyle({ pointSizePx: Number(e.target.value) });
          }}
        />
      </label>

      <label className="geo-style-field">
        <span>Line width</span>
        <input
          className="geo-style-number"
          type="number"
          min={1}
          step={1}
          aria-label="Line width"
          title="Line width, in pixels"
          value={layer.style.lineWidthPx}
          onChange={(e) => {
            if (e.target.value !== "")
              editStyle({ lineWidthPx: Number(e.target.value) });
          }}
        />
      </label>

      <label className="geo-style-field">
        <span>Fill opacity</span>
        <input
          className="geo-style-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          aria-label="Fill opacity"
          title={`Polygon fill opacity — ${Math.round(
            layer.style.fillOpacity * 100,
          )}% (multiplies the layer's own opacity)`}
          value={layer.style.fillOpacity}
          onChange={(e) => editStyle({ fillOpacity: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
