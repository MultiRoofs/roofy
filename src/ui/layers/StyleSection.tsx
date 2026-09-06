/**
 * "How is this layer drawn?" — the first of the active layer's three
 * sections, and the one open by default, because it is the question a user
 * has about a layer they just clicked.
 *
 * What that means differs by kind, and the section answers in the kind's own
 * terms rather than showing a lowest-common-denominator form:
 *
 *  - a CITY layer (static or streaming) is coloured by RULES, so this is the
 *    whole {@link RulesEditor} — the thing that used to be the inspector's
 *    fifth tab, five clicks away from the layer it colours. The `model` prop
 *    is the layer's own, exactly as `InspectorPanel` passed it: the editor
 *    branches on `isStreaming` internally and reads a streaming layer's
 *    fields from the resident model, because a streaming layer's `model` is
 *    a stub (see residentModel.ts);
 *  - a VECTOR layer has the flat per-layer style plus its opacity;
 *  - a RASTER layer has opacity and nothing else: its pixels arrive already
 *    drawn;
 *  - a 3D TILESET has nothing, and says so — an empty box reads as a bug.
 *
 * There is no colormap for a raster and no per-rule appearance here: the
 * engine offers no handle for either (see `docs/architecture-notes.md`), and
 * a control that cannot do anything is worse than its absence.
 */
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import { RulesEditor } from "./RulesEditor";
import { GeoOpacityControl, GeoVectorStyleFields } from "./GeoStyleControls";

export function StyleSection({ item }: { readonly item: ActiveLayer }) {
  if (item.kind === "city") {
    return <RulesEditor model={item.layer.model} layerId={item.layer.id} />;
  }

  const layer = item.layer;
  if (layer.kind === "3d-tiles") {
    return <p className="active-layer-note">No style options</p>;
  }

  return (
    <div className="active-layer-fields">
      {/* A caption, not a `<label>`: the slider carries its own `aria-label`
          (the two read the same), and wrapping it would give the control two
          labelling paths to the same name. */}
      <div className="active-layer-field">
        <span className="active-layer-field-label" aria-hidden>
          Opacity
        </span>
        <GeoOpacityControl layer={layer} />
      </div>
      {layer.kind === "geojson" && <GeoVectorStyleFields layer={layer} />}
    </div>
  );
}
