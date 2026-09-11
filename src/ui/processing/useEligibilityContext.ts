/**
 * The stores behind the spec §5 disabled-row reasons, gathered for ONE
 * candidate target.
 *
 * The status is SUBSCRIBED (`useDuckDBStatus`), not polled. A lazy extension
 * load moves it without touching a layer's table, so the catalogue's chips and
 * the extension-failure reason would otherwise go on showing the state the
 * panel happened to open with.
 *
 * The PURE `eligibilityContextFor` sits beside the hook because a hook answers
 * for one target and §6's layer select has to ask the same question of every
 * candidate layer: hooks cannot be called in a loop, a pure function can.
 */
import { useLayerTableStore } from "../../insights/layerTables";
import type { LayerTableState } from "../../insights/layerTables";
import { useDuckDBStatus } from "../../insights/useDuckDBStatus";
import type { DuckDBStatus } from "../../insights/duckdb";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { layerKindOf } from "../../features/layers/layerPresentation";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import type { EligibilityContext } from "../../features/processing/eligibility";

/** Everything {@link eligibilityContextFor} reads, subscribed once. */
export interface EligibilityInputs {
  readonly tables: Readonly<Record<string, LayerTableState>>;
  readonly hasVectorLayer: boolean;
  readonly status: DuckDBStatus;
}

export function useEligibilityInputs(): EligibilityInputs {
  const tables = useLayerTableStore((s) => s.tables);
  const hasVectorLayer = useGeoLayerStore((s) =>
    s.layers.some((l) => l.kind === "geojson"),
  );
  return { tables, hasVectorLayer, status: useDuckDBStatus() };
}

export function eligibilityContextFor(
  target: ActiveLayer | null,
  tables: Readonly<Record<string, LayerTableState>>,
  hasVectorLayer: boolean,
  status: DuckDBStatus,
): EligibilityContext {
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

export function useEligibilityContext(
  target: ActiveLayer | null,
): EligibilityContext {
  const { tables, hasVectorLayer, status } = useEligibilityInputs();
  return eligibilityContextFor(target, tables, hasVectorLayer, status);
}
