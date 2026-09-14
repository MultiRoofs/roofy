import { useState } from "react";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import { useLayerTableStore } from "../../insights/layerTables";
import { epsgOf } from "../../features/layers/layerPresentation";
import { ActionIcon } from "../ActionIcon";
import { ExportDialog } from "../table/ExportDialog";
import { GeoLayerExport } from "./GeoLayerExport";
/** Owned by the layer, independent of whether its table drawer is mounted. */
export function LayerExport({ item }: { item: ActiveLayer }) {
  const [open, setOpen] = useState(false);
  const entry = useLayerTableStore((s) => s.tables[item.layer.id]);
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
