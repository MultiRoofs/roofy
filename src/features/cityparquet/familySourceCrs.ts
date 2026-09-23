/**
 * The CRS a streamed family's FILE declares — what its `bbox` columns are in.
 *
 * WHY NOT THE STREAM HEADER. `CityParquetStreamHeader.epsg` /
 * `referenceSystem` are the stream's PROJECTED target (`coordinateTargetFor`
 * puts EPSG:6697 into a WGS84 UTM zone before a vertex reaches the scene), and
 * the layer's model metadata is a copy of that. A family's VIEW, though, reads
 * the file directly (ruling R-B′), so its `bbox` columns are the file's own
 * coordinates — degrees for a PLATEAU package. Recording the header's CRS on
 * the view would therefore claim metres for a table measured in degrees, and
 * the metric-bounds refusal (ruling S2) would never fire on exactly the data it
 * exists for.
 *
 * So the file is asked. `readCityParquetSchema` reads the Parquet FOOTER only —
 * the same read `browserFooterSize` already makes for the stream decision — and
 * `footer.epsg` is the PROJJSON `id` of the file's `city.crs`.
 *
 * ANY failure is `null`, which means "no claim": an unreadable footer must not
 * refuse a tool, and must not fail the table it was asked for. A stream that was
 * admitted at all has working ranged reads, so a failure here is unusual rather
 * than routine.
 *
 * CACHED PER SOURCE, by the same identity rule `familyViews` registers by: a URL
 * by its text, a `File` by its object (a re-picked handle is a new file). One
 * promise per source, so the families of one package — and a family whose table
 * is dropped and rebuilt — share the one footer read.
 */
import {
  asyncBufferFromBlob,
  asyncBufferFromHttp,
  readCityParquetSchema,
} from "@cityjson/navara-cityparquet";
import type { FamilySource } from "../../insights/familyViews";

const byUrl = new Map<string, Promise<string | null>>();
const byFile = new WeakMap<File, Promise<string | null>>();

async function read(source: FamilySource): Promise<string | null> {
  try {
    const buffer =
      "url" in source
        ? await asyncBufferFromHttp(source.url)
        : asyncBufferFromBlob(source.file);
    const schema = await readCityParquetSchema(buffer);
    const epsg = schema.footer.epsg;
    return epsg === null ? null : `EPSG:${String(epsg)}`;
  } catch {
    return null;
  }
}

/** `"EPSG:<code>"` for `source`'s own declared CRS, or `null` when the file
 *  does not say (or could not be read). Never rejects. */
export function familySourceCrs(source: FamilySource): Promise<string | null> {
  if ("url" in source) {
    const cached = byUrl.get(source.url);
    if (cached !== undefined) return cached;
    const pending = read(source);
    byUrl.set(source.url, pending);
    return pending;
  }
  const cached = byFile.get(source.file);
  if (cached !== undefined) return cached;
  const pending = read(source);
  byFile.set(source.file, pending);
  return pending;
}

export function resetFamilySourceCrsForTest(): void {
  byUrl.clear();
}
