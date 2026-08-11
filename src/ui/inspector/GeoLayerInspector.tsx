/**
 * The inspector's view of a SELECTED geospatial layer — the geo mirror of the
 * city tabs, one panel instead of five: a geo layer has no objects, surfaces
 * or rules, so what remains is what it is (name, kind, source) and how it is
 * drawn (opacity; for a vector layer the flat per-layer style). The controls
 * moved here from the layer row so both kinds of layer share one mental
 * model: click a row on the left, configure it on the right.
 */
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../features/geoLayers/geoLayerStore";
import type { GeoLayerStyle } from "../../features/geoLayers/geoLayerStyle";
import {
  KIND_BADGE,
  KIND_LABEL,
  colorInputValue,
  sourceOf,
} from "../layers/geoLayerMeta";

export function GeoLayerInspector({ layer }: { readonly layer: GeoLayer }) {
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);

  /** One edited field at a time, but the store takes the WHOLE style — see
   *  `GeoLayerPatch.style`. */
  const editStyle = (patch: Partial<GeoLayerStyle>) =>
    updateGeoLayer(layer.id, { style: { ...layer.style, ...patch } });

  return (
    <div className="geo-inspector">
      <div className="attr-section">
        <div className="attr-section-title">
          <span>Layer</span>
          <span className="layer-badge-geo" title={KIND_LABEL[layer.kind]}>
            {KIND_BADGE[layer.kind]}
          </span>
        </div>
        <div className="attr-row">
          <span className="attr-key">Name</span>
          <span className="attr-value">{layer.name}</span>
        </div>
        <div className="attr-row">
          <span className="attr-key">Kind</span>
          <span className="attr-value">{KIND_LABEL[layer.kind]}</span>
        </div>
        <div className="attr-row">
          <span className="attr-key">Source</span>
          <span className="attr-value geo-inspector-source">
            {sourceOf(layer)}
          </span>
        </div>
      </div>

      {/* A tileset's appearance comes from the tiles' own materials — no
          opacity, no style (same reasoning as the old row controls). */}
      {(layer.kind === "raster-xyz" || layer.kind === "geojson") && (
        <div className="attr-section">
          <div className="attr-section-title">
            <span>Opacity</span>
          </div>
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
        </div>
      )}

      {/* Only a vector layer has these: a raster tile's pixels arrive already
          drawn, and a 3D tileset carries its own materials.

          The numbers commit on `change` with a bare `Number(...)`: the store
          normalizes on write (a NaN or a zero falls back to the default rather
          than reaching the engine), so the input does not need its own
          validation branch. The ONE guarded case is the empty field, which is
          a user mid-edit rather than a value — `Number("")` is 0, so
          committing it would jump a layer sitting at 8 px to the app default
          the moment its box was cleared for retyping. */}
      {layer.kind === "geojson" && (
        <div className="attr-section">
          <div className="attr-section-title">
            <span>Style</span>
          </div>
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
                onChange={(e) =>
                  editStyle({ fillOpacity: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
