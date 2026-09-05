/**
 * Writing a layer, or its filtered subset, back out.
 *
 * Everything goes through DuckDB's own writers and comes back through the VFS
 * as bytes — there is no app-side serialiser here, which is what keeps a CSV
 * of a DATE column formatted the way DuckDB formats it rather than the way JS
 * would.
 *
 * NOT offered, and not to be added without re-probing: the `FORMAT cityjson |
 * cityjsonseq | flatcitybuf` sinks bypass DuckDB's VFS entirely — no file is
 * created at all — while the same extension writes fine through
 * `cityparquet_write`. A format that produces nothing is worse than a format
 * that is absent, so those three are offered only as DISABLED options in the
 * dialog, and every read-back here is validated by CONTENT.
 */

import { zipSync } from "fflate";
import { groupTypesByModule } from "./cityGmlModule";
import type { ColumnInfo } from "./columnKind";
import { ddl, dropBuffer, readFile, registerBuffer, runQuery } from "./duckdb";
import type { SourceProvider } from "./layerTables";
import {
  buildAttributeExportSql,
  buildCityParquetModuleSql,
  buildCityParquetSourceSql,
  exportColumnNames,
  quoteIdent,
  quoteLiteral,
  type AttributeExportFormat,
} from "./sql";

export interface AttributeExportRequest {
  readonly kind: "attributes";
  readonly format: AttributeExportFormat;
  readonly table: string;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly where: string | null;
  /** The TOP-LEVEL types the user chose. Parts follow their root, exactly as
   *  in the CityParquet route — the two selections are one choice in the
   *  dialog and must mean one thing here. */
  readonly rootTypes: ReadonlyArray<string>;
  /** Every root type the layer has. Only the COMPARISON is interesting: a
   *  selection equal to this needs no predicate, and emitting one anyway is a
   *  self-join over the whole table for no filtering at all. */
  readonly allRootTypes: ReadonlyArray<string>;
  readonly fileName: string;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly fileName: string;
  /** Advisory, never a refusal — a validation finding, a module that wrote no
   *  rows. The dialog shows them beside the download. */
  readonly warnings: ReadonlyArray<string>;
}

const MIME: Readonly<Record<AttributeExportFormat, string>> = {
  parquet: "application/vnd.apache.parquet",
  csv: "text/csv",
  json: "application/json",
};

/** What a read-back is checked AS — not the download's format, since a
 *  CityParquet package's own files are parquet and json. */
export type ExportContentFormat = "parquet" | "csv" | "json";

export type ReadbackOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

const PAR1 = [0x50, 0x41, 0x52, 0x31]; // "PAR1"

/**
 * Is this really the file DuckDB was asked to write?
 *
 * The check is BY CONTENT, and that is not belt-and-braces: a VFS name that
 * was never created reads back as ONE GARBAGE BYTE with NO error — from
 * `copyFileToBuffer` and `read_blob` alike — while a genuinely empty file
 * reads back as zero. So "the writer silently wrote nothing" and "here is your
 * file" are indistinguishable by the call's own result, and only the bytes can
 * tell them apart. A one-byte "CSV" would otherwise download happily.
 *
 * Pure, so the three format rules are unit-tested without an engine.
 */
export function validateExportBytes(
  name: string,
  format: ExportContentFormat,
  bytes: Uint8Array | null,
): ReadbackOutcome {
  const fail: ReadbackOutcome = {
    ok: false,
    message: `DuckDB produced no output for ${name}`,
  };
  // Catches both the empty write and the missing-name signature before any
  // format-specific check has to think about a 1-byte buffer.
  if (bytes === null || bytes.length <= 1) return fail;

  if (format === "parquet") {
    for (let i = 0; i < PAR1.length; i++) {
      if (bytes[i] !== PAR1[i]) return fail;
    }
    return { ok: true, bytes };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail;
  }

  if (format === "json") {
    try {
      JSON.parse(text);
    } catch {
      return fail;
    }
    return { ok: true, bytes };
  }

  // CSV: a header line, terminated. A header with no newline is a truncated
  // write; a leading newline means the header itself never arrived.
  const newline = text.indexOf("\n");
  if (newline <= 0) return fail;
  return { ok: true, bytes };
}

/** VFS names are minted from a counter and never reused: a `dropFile`d name
 *  still resolves, to zero bytes, so a second export under an old name would
 *  hand back an empty file with no error anywhere. */
let exportCounter = 0;

function nextExportName(): string {
  return `export_${++exportCounter}`;
}

/**
 * Rewind the counter. TEST-ONLY.
 *
 * Module state survives between `it` blocks in one file, so without this the
 * second test in a suite writes `export_2.csv` and every exact-name assertion
 * after the first is checking the wrong number — including the one that exists
 * precisely to prove names are NOT reused, which would then be asserting the
 * wrong pair. Exported rather than papered over with a regex: the names are
 * part of the contract, and `export_\d+` would not notice a counter that had
 * stopped incrementing.
 */
export function resetExportCounterForTests(): void {
  exportCounter = 0;
}

/**
 * The types to name in the SQL, or `null` for "no predicate".
 *
 * A selection covering every type the layer has filters nothing, so it is
 * emitted as nothing: the predicate is a correlated subquery over the whole
 * table, and paying for it to keep every row is the sort of cost that turns a
 * 700 k-row export into a slow one for no reason. An EMPTY selection is a
 * refusal rather than `IN ()` — a syntax error — or an empty file, which the
 * user would have to open to discover.
 */
function rootTypePredicateTypes(
  request: AttributeExportRequest,
): ReadonlyArray<string> | null {
  const chosen = [...new Set(request.rootTypes)];
  if (chosen.length === 0) {
    throw new Error("Choose at least one object type to export.");
  }
  const all = new Set(request.allRootTypes);
  const everyType =
    chosen.length >= all.size && chosen.every((t) => all.has(t));
  return everyType ? null : chosen;
}

/**
 * One CSV line's fields, respecting RFC 4180 quoting.
 *
 * A column name may legitimately hold a comma or a quote (a CityJSON
 * attribute name is free text), and DuckDB then writes `"a,b"` — splitting on
 * commas would read that as two columns and refuse a perfectly good file.
 */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push(field);
      field = "";
    } else field += char;
  }
  fields.push(field);
  return fields;
}

/**
 * Does the CSV DuckDB wrote carry the columns we asked for?
 *
 * `validateExportBytes` proves there IS a header line; this proves it is the
 * RIGHT one. The pair matters because the `COPY` target is a VFS name and the
 * VFS is shared: a stale file under a name we thought was fresh reads back as
 * a perfectly valid CSV of the wrong columns, and the user would only find out
 * in whatever they opened it with.
 */
function csvHeaderMismatch(
  bytes: Uint8Array,
  expected: ReadonlyArray<string>,
): string | null {
  // A projection of nothing writes `SELECT 1`, whose header is "1" and names
  // no column of ours — there is nothing to compare it against.
  if (expected.length === 0) return null;
  const text = new TextDecoder().decode(bytes);
  const firstLine = text.slice(0, text.indexOf("\n")).replace(/\r$/, "");
  const actual = csvFields(firstLine);
  const same =
    actual.length === expected.length &&
    actual.every((name, i) => name === expected[i]);
  return same
    ? null
    : `The CSV DuckDB wrote has the columns ${actual.join(", ")}, not the ${expected.join(", ")} that were asked for.`;
}

async function exportAttributes(
  request: AttributeExportRequest,
): Promise<ExportResult> {
  const rootTypes = rootTypePredicateTypes(request);
  const outFile = `${nextExportName()}.${request.format}`;
  try {
    const written = await ddl(
      buildAttributeExportSql({
        table: request.table,
        columns: request.columns,
        where: request.where,
        format: request.format,
        outFile,
        rootTypes,
      }),
    );
    if (!written.ok) throw new Error(written.message);

    const readback = validateExportBytes(
      outFile,
      request.format,
      await readFile(outFile),
    );
    if (!readback.ok) throw new Error(readback.message);

    if (request.format === "csv") {
      const mismatch = csvHeaderMismatch(
        readback.bytes,
        exportColumnNames(request.columns, "csv"),
      );
      if (mismatch !== null) throw new Error(mismatch);
    }

    return {
      blob: new Blob([readback.bytes as BlobPart], {
        type: MIME[request.format],
      }),
      fileName: request.fileName,
      warnings: [],
    };
  } finally {
    await dropBuffer(outFile);
  }
}

/**
 * The file NAME out of one `cityparquet_write` result row.
 *
 * The FIRST string-valued column, not a column called `file`: the observed
 * shape is `file | action | rows | bytes`, but that column name is the
 * extension's, undocumented, and a rename would silently produce an empty zip
 * rather than an error. The first string in a row of (name, action, count,
 * count) is the name in any spelling of that tuple.
 *
 * A leading `<outDir>/` is stripped: the extension has been seen to report
 * both a bare name and a path relative to the database, and prefixing an
 * already-prefixed name yields `exp_1/exp_1/building.parquet`, which reads
 * back as the missing-file signature.
 */
function writtenFileName(
  row: Record<string, unknown>,
  outDir: string,
): string | null {
  for (const value of Object.values(row)) {
    if (typeof value !== "string" || value === "") continue;
    return value.startsWith(`${outDir}/`)
      ? value.slice(outDir.length + 1)
      : value;
  }
  return null;
}

/** How one of the writer's own output files is checked. Its package holds
 *  parquet object tables and a JSON STAC Item, nothing else. */
function contentFormatOf(fileName: string): ExportContentFormat {
  if (fileName.endsWith(".parquet")) return "parquet";
  if (fileName.endsWith(".csv")) return "csv";
  return "json";
}

export interface CityParquetExportRequest {
  readonly kind: "cityparquet";
  readonly table: string;
  readonly reader: "read_cityjson" | "read_cityjsonseq";
  readonly source: SourceProvider;
  readonly sourceExtension: string;
  /** `LodColumn.suffix` — the reader's own spelling ("2_2", "0_0"), never a
   *  label re-spelled here. */
  readonly lodSuffix: string;
  readonly attributes: ReadonlyArray<string>;
  readonly where: string | null;
  readonly rootTypes: ReadonlyArray<string>;
  readonly epsg: number;
  readonly fileName: string;
}

/**
 * Everything `cityparquet_validate` had to say, as a line for the dialog.
 *
 * The pragma RETURNS NO ROWS: it MATERIALISES its findings into a temp table
 * called `cityparquet_validation`, which is then selected from (a PRAGMA cannot
 * be a subquery). Two consequences this function exists to handle:
 *
 *  - if the PRAGMA fails, that table is never created at all, and the follow-up
 *    SELECT fails with `Catalog Error: Table with name cityparquet_validation
 *    does not exist!` — observed in probe P6g on a schema missing `feature_id`;
 *  - the table persists on the connection, so a PREVIOUS export's findings would
 *    be read as this one's. It is dropped first.
 *
 * Nothing here is a refusal — the writer never refuses on a finding, so neither
 * do we — but a validation that could not be RUN or READ is reported, never
 * silently skipped: "no warnings" and "we never looked" must not look alike.
 */
async function validationWarnings(schema: string): Promise<string[]> {
  await ddl("DROP TABLE IF EXISTS cityparquet_validation");

  const validated = await ddl(
    `PRAGMA cityparquet_validate(${quoteLiteral(schema)})`,
  );
  if (!validated.ok) {
    return [`Validation could not be run: ${validated.message}`];
  }

  const findings = await runQuery(
    'SELECT "severity", count(*) AS "n" FROM cityparquet_validation GROUP BY 1 ORDER BY 1',
  );
  if (!findings.ok) {
    return [`Validation could not be read: ${findings.message}`];
  }

  let total = 0;
  const parts: string[] = [];
  for (const row of findings.rows) {
    const n = Number(row.n ?? 0);
    total += n;
    // A row's value is `unknown`: anything but a string is reported as
    // "unknown" rather than stringified into "[object Object]".
    const severity =
      typeof row.severity === "string" ? row.severity : "unknown";
    parts.push(`${n} ${severity}`);
  }
  if (total === 0) return [];
  return [
    `cityparquet_validate reported ${total} findings (${parts.join(", ")}). The package was written anyway.`,
  ];
}

/** Remove one file the WRITER created (as opposed to a buffer we registered).
 *  `dropFile` over a writer-created path is not something the probes covered,
 *  so a failure is reported rather than swallowed — and never allowed to mask
 *  the export's own outcome, which is why it cannot throw. */
async function dropWrittenFile(path: string): Promise<void> {
  try {
    await dropBuffer(path);
  } catch (error) {
    console.warn(`Could not remove the exported file "${path}":`, error);
  }
}

/**
 * A CityParquet package, written by the extension and zipped here.
 *
 * The shape is dictated by what `cityparquet_write` actually accepts (probed
 * end to end): the export schema must hold ORDINARY tables named for CityGML
 * modules, the source has to be read again through the cityjson reader because
 * the browsing table has no geometry, and the write's own RESULT ROWS name the
 * files it produced — which is the ONLY list of them there is. Listing the VFS
 * is no help: a name that was never created still resolves, to one garbage
 * byte and no error (the same probe finding {@link validateExportBytes} exists
 * for), so a directory listing cannot tell a written file from an imaginary
 * one. Cleanup therefore uses the names the write rows gave us, and nothing
 * else.
 *
 * The source is read exactly ONCE, into a scratch table in a SEPARATE schema:
 * `cityparquet_init` describes every table in the schema it is handed, so the
 * scratch table cannot live beside the module tables, and cutting each module
 * straight from the reader would re-parse the whole file per module.
 */
async function exportCityParquet(
  request: CityParquetExportRequest,
): Promise<ExportResult> {
  // An EPSG code reaches the SQL as part of a literal, and `crs =>
  // 'EPSG:7415.5'` is not a CRS the writer can resolve — nor is `EPSG:NaN`,
  // which is what a `Number("")` upstream would spell. Refused here, in the
  // one place that knows the writer's argument shape.
  if (!Number.isInteger(request.epsg) || request.epsg <= 0) {
    throw new Error(
      `"${String(request.epsg)}" is not an EPSG code, so a CityParquet package cannot be written for this layer.`,
    );
  }

  const base = nextExportName().replace("export_", "exp_");
  const schema = base;
  const scratchSchema = `${base}_src`;
  const outDir = base;
  const sourceName = `${base}_src.${request.sourceExtension}`;
  const writtenFiles: string[] = [];

  try {
    const modules = groupTypesByModule(request.rootTypes);
    if (modules.length === 0) {
      throw new Error("Choose at least one object type to export.");
    }

    const scratchCreated = await ddl(
      `CREATE SCHEMA ${quoteIdent(scratchSchema)}`,
    );
    if (!scratchCreated.ok) throw new Error(scratchCreated.message);
    const schemaCreated = await ddl(`CREATE SCHEMA ${quoteIdent(schema)}`);
    if (!schemaCreated.ok) throw new Error(schemaCreated.message);

    // A FRESH array from the provider: registering consumes it.
    const bytes = await request.source();
    if (!(await registerBuffer(sourceName, bytes))) {
      throw new Error("The layer's source could not be re-read for export.");
    }

    const sourceRead = await ddl(
      buildCityParquetSourceSql({
        scratchSchema,
        reader: request.reader,
        sourceFile: sourceName,
        table: request.table,
        lodSuffix: request.lodSuffix,
        attributes: request.attributes,
        where: request.where,
      }),
    );
    if (!sourceRead.ok) throw new Error(sourceRead.message);
    // The parse is done; the bytes are dead weight from here on.
    await dropBuffer(sourceName);

    for (const { module, types } of modules) {
      const created = await ddl(
        buildCityParquetModuleSql({
          schema,
          module,
          scratchSchema,
          table: request.table,
          moduleTypes: types,
        }),
      );
      if (!created.ok) throw new Error(created.message);
    }

    // ITS OWN STATEMENT, never batched with another: `cityparquet_init` is
    // what stamps the schema's `__cityparquet` bookkeeping, and a batched
    // PRAGMA is not reliably applied before the statement beside it runs.
    const initialised = await ddl(
      `PRAGMA cityparquet_init(${quoteLiteral(schema)})`,
    );
    if (!initialised.ok) throw new Error(initialised.message);

    const warnings = await validationWarnings(schema);

    const written = await runQuery(
      `SELECT * FROM cityparquet_write(${quoteLiteral(schema)}, ${quoteLiteral(outDir)}, crs => ${quoteLiteral(`EPSG:${request.epsg}`)})`,
    );
    if (!written.ok) throw new Error(written.message);

    // TWO passes, and the order matters. EVERY name the write reported is put
    // on the cleanup list FIRST, before a single byte is read: a validation
    // failure on the first output would otherwise throw with the rest of the
    // package still sitting in the VFS, and nothing would ever remove it —
    // a failed export of a large city would leak more memory than a successful
    // one. The directory argument carries NO trailing slash: with one, the
    // writer produces a second, duplicated set of paths.
    const names: string[] = [];
    for (const row of written.rows) {
      const name = writtenFileName(row, outDir);
      if (name === null) continue;
      names.push(name);
      writtenFiles.push(`${outDir}/${name}`);
    }
    if (names.length === 0) {
      throw new Error("The CityParquet writer produced no files.");
    }

    const entries: Record<string, Uint8Array> = {};
    for (const name of names) {
      const path = `${outDir}/${name}`;
      // EVERY named file must read back and validate: a package missing one of
      // its object tables — or carrying a `metadata.json` that does not parse —
      // is not a package, and the missing-name read gives back one garbage byte
      // with no error to warn us.
      const readback = validateExportBytes(
        path,
        contentFormatOf(name),
        await readFile(path),
      );
      if (!readback.ok) throw new Error(readback.message);
      entries[name] = readback.bytes;
    }

    return {
      blob: new Blob([zipSync(entries) as BlobPart], {
        type: "application/zip",
      }),
      fileName: request.fileName,
      warnings,
    };
  } finally {
    // ALWAYS: a half-built schema, a scratch copy of the whole model and a
    // multi-megabyte source buffer must not outlive a failed export. The
    // findings table is dropped at BOTH ends — before the validation so a
    // previous run's rows are not read as this one's, and here so a failed
    // export does not leave rows on the connection for the next one to find.
    await ddl("DROP TABLE IF EXISTS cityparquet_validation");
    await ddl(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    await ddl(`DROP SCHEMA IF EXISTS ${quoteIdent(scratchSchema)} CASCADE`);
    await dropBuffer(sourceName);
    for (const path of writtenFiles) await dropWrittenFile(path);
  }
}

export type ExportRequest = AttributeExportRequest | CityParquetExportRequest;

export async function runExport(request: ExportRequest): Promise<ExportResult> {
  return request.kind === "cityparquet"
    ? await exportCityParquet(request)
    : await exportAttributes(request);
}
