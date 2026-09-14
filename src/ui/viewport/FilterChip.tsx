import { clearMapFilter } from "../../features/query/mapFilterSync";
import { useGeoFeatureVisibilityStore } from "../../features/geoLayers/geoFeatureVisibilityStore";
import { useActiveLayer } from "../../features/workspace/activeLayer";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useShellStore } from "../shell/shellStore";
import { formatCount } from "../table/tableText";
import { useLayerCounts } from "../table/useLayerCounts";

export function FilterChip() {
  const active = useActiveLayer();
  const layerId = active?.layer.id ?? null;
  const applied = useQueryStore((state) =>
    layerId === null ? null : layerQuery(state, layerId).applied,
  );
  const counts = useLayerCounts(active?.kind === "city" ? layerId : null);
  const visible = useGeoFeatureVisibilityStore((state) =>
    layerId === null ? null : state.visible[layerId],
  );
  if (active === null || applied === null || applied.conditions.length === 0)
    return null;
  const label =
    active.kind === "geo" && active.layer.kind === "geojson"
      ? `${formatCount(visible?.size ?? 0)} matching features`
      : counts.matching === null
        ? active.kind === "city" && active.layer.isStreaming
          ? "Filtered · table only"
          : "Filtered"
        : active.kind === "city" && active.layer.isStreaming
          ? `${formatCount(counts.matching)} listed (table only)`
          : `${formatCount(counts.matching)} matching ${layerQuery(useQueryStore.getState(), active.layer.id).view === "raw" ? "objects" : "buildings"}`;
  return (
    <div className="map-filter-chip">
      <span role="status" aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        onClick={() => {
          useShellStore.getState().openDrawer();
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>(".filter-bar")?.focus(),
          );
        }}
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => {
          useQueryStore.getState().clearFilter(active.layer.id);
          if (active.kind === "city") clearMapFilter(active.layer.id);
        }}
      >
        Clear
      </button>
    </div>
  );
}
