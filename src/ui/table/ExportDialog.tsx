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
import { runQuery } from "../../analytics/duckdb";
import type { LodColumn } from "../../analytics/columnKind";
import type { LayerTable } from "../../analytics/layerTables";
import { runExport, type ExportRequest } from "../../analytics/export";
import { buildRootTypesSql, compileFilter } from "../../analytics/sql";
import { FLAT_PREFIX_COLUMNS } from "../../analytics/layerRows";
import { refreshStreamingTable } from "../../features/layers/layerTableLifecycle";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { downloadBlob } from "../../platform/download";
import { useModalChrome } from "../useModalChrome";
import { exportFileName } from "./exportFileName";

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
  useModalChrome(dialogRef, onClose);

  const query = useQueryStore((s) => layerQuery(s, layerId));

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
  /** A reader-backed layer whose bytes can no longer be obtained: the table is
   *  browsable, but nothing can be written from a source that is not there. */
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
  const [scope, setScope] = useState<"all" | "filter">(
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ReadonlyArray<string>>([]);

  // A streaming layer's table is only as fresh as its last rebuild, and the
  // panel gates those on being open. Opening this dialog is a promise that the
  // export reflects what is resident NOW, so force one rebuild; the new table
  // arrives as a new `table` prop and re-runs the type probe below.
  useEffect(() => {
    if (!isStreaming) return;
    void refreshStreamingTable(layerId);
  }, [isStreaming, layerId]);

  // The top-level types come from the table, not from the model: a streaming
  // layer has no model to ask, and the two could disagree.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await runQuery(buildRootTypesSql(table.table));
      if (cancelled || !result.ok) return;
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

  const handleExport = useCallback(async () => {
    setError(null);
    setWarnings([]);
    setBusy(true);
    try {
      let where: string | null = null;
      if (scope === "filter" && query.applied !== null) {
        const compiled = compileFilter(query.applied, table.columns);
        if (!compiled.ok) throw new Error(compiled.message);
        where = compiled.where;
      }

      const attributes = attributeColumns
        .filter((c) => selectedAttributes.has(c.name))
        .map((c) => c.name);

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
          where,
          rootTypes: rootTypes.filter((t) => selectedTypes.has(t)),
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
    query.applied,
    rootTypes,
    scope,
    selectedAttributes,
    selectedTypes,
    table,
  ]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Export ${layerName}`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2>Export {layerName}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body export-body">
          <fieldset className="export-group">
            <legend>Rows</legend>
            <label>
              <input
                type="radio"
                name="export-scope"
                aria-label="Whole layer"
                checked={scope === "all"}
                onChange={() => setScope("all")}
              />
              <span>Whole layer</span>
            </label>
            <label>
              <input
                type="radio"
                name="export-scope"
                aria-label="Current filter"
                disabled={query.applied === null}
                checked={scope === "filter"}
                onChange={() => setScope("filter")}
              />
              <span>Current filter</span>
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

          {error !== null && (
            <p className="export-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            title={relinkNeeded ? RELINK_REASON : undefined}
            disabled={busy || selectedTypes.size === 0 || relinkNeeded}
            onClick={() => void handleExport()}
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
