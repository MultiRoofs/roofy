import { useMemo } from "react";
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../features/geoLayers/geoLayerStore";
import {
  filterGeoRecords,
  geoRecordColumns,
  geoRecordId,
  geoRecords,
} from "../../features/geoLayers/geoRecords";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { DataGrid } from "./DataGrid";
import { FilterBar } from "./FilterBar";
import { Pagination } from "./Pagination";

export function GeoRecordsPanel({
  layer,
}: {
  readonly layer: Extract<GeoLayer, { kind: "geojson" }>;
}) {
  const query = useQueryStore((state) => layerQuery(state, layer.id));
  const geoSelection = useSelectionStore((state) => state.geoSelection);
  const source = layer.config.preparedData;
  const records = useMemo(() => geoRecords(source), [source]);
  const matching = useMemo(
    () => filterGeoRecords(records, query.applied),
    [records, query.applied],
  );
  const sorted = useMemo(
    () =>
      query.sort === null
        ? matching
        : [...matching].sort((a, b) => {
            const left = String(a[query.sort!.column] ?? "");
            const right = String(b[query.sort!.column] ?? "");
            return (
              left.localeCompare(right, undefined, { numeric: true }) *
              (query.sort!.dir === "asc" ? 1 : -1)
            );
          }),
    [matching, query.sort],
  );
  const selected =
    geoSelection?.geoLayerId === layer.id && geoSelection.stableFeatureId
      ? new Set([geoSelection.stableFeatureId])
      : new Set<string>();
  const selectedOnly = query.showSelectedOnly
    ? sorted.filter((row) =>
        selected.has(geoRecordId(row as (typeof records)[number])),
      )
    : sorted;
  const pageRows = selectedOnly.slice(
    query.page * query.pageSize,
    (query.page + 1) * query.pageSize,
  );
  const columns = useMemo(() => geoRecordColumns(records), [records]);
  if (layer.config.preparation === "loading")
    return (
      <div className="table-message">
        <span className="loading-spinner" />
        Loading vector records…
      </div>
    );
  if (layer.config.preparation === "failed")
    return (
      <div className="table-message" role="alert">
        Could not load vector records: {layer.config.preparationError}
        <button
          type="button"
          className="tb-btn table-action-btn"
          onClick={() =>
            useGeoLayerStore.getState().retryGeoJsonPreparation(layer.id)
          }
        >
          Retry
        </button>
      </div>
    );
  if (source === undefined)
    return (
      <div className="table-message">
        This vector source has no records available.
      </div>
    );
  if (records.length > 0 && columns.length === 0)
    return (
      <div className="table-message">
        This vector layer has no attributes to browse.
      </div>
    );
  return (
    <>
      <label className="table-sync-label geo-record-selection">
        <input
          type="checkbox"
          checked={query.showSelectedOnly}
          onChange={(event) =>
            useQueryStore
              .getState()
              .setShowSelectedOnly(layer.id, event.target.checked)
          }
        />{" "}
        Show selected records
      </label>
      <FilterBar
        columns={columns}
        filter={query.filter}
        error={null}
        disabled={false}
        onChange={(filter) =>
          useQueryStore.getState().setFilter(layer.id, filter)
        }
        onApply={() => useQueryStore.getState().applyFilter(layer.id)}
        onClear={() => useQueryStore.getState().clearFilter(layer.id)}
      />
      <DataGrid
        columns={columns}
        rows={pageRows}
        sort={query.sort}
        selectedIds={selected}
        emptyMessage={
          query.showSelectedOnly
            ? "No selected vector records match."
            : "No vector records match this filter."
        }
        onSort={(column) =>
          useQueryStore.getState().toggleSort(layer.id, column)
        }
        getRowId={(row) => String(geoRecordId(row as (typeof records)[number]))}
        onRowClick={(id) => {
          const row = records.find((record) => geoRecordId(record) === id);
          if (row) {
            const properties = { ...row };
            useSelectionStore.getState().selectGeoFeature({
              geoLayerId: layer.id,
              batchId: -1,
              stableFeatureId: id,
              properties,
            });
          }
        }}
      />
      <Pagination
        page={query.page}
        pageSize={query.pageSize}
        totalRows={selectedOnly.length}
        unfilteredRows={records.length}
        filtered={query.applied !== null}
        onPage={(page) => useQueryStore.getState().setPage(layer.id, page)}
        onPageSize={(size) =>
          useQueryStore.getState().setPageSize(layer.id, size)
        }
      />
    </>
  );
}
