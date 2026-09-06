/**
 * The inspector's view of a SELECTED geospatial layer — the geo mirror of the
 * city tabs, one panel instead of five: a geo layer has no objects, surfaces
 * or rules, so what remains is what it is (name, kind, source) and how it is
 * drawn (opacity; for a vector layer the flat per-layer style). The controls
 * moved here from the layer row so both kinds of layer share one mental
 * model: click a row on the left, configure it on the right.
 */
import type { GeoLayer } from "../../features/geoLayers/geoLayerStore";
import { KIND_BADGE, KIND_LABEL, sourceOf } from "../layers/geoLayerMeta";
import {
  GeoOpacityControl,
  GeoVectorStyleFields,
} from "../layers/GeoStyleControls";

export function GeoLayerInspector({ layer }: { readonly layer: GeoLayer }) {
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

      {/* A tileset gets no controls here: its appearance IS the tiles' own
          materials, so a colour or a point size would mean nothing. The
          descriptor does carry opacity (`geoLayerDescriptions` passes
          `opacity`/`transparent` for 3d-tiles) — the app simply offers no
          handle for it, a slider over someone else's photogrammetry having
          been judged not worth the row. Same reasoning as the old row
          controls. */}
      {(layer.kind === "raster-xyz" || layer.kind === "geojson") && (
        <div className="attr-section">
          <div className="attr-section-title">
            <span>Opacity</span>
          </div>
          <GeoOpacityControl layer={layer} />
        </div>
      )}

      {/* Only a vector layer has these: a raster tile's pixels arrive already
          drawn, and a 3D tileset carries its own materials. How the fields
          commit is `GeoStyleControls`' business now — this panel only says
          which layers get to see them. */}
      {layer.kind === "geojson" && (
        <div className="attr-section">
          <div className="attr-section-title">
            <span>Style</span>
          </div>
          <GeoVectorStyleFields layer={layer} />
        </div>
      )}
    </div>
  );
}
