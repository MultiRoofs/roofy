/**
 * Write the layer — or the rows the filter kept — out to a file.
 *
 * Everything is FEATURE-scoped, never a bare row predicate: a Building carries
 * the attributes and its BuildingPart carries the geometry, so exporting only
 * the rows a filter matched would routinely produce a file of semantics with
 * no shapes in it.
 *
 * CityJSON, CityJSONSeq and FlatCityBuf are deliberately absent: their wasm
 * writers produce ZERO BYTES, silently, and a format that hands back an empty
 * file is worse than one that is not offered.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runQuery } from "../../insights/duckdb";
import type { LodColumn } from "../../insights/columnKind";
import {
  useLayerTableStore,
  type LayerTable,
} from "../../insights/layerTables";
import { runExport, type ExportRequest } from "../../insights/export";
import { computedColumnsOf } from "../../insights/computedColumns";
import {
  buildRootTypesSql,
  compileFilter,
  quoteLiteral,
} from "../../insights/sql";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { useLayerStore } from "../../features/layers/layerStore";
import {
  parentsIndexOf,
  rootFeatureId,
} from "../../domain/citymodel/featureId";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";
import { FLAT_PREFIX_COLUMNS } from "../../insights/layerRows";
import { refreshStreamingTable } from "../../features/layers/layerTableLifecycle";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { downloadBlob } from "../../platform/download";
import { useModalChrome } from "../useModalChrome";
import { exportFileName } from "./exportFileName";
import { useLayerCounts } from "./useLayerCounts";

/**
 * The columns that are never offered as "attributes".
 *
 * `id, feature_id, object_type, parents, children` plus `children_roles` and
 * `bbox` are identity and structure — the exporter always writes them, and
 * `CITYPARQUET_REQUIRED_COLUMNS` says so.
 *
 * `address` and `other` are here for the OPPOSITE reason: they are the
 * reader's own columns, not the file's attributes, and the CityParquet source
 * table does not carry them (the writer does not require them, and nobody
 * chose them). Leaving them in the attribute list would offer
 * `address STRUCT[]` as a tick-box and then feed it into a source SELECT that
 * has no business holding it.
 */
const FIXED_COLUMNS = new Set([
  ...FLAT_PREFIX_COLUMNS,
  "children_roles",
  "bbox",
  "address",
  "other",
]);

type Format = "cityparquet" | "parquet" | "csv" | "json";

const FORMAT_LABELS: Readonly<Record<Format, string>> = {
  cityparquet: "CityParquet package (.zip)",
  parquet: "Parquet",
  csv: "CSV",
  json: "JSON",
};

const EXTENSIONS: Readonly<Record<Format, string>> = {
  cityparquet: "cityparquet.zip",
  parquet: "parquet",
  csv: "csv",
  json: "json",
};

/**
 * Shown, and greyed out, so the user learns the capability EXISTS and why they
 * cannot have it — an absent option teaches nothing and invites the same
 * question again next release.
 *
 * The sinks bypass DuckDB's VFS entirely: browser-confirmed 2026-09-04 that no
 * file is created at all (the missing-file signature), for all three formats,
 * with and without a pre-registered empty buffer, while the same extension
 * writes fine through `cityparquet_write`.
 */
const DISABLED_FORMATS: ReadonlyArray<string> = [
  "CityJSON",
  "CityJSONSeq",
  "FlatCityBuf",
];

const DISABLED_FORMAT_REASON =
  "Not available in the browser build of the cityjson extension (writes an empty file)";

const NO_EPSG_REASON =
  "This layer has no EPSG code, so a CityParquet package cannot be written.";

const NO_SOURCE_REASON =
  "This layer has no CityJSON source in DuckDB; geometry formats need one";

const RELINK_REASON = "Re-link the file to export this layer";

/**
 * Why Export is withheld after a refresh that did not land.
 *
 * Named up front, with the engine's own sentence appended: "could not be
 * rebuilt" says what happened to the table, and DuckDB's message says why.
 */
const REFRESH_FAILED_PREFIX =
  "This layer's table could not be rebuilt, so an export would write an out-of-date set of objects. ";

export interface ExportDialogProps {
  readonly layerId: string;
  readonly layerName: string;
  readonly table: LayerTable;
  readonly epsg: number | null;
  readonly selectedLod: string | null;
  readonly isStreaming: boolean;
  readonly onClose: () => void;
}

export function ExportDialog({
  layerId,
  layerName,
  table,
  epsg,
  selectedLod,
  isStreaming,
  onClose,
}: ExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // `useModalChrome` is called further down, once `requestClose` exists: the
  // dialog must not dismiss itself out from under an export in flight.

  const query = useQueryStore((s) => layerQuery(s, layerId));
  const counts = useLayerCounts(layerId);
  const selections = useSelectionStore((s) => s.selections);
  const selectedObjectIds = useMemo(
    () =>
      selections
        .filter((selection) => selection.layerId === layerId)
        .map((selection) => selection.objectId),
    [selections, layerId],
  );
  const layer = useLayerStore((s) =>
    s.layers.find((candidate) => candidate.id === layerId),
  );
  const streamVersion = useStreamStore((s) => s.streams[layerId]?.version);
  const selectedFeatureIds = useMemo(() => {
    if (!layer) return selectedObjectIds;
    const objects = layer.isStreaming
      ? getResidentModel(layerId, streamVersion ?? 0).objects
      : layer.model.objects;
    const parents = parentsIndexOf(objects);
    return selectedObjectIds.map((id) => rootFeatureId(id, parents));
  }, [layer, layerId, selectedObjectIds.join("\u0000"), streamVersion]);

  const attributeColumns = useMemo(
    () => table.columns.filter((c) => !FIXED_COLUMNS.has(c.name)),
    [table.columns],
  );

  /** A CityParquet package needs a reader (the geometry comes from the source,
   *  not the browsing table), an LoD, and an EPSG code for its CRS. */
  const canCityParquet =
    table.reader !== null &&
    table.source !== null &&
    table.lods.length > 0 &&
    epsg !== null;
  const formats: ReadonlyArray<Format> = canCityParquet
    ? ["cityparquet", "parquet", "csv", "json"]
    : ["parquet", "csv", "json"];
  /**
   * A reader-backed layer whose bytes can no longer be obtained.
   *
   * It costs the CityParquet package and NOTHING else: the attribute formats
   * are written from the browsing table, which is right there. Gating the
   * whole Export button on this is what made a re-opened session unable to
   * take a CSV out of a table it was busily browsing.
   */
  const relinkNeeded = table.reader !== null && table.source === null;

  const [rootTypes, setRootTypes] = useState<ReadonlyArray<string>>([]);
  const [selectedTypes, setSelectedTypes] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [selectedAttributes, setSelectedAttributes] = useState<
    ReadonlySet<string>
  >(() => new Set(attributeColumns.map((c) => c.name)));

  // That initialiser runs ONCE. A streaming layer's table is rebuilt under
  // this dialog — `refreshStreamingTable` on open, and again on every commit
  // while the panel is up — and the new table can carry different columns, so
  // re-seed on the column list's identity. Without it the export writes a
  // column list belonging to a table that no longer exists.
  useEffect(() => {
    setSelectedAttributes(new Set(attributeColumns.map((c) => c.name)));
  }, [attributeColumns]);
  const [scope, setScope] = useState<"all" | "filter" | "selected">(
    query.applied === null ? "all" : "filter",
  );
  const [chosenFormat, setChosenFormat] = useState<Format>("csv");
  // CLAMPED, not stored blind: `formats` SHRINKS when the table is rebuilt as
  // a fallback (a streaming layer's rebuild), and a `chosenFormat` of
  // "cityparquet" that is no longer offered would leave the dialog with no
  // radio checked and an Export button running a route this layer cannot serve.
  // "parquet" rather than `formats[0]!`: it is in BOTH lists, so the fallback
  // is a format the layer can genuinely serve, not an assertion that the array
  // is non-empty.
  const format: Format = formats.includes(chosenFormat)
    ? chosenFormat
    : (formats[0] ?? "parquet");
  // The SUFFIX is the identity here — labels are for reading. The layer's own
  // `selectedLod` is a label ("2.2"), so it is matched against `label`, and the
  // fallback is the LAST (highest) rung rather than a re-spelled string.
  const defaultLod =
    table.lods.find((l) => l.label === selectedLod) ??
    table.lods[table.lods.length - 1] ??
    null;
  const [chosenLodSuffix, setChosenLodSuffix] = useState<string | null>(
    defaultLod?.suffix ?? null,
  );
  const lod: LodColumn | null =
    table.lods.find((l) => l.suffix === chosenLodSuffix) ?? defaultLod;

  // Re-seeded with the columns, for the same reason: a rebuilt table can carry
  // a different ladder, and a suffix from the old one names no column.
  useEffect(() => {
    setChosenLodSuffix(defaultLod?.suffix ?? null);
    // `defaultLod` is derived from `table.lods`; keying on the array identity
    // is what makes this run once per table rather than once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.lods]);
  // A streaming layer's table is REBUILT under this dialog (below), and the
  // registry keeps the old table readable while it runs — which is right for
  // the grid and wrong for an export: writing the previous resident set is
  // exactly what the rebuild exists to prevent. So the button waits, and says
  // why rather than looking broken.
  const rebuilding = useLayerTableStore((s) => {
    const entry = s.tables[layerId];
    return entry?.state === "ready" && entry.rebuilding === true;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ReadonlyArray<string>>([]);

  /**
   * The refresh this dialog asked for and did not get.
   *
   * A failed rebuild leaves the PREVIOUS table `ready` — right for the grid,
   * and the reason the store cannot answer this question. Without the outcome
   * the dialog simply stopped showing "Refreshing table…" and exported the
   * resident set from whenever the last successful build was, with nothing on
   * screen to say so.
   */
  const [refreshFailure, setRefreshFailure] = useState<string | null>(null);

  // A streaming layer's table is only as fresh as its last rebuild, and the
  // panel gates those on being open. Opening this dialog is a promise that the
  // export reflects what is resident NOW, so force one rebuild; the new table
  // arrives as a new `table` prop and re-runs the type probe below.
  useEffect(() => {
    if (!isStreaming) return;
    let cancelled = false;
    setRefreshFailure(null);
    void (async () => {
      const outcome = await refreshStreamingTable(layerId);
      if (cancelled) return;
      setRefreshFailure(outcome.ok ? null : outcome.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [isStreaming, layerId]);

  // The top-level types come from the table, not from the model: a streaming
  // layer has no model to ask, and the two could disagree.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await runQuery(buildRootTypesSql(table.table));
      if (cancelled) return;
      if (!result.ok) {
        // Without this the type list is simply empty, which disables Export
        // with no explanation anywhere on screen — indistinguishable from a
        // layer that genuinely holds no objects.
        setError(result.message);
        return;
      }
      const types = result.rows
        .map((row) => row.value)
        .filter((v): v is string => typeof v === "string");
      setRootTypes(types);
      setSelectedTypes(new Set(types));
    })();
    return () => {
      cancelled = true;
    };
  }, [table.table]);

  const toggle = useCallback(
    (set: ReadonlySet<string>, value: string): ReadonlySet<string> => {
      const next = new Set(set);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    },
    [],
  );

  /**
   * The scope actually in force.
   *
   * `scope` is seeded when the dialog opens and the filter can be cleared
   * under it (the filter bar is still live behind this modal). A stale
   * "filter" would then compile nothing and export the whole layer while the
   * radio still claimed otherwise — so "there is no applied filter" resolves
   * to "whole layer" everywhere, in the radio and in the request alike.
   */
  const effectiveScope: "all" | "filter" | "selected" =
    scope === "filter" && query.applied === null ? "all" : scope;

  /** Escape and a backdrop click are dismissals; an export in flight is not
   *  something to dismiss — closing would throw away the warnings or the error
   *  it is about to produce, with the write already gone to DuckDB. */
  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  // Focus trap, scroll lock and Escape — Escape through `requestClose`, so an
  // export in flight ignores it exactly as the backdrop and the × do.
  useModalChrome(dialogRef, requestClose);

  const handleExport = useCallback(async () => {
    setError(null);
    setWarnings([]);
    setBusy(true);
    try {
      let where: string | null = null;
      if (effectiveScope === "filter" && query.applied !== null) {
        const compiled = compileFilter(query.applied, table.columns);
        if (!compiled.ok) throw new Error(compiled.message);
        where = compiled.where;
      } else if (effectiveScope === "selected") {
        const ids = [...new Set(selectedFeatureIds)];
        if (ids.length === 0)
          throw new Error(
            "Select at least one building to export selected records.",
          );
        // Feature scope deliberately does not intersect the current filter.
        where = `COALESCE("feature_id", "id") IN (${ids.map(quoteLiteral).join(", ")})`;
      }

      const attributes = attributeColumns
        .filter((c) => selectedAttributes.has(c.name))
        .map((c) => c.name);
      // Spec §8: a tool's columns export as attributes too — but they were
      // never in the file, so the CityParquet path has to read them from the
      // layer's table rather than from the re-registered source.
      const computed = computedColumnsOf(layerId);
      const computedAttributes = attributes.filter((name) =>
        computed.has(name),
      );

      // ONE selection, both routes. The type tick-boxes used to reach the
      // CityParquet request only, so a CSV of "Buildings" came back holding
      // every other object type in the layer.
      const chosenTypes = rootTypes.filter((t) => selectedTypes.has(t));

      let request: ExportRequest;
      if (format === "cityparquet") {
        // A real guard, not `!`. `canCityParquet` gates the option, but the
        // TABLE can be rebuilt under an open dialog and come back as a
        // fallback with no reader and no source; a non-null assertion would
        // then send `undefined` into the exporter and fail somewhere deep in
        // the SQL, where the message means nothing to the user.
        const { reader, source } = table;
        if (
          reader === null ||
          source === null ||
          epsg === null ||
          lod === null
        ) {
          throw new Error(
            "This layer no longer has a CityJSON source with an LoD and an EPSG code, so a CityParquet package cannot be written. Pick another format.",
          );
        }
        request = {
          kind: "cityparquet",
          table: table.table,
          reader,
          source,
          sourceExtension:
            reader === "read_cityjsonseq" ? "city.jsonl" : "city.json",
          lodSuffix: lod.suffix,
          attributes,
          computedAttributes,
          where,
          rootTypes: chosenTypes,
          epsg,
          fileName: exportFileName(layerName, EXTENSIONS.cityparquet),
        };
      } else {
        request = {
          kind: "attributes",
          format,
          table: table.table,
          columns: [
            ...table.columns.filter(
              (c) =>
                c.name === "id" ||
                c.name === "feature_id" ||
                c.name === "object_type",
            ),
            ...attributeColumns.filter((c) => selectedAttributes.has(c.name)),
          ],
          rootTypes: chosenTypes,
          allRootTypes: rootTypes,
          where,
          fileName: exportFileName(layerName, EXTENSIONS[format]),
        };
      }

      const result = await runExport(request);
      downloadBlob(result.blob, result.fileName);
      setWarnings(result.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed.");
    } finally {
      // Cancel-safe: a rejected export must still give the button back.
      setBusy(false);
    }
  }, [
    attributeColumns,
    epsg,
    format,
    layerName,
    lod,
    layerId,
    effectiveScope,
    query.applied,
    rootTypes,
    selectedAttributes,
    selectedTypes,
    table,
  ]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // preventDefault, or the browser's own mousedown behaviour moves focus
        // to <body> after the chrome has already restored it to the trigger —
        // the same reason `AddLayerDialog` does it.
        e.preventDefault();
        requestClose();
      }}
    >
      {/* `modal`, not a spelling of its own: the panel background, the width
          bound and the max-height scroll all live on that class, and the
          `modal-dialog` this used to name exists in no stylesheet here — the
          dialog rendered as unstyled text over the viewport. */}
      <div
        className="modal export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="export-dialog-title">
            Export {layerName}
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            title="Close"
            disabled={busy}
            onClick={requestClose}
          >
            ×
          </button>
        </div>

        <div className="modal-body export-body">
          {isStreaming && (
            <p className="export-streaming-note">
              Exports include currently loaded records only, not the whole
              dataset.
            </p>
          )}
          <fieldset className="export-group">
            <legend>Rows</legend>
            <label>
              <input
                type="radio"
                name="export-scope"
                aria-label="Whole layer"
                checked={effectiveScope === "all"}
                onChange={() => setScope("all")}
              />
              <span>
                {query.view === "raw"
                  ? "Whole raw-object layer"
                  : `Whole layer · ${counts.all === null ? "?" : counts.all} buildings including parts`}
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="export-scope"
                aria-label="Selected records"
                disabled={selectedObjectIds.length === 0}
                checked={effectiveScope === "selected"}
                onChange={() => setScope("selected")}
              />
              <span>
                Selected records · {new Set(selectedFeatureIds).size} buildings
                including parts
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="export-scope"
                aria-label="Current filter"
                disabled={query.applied === null}
                checked={effectiveScope === "filter"}
                onChange={() => setScope("filter")}
              />
              <span>
                {query.view === "raw"
                  ? "Current raw-object filter"
                  : `Current filter · ${counts.matching === null ? "?" : counts.matching} buildings including parts`}
              </span>
            </label>
          </fieldset>

          <fieldset className="export-group">
            <legend>Object types</legend>
            {rootTypes.map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  aria-label={type}
                  checked={selectedTypes.has(type)}
                  onChange={() => setSelectedTypes((s) => toggle(s, type))}
                />
                <span>{type}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="export-group export-group-scroll">
            <legend>Attributes</legend>
            {attributeColumns.map((column) => (
              <label key={column.name}>
                <input
                  type="checkbox"
                  aria-label={column.name}
                  checked={selectedAttributes.has(column.name)}
                  onChange={() =>
                    setSelectedAttributes((s) => toggle(s, column.name))
                  }
                />
                <span>{column.name}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="export-group">
            <legend>Format</legend>
            {formats.map((f) => (
              <label key={f}>
                <input
                  type="radio"
                  name="export-format"
                  aria-label={FORMAT_LABELS[f]}
                  checked={format === f}
                  onChange={() => setChosenFormat(f)}
                />
                <span>{FORMAT_LABELS[f]}</span>
              </label>
            ))}
            {/* Only where a source exists to write geometry FROM: on a
                fallback layer the honest message is the sentence below, not a
                greyed-out option whose reason is a different one. */}
            {table.reader !== null &&
              DISABLED_FORMATS.map((label) => (
                <label key={label} title={DISABLED_FORMAT_REASON}>
                  <input
                    type="radio"
                    name="export-format"
                    aria-label={label}
                    disabled
                    checked={false}
                    onChange={() => {}}
                  />
                  <span>{label}</span>
                </label>
              ))}
          </fieldset>

          {table.reader === null && (
            <p className="export-note">{NO_SOURCE_REASON}</p>
          )}

          {relinkNeeded && <p className="export-note">{RELINK_REASON}</p>}

          {table.lods.length > 0 && (
            <label className="export-field">
              <span>Level of detail</span>
              <select
                aria-label="Level of detail"
                value={lod?.suffix ?? ""}
                onChange={(e) => setChosenLodSuffix(e.target.value)}
              >
                {table.lods.map((l) => (
                  // The VALUE is the suffix — what a column name is built
                  // from — and the label is only what the user reads.
                  <option key={l.suffix} value={l.suffix}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {table.reader !== null && epsg === null && (
            <p className="export-note">{NO_EPSG_REASON}</p>
          )}

          {warnings.map((warning) => (
            <p className="export-note" key={warning}>
              {warning}
            </p>
          ))}

          {/* A REFUSAL, not a warning: what is in the table is not what is on
              screen, so exporting it would hand back a file of stale
              residents with nothing to mark it as such. */}
          {refreshFailure !== null && (
            <p className="export-error" role="alert">
              {REFRESH_FAILED_PREFIX}
              {refreshFailure}
            </p>
          )}

          {error !== null && (
            <p className="export-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="export-cancel"
            onClick={requestClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="export-submit"
            // NOT gated on `relinkNeeded`: the attribute formats are written
            // from the browsing table and need no source at all. The missing
            // source costs the CityParquet option, which `canCityParquet`
            // already withholds, and says so in a sentence above.
            // `refreshFailure` gates it for the same reason `rebuilding`
            // does — the table is not the one this dialog promised — except
            // that waiting will not fix this one, so the message says so.
            disabled={
              busy ||
              rebuilding ||
              refreshFailure !== null ||
              selectedTypes.size === 0
            }
            onClick={() => void handleExport()}
          >
            {busy ? "Exporting…" : rebuilding ? "Refreshing table…" : "Export"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
