/**
 * The stores behind the spec §5 disabled-row reasons, gathered for ONE
 * candidate target.
 *
 * `getDuckDBStatus()` is a plain read, not a subscription: the engine's state
 * only moves on boot and on Retry, and both of those also move a layer's table
 * — which IS subscribed here — so the catalogue re-renders anyway. The lazy
 * extension loads that would need their own subscription arrive with the
 * executor (M2), and the status read moves with them.
 */
import { useLayerTableStore } from "../../insights/layerTables";
import { getDuckDBStatus } from "../../insights/duckdb";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { layerKindOf } from "../../features/layers/layerPresentation";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import type { EligibilityContext } from "../../features/processing/eligibility";

export function useEligibilityContext(
  target: ActiveLayer | null,
): EligibilityContext {
  const tables = useLayerTableStore((s) => s.tables);
  const hasVectorLayer = useGeoLayerStore((s) =>
    s.layers.some((l) => l.kind === "geojson"),
  );
  const status = getDuckDBStatus();
  const entry = target?.kind === "city" ? tables[target.layer.id] : undefined;
  const ready =
    entry !== undefined && entry.state === "ready" ? entry.info : null;
  const ext = status.state === "ready" ? status.extensions : null;
  const extState = (name: "spatial" | "three_d") =>
    ext ? ext[name].state : "unloaded";
  return {
    targetKind: target ? layerKindOf(target) : "none",
    sourceEncoding:
      target?.kind === "city" ? target.layer.model.sourceEncoding : null,
    hasReader: ready !== null && ready.reader !== null,
    sourceAvailable: ready !== null && ready.source !== null,
    tableState: entry?.state ?? "none",
    engineState: status.state,
    hasVectorLayer,
    extensionState: {
      spatial: extState("spatial"),
      three_d: extState("three_d"),
    },
  };
}
