/**
 * What geometry stands for a building in 2D (spec §7.5's "Building geometry").
 *
 * ONE answer, for four readers: the form's radio, §6.4's log row, the three
 * cross-layer executors' SQL, and `defaultProxy`. Three proxies and no fourth —
 * a fourth would be a fourth thing the log, the form and the executors have to
 * agree about.
 *
 * WHY FOOTPRINT NEEDS BOTH AN LoD 0 COLUMN AND A READER. `ST_GeomFromWKB`
 * parses the LoD 0 MultiPolygon Z and RAISES "Unsupported geometry type in
 * WKB" on the PolyhedralSurface Z every solid LoD produces — and one such row
 * fails the whole statement, so a footprint taken from a solid LoD is not a
 * rougher answer, it is a failed run. The browsing table holds no geometry at
 * all (`isDroppedColumn`, `columnKind.ts:74-80`), so the WKB comes from the
 * READER, which a CityGML, CityParquet or streaming layer does not have.
 * `footprintAvailable` is that predicate, exported because the form, the
 * default and the options list must not each re-derive it.
 *
 * WHY THE OTHER TWO ALWAYS WORK. Every layer kind's table carries `bbox
 * STRUCT(xmin, ymin, zmin, xmax, ymax, zmax)` — the reader writes it and
 * `layerTables.ts:642-653` forces the same type on the flat fallback, for
 * exactly this reason.
 *
 * THE PROXY RELATION'S `g` IS 2-D, ALWAYS. `ST_GeomFromWKB` keeps the LoD 0
 * column's Z and `ST_Union_Agg` keeps it too (both pinned in
 * `crossLayer.test.ts`), so the footprint branch wraps the parse in
 * `ST_Force2D`; the two bbox branches need no wrap, because `ST_MakeEnvelope`
 * and `ST_Point` take DOUBLEs and already return 2-D geometry. This is an
 * OUTPUT CONTRACT rather than a correctness fix: every predicate and measure
 * the consumers use accepts a Z geometry (Task 16's `ST_CoveredBy` /
 * `ST_Intersects` / `ST_Area(ST_Intersection(…))`, Task 17's `ST_Distance`,
 * Task 19's same predicates over the source city), and each is 2-D in its
 * answer. What the wrap buys is that the relation is ONE type whichever proxy
 * a run chose — §7.7's copy says "2D distance", and a geometry handed onward
 * (or read back in a log, or unioned with a bbox proxy's output) is the shape
 * that sentence promises.
 *
 * Everything here is PURE: the executors open the reader handle and release it,
 * and hand `from` and `geometryColumn` in.
 */
import type { LayerTable } from "../../insights/layerTables";
import { quoteIdent, quoteLiteral } from "../../insights/sql";

export type BuildingProxy = "footprint" | "rectangle" | "centre";

export interface ProxyOption {
  readonly key: BuildingProxy;
  readonly label: string;
  readonly available: boolean;
  /** Why it is not available, as §7.5 words it. Null when it is. */
  readonly note: string | null;
}

/** §7.5's three labels, verbatim, in the order the radio shows them. */
const LABELS: Readonly<Record<BuildingProxy, string>> = {
  footprint: "Footprint (LoD 0)",
  rectangle: "Extent rectangle",
  centre: "Extent centre",
};

/** §7.5's muted line, on the option it explains. */
const NO_FOOTPRINT =
  "LoD 0 footprints are not in this layer; the bounding-box centre is used.";

/**
 * The LoD 0 rung's OWN label, or null.
 *
 * The label, never a re-spelled suffix: `"0"` and `"0.0"` are DIFFERENT columns
 * and only the file knows which it has (`columnKind.ts:104-120`) — and the
 * reader normalises, so a document saying `"lod": "0"` can still describe
 * `geometry_lod0_0`. The caller hands this to `readSource`, which looks the
 * suffix up in the same `lods` list.
 */
export function lodZeroLabel(table: LayerTable): string | null {
  return (
    table.lods.find((lod) => Number.parseFloat(lod.label) === 0)?.label ?? null
  );
}

/**
 * Whether §7.5 may offer the footprint proxy at all: an LoD 0 rung to read AND
 * a reader to read it with.
 */
export function footprintAvailable(table: LayerTable): boolean {
  return lodZeroLabel(table) !== null && table.reader !== null;
}

export function proxyOptions(table: LayerTable): ReadonlyArray<ProxyOption> {
  const footprint = footprintAvailable(table);
  return [
    {
      key: "footprint",
      label: LABELS.footprint,
      available: footprint,
      note: footprint ? null : NO_FOOTPRINT,
    },
    { key: "rectangle", label: LABELS.rectangle, available: true, note: null },
    { key: "centre", label: LABELS.centre, available: true, note: null },
  ];
}

/** §7.5: "footprint when available, otherwise extent centre." */
export function defaultProxy(table: LayerTable): BuildingProxy {
  return footprintAvailable(table) ? "footprint" : "centre";
}

/** §6.4's "building geometry proxy actually used". */
export function proxyLogLabel(proxy: BuildingProxy): string {
  return LABELS[proxy];
}

/** §7.7: "2D distance to the building footprint / extent / centre" — the one
 *  of the three the run actually used. */
export function proxyDistanceNote(proxy: BuildingProxy): string {
  const noun =
    proxy === "footprint"
      ? "footprint"
      : proxy === "rectangle"
        ? "extent"
        : "centre";
  return `2D distance to the building ${noun}`;
}

export interface ProxySqlInput {
  readonly proxy: BuildingProxy;
  readonly table: string;
  /** The reader FROM clause (`ReadSourceHandle.from`), footprint only. */
  readonly from: string | null;
  /** The LoD 0 geometry column (`ReadSourceHandle.geometryColumn`), footprint
   *  only. */
  readonly geometryColumn: string | null;
  /** ROW ids, already expanded to whole features by `resolveScope`; null for
   *  every row. */
  readonly ids: ReadonlyArray<string> | null;
}

function whereIds(ids: ReadonlyArray<string> | null): string {
  return ids === null
    ? ""
    : ` WHERE "id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
}

/**
 * One row per TABLE ROW: `(id, f, g)`.
 *
 * The NULL branch is not defensiveness: `ST_GeomFromWKB` is the function that
 * RAISES on geometry it cannot read, and a row with no LoD 0 geometry has a
 * NULL column — untested, and one raise fails the whole statement. The same
 * guard on the bbox path keeps a row with no extent from becoming an envelope
 * of NULLs.
 */
export function buildProxySql(input: ProxySqlInput): string {
  const head = `SELECT "id", COALESCE("feature_id", "id") AS f, `;
  if (input.proxy === "footprint") {
    if (input.from === null || input.geometryColumn === null) {
      throw new Error("The footprint proxy needs a reader and an LoD 0 column");
    }
    const col = quoteIdent(input.geometryColumn);
    // The SCOPE applies to the reader relation too. Without this a Selected or
    // Matching run reads every building in the file: the join then counts
    // buildings outside the scope, and §7.6's per-area counts are wrong in a
    // way no output column shows. The reader's own `id` column is the same id
    // the table's rows carry, which is what makes one `whereIds` serve both.
    //
    // `ST_Force2D` is applied HERE, per row, rather than to the union above:
    // then the aggregate runs on 2-D inputs and BOTH relations this module
    // builds carry the same 2-D contract.
    return (
      `${head}CASE WHEN ${col} IS NULL THEN NULL ELSE ST_Force2D(ST_GeomFromWKB(${col})) END AS g ` +
      `FROM ${input.from}${whereIds(input.ids)}`
    );
  }
  const geometry =
    input.proxy === "rectangle"
      ? `ST_MakeEnvelope("bbox"."xmin", "bbox"."ymin", "bbox"."xmax", "bbox"."ymax")`
      : `ST_Point(("bbox"."xmin" + "bbox"."xmax") / 2, ("bbox"."ymin" + "bbox"."ymax") / 2)`;
  return (
    `${head}CASE WHEN "bbox"."xmin" IS NULL THEN NULL ELSE ${geometry} END AS g ` +
    `FROM ${quoteIdent(input.table)}${whereIds(input.ids)}`
  );
}

/**
 * One row per FEATURE: `(f, g)`, with `g` NULL where the feature has no
 * geometry at all.
 *
 * §7 evaluates the join, the nearest id and the distance ONCE per feature, "on
 * the feature's proxy geometry (the union of its parts' footprints, or the
 * feature's combined extent), then copied to root and parts alike". A per-ROW
 * join would count a three-part building three times in §7.6 and would give
 * §7.5's tie rule a different answer per part.
 *
 * §7's CONTRIBUTOR rule applies to the FOOTPRINT and not to the two extent
 * proxies, because §7 words them differently: "the union of its PARTS'
 * footprints, or the feature's COMBINED extent". So the footprint path selects
 * the part rows wherever any part has a footprint and the root's own row
 * otherwise — the rule verbatim — while the bbox paths aggregate every row of
 * the feature, which is also how §7.4's `extent_height_m` reads "combined".
 * Unioning the root's footprint in as well is harmless only when it IS its
 * parts' (3D BAG's duplication); a root carrying the whole site's polygon
 * would otherwise be joined against a shape no part has.
 *
 * A feature whose rows all have NULL geometry keeps its row with `g` NULL,
 * because the executors LEFT JOIN from this relation and §6.2's value rule
 * needs the difference between "no proxy" (NULL) and "no match" (0).
 */
export function buildFeatureProxySql(input: ProxySqlInput): string {
  if (input.proxy === "footprint") {
    // `parts` is "some PART of this feature has a footprint", answered as a
    // window over the feature rather than in a second pass; `("id" <> "f") =
    // "parts"` then keeps the PART rows when there are any and the root's row
    // when there are none. FILTER rather than a WHERE inside: a feature with no
    // footprint at all must keep its row, and an aggregate over an empty
    // filtered set is NULL.
    //
    // AND THE OUTER CASE IS NOT DECORATION. `ST_Union_Agg` over an EMPTY
    // filtered set returns an EMPTY GEOMETRY, not NULL (pinned in
    // `crossLayer.test.ts`, and the same trap `ST_GeomFromGeoJSON` sets with
    // `[]` coordinates): a feature with no footprint would then read as "has a
    // proxy that matches nothing" rather than "has no proxy", which is exactly
    // the distinction §6.2 writes NULL for. `ST_IsEmpty` is the test that
    // catches it — it also catches a union that collapses to nothing.
    return (
      `SELECT "f", CASE WHEN ST_IsEmpty("u") THEN NULL ELSE "u" END AS g FROM (` +
      `SELECT "f", ST_Union_Agg("g") FILTER (WHERE "g" IS NOT NULL AND ("id" <> "f") = "parts") AS "u" ` +
      `FROM (SELECT *, COALESCE(BOOL_OR("g" IS NOT NULL AND "id" <> "f") ` +
      `OVER (PARTITION BY "f"), FALSE) AS "parts" FROM (${buildProxySql(input)})) ` +
      `GROUP BY "f")`
    );
  }
  const geometry =
    input.proxy === "rectangle"
      ? `ST_MakeEnvelope(MIN("bbox"."xmin"), MIN("bbox"."ymin"), MAX("bbox"."xmax"), MAX("bbox"."ymax"))`
      : `ST_Point((MIN("bbox"."xmin") + MAX("bbox"."xmax")) / 2, ` +
        `(MIN("bbox"."ymin") + MAX("bbox"."ymax")) / 2)`;
  return (
    `SELECT COALESCE("feature_id", "id") AS f, ` +
    `CASE WHEN MIN("bbox"."xmin") IS NULL THEN NULL ELSE ${geometry} END AS g ` +
    `FROM ${quoteIdent(input.table)}${whereIds(input.ids)} GROUP BY 1`
  );
}
