/**
 * A picked geospatial feature's details: the layer name, a summary (Name /
 * Zone when present, else the first three properties) and the full property
 * table. Replaces `GeoFeatureDetailsTemp` (deleted in T33).
 */
import type { GeoFeatureSelection } from "../../domain/selection/types";
import { AttrRow } from "../inspector/attrDisplay";
import { formatValue } from "../inspector/formatAttrValue";
import { geoSummary } from "./subject";
import { SummarySection } from "./SummarySection";

export function GeoFeatureDetails({
  selection,
}: {
  readonly selection: GeoFeatureSelection;
}) {
  return (
    <>
      <SummarySection rows={geoSummary(selection.properties)} />
      <section className="details-section">
        <h3 className="details-section-title">Attributes</h3>
        {Object.entries(selection.properties).length === 0 ? (
          <div className="details-placeholder">No attributes</div>
        ) : (
          Object.entries(selection.properties).map(([key, value]) => (
            <AttrRow key={key} label={key} value={formatValue(value)} />
          ))
        )}
      </section>
    </>
  );
}
