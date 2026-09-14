/**
 * A picked geospatial feature's details: the layer name, a summary (Name /
 * Zone when present, else the first three properties) and the full property
 * table. Replaces `GeoFeatureDetailsTemp` (deleted in T33).
 *
 * Spec §8 splits the attribute list by PROVENANCE, and §7.6 says a vector
 * layer's computed properties behave "like any other attribute": so the columns
 * a tool wrote for THIS layer move into a COMPUTED group with the badge and the
 * provenance tooltip, exactly as they do for a city layer. The split is the
 * registry's answer and never a guess from the key's name — a source document
 * may carry a `bld_buildings_n` of its own.
 */
import type { GeoFeatureSelection } from "../../domain/selection/types";
import {
  formatProvenance,
  useComputedColumnStore,
} from "../../insights/computedColumns";
import { ComputedAttributeBadge } from "../table/ComputedAttributeBadge";
import { AttrRow } from "../inspector/attrDisplay";
import { formatValue } from "../inspector/formatAttrValue";
import { geoSummary } from "./subject";
import { SummarySection } from "./SummarySection";

export function GeoFeatureDetails({
  selection,
}: {
  readonly selection: GeoFeatureSelection;
}) {
  // The store's own object, not `computedColumnsOf`: that builds a fresh Set
  // per call, which as a selector snapshot would re-render forever.
  const computed = useComputedColumnStore(
    (state) => state.byLayer[selection.geoLayerId],
  );
  const entries = Object.entries(selection.properties);
  const fileEntries = entries.filter(([key]) => computed?.[key] === undefined);
  const computedKeys = entries
    .filter(([key]) => computed?.[key] !== undefined)
    .map(([key]) => key);
  return (
    <>
      <SummarySection rows={geoSummary(selection.properties)} />
      <section className="details-section">
        <h3 className="details-section-title">Attributes</h3>
        {entries.length === 0 ? (
          <div className="details-placeholder">No attributes</div>
        ) : (
          fileEntries.map(([key, value]) => (
            <AttrRow key={key} label={key} value={formatValue(value)} />
          ))
        )}
        {computedKeys.length > 0 && (
          <div role="group" aria-label="Computed attributes">
            <h4 className="details-section-title details-computed-title">
              COMPUTED
            </h4>
            {computedKeys.map((key) => (
              <AttrRow
                key={key}
                label={key}
                value={formatValue(selection.properties[key])}
                badge={
                  <ComputedAttributeBadge
                    title={formatProvenance(computed![key]!)}
                  />
                }
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
