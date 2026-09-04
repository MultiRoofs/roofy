/**
 * The FLAT-FALLBACK table's rows: what a layer with no DuckDB reader
 * (CityGML, a zipped CityGML archive, CityParquet, a streaming layer's
 * resident cells) contributes instead.
 *
 * The column names are ALIGNED to the reader's — `id, feature_id, object_type,
 * parents, children`, then one column per attribute — because the filter
 * builder, the export scope and the map-filter id set are written once and
 * must mean the same thing on every layer. `parents`/`children` are NULL when
 * empty, exactly as the reader writes them, so `parents IS NULL` really is the
 * "is this a feature root" test on both kinds of table.
 *
 * The old `lod` and `surface_count` columns are gone: they were app-side
 * derivations, not data, and no other layer kind has them.
 *
 * Pure — no engine import, no store.
 */

import type { CityModel } from "../domain/citymodel/types";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";
import { parentsIndexOf, rootFeatureId } from "../domain/citymodel/featureId";

export interface FlatRow {
  readonly id: string;
  readonly feature_id: string;
  readonly object_type: string;
  readonly parents: ReadonlyArray<string> | null;
  readonly children: ReadonlyArray<string> | null;
  readonly [attribute: string]: unknown;
}

export const FLAT_PREFIX_COLUMNS: ReadonlyArray<string> = [
  "id",
  "feature_id",
  "object_type",
  "parents",
  "children",
];

const RESERVED = new Set(FLAT_PREFIX_COLUMNS);

/** An object's attributes as columns. A key that collides with a prefix
 *  column is DROPPED, not renamed: a file whose attribute is called `id`
 *  would otherwise silently replace the identity every join depends on. */
function attributeColumns(
  attributes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (RESERVED.has(key)) continue;
    out[key] =
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : value;
  }
  return out;
}

function emptyToNull(
  list: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | null {
  return list === undefined || list.length === 0 ? null : list;
}

export function flatRowsFromModel(model: CityModel): FlatRow[] {
  const parents = parentsIndexOf(model.objects);
  const rows: FlatRow[] = [];
  for (const [id, obj] of Object.entries(model.objects)) {
    if (!obj) continue;
    rows.push({
      ...attributeColumns(obj.attributes),
      id,
      feature_id: rootFeatureId(id, parents),
      object_type: obj.objectType,
      parents: emptyToNull(obj.parents),
      children: emptyToNull(obj.children),
    });
  }
  return rows;
}

export function flatRowsFromRecords(
  records: ReadonlyArray<ResidentObjectRecord>,
): FlatRow[] {
  const byId: Record<string, { readonly parents?: ReadonlyArray<string> }> = {};
  for (const r of records) byId[r.id] = { parents: r.parents };
  const parents = parentsIndexOf(byId);
  return records.map((r) => ({
    ...attributeColumns(r.attributes),
    id: r.id,
    feature_id: rootFeatureId(r.id, parents),
    object_type: r.objectType,
    parents: emptyToNull(r.parents),
    children: emptyToNull(r.children),
  }));
}

/**
 * The rows as UTF-8 JSON for `registerBuffer` + `read_json_auto`.
 *
 * BigInt is stringified rather than allowed to throw: a CityParquet or CityGML
 * attribute can genuinely be a 64-bit integer, and `JSON.stringify` refuses
 * one outright — which would fail the whole layer's table for one cell.
 */
export function encodeRowsAsJson(rows: ReadonlyArray<FlatRow>): Uint8Array {
  const json = JSON.stringify(rows, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return new TextEncoder().encode(json);
}
