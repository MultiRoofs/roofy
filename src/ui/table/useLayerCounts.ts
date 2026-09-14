import { useEffect, useMemo, useRef, useState } from "react";
import {
  rootFeatureId,
  parentsIndexOf,
} from "../../domain/citymodel/featureId";
import { useLayerStore } from "../../features/layers/layerStore";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";
import { runQuery } from "../../insights/duckdb";
import {
  useLayerTableStore,
  type LayerTable,
} from "../../insights/layerTables";
import {
  buildCountSql,
  buildFeatureScopeWhere,
  compileFilter,
  quoteLiteral,
} from "../../insights/sql";

export interface LayerCounts {
  readonly all: number | null;
  readonly matching: number | null;
  readonly selected: number | null;
  readonly loading: boolean;
  readonly message: string | null;
}

const UNKNOWN: LayerCounts = {
  all: null,
  matching: null,
  selected: null,
  loading: false,
  message: null,
};
type CountState = LayerCounts & { readonly key: string | null };
const rootBuildings = '"parents" IS NULL AND "object_type" = \'Building\'';

function count(rows: ReadonlyArray<Record<string, unknown>>): number | null {
  const value = rows[0]?.n;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function useLayerCounts(layerId: string | null): LayerCounts {
  const tableState = useLayerTableStore((state) =>
    layerId === null ? undefined : state.tables[layerId],
  );
  const query = useQueryStore((state) =>
    layerId === null ? null : layerQuery(state, layerId),
  );
  const selections = useSelectionStore((state) => state.selections);
  const layer = useLayerStore((state) =>
    layerId === null
      ? null
      : (state.layers.find((candidate) => candidate.id === layerId) ?? null),
  );
  const [counts, setCounts] = useState<CountState>({ ...UNKNOWN, key: null });
  const generation = useRef(0);
  const table: LayerTable | null =
    tableState?.state === "ready" ? tableState.info : null;
  const streamVersion = useStreamStore((state) =>
    layerId === null ? undefined : state.streams[layerId]?.version,
  );
  const resident =
    layer?.isStreaming && layerId !== null
      ? getResidentModel(layerId, streamVersion ?? 0)
      : null;
  const key = `${layerId ?? ""}:${table?.table ?? ""}`;
  const selectedIds = useMemo(
    () =>
      selections
        .filter((selection) => selection.layerId === layerId)
        .map((selection) => selection.objectId),
    [layerId, selections],
  );
  const selectedFeatures = useMemo(() => {
    if (query?.view !== "buildings" || layer === null) return selectedIds;
    const parents = parentsIndexOf(
      layer.isStreaming ? (resident?.objects ?? {}) : layer.model.objects,
    );
    return [...new Set(selectedIds.map((id) => rootFeatureId(id, parents)))];
  }, [layer, query?.view, resident, selectedIds.join("\u0000")]);

  useEffect(() => {
    const current = ++generation.current;
    if (table === null || query === null) {
      setCounts({ ...UNKNOWN, key });
      return;
    }
    const compiled =
      query.applied === null
        ? { ok: true as const, where: null }
        : compileFilter(query.applied, table.columns);
    if (!compiled.ok) {
      setCounts({ ...UNKNOWN, key, message: compiled.message });
      return;
    }
    const rootWhere = query.view === "buildings" ? rootBuildings : null;
    const matchingWhere =
      query.view === "buildings"
        ? [buildFeatureScopeWhere(table.table, compiled.where), rootBuildings]
            .filter(Boolean)
            .join(" AND ")
        : compiled.where;
    const selectedWhere =
      selectedFeatures.length === 0
        ? "FALSE"
        : query.view === "buildings"
          ? `COALESCE("feature_id", "id") IN (${selectedFeatures.map(quoteLiteral).join(", ")}) AND ${rootBuildings}`
          : `"id" IN (${selectedFeatures.map(quoteLiteral).join(", ")})`;
    setCounts({ ...UNKNOWN, key, loading: true });
    void Promise.all([
      runQuery(buildCountSql(table.table, rootWhere)),
      runQuery(buildCountSql(table.table, matchingWhere)),
      runQuery(buildCountSql(table.table, selectedWhere)),
    ]).then(([all, matching, selected]) => {
      if (current !== generation.current) return;
      const failed = [all, matching, selected].find((result) => !result.ok);
      setCounts({
        key,
        all: all.ok ? count(all.rows) : null,
        matching: matching.ok ? count(matching.rows) : null,
        selected: selected.ok ? count(selected.rows) : null,
        loading: false,
        message: failed && !failed.ok ? failed.message : null,
      });
      // A city layer without any root Buildings still has useful raw objects.
      // Do this only after the all-scope query succeeded, never from a zero
      // matching count and never while a streaming resident cache is empty.
      if (
        all.ok &&
        count(all.rows) === 0 &&
        query.view === "buildings" &&
        layer !== null &&
        !layer.isStreaming &&
        layerId !== null
      ) {
        useQueryStore.getState().setView(layerId, "raw");
      }
    });
    return () => {
      generation.current++;
    };
  }, [
    key,
    query?.applied,
    query?.view,
    selectedFeatures.join("\u0000"),
    table,
  ]);

  return counts.key === key ? counts : UNKNOWN;
}
