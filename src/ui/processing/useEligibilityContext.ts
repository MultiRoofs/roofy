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
import { layerTableKey, useLayerTableStore } from "../../insights/layerTables";
import type { LayerTableState } from "../../insights/layerTables";
import { useDuckDBStatus } from "../../insights/useDuckDBStatus";
import type { DuckDBStatus } from "../../insights/duckdb";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { useLayerStore } from "../../features/layers/layerStore";
import { layerKindOf } from "../../features/layers/layerPresentation";
import {
  activeFamilyOf,
  useFamilyStore,
  type LayerFamilyState,
} from "../../features/layers/familyStore";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import {
  metricBoundsRefusal,
  type EligibilityContext,
} from "../../features/processing/eligibility";
import { toolById } from "../../features/processing/toolRegistry";
import type { ToolId } from "../../features/processing/types";
import { isMetricCrs, parseEpsgCode } from "@cityjson/navara-core";

/** Everything {@link eligibilityContextFor} reads, subscribed once. */
export interface EligibilityInputs {
  readonly tables: Readonly<Record<string, LayerTableState>>;
  /**
   * The family store's own record, so a table can be resolved through a layer's
   * ACTIVE family (ruling S3) for any number of candidate layers.
   *
   * The RECORD rather than a derived `{layerId: family}` map, because that map
   * would be a fresh object on every render and this is threaded through
   * `useToolForm`'s memos.
   */
  readonly families: Readonly<Record<string, LayerFamilyState>>;
  readonly hasVectorLayer: boolean;
  readonly hasCityLayer: boolean;
  readonly status: DuckDBStatus;
}

export function useEligibilityInputs(): EligibilityInputs {
  const tables = useLayerTableStore((s) => s.tables);
  const families = useFamilyStore((s) => s.layers);
  const hasVectorLayer = useGeoLayerStore((s) =>
    s.layers.some((l) => l.kind === "geojson"),
  );
  const hasCityLayer = useLayerStore((s) => s.layers.length > 0);
  return {
    tables,
    families,
    hasVectorLayer,
    hasCityLayer,
    status: useDuckDBStatus(),
  };
}

/**
 * One city layer's table entry, through its ACTIVE family (ruling S3).
 *
 * Exported because `useToolForm` asks the same question of its candidate list
 * and of the layer whose LoD ladder and scope counts a form reads — and a second
 * spelling of "which table is this layer's" is how the select and the form come
 * to disagree about it.
 */
export function tableEntryFor(
  inputs: Pick<EligibilityInputs, "tables" | "families">,
  layerId: string,
): LayerTableState | undefined {
  return inputs.tables[
    layerTableKey(layerId, activeFamilyOf(inputs.families, layerId))
  ];
}

/**
 * Whether `crs` — a table's recorded `sourceCrs` (R-G) — is metre-based.
 *
 * `null` in, `null` out: NO CLAIM, which is every table in the app but a
 * CityParquet family view. The answer needs proj4's registry, so it is resolved
 * here rather than in the pure `toolEligibility`, and through navara-core's own
 * gate (`isMetricCrs`) so the toolbox and the loader refuse the same units.
 */
export function metricSourceCrs(crs: string | null): boolean | null {
  if (crs === null) return null;
  const epsg = parseEpsgCode(crs);
  // A CRS spelt in a way nothing can parse is not a claim that it is metric.
  if (epsg === null) return false;
  return isMetricCrs(epsg);
}

/**
 * Why `layerId` cannot be a CITY SOURCE for `toolId`, or `null`.
 *
 * Aggregate buildings per area writes to a vector layer and READS a city one, so
 * `toolEligibility` — which only ever sees the target — never looks at the layer
 * whose bounds the run actually measures. Ruling S2 has to reach that row too,
 * and through the same function, so the two cannot drift.
 */
export function citySourceReason(
  inputs: Pick<EligibilityInputs, "tables" | "families">,
  layerId: string,
  toolId: ToolId,
): string | null {
  const entry = tableEntryFor(inputs, layerId);
  const crs = entry?.state === "ready" ? (entry.info.sourceCrs ?? null) : null;
  return metricBoundsRefusal(toolById(toolId), {
    activeTableCrs: crs,
    activeTableCrsMetric: metricSourceCrs(crs),
  });
}

export function eligibilityContextFor(
  target: ActiveLayer | null,
  inputs: EligibilityInputs,
): EligibilityContext {
  const { hasVectorLayer, hasCityLayer, status } = inputs;
  const entry =
    target?.kind === "city"
      ? tableEntryFor(inputs, target.layer.id)
      : undefined;
  const ready =
    entry !== undefined && entry.state === "ready" ? entry.info : null;
  const ext = status.state === "ready" ? status.extensions : null;
  const extState = (name: "spatial" | "three_d") =>
    ext ? ext[name].state : "unloaded";
  const geojson =
    target?.kind === "geo" && target.layer.kind === "geojson"
      ? target.layer.config
      : null;
  // Ruling S2: the CRS the ACTIVE table measures in. Only a file-backed family
  // view records one, so this is `null` — no claim — for every other layer.
  const activeTableCrs = ready?.sourceCrs ?? null;
  return {
    targetKind: target ? layerKindOf(target) : "none",
    sourceEncoding:
      target?.kind === "city" ? target.layer.model.sourceEncoding : null,
    hasReader: ready !== null && ready.reader !== null,
    sourceAvailable: ready !== null && ready.source !== null,
    tableState: entry?.state ?? "none",
    engineState: status.state,
    hasVectorLayer,
    hasCityLayer,
    vectorPreparation: geojson?.preparation ?? "none",
    extensionState: {
      spatial: extState("spatial"),
      three_d: extState("three_d"),
    },
    activeTableCrs,
    activeTableCrsMetric: metricSourceCrs(activeTableCrs),
  };
}

export function useEligibilityContext(
  target: ActiveLayer | null,
): EligibilityContext {
  return eligibilityContextFor(target, useEligibilityInputs());
}
