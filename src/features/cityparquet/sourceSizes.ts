/**
 * The browser's size probes for the CityParquet static/stream decision
 * (`streamDecision.ts` takes them injected; tests pass fakes).
 *
 * Both answer `null` rather than throw: "unknown" is a legitimate answer the
 * decision knows how to treat, and a probe failure must never fail a load.
 */
import {
  asyncBufferFromHttp,
  readCityParquetSchema,
} from "@cityjson/navara-cityparquet";

function lengthOf(header: string | null): number | null {
  if (header === null || header.trim() === "") return null;
  const n = Number(header);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The `Content-Length` of a `HEAD` for `url`, or `null`. */
export async function browserHeadLength(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok
      ? lengthOf(response.headers.get("Content-Length"))
      : null;
  } catch {
    return null;
  }
}

/**
 * A table's size, learned by opening it through a ranged buffer when `HEAD`
 * gave nothing: the buffer's own `byteLength`, which it established from the
 * ranged probe's `Content-Range` (or a `Content-Length` it did see). Only the
 * footer is ever fetched. `null` when the server serves no ranges, or the file
 * is not a readable CityParquet table.
 *
 * `readCityParquetSchema` is the gate, not the measurement: its job here is to
 * answer "is this a CityParquet table at all", so a JPEG behind a `.parquet`
 * URL comes back `null` rather than as a size.
 *
 * It used to sum the row groups' `total_compressed_size` instead. That is a
 * smaller number than the file — the footer, the page indexes and the magic
 * bytes sit outside every row group — and it is the wrong one: the 128 MiB
 * streaming threshold is written about the bytes a static load would have to
 * download, so a 140 MiB table whose row groups sum to 120 MiB was routed
 * static (Codex milestone review, Important).
 */
export async function browserFooterSize(url: string): Promise<number | null> {
  try {
    const buffer = await asyncBufferFromHttp(url);
    await readCityParquetSchema(buffer);
    return buffer.byteLength;
  } catch {
    return null;
  }
}
