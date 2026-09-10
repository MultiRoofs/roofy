import { useMemo, useState } from "react";
import type { GeoLayer } from "../../features/geoLayers/geoLayerStore";
import {
  geoExportText,
  geoScopeCount,
  type GeoExportScope,
} from "../../features/geoLayers/geoExport";
import {
  filterGeoRecords,
  geoRecordId,
  geoRecords,
} from "../../features/geoLayers/geoRecords";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { downloadBlob } from "../../platform/download";
export function GeoLayerExport({
  layer,
}: {
  layer: Extract<GeoLayer, { kind: "geojson" }>;
}) {
  const [scope, setScope] = useState<GeoExportScope>("all");
  const query = useQueryStore((s) => layerQuery(s, layer.id));
  const geoSelection = useSelectionStore((s) => s.geoSelection);
  const source = layer.config.preparedData;
  const records = useMemo(() => geoRecords(source), [source]);
  const matching = useMemo(
    () => filterGeoRecords(records, query.applied),
    [records, query.applied],
  );
  const selected = new Set<string>(
    geoSelection?.geoLayerId === layer.id && geoSelection.stableFeatureId
      ? [geoSelection.stableFeatureId]
      : [],
  );
  const matchingIds = new Set(matching.map((row) => geoRecordId(row)));
  const selectedIds = selected;
  const exportCount = geoScopeCount(records, scope, matchingIds, selectedIds);
  return (
    <div className="geo-record-actions">
      <label>
        Export{" "}
        <select
          className="geo-record-scope"
          value={scope}
          onChange={(event) => setScope(event.target.value as GeoExportScope)}
        >
          <option value="all">All ({records.length})</option>
          <option value="matching">Matching ({matching.length})</option>
          <option value="selected" disabled={selected.size === 0}>
            Selected ({selected.size})
          </option>
        </select>
      </label>
      <button
        type="button"
        className="tb-btn table-action-btn"
        disabled={exportCount === 0}
        onClick={() =>
          downloadBlob(
            new Blob(
              [
                geoExportText(
                  source,
                  "geojson",
                  scope,
                  matchingIds,
                  selectedIds,
                ),
              ],
              { type: "application/geo+json" },
            ),
            `${layer.name}.geojson`,
          )
        }
      >
        GeoJSON
      </button>
      <button
        type="button"
        className="tb-btn table-action-btn"
        disabled={exportCount === 0}
        onClick={() =>
          downloadBlob(
            new Blob(
              [geoExportText(source, "csv", scope, matchingIds, selectedIds)],
              { type: "text/csv" },
            ),
            `${layer.name}.csv`,
          )
        }
      >
        CSV
      </button>
    </div>
  );
}
