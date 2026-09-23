import { useEffect, useMemo, useRef, useState } from "react";
import {
  rootFeatureId,
  parentsIndexOf,
} from "../../domain/citymodel/featureId";
import { useActiveFamily } from "../../features/layers/familyStore";
import { useLayerStore } from "../../features/layers/layerStore";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";
import { runQuery } from "../../insights/duckdb";
import {
  layerTableKey,
  useLayerTableStore,
  type LayerTable,
} from "../../insights/layerTables";
import { buildSelectedRootsSubquery } from "../../insights/selectedFeatures";
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
  // The ACTIVE family's table for a CityParquet layer (ruling S3); the bare key
  // for every other one.
  const family = useActiveFamily(layerId);
  // The table AND its query state under one key (R-C′).
  const queryKey = layerId === null ? null : layerTableKey(layerId, family);
  const tableState = useLayerTableStore((state) =>
    queryKey === null ? undefined : state.tables[queryKey],
  );
  const query = useQueryStore((state) =>
    queryKey === null ? null : layerQuery(state, queryKey),
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
  const key = `${queryKey ?? ""}:${table?.table ?? ""}`;
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
    // The FILE decides which feature a selected object belongs to when the table
    // is a view over it (ruling R-B′): its rows include objects the camera never
    // delivered, so `selectedFeatures` — resolved through the residents — leaves
    // an unloaded part pointing at itself and the count answers zero over a
    // selection the user can see. As a SUBQUERY, so this stays three statements.
    const selectedRootsIn =
      table.fileBacked === true
        ? `(${buildSelectedRootsSubquery(table.table, selectedIds)})`
        : `(${selectedFeatures.map(quoteLiteral).join(", ")})`;
    const selectedWhere =
      selectedIds.length === 0
        ? "FALSE"
        : query.view === "buildings"
          ? `COALESCE("feature_id", "id") IN ${selectedRootsIn} AND ${rootBuildings}`
          : // The RAW reading counts rows by their own id, which needs no
            // resolution at all — on any table.
            `"id" IN (${selectedIds.map(quoteLiteral).join(", ")})`;
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
        queryKey !== null
      ) {
        useQueryStore.getState().setView(queryKey, "raw");
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
    // The SELECTION itself as well: a file-backed table's predicate is built
    // from `selectedIds`, and two ids that the residents cannot tell apart would
    // otherwise leave the count describing the previous selection.
    selectedIds.join("\u0000"),
    table,
  ]);

  return counts.key === key ? counts : UNKNOWN;
}
