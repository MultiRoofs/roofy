import { useState } from "react";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import { layerTableKey, useLayerTableStore } from "../../insights/layerTables";
import { useActiveFamily } from "../../features/layers/familyStore";
import { epsgOf } from "../../features/layers/layerPresentation";
import { ActionIcon } from "../ActionIcon";
import { ExportDialog } from "../table/ExportDialog";
import { GeoLayerExport } from "./GeoLayerExport";
/** Owned by the layer, independent of whether its table drawer is mounted. */
export function LayerExport({ item }: { item: ActiveLayer }) {
  const [open, setOpen] = useState(false);
  // The ACTIVE family's table for a CityParquet layer (ruling S3): an export
  // writes the family the user is looking at.
  const family = useActiveFamily(item.layer.id);
  const entry = useLayerTableStore(
    (s) => s.tables[layerTableKey(item.layer.id, family)],
  );
  const cityReady = item.kind === "city" && entry?.state === "ready";
  const geo =
    item.kind === "geo" && item.layer.kind === "geojson" ? item.layer : null;
  if (item.kind !== "city" && !geo) return null;
  return (
    <>
      <button
        type="button"
        className="active-layer-action"
        disabled={!cityReady && !geo}
        aria-expanded={open}
        title={
          !cityReady && !geo
            ? "Preparing layer data for export"
            : "Export layer"
        }
        onClick={() => setOpen(!open)}
      >
        <ActionIcon name="export" /> Export
      </button>
      {open && cityReady && item.kind === "city" && (
        <ExportDialog
          layerId={item.layer.id}
          layerName={item.layer.name}
          table={entry.info}
          epsg={epsgOf(item.layer.model.metadata.referenceSystem)}
          selectedLod={item.layer.selectedLod}
          isStreaming={item.layer.isStreaming}
          onClose={() => setOpen(false)}
        />
      )}
      {open && geo && <GeoLayerExport layer={geo} />}
    </>
  );
}
