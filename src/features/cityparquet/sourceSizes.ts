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
 * A table's size from its Parquet footer: the sum of its row groups'
 * `total_compressed_size`, read through a ranged buffer (only the footer is
 * fetched). The buffer's own byte length stands in when a row group omits the
 * field (it is optional in the format). `null` when the server serves no
 * ranges, or the file is not a readable CityParquet table.
 */
export async function browserFooterSize(url: string): Promise<number | null> {
  try {
    const buffer = await asyncBufferFromHttp(url);
    const { metadata } = await readCityParquetSchema(buffer);
    let total = 0;
    for (const group of metadata.row_groups) {
      if (group.total_compressed_size === undefined) return buffer.byteLength;
      total += Number(group.total_compressed_size);
    }
    return total;
  } catch {
    return null;
  }
}
