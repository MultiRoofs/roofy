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

/**
 * `JSON.stringify`'s replacer for everything this module serialises.
 *
 * `JSON.stringify` THROWS on a BigInt — it has no representation in JSON — and
 * a BigInt is not exotic here: hyparquet decodes every INT64 to one, so a
 * CityParquet `identificatie` is a BigInt and an attribute that is an OBJECT
 * routinely has one nested inside it. Unreplaced, a single such cell takes the
 * whole layer's table down. Its decimal STRING is the honest carrier: DuckDB
 * would render a 64-bit integer as text anyway (see `columnKind`'s castText).
 */
function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** An object's attributes as columns. A key that collides with a prefix
 *  column is DROPPED, not renamed: a file whose attribute is called `id`
 *  would otherwise silently replace the identity every join depends on. Each
 *  such key is recorded in `dropped` so the table can report it ONCE. */
function attributeColumns(
  attributes: Readonly<Record<string, unknown>>,
  dropped: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (RESERVED.has(key)) {
      dropped.add(key);
      continue;
    }
    out[key] =
      typeof value === "object" && value !== null
        ? JSON.stringify(value, bigintSafe)
        : value;
  }
  return out;
}

/**
 * One line per TABLE, not per row, naming what the fixed columns cost.
 *
 * Dropping the attribute is right — the identity every join and every feature
 * predicate depends on cannot be overwritten by a third party's column name —
 * but doing it silently means an attribute the user can see in the source file
 * is simply absent from the grid with nothing to explain it. Reported in the
 * fixed vocabulary's own order, so the sentence does not depend on which
 * object happened to be read first.
 */
function warnDroppedAttributes(dropped: ReadonlySet<string>): void {
  if (dropped.size === 0) return;
  const names = FLAT_PREFIX_COLUMNS.filter((c) => dropped.has(c)).join(", ");
  console.warn(
    `Flat table: source attributes named ${names} were dropped because they collide with the fixed columns.`,
  );
}

function emptyToNull(
  list: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | null {
  return list === undefined || list.length === 0 ? null : list;
}

export function flatRowsFromModel(model: CityModel): FlatRow[] {
  const parents = parentsIndexOf(model.objects);
  const dropped = new Set<string>();
  const rows: FlatRow[] = [];
  for (const [id, obj] of Object.entries(model.objects)) {
    if (!obj) continue;
    rows.push({
      ...attributeColumns(obj.attributes, dropped),
      id,
      feature_id: rootFeatureId(id, parents),
      object_type: obj.objectType,
      parents: emptyToNull(obj.parents),
      children: emptyToNull(obj.children),
    });
  }
  warnDroppedAttributes(dropped);
  return rows;
}

export function flatRowsFromRecords(
  records: ReadonlyArray<ResidentObjectRecord>,
): FlatRow[] {
  const byId: Record<string, { readonly parents?: ReadonlyArray<string> }> = {};
  for (const r of records) byId[r.id] = { parents: r.parents };
  const parents = parentsIndexOf(byId);
  const dropped = new Set<string>();
  const rows = records.map((r) => ({
    ...attributeColumns(r.attributes, dropped),
    id: r.id,
    feature_id: rootFeatureId(r.id, parents),
    object_type: r.objectType,
    parents: emptyToNull(r.parents),
    children: emptyToNull(r.children),
  }));
  warnDroppedAttributes(dropped);
  return rows;
}

/**
 * The rows as UTF-8 JSON for `registerBuffer` + `read_json_auto`.
 *
 * The same {@link bigintSafe} replacer as the attribute columns, so a 64-bit
 * integer reads identically whether it arrived at top level or nested inside
 * an object attribute — one rule, applied at both places a row is serialised.
 */
export function encodeRowsAsJson(rows: ReadonlyArray<FlatRow>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(rows, bigintSafe));
}
