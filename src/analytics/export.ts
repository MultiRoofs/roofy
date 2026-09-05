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

import type { ColumnInfo } from "./columnKind";
import { ddl, dropBuffer, readFile } from "./duckdb";
import { buildAttributeExportSql, type AttributeExportFormat } from "./sql";

export interface AttributeExportRequest {
  readonly kind: "attributes";
  readonly format: AttributeExportFormat;
  readonly table: string;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly where: string | null;
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

async function exportAttributes(
  request: AttributeExportRequest,
): Promise<ExportResult> {
  const outFile = `${nextExportName()}.${request.format}`;
  try {
    const written = await ddl(
      buildAttributeExportSql({
        table: request.table,
        columns: request.columns,
        where: request.where,
        format: request.format,
        outFile,
      }),
    );
    if (!written.ok) throw new Error(written.message);

    const readback = validateExportBytes(
      outFile,
      request.format,
      await readFile(outFile),
    );
    if (!readback.ok) throw new Error(readback.message);

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

export type ExportRequest = AttributeExportRequest;

export async function runExport(request: ExportRequest): Promise<ExportResult> {
  return await exportAttributes(request);
}
