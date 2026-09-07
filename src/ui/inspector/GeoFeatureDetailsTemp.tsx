/**
 * TEMPORARY (`data-temporary="12.3"`) — minimal stand-in for a picked geo
 * feature's details.
 *
 * A `GeoFeatureSelection` has no city-object identity (see its doc comment
 * in `domain/selection/types.ts`), so it never reaches `InspectorPanel`:
 * `App` renders this component instead when a geo feature is picked and no
 * city object is selected. It is the old `GeoAttributes` view from the
 * deleted `ui/viewport/AttributePanel.tsx` overlay (see `git show
 * 9e5d21d^:src/ui/viewport/AttributePanel.tsx`), recreated here as a flat
 * key/value list — no inheritance, no aggregation, because a geo feature has
 * neither an object graph nor a multi-select. Task 12.3 gives the geo
 * feature a proper place in the redesigned inspector; until then this is
 * the whole story.
 */
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import type { GeoFeatureSelection } from "../../domain/selection/types";
import { AttrRow } from "./attrDisplay";
import { formatValue } from "./formatAttrValue";

export interface GeoFeatureDetailsTempProps {
  readonly selection: GeoFeatureSelection;
  readonly onClose: () => void;
}

export function GeoFeatureDetailsTemp({
  selection,
  onClose,
}: GeoFeatureDetailsTempProps) {
  // The layer can be gone by the time this renders — App drops a geo
  // selection whose layer no longer exists, but belt-and-braces here too.
  const layerName = useGeoLayerStore(
    (s) => s.layers.find((l) => l.id === selection.geoLayerId)?.name,
  );
  const entries = Object.entries(selection.properties);

  return (
    <aside className="inspector" data-temporary="12.3">
      <div className="inspector-header">
        <h3>{layerName ?? "Feature"}</h3>
        <button className="tb-btn" title="Close panel" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="inspector-body">
        <div className="attr-section">
          <div className="attr-section-title">Attributes</div>
          {entries.length === 0 ? (
            <div className="inspector-placeholder">No attributes</div>
          ) : (
            entries.map(([key, value]) => (
              <AttrRow key={key} label={key} value={formatValue(value)} />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
