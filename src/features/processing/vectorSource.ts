/**
 * A vector layer's features, reprojected into a city layer's CRS, with §7.5's
 * preflight counted rather than swallowed.
 *
 * NO STORE AND NO ENGINE, which is the point: every sentence §7.5 asks for — "4
 * areas skipped: invalid geometry", "No usable areas in Zones", "The source
 * layer has no features" — is decided by counting `skipped` against
 * `features.length`, in a unit test with nothing mocked but proj4.
 *
 * ASYNC, AND IN BOUNDED BATCHES. A 200 MB roads layer is millions of
 * coordinates; one synchronous walk blocks the frame and the Cancel button for
 * as long as it takes, which is the hazard M2's "nothing walks a whole layer's
 * geometry synchronously" names. The walk yields a MACROTASK every
 * {@link FEATURE_BATCH} features and every {@link COORDINATE_BUDGET}
 * coordinates, and calls `control.checkpoint()` — the run's
 * `ctx.throwIfCancelled` — on BOTH sides of each yield, so a cancelled run
 * stops INSIDE the phase and sees a Cancel delivered while it was parked. The
 * budget is spent position by position wherever the walk is, so one enormous
 * ring yields as well as ten thousand small ones, and every copy the ASSEMBLY
 * makes of the text built so far is charged to the same budget
 * ({@link TEXT_PER_COORDINATE}) — there is no `join` of a whole ring left to
 * block a Cancel once the last coordinate is projected.
 *
 * THE CALLER MUST AWAIT `ensureModelCrsLoadable(targetModel)` FIRST.
 * `crsFromGeodetic`'s `ensureProjDef` guard is synchronous and returns `null`
 * for a definition proj4 has not fetched yet, so on a cold CRS every feature
 * would be counted unprojectable — "every area skipped" instead of "4". The
 * run's `"source"` phase is where that await belongs; it costs nothing when
 * the definition is already loaded. This module takes an EPSG code, not a
 * model, so it cannot perform that await itself and does not try.
 *
 * `crsFromGeodetic` (`scene/cursorCrsReadout.ts`) is the app's ONE proj4 call
 * site and this module does not open a second: it is 2-D (every operation in
 * §7.5-§7.7 is), it returns `null` rather than a partly-NaN triple, and it is
 * already guarded. `features/` importing from `scene/` is established
 * (`geoLayers/categorize.ts`). `ST_Transform` is never used, even though the
 * wasm build has it (Global Constraints).
 */
import type { ColumnType } from "../../insights/computedColumns";
import {
  publicGeoProperties,
  readGeoStableFeatureId,
} from "../geoLayers/geoJsonRecords";
import type { GeoRecord } from "../geoLayers/geoRecords";
import { crsFromGeodetic } from "../../scene/cursorCrsReadout";

export interface ProjectedFeature {
  /**
   * The feature's index in the SOURCE document, gaps included.
   *
   * §7.5's tie rule is "first, by source order", everywhere: the first matching
   * area, the first equally-near feature. Renumbering the kept features would
   * let an unprojectable neighbour decide which of two ties wins.
   */
  readonly idx: number;
  /** `geoJsonRecords`' stable feature id — the key a vector target's results
   *  are written back under (§7.6). */
  readonly stableId: string;
  /**
   * The GeoJSON feature-level `id` as text, or null.
   *
   * §7.7's "Also write the nearest feature's id" defaults to it. A feature's
   * `id` is a SIBLING of `properties`, so it is not in the bag below.
   */
  readonly featureId: string | null;
  /** The feature's own properties, renderer bookkeeping removed. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** 2-D WKT in the target's CRS, for `ST_GeomFromText`. */
  readonly wkt: string;
}

export interface VectorPreflight {
  readonly features: ReadonlyArray<ProjectedFeature>;
  /** §7.5: null, empty, unparseable or unprojectable geometry. */
  readonly skipped: number;
  /**
   * The property keys of EVERY live feature, kept or skipped, in first-seen
   * source order.
   *
   * Not the kept features' keys: §6.1's frozen-field re-validation at the queue
   * head reads this, and a field carried only by a feature whose GEOMETRY was
   * skipped is still a field of an unchanged layer — calling that "Layer
   * changed while running" would refuse a run the user can never fix. Geometry
   * filtering and property discovery are deliberately separate.
   */
  readonly propertyKeys: ReadonlyArray<string>;
  readonly propertyTypes: ReadonlyMap<string, ColumnType>;
  /** Every kept feature is an area — a Polygon, a MultiPolygon, or a
   *  collection of nothing else (§7.5's areas). */
  readonly polygonOnly: boolean;
  /**
   * How many of `skipped` were dropped for NOT BEING AN AREA (finding S3).
   *
   * Always 0 unless the caller asked for `areasOnly`. Separate from the rest of
   * `skipped` because the two have different sentences: §7.5's is "invalid
   * geometry", and a point is perfectly valid — it is simply not something an
   * area tool can take.
   */
  readonly notAreas: number;
}

/** What a caller wants out of the document, beyond the projection itself. */
export interface ReprojectOptions {
  /**
   * Keep only the AREAS (finding S3).
   *
   * §7.5 and §7.6 are defined over areas, and a mixed polygon/point layer is
   * eligible for them as long as it holds ONE polygon — the form says "Needs
   * areas (polygons)" only when there is none. Without this, every other
   * feature reached the compute too: Join could pick a coincident POINT as the
   * nearest area, and Aggregate wrote building counts onto points. §7.6's
   * "every target feature is written" still holds for them — a dropped feature
   * is written NULL, which is §6.2's "could not be evaluated".
   */
  readonly areasOnly?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The feature objects of a `FeatureCollection`, a bare `Feature`, or junk. */
function featuresOf(document: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!isRecord(document)) return [];
  if (document.type === "FeatureCollection" && Array.isArray(document.features))
    return document.features.filter(isRecord);
  if (document.type === "Feature") return [document];
  return [];
}

/** A feature's own properties, the renderer's stable-id envelope removed. */
function propertiesOf(
  feature: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  return publicGeoProperties(
    isRecord(feature.properties) ? feature.properties : {},
  );
}

/**
 * One coordinate as WKT, to 0.1 mm.
 *
 * Rounded for two reasons: a metric CRS has nothing to say below a tenth of a
 * millimetre, and `String(1e-7)` is `"1e-7"` — exponent notation a WKT parser
 * is not obliged to accept. Rounding first makes every ordinate a plain
 * decimal.
 */
function ordinate(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** How many coordinates the walk converts before it yields the event loop. */
const COORDINATE_BUDGET = 20_000;
/** How many features it converts before it yields, whatever their size. */
const FEATURE_BATCH = 500;

/**
 * How many characters of assembled WKT cost one coordinate's worth of budget.
 *
 * Assembly is not free once a feature is large: wrapping a 200,000-position
 * ring in its parentheses and again in `POLYGON (…)` copies several megabytes
 * per step, and a Cancel pressed during those copies would wait for them. So
 * every copy is charged to the SAME budget the positions are, in units of about
 * one position's worth of text ("4000.0001 52000" and its separator).
 */
const TEXT_PER_COORDINATE = 20;

export interface YieldControl {
  /**
   * Called on BOTH sides of every yield, and allowed to throw.
   *
   * The run passes `ctx.throwIfCancelled`, so a cancelled run stops inside the
   * walk instead of after it. Absent for the form's own uses, which have
   * nothing to cancel.
   */
  readonly checkpoint?: () => void;
}

/** The coordinate budget, as one cell the whole walk shares. */
interface Budget {
  left: number;
}

/**
 * A checkpoint, a macrotask, and a checkpoint again.
 *
 * A macrotask and not `Promise.resolve()`: a microtask does not let the browser
 * paint or a click land, which is the whole point of the batching. BOTH
 * checkpoints, deliberately, and for the same reason `vectorTable.ts`'s `pause`
 * takes both: a Cancel is delivered by a timer or an event, which can only run
 * while the walk is parked here, so a checkpoint taken solely before the yield
 * reads the state as it was one whole batch ago.
 */
async function yieldToLoop(control: YieldControl | undefined): Promise<void> {
  control?.checkpoint?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  control?.checkpoint?.();
}

/** Spend `cost` units of work, and yield when the budget runs out. */
async function spend(
  budget: Budget,
  control: YieldControl | undefined,
  cost = 1,
): Promise<void> {
  budget.left -= cost;
  if (budget.left > 0) return;
  await yieldToLoop(control);
  budget.left = COORDINATE_BUDGET;
}

/** Charge one copy of assembled text to the coordinate budget. */
async function spendText(
  text: string,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<void> {
  await spend(budget, control, Math.ceil(text.length / TEXT_PER_COORDINATE));
}

/** One position as `"x y"`, or null when it is not a projectable pair. */
function position(value: unknown, epsg: number): string | null {
  if (!Array.isArray(value)) return null;
  const lng: unknown = value[0];
  const lat: unknown = value[1];
  // Two FINITE numbers, or it is not a position: the mocked and the real
  // `crsFromGeodetic` must agree about a NaN, and `NaN NaN` is WKT that
  // `ST_GeomFromText` RAISES on.
  if (typeof lng !== "number" || !Number.isFinite(lng)) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  // The third ordinate is dropped: every operation §7.5-§7.7 performs is 2-D
  // in the target's CRS, and `crsFromGeodetic` carries height through untouched
  // rather than reprojecting it anyway.
  const xy = crsFromGeodetic(lng, lat, 0, epsg);
  if (xy === null) return null;
  return `${ordinate(xy[0])} ${ordinate(xy[1])}`;
}

/**
 * A list of positions as `"x y, x y"` — or null when the STRUCTURE is wrong.
 *
 * `minimum` is the type's own rule (2 positions for a line, 4 for a ring) and
 * `closed` is the ring rule. Both matter: `ST_GeomFromText` RAISES on a
 * one-position line and on an unclosed ring, and the vector table is ONE
 * statement, so a malformed feature that reached it would fail the whole run
 * instead of being skipped and counted (§7.5). An EMPTY array is §7.5's "empty
 * geometry" — the probed `ST_GeomFromGeoJSON` trap in reverse.
 *
 * The text is accumulated POSITION BY POSITION rather than joined at the end:
 * a `join` over a 200,000-element array is one synchronous multi-megabyte step
 * that no checkpoint interrupts, and appending to the running text costs
 * nothing beyond what the walk is already charged for.
 *
 * CLOSURE IS COMPARED ON THE PROJECTED, ROUNDED TEXT, so two source positions
 * a tenth of a millimetre apart close a ring — which is the honest rule: the
 * WKT this builds is what `ST_GeomFromText` reads, and in THAT text they are
 * the same position.
 */
async function positionList(
  value: unknown,
  epsg: number,
  minimum: number,
  closed: boolean,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<string | null> {
  if (!Array.isArray(value) || value.length < minimum) return null;
  let text = "";
  let first: string | null = null;
  let last: string | null = null;
  for (const entry of value) {
    const point = position(entry, epsg);
    // Half a ring is not a geometry: §7.5 skips the FEATURE.
    if (point === null) return null;
    text = first === null ? point : `${text}, ${point}`;
    first ??= point;
    last = point;
    await spend(budget, control);
  }
  if (first === null || last === null) return null;
  if (closed && first !== last) return null;
  return text;
}

/** A polygon's rings as `"(shell), (hole)"`, or null if any ring is not one. */
async function ringsOf(
  value: unknown,
  epsg: number,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<string | null> {
  if (!Array.isArray(value) || value.length === 0) return null;
  let text: string | null = null;
  for (const ring of value) {
    const positions = await positionList(ring, epsg, 4, true, budget, control);
    if (positions === null) return null;
    const wrapped = `(${positions})`;
    await spendText(wrapped, budget, control);
    text = text === null ? wrapped : `${text}, ${wrapped}`;
  }
  return text;
}

/**
 * A geometry as its WKT, plus whether it is nothing but areas.
 *
 * `areaOnly` is §7.5's question ("Needs areas (polygons)"), asked of the
 * FAMILY rather than of the document's type word: a collection of areas is
 * areas, however the document wrapped them.
 */
interface Shape {
  readonly wkt: string;
  readonly areaOnly: boolean;
}

/**
 * `KEYWORD (body)`, charged to the budget.
 *
 * The wrap is a copy of everything assembled so far, which on a large feature
 * is megabytes — so it is spent like the positions that produced it, and the
 * checkpoint it triggers is what lets a Cancel land during ASSEMBLY rather than
 * only during projection.
 */
async function wrap(
  keyword: string,
  body: string,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<string> {
  const text = `${keyword} (${body})`;
  await spendText(text, budget, control);
  return text;
}

async function shapeOf(
  geometry: unknown,
  epsg: number,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<Shape | null> {
  if (!isRecord(geometry)) return null;
  const coordinates = geometry.coordinates;
  switch (geometry.type) {
    case "Point": {
      const text = position(coordinates, epsg);
      await spend(budget, control);
      return text === null ? null : { wkt: `POINT (${text})`, areaOnly: false };
    }
    case "MultiPoint": {
      const list = await positionList(
        coordinates,
        epsg,
        1,
        false,
        budget,
        control,
      );
      return list === null
        ? null
        : {
            wkt: await wrap("MULTIPOINT", list, budget, control),
            areaOnly: false,
          };
    }
    case "LineString": {
      const list = await positionList(
        coordinates,
        epsg,
        2,
        false,
        budget,
        control,
      );
      return list === null
        ? null
        : {
            wkt: await wrap("LINESTRING", list, budget, control),
            areaOnly: false,
          };
    }
    case "MultiLineString": {
      if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
      let text: string | null = null;
      for (const line of coordinates) {
        const list = await positionList(line, epsg, 2, false, budget, control);
        if (list === null) return null;
        const part = `(${list})`;
        await spendText(part, budget, control);
        text = text === null ? part : `${text}, ${part}`;
      }
      return text === null
        ? null
        : {
            wkt: await wrap("MULTILINESTRING", text, budget, control),
            areaOnly: false,
          };
    }
    case "Polygon": {
      const rings = await ringsOf(coordinates, epsg, budget, control);
      return rings === null
        ? null
        : {
            wkt: await wrap("POLYGON", rings, budget, control),
            areaOnly: true,
          };
    }
    case "MultiPolygon": {
      if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
      let text: string | null = null;
      for (const polygon of coordinates) {
        const rings = await ringsOf(polygon, epsg, budget, control);
        if (rings === null) return null;
        const part = `(${rings})`;
        await spendText(part, budget, control);
        text = text === null ? part : `${text}, ${part}`;
      }
      return text === null
        ? null
        : {
            wkt: await wrap("MULTIPOLYGON", text, budget, control),
            areaOnly: true,
          };
    }
    case "GeometryCollection":
      return await collectionShape(geometry.geometries, epsg, budget, control);
    default:
      // A type the list does not name reads as unparseable, which §7.5 COUNTS
      // rather than fails on.
      return null;
  }
}

/**
 * A `GeometryCollection` as `GEOMETRYCOLLECTION (…)`, or null when it is empty
 * or one of its members is malformed.
 *
 * §7.7's source is "a vector layer of any geometry type", and EVERY collection
 * converts — same-family or mixed. Probed against this checkout's DuckDB 1.5.5
 * with `spatial`: `ST_GeomFromText` parses a collection (mixed point/line
 * included) and `ST_Intersects`, `ST_CoveredBy`, `ST_Area`,
 * `ST_Area(ST_Intersection(…))`, `ST_Centroid`, `ST_Union_Agg` and
 * `ST_Distance` all answer on one, which is every operation §7.5-§7.7
 * performs. Members are rendered by the same recursion, so a nested collection
 * nests in the WKT exactly as the document wrote it — nothing is re-spelt as a
 * multi-geometry it is not.
 */
async function collectionShape(
  members: unknown,
  epsg: number,
  budget: Budget,
  control: YieldControl | undefined,
): Promise<Shape | null> {
  if (!Array.isArray(members) || members.length === 0) return null;
  let text: string | null = null;
  let areaOnly = true;
  for (const member of members) {
    const shape = await shapeOf(member, epsg, budget, control);
    if (shape === null) return null;
    if (!shape.areaOnly) areaOnly = false;
    text = text === null ? shape.wkt : `${text}, ${shape.wkt}`;
  }
  return text === null
    ? null
    : {
        wkt: await wrap("GEOMETRYCOLLECTION", text, budget, control),
        areaOnly,
      };
}

export async function reprojectGeoLayer(
  document: unknown,
  epsg: number,
  control?: YieldControl,
  options?: ReprojectOptions,
): Promise<VectorPreflight> {
  const features: ProjectedFeature[] = [];
  const bags: Array<Readonly<Record<string, unknown>>> = [];
  let skipped = 0;
  let notAreas = 0;
  let polygonOnly = true;
  const budget: Budget = { left: COORDINATE_BUDGET };
  const source = featuresOf(document);
  for (const [idx, feature] of source.entries()) {
    // A batch of small features costs no coordinates worth yielding for, so the
    // feature counter is what bounds it; `spend` bounds the other direction.
    if (idx > 0 && idx % FEATURE_BATCH === 0) await yieldToLoop(control);
    // Every LIVE feature's properties, kept or skipped: the keys below are the
    // layer's fields, which a geometry cannot revoke.
    const properties = propertiesOf(feature);
    bags.push(properties);
    const shape = await shapeOf(feature.geometry, epsg, budget, control);
    if (shape === null) {
      skipped += 1;
      continue;
    }
    // S3: not an area, and this tool is defined over areas. Skipped BEFORE the
    // feature is built, so nothing that is not an area can reach the vector
    // table — the table is what the predicates and the counts are evaluated
    // against.
    if (options?.areasOnly === true && !shape.areaOnly) {
      skipped += 1;
      notAreas += 1;
      continue;
    }
    // A document that never went through `normalizeGeoJsonDocument` (a test,
    // a hand-built collection) has no envelope; the fallback is the same
    // spelling that function mints, so no feature is silently dropped.
    const stableId =
      readGeoStableFeatureId(
        isRecord(feature.properties) ? feature.properties : undefined,
      ) ?? `index:${idx}`;
    const id = feature.id;
    if (!shape.areaOnly) polygonOnly = false;
    features.push({
      idx,
      stableId,
      featureId:
        typeof id === "string" || typeof id === "number" ? String(id) : null,
      properties,
      wkt: shape.wkt,
    });
  }

  const propertyKeys = keysOf(bags);
  return {
    features,
    skipped,
    propertyKeys,
    propertyTypes: typesOf(bags, propertyKeys),
    polygonOnly,
    notAreas,
  };
}

/**
 * §7.5's skip sentences for one preflight, in the order the card shows them.
 *
 * TWO causes, not one: §7.5's own "4 areas skipped: invalid geometry" covers a
 * null, empty or unprojectable geometry, and S3's non-areas are a separate
 * count with a separate reason — a point is perfectly valid geometry, it is
 * simply not something §7.5 or §7.6 can take. The second sentence is
 * **[adapted copy A19]**, written to §7.5's own `<count> <noun> skipped:
 * <cause>` pattern; the spec words no case in which a usable geometry is set
 * aside for its KIND.
 *
 * Shared by the queue head (§7.5's source) and by Aggregate (§7.6's target) so
 * the two destinations cannot word the same fact differently.
 */
export function preflightWarnings(
  preflight: Pick<VectorPreflight, "skipped" | "notAreas">,
): ReadonlyArray<string> {
  const out: string[] = [];
  const invalid = preflight.skipped - preflight.notAreas;
  if (invalid > 0) {
    out.push(`${count(invalid, "area", "areas")} skipped: invalid geometry`);
  }
  if (preflight.notAreas > 0) {
    out.push(
      `${count(preflight.notAreas, "feature", "features")} skipped: not an area`,
    );
  }
  return out;
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Every key any bag carries, in first-seen order. */
function keysOf(
  bags: ReadonlyArray<Readonly<Record<string, unknown>>>,
): ReadonlyArray<string> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const bag of bags) {
    // `Object.keys` never yields the SYMBOL `geoRecords` keys its identity
    // with, so a checklist can never offer the renderer's own id as a field.
    for (const key of Object.keys(bag)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The ONE type rule (§7.5: "numbers as DOUBLE, booleans, everything else as
 * VARCHAR"), shared by preflight and by the form's fields checklist so the
 * types the user reads before Run are the types the columns are created with.
 *
 * `geoRecordColumns` (`geoRecords.ts`) keeps its own two-way answer: it feeds
 * the grid's filter bar, which has no BOOLEAN kind. This function agrees with
 * it about DOUBLE and splits its VARCHAR half, so the two can never disagree
 * about a column.
 */
function typesOf(
  bags: ReadonlyArray<Readonly<Record<string, unknown>>>,
  keys: ReadonlyArray<string>,
): ReadonlyMap<string, ColumnType> {
  const types = new Map<string, ColumnType>();
  for (const key of keys) {
    let anyNumber = false;
    let anyBoolean = false;
    let allBoolean = true;
    for (const bag of bags) {
      const value = bag[key];
      if (value === null || value === undefined) continue;
      if (typeof value === "number") anyNumber = true;
      if (typeof value === "boolean") anyBoolean = true;
      else allBoolean = false;
    }
    types.set(
      key,
      anyNumber ? "DOUBLE" : anyBoolean && allBoolean ? "BOOLEAN" : "VARCHAR",
    );
  }
  return types;
}

export function geoPropertyTypes(
  records: ReadonlyArray<GeoRecord>,
): ReadonlyMap<string, ColumnType> {
  return typesOf(records, keysOf(records));
}

/**
 * Every property key the LIVE document carries, kept geometry or not.
 *
 * §6.1's head re-validation of a frozen field list reads this: a run can wait
 * minutes in the queue and the source layer can be re-linked in between, but a
 * field present on a feature whose geometry preflight skipped has NOT gone
 * anywhere, and refusing such a run with "Layer changed while running" would be
 * a refusal the user cannot act on. Geometry filtering stays in
 * {@link reprojectGeoLayer}; property discovery is this.
 */
export function documentPropertyKeys(document: unknown): ReadonlyArray<string> {
  return keysOf(featuresOf(document).map(propertiesOf));
}

/**
 * The geometry `type` strings a document carries, in first-seen order.
 *
 * The FORM's question, not the run's: §7.5 lists a point or line layer in the
 * source select disabled with "Needs areas (polygons)", and that select is
 * drawn before any CRS is resolved. `reprojectGeoLayer` cannot answer it — on
 * a cold proj4 definition every feature is skipped and `polygonOnly` is
 * vacuously true.
 *
 * A `GeometryCollection` reports its MEMBERS' types rather than itself, for the
 * same reason `reprojectGeoLayer` converts one: a collection of areas is areas,
 * and the select must not refuse a layer the run would accept.
 */
export function documentGeometryKinds(document: unknown): ReadonlySet<string> {
  const kinds = new Set<string>();
  const add = (geometry: unknown): void => {
    if (!isRecord(geometry) || typeof geometry.type !== "string") return;
    if (geometry.type === "GeometryCollection") {
      if (Array.isArray(geometry.geometries)) geometry.geometries.forEach(add);
      return;
    }
    kinds.add(geometry.type);
  };
  for (const feature of featuresOf(document)) add(feature.geometry);
  return kinds;
}

/**
 * Does any feature carry a GeoJSON `id` of its own?
 *
 * §7.7's nearest-id select "defaults to the GeoJSON feature `id` when the
 * source has one; when it has none, the checkbox is off by default". The form
 * asks this before any run, so it cannot come from `reprojectGeoLayer`.
 */
export function documentHasFeatureIds(document: unknown): boolean {
  return featuresOf(document).some(
    (feature) =>
      typeof feature.id === "string" || typeof feature.id === "number",
  );
}

/**
 * Does the document carry a feature at all?
 *
 * §7.5 and §7.7's "The source layer has no features" is about the SOURCE
 * select, which is drawn per keystroke over every candidate layer — so it stops
 * at the FIRST feature object it sees and never copies the feature array the
 * way `featuresOf` does, let alone walks anyone's geometry.
 */
export function documentHasFeatures(document: unknown): boolean {
  if (!isRecord(document)) return false;
  if (document.type === "Feature") return true;
  return (
    document.type === "FeatureCollection" &&
    Array.isArray(document.features) &&
    document.features.some(isRecord)
  );
}
