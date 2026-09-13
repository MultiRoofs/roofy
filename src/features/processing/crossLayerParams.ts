/**
 * §7.5, §7.6 and §7.7's parameters, and the columns they resolve to.
 *
 * ONE module for three tools, because they share everything that matters: the
 * building proxy, the predicate, the slugified column names and the "resolves
 * to the same column" rule. Three files would be three places for the tie rule
 * to drift.
 *
 * FOUR READERS, and that is why every answer is pure: the registry (whose
 * `outputColumns`, `validateParams` and `normaliseParams` are data), the form
 * (which prints the resolved column list before any run exists), `submitRun`
 * (which FREEZES the normalised bag, so §6.4's log is the reproducible record)
 * and the executors (which read the frozen bag back).
 *
 * THE DEFAULTS THAT NEED CONTEXT LIVE IN `resolveCrossLayerParams`, NOT IN THE
 * READERS. §7.5's "all fields on by default" needs the SOURCE's keys and
 * "footprint when available" needs the TARGET's table — facts a `joinParams`
 * over an untyped bag cannot have. The hook resolves them per render, the form
 * renders the resolved bag, and `ToolView` freezes it; so the proxy in §6.4's
 * "building geometry proxy actually used" is literally the one that was used.
 * The readers' own fallback proxy is `"centre"`, the one every layer kind can
 * offer, so a bag that somehow lost its proxy can never claim a footprint the
 * layer does not have.
 */
import type { ColumnType, OutputColumn } from "../../insights/computedColumns";
import type { LayerTable } from "../../insights/layerTables";
import {
  defaultProxy,
  proxyOptions,
  type BuildingProxy,
} from "./buildingProxy";
import type { ToolId } from "./types";

export type JoinPredicate = "intersects" | "within" | "centreWithin";
export type JoinTie = "first" | "largestOverlap" | "countOnly";

export interface JoinParams {
  readonly proxy: BuildingProxy;
  readonly predicate: JoinPredicate;
  /** The SOURCE property names to copy, in source order. */
  readonly fields: ReadonlyArray<string>;
  readonly tie: JoinTie;
  readonly writeMatchCount: boolean;
  /**
   * The SOURCE property types, keyed by the RAW property name.
   * `resolveCrossLayerParams` puts them here and `normaliseParams` freezes them
   * with the rest of the bag, which is what keeps
   * `ToolDefinition.outputColumns(prefix, params)` TWO-argument and exact in
   * `RunFooter`, where no source layer is reachable (Decisions item 6 (iii)).
   * A field with no entry is VARCHAR — the type that holds anything — never
   * DOUBLE.
   */
  readonly fieldTypes: Readonly<Record<string, ColumnType>>;
}

export interface DistanceParams {
  readonly proxy: BuildingProxy;
  /** §7.7: "positive number, default 500". */
  readonly maxDistanceM: number;
  readonly writeNearestId: boolean;
  /** The source property to copy, or `null` for the feature's own GeoJSON
   *  `id` — §7.7's default when the source has one. */
  readonly nearestIdProperty: string | null;
}

export type AggregateOp = "count" | "sum" | "mean" | "min" | "max";
export interface AggregateRow {
  readonly op: AggregateOp;
  /** The SOURCE city column, or null for `count`. */
  readonly column: string | null;
}
export interface AggregateParams {
  readonly proxy: BuildingProxy;
  readonly predicate: JoinPredicate;
  readonly rows: ReadonlyArray<AggregateRow>;
}

/** §7.5's source must be AREAS; §7.7's may be any geometry type. */
export const SOURCE_NEEDS_AREAS: ReadonlySet<ToolId> = new Set<ToolId>([
  "join-by-location",
]);
/** §7.6's TARGET must be areas — "point and line layers are disabled". */
export const TARGET_NEEDS_AREAS: ReadonlySet<ToolId> = new Set<ToolId>([
  "aggregate-per-area",
]);
/** The GeoJSON geometry types that are areas. */
export const POLYGONAL_KINDS: ReadonlySet<string> = new Set([
  "Polygon",
  "MultiPolygon",
]);

const PROXIES: ReadonlyArray<BuildingProxy> = [
  "footprint",
  "rectangle",
  "centre",
];
const PREDICATES: ReadonlyArray<JoinPredicate> = [
  "intersects",
  "within",
  "centreWithin",
];
const TIES: ReadonlyArray<JoinTie> = ["first", "largestOverlap", "countOnly"];
const OPS: ReadonlyArray<AggregateOp> = ["count", "sum", "mean", "min", "max"];
const DEFAULT_MAX_DISTANCE_M = 500;

function pick<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback;
}

function strings(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * A field name as a column name: lower snake case, §6's collision rule
 * included — "Zone Name" and "zone_name" BOTH resolve to `zone_name`, and the
 * second one is flagged.
 *
 * A name with nothing usable in it becomes `field` rather than an empty string,
 * because an empty suffix would make the column the bare prefix — and for
 * §7.5's empty default prefix, no name at all.
 */
export function slugifyField(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? "field" : slug;
}

export function joinParams(raw: Readonly<Record<string, unknown>>): JoinParams {
  const tie = pick(raw["tie"], TIES, "first");
  return {
    proxy: pick(raw["proxy"], PROXIES, "centre"),
    predicate: pick(raw["predicate"], PREDICATES, "intersects"),
    fields: strings(raw["fields"]),
    tie,
    // §7.5: "count only" "writes no fields and FORCES the match count on".
    writeMatchCount: tie === "countOnly" || raw["writeMatchCount"] === true,
    fieldTypes: columnTypes(raw["fieldTypes"]),
  };
}

/** A bag's `fieldTypes` entry, narrowed. Anything that is not one of the three
 *  `ColumnType` spellings is dropped, so a stale or hand-edited frozen bag
 *  reads as "unknown" (VARCHAR) rather than poisoning a column's type. */
function columnTypes(value: unknown): Readonly<Record<string, ColumnType>> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, ColumnType> = {};
  for (const [key, type] of Object.entries(value as Record<string, unknown>)) {
    if (type === "DOUBLE" || type === "BOOLEAN" || type === "VARCHAR") {
      out[key] = type;
    }
  }
  return out;
}

export function distanceParams(
  raw: Readonly<Record<string, unknown>>,
): DistanceParams {
  // Kept as typed, not clamped: §6's validation is what refuses 0 and -4, and
  // a silently clamped limit would run over a distance the user never asked
  // for. `Number(undefined)` is NaN, so an absent limit takes the default
  // through the same branch as a junk one.
  const limit = Number(raw["maxDistanceM"]);
  const property = raw["nearestIdProperty"];
  return {
    proxy: pick(raw["proxy"], PROXIES, "centre"),
    maxDistanceM: Number.isFinite(limit) ? limit : DEFAULT_MAX_DISTANCE_M,
    writeNearestId: raw["writeNearestId"] === true,
    nearestIdProperty: typeof property === "string" ? property : null,
  };
}

export function aggregateParams(
  raw: Readonly<Record<string, unknown>>,
): AggregateParams {
  const rows = Array.isArray(raw["rows"]) ? raw["rows"] : [];
  return {
    proxy: pick(raw["proxy"], PROXIES, "centre"),
    predicate: pick(raw["predicate"], PREDICATES, "intersects"),
    rows: rows.flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const record = row as Record<string, unknown>;
      const op = pick(record["op"], OPS, "count");
      const column = record["column"];
      return [
        {
          op,
          column: op === "count" || typeof column !== "string" ? null : column,
        },
      ];
    }),
  };
}

/**
 * §7.5's columns: one per copied field, then the match count.
 *
 * The ORDER is the fields' source order, which is what §6.2's Style by result
 * walks to find "the first copied TEXT field". A field whose type the source
 * did not report is VARCHAR — the type that holds anything — never DOUBLE.
 *
 * TWO arguments, never three: the types ride in `params.fieldTypes`, which the
 * form's `normaliseParams` embedded before the request was frozen. That is what
 * makes `tool.outputColumns(run.prefix, run.params)` exact in `RunFooter`,
 * which has no source layer left to ask (Decisions item 6 (iii)).
 */
export function joinColumns(
  prefix: string,
  params: JoinParams,
): ReadonlyArray<OutputColumn> {
  const columns: OutputColumn[] = [];
  // §7.5: "count only" writes NO fields.
  if (params.tie !== "countOnly") {
    for (const field of params.fields) {
      columns.push({
        name: `${prefix}${slugifyField(field)}`,
        type: params.fieldTypes[field] ?? "VARCHAR",
      });
    }
  }
  if (params.writeMatchCount) {
    columns.push({ name: `${prefix}matches_n`, type: "DOUBLE" });
  }
  return columns;
}

/** §7.7: `roads_distance_m`, then `roads_nearest_id`. */
export function distanceColumns(
  prefix: string,
  params: DistanceParams,
): ReadonlyArray<OutputColumn> {
  const columns: OutputColumn[] = [
    { name: `${prefix}distance_m`, type: "DOUBLE" },
  ];
  if (params.writeNearestId) {
    columns.push({ name: `${prefix}nearest_id`, type: "VARCHAR" });
  }
  return columns;
}

/** The name §7.6's row resolves to, or null when its op needs a column and has
 *  none. ONE spelling, shared by `aggregateColumns` and `aggregateRowErrors`,
 *  so "which column would this row write" has a single answer. */
function aggregateColumnName(prefix: string, row: AggregateRow): string | null {
  if (row.op === "count") return `${prefix}buildings_n`;
  return row.column === null
    ? null
    : `${prefix}${row.op}_${slugifyField(row.column)}`;
}

/**
 * §7.6: "one column per row, named `<prefix><agg>_<column>` (`buildings_n` for
 * count)". With the default prefix that reads `bld_buildings_n`,
 * `bld_sum_roof_area_m2`.
 *
 * A row whose op needs a column and has none is SKIPPED rather than named after
 * nothing; that state is reachable only on a source layer with no numeric
 * column at all, and `crossLayerParamsError` refuses Run for it.
 */
export function aggregateColumns(
  prefix: string,
  params: AggregateParams,
): ReadonlyArray<OutputColumn> {
  return params.rows.flatMap((row) => {
    const name = aggregateColumnName(prefix, row);
    return name === null ? [] : [{ name, type: "DOUBLE" as const }];
  });
}

/** The numeric columns §7.6's aggregate rows may summarise — the file's and the
 *  computed ones alike. `columnKind.ts` has `isTextColumn` but no numeric
 *  predicate, and inverting it would offer a BOOLEAN or a list column to
 *  `sum`. */
const NUMERIC_TYPE =
  /^(DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC|BIGINT|HUGEINT|INTEGER|SMALLINT|TINYINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)\b/i;

export function numericColumnsOf(
  table: LayerTable | null,
): ReadonlyArray<string> {
  return (table?.columns ?? [])
    .filter((c) => c.kind === "scalar" && NUMERIC_TYPE.test(c.type.trim()))
    .map((c) => c.name);
}

export interface CrossLayerContext {
  /** The COMPUTE layer's table — the city layer whose buildings are measured
   *  (the target for §7.5/§7.7, the source for §7.6). */
  readonly table: LayerTable | null;
  readonly sourcePropertyKeys: ReadonlyArray<string>;
  /** `geoPropertyTypes(records)` over the SOURCE document (Task 12). The join's
   *  resolved bag carries them into `fieldTypes`, so the FROZEN params alone
   *  type the copied columns. */
  readonly sourcePropertyTypes: ReadonlyMap<string, ColumnType>;
  /** Whether the source layer's features carry a GeoJSON `id` (§7.7). */
  readonly sourceHasFeatureIds: boolean;
  readonly numericColumns: ReadonlyArray<string>;
}

/**
 * The draft's bag with every context-dependent default filled in — the EFFECTIVE
 * parameters the form renders and `submitRun` freezes.
 *
 * **Idempotent, including against an EMPTY context, and that is load-bearing.**
 * The form resolves with the real source; `ToolView.run()` then calls the
 * registry's `normaliseParams`, which resolves the ALREADY-resolved bag again
 * with `BAG_ONLY` — no table, no source keys, no source types. Every narrowing
 * this function does against the context is therefore conditioned on the
 * context HAVING an answer: an empty `sourcePropertyKeys` narrows nothing, and
 * an empty `sourcePropertyTypes` falls back to the bag's own `fieldTypes`.
 * Without that, re-normalising would strip Join's `fields` to `[]`, null
 * Distance's `nearestIdProperty` and wipe the embedded types — and the run
 * would write nothing but `matches_n`.
 */
export function resolveCrossLayerParams(
  toolId: ToolId,
  raw: Readonly<Record<string, unknown>>,
  ctx: CrossLayerContext,
): Readonly<Record<string, unknown>> {
  // §7.5: "footprint when available, otherwise extent centre" — and a proxy
  // the CURRENT table cannot offer is replaced, because the draft is kept per
  // tool for the session and survives a retarget.
  //
  // Only a TABLE can say a proxy is unavailable, so a context with none keeps
  // what the bag has. This is the same "an empty context is no opinion" rule as
  // the fields and the aggregate columns below, and here it is load-bearing in
  // the same way: `normaliseParams` re-resolves the form's already-resolved bag
  // with `BAG_ONLY`, and narrowing to "centre" there would freeze a run against
  // a proxy the form never showed — §6.4's record would name a proxy that was
  // not used, and a footprint join would silently become a centre join.
  const chosen = pick(raw["proxy"], PROXIES, "centre");
  const table = ctx.table;
  const offered =
    table === null
      ? chosen
      : raw["proxy"] === undefined ||
          !proxyOptions(table).some(
            (option) => option.key === chosen && option.available,
          )
        ? defaultProxy(table)
        : chosen;
  // §7.5: `centre within` "forces the centre proxy". It is forced HERE, in the
  // one bag the form renders and `submitRun` freezes, so §6.4's log cannot name
  // a proxy the predicate overrode, the footprint workload note goes away, and
  // `largest overlap` is refused by the rule below. The bag keeps the user's
  // own `proxy` untouched, so switching the predicate back restores it.
  const forcesCentre =
    toolId !== "distance-to-nearest" &&
    pick(raw["predicate"], PREDICATES, "intersects") === "centreWithin";
  const proxy: BuildingProxy = forcesCentre ? "centre" : offered;
  const known = new Set(ctx.sourcePropertyKeys);
  // No source in this context (the registry's `BAG_ONLY`) means "no opinion",
  // never "no properties": the caller that HAS the source has already pruned.
  const knowsSource = known.size > 0;

  if (toolId === "distance-to-nearest") {
    const p = distanceParams({ ...raw, proxy });
    const property =
      p.nearestIdProperty !== null &&
      (!knowsSource || known.has(p.nearestIdProperty))
        ? p.nearestIdProperty
        : null;
    return {
      proxy,
      maxDistanceM: p.maxDistanceM,
      // §7.7: on by default when the source has a feature `id`; off when it has
      // none, because ticking it would then need a property nobody chose.
      writeNearestId:
        raw["writeNearestId"] === undefined
          ? ctx.sourceHasFeatureIds
          : p.writeNearestId,
      nearestIdProperty: property,
    };
  }

  if (toolId === "aggregate-per-area") {
    const p = aggregateParams({ ...raw, proxy });
    // §7.6's "Default row: count".
    const rows =
      raw["rows"] === undefined
        ? [{ op: "count" as const, column: null }]
        : p.rows;
    return {
      proxy,
      predicate: p.predicate,
      rows: rows.map((row) =>
        row.op === "count"
          ? { op: row.op, column: null }
          : {
              op: row.op,
              // Same rule: an empty `numericColumns` is "no opinion". Keeping
              // the row's own column is what survives the re-normalise.
              column:
                ctx.numericColumns.length === 0 ||
                (row.column !== null && ctx.numericColumns.includes(row.column))
                  ? row.column
                  : (ctx.numericColumns[0] ?? null),
            },
      ),
    };
  }

  const p = joinParams({ ...raw, proxy });
  // §7.5: "all on by default". An EXPLICIT empty list stays empty — that is
  // the state the user reaches by unticking everything, and Run refuses it.
  const fields =
    raw["fields"] === undefined
      ? [...ctx.sourcePropertyKeys]
      : knowsSource
        ? p.fields.filter((field) => known.has(field))
        : p.fields;
  // Decisions item 6 (iii): the SOURCE's types are EMBEDDED here, so the frozen
  // bag is self-sufficient and `outputColumns(prefix, params)` needs no third
  // argument. Only the chosen fields go in — the bag is §6.4's record and a map
  // of every property the source ever had is noise. A plain object, not a Map,
  // because the bag is JSON: §6.4's log renders it through `paramValue`.
  //
  // The bag's OWN entry wins when this context has no answer, which is what
  // keeps the function idempotent: the registry's `normaliseParams` re-resolves
  // with `BAG_ONLY` (no source at all), and it must not wipe the types the
  // form already embedded.
  const fieldTypes: Record<string, ColumnType> = {};
  for (const field of fields) {
    const type = ctx.sourcePropertyTypes.get(field) ?? p.fieldTypes[field];
    if (type !== undefined) fieldTypes[field] = type;
  }
  return {
    proxy,
    predicate: p.predicate,
    fields,
    tie: p.tie,
    writeMatchCount: p.writeMatchCount,
    fieldTypes,
  };
}

/** The first duplicate column name in a list, or null. §6 flags it on the
 *  SECOND occurrence. */
function firstDuplicate(names: ReadonlyArray<string>): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

/**
 * §6's inline validation for §7.6's aggregate list, ONE ANSWER PER ROW.
 *
 * Residual B11: the sentence has to render beside the row it is about, so the
 * form needs the offence keyed by row — and `crossLayerParamsError` below is
 * built out of this, so the message Run is blocked with is literally the one
 * the row shows. Two producers would be two chances to disagree about which
 * row is wrong.
 *
 * An unprefixed column name is deliberate: the message names the row's
 * RESOLVED column, and §6's own example (`'sum_roof_area_m2' resolves to the
 * same column`) is the bare one — the prefix is the same on both rows, so it
 * says nothing about the collision.
 */
export function aggregateRowErrors(
  params: AggregateParams,
): ReadonlyArray<string | null> {
  const seen = new Set<string>();
  return params.rows.map((row) => {
    const name = aggregateColumnName("", row);
    // **[adapted copy A17]** — §7.6 requires a numeric column for every
    // aggregate except count and words no message for an unfilled one.
    if (name === null) return "Choose a column to summarise";
    if (seen.has(name)) return `'${name}' resolves to the same column`;
    seen.add(name);
    return null;
  });
}

/**
 * §6's inline validation for §7.5's copied-field checklist, ONE ANSWER PER
 * FIELD — keyed by the RAW property name, so the checkbox that carries the
 * sentence is the one the collision is about.
 *
 * §6 flags a collision "on the second field", which is the same rule
 * `aggregateRowErrors` states for §7.6's rows, and it is built the same way:
 * `crossLayerParamsError` reads this, so the sentence Run is blocked with is
 * literally the one beside the field.
 *
 * EMPTY under `count only`, which copies no field at all — two fields sharing a
 * column name is not a problem for a run that writes neither.
 */
export function joinFieldErrors(
  params: JoinParams,
): ReadonlyMap<string, string> {
  const errors = new Map<string, string>();
  if (params.tie === "countOnly") return errors;
  const seen = new Set<string>();
  for (const field of params.fields) {
    const name = slugifyField(field);
    if (seen.has(name)) {
      errors.set(field, `'${name}' resolves to the same column`);
    }
    seen.add(name);
  }
  return errors;
}

/**
 * §6's "Validation is inline and blocks Run", for the three cross-layer tools.
 *
 * Everything decidable from the BAG plus the SOURCE. The registry's
 * `validateParams` forwards to this with the context the form supplies; the
 * separation from the readers above is that these are SENTENCES, and a sentence
 * belongs beside the rule it states.
 *
 * `ctx.table` is never read here, which is what lets the FORM ask the same
 * question from a component that has the source's facts but no table.
 */
export function crossLayerParamsError(
  toolId: ToolId,
  raw: Readonly<Record<string, unknown>>,
  ctx: CrossLayerContext,
): string | null {
  if (toolId === "distance-to-nearest") {
    const p = distanceParams(raw);
    if (!(p.maxDistanceM > 0)) {
      // **[adapted copy A11]** — §6 states the rule ("a distance limit must be
      // a positive number") and gives no sentence.
      return "A distance limit must be a positive number";
    }
    // §7.7: "ticking it requires choosing a property". Only wrong when the
    // source has no feature `id` of its own to fall back on.
    if (
      p.writeNearestId &&
      p.nearestIdProperty === null &&
      !ctx.sourceHasFeatureIds
    ) {
      return "Choose the property to copy";
    }
    return null;
  }

  if (toolId === "aggregate-per-area") {
    const p = aggregateParams(raw);
    // §7.6's "+ Add aggregate" list, empty. `Pick at least one measure` is
    // REUSED here verbatim (Decisions recorded item 5).
    if (p.rows.length === 0) return "Pick at least one measure";
    // EVERY row, in ROW ORDER, so the sentence Run repeats is the one the
    // offending row shows. `aggregateColumns` skips a row whose op needs a
    // column and has none, so a `count` beside a column-less `sum` would
    // otherwise pass validation with one column and the sum would vanish
    // between the form and the write — a run that silently did less than it
    // was asked.
    return aggregateRowErrors(p).find((error) => error !== null) ?? null;
  }

  const p = joinParams(raw);
  // §6: "a proxy/predicate pair that cannot combine … disables the option with
  // that text" — and the same sentence blocks Run if a stored draft carries the
  // pair anyway. `centre within` FORCES the centre proxy (§7.5), so the pair is
  // refused on the predicate as well as on the proxy: a raw bag can still carry
  // the footprint the user picked before switching the predicate, and
  // `resolveCrossLayerParams` is the only thing that has rewritten it.
  if (
    p.tie === "largestOverlap" &&
    (p.proxy === "centre" || p.predicate === "centreWithin")
  ) {
    return "Largest overlap needs a footprint or rectangle";
  }
  const columns = joinColumns("", p);
  if (columns.length === 0) return "Pick at least one measure";
  // The FIELD-level answer first, so the sentence Run repeats is the one the
  // offending checkbox shows; the column-level sweep after it catches the one
  // collision no field can own — a field slugging to `matches_n`.
  const fieldError = [...joinFieldErrors(p).values()][0];
  if (fieldError !== undefined) return fieldError;
  const duplicate = firstDuplicate(columns.map((c) => c.name));
  return duplicate === null
    ? null
    : `'${duplicate}' resolves to the same column`;
}
