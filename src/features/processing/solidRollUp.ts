/**
 * Spec §7's contributor rule and solid roll-ups — shared by Measure solids
 * (§7.2) and Validate solids (§7.3), which select contributors identically and
 * skip for identically two reasons.
 *
 * It is a module of its own rather than an export of `tools/measureSolids.ts`
 * because importing a TOOL module runs its `registerExecutor` side effect, and
 * `tools/register.ts` is the single wire that decides which executors exist.
 *
 * Pure: no engine, no store, no React, and its one plugin import is a TYPE.
 */
import type { CityJSONGeometryType } from "@cityjson/navara-core";
import type { SkipCount } from "./types";

/**
 * The three CityJSON geometry types that carry a solid — finding D4's rule,
 * spelled ONCE for the whole app: `solidGeometrySource.ts` tests the MODEL's
 * `Surface.geometryType` against this set, and the solids executors test the
 * READER's `geometry_properties_lod*.type` against the same one.
 *
 * `cityjson_wkb_geometry_type` is never the detector: a CompositeSolid's WKB
 * name is "GeometryCollection Z", so keying on the WKB would drop every
 * composite. `MultiSolid` and `CompositeSolid` are IN because §7.2's roll-up
 * sums volume over contributors, which is the right answer for a multi-shell
 * building whether the engine parses it as one solid or the app sums several.
 *
 * Declared `ReadonlySet<string>` over a `Set<CityJSONGeometryType>` literal: the
 * literal is checked against the union (a typo fails to compile), while the
 * exported type takes the reader's untyped VARCHAR without a cast.
 */
export const SOLID_GEOMETRY_TYPES: ReadonlySet<string> =
  new Set<CityJSONGeometryType>(["Solid", "MultiSolid", "CompositeSolid"]);

/** One LAYER-TABLE row: its own id, and the feature it belongs to. */
export interface FeatureRow {
  readonly id: string;
  readonly f: string;
}

/** One row of `buildSolidMeasureSql`'s output. */
export interface SolidRow {
  readonly id: string;
  /** The CityJSON geometry type from the reader's properties struct (D4). */
  readonly geometry_type: string | null;
  readonly parsed: boolean;
  readonly is_valid: boolean | null;
  readonly volume_m3: number | null;
  readonly envelope_m2: number | null;
  readonly footprint_m2: number | null;
  readonly ground_m: number | null;
  readonly ridge_m: number | null;
}

export interface FeatureGroup {
  readonly featureId: string;
  /** Every row of the feature in scope — §7 writes them all, NULL included. */
  readonly members: ReadonlyArray<FeatureRow>;
  /** The row ids §7's contributor rule chose; `[]` means "no geometry". */
  readonly contributors: ReadonlyArray<string>;
}

/** §7.2's two skip causes — the only two either solids tool reports. */
export const SKIP_NOT_A_SOLID = "not a solid";
export const skipNoGeometry = (lod: string): string =>
  `no geometry at LoD ${lod}`;
/** §6.2's caveat for a building measured with its volume withheld. */
export const CAVEAT_INVALID_SOLIDS = "invalid solids (no volume)";

/**
 * §7's contributor rule, verbatim: "At the chosen LoD, if any part of the
 * feature has GEOMETRY, the PARTS are the contributors and the root's own
 * geometry at that LoD is ignored (3D BAG stores the same building on both);
 * otherwise the root is the sole contributor."
 *
 * GEOMETRY of any kind — `hasGeometryAt` must NOT be a "has a solid" test. A
 * wall-only part that falls back to the root's solid is exactly the double
 * count this rule exists to prevent, which is why "not a solid" is a verdict on
 * the CHOSEN contributors (below) and never an input to choosing them.
 */
export function groupContributors(
  rows: ReadonlyArray<FeatureRow>,
  hasGeometryAt: (objectId: string, lod: string) => boolean,
  lod: string,
): ReadonlyArray<FeatureGroup> {
  const members = new Map<string, FeatureRow[]>();
  for (const row of rows) {
    const list = members.get(row.f);
    if (list) list.push(row);
    else members.set(row.f, [row]);
  }
  const groups: FeatureGroup[] = [];
  for (const [featureId, memberRows] of members) {
    const parts = memberRows.filter((row) => row.id !== featureId);
    const partContributors = parts
      .filter((row) => hasGeometryAt(row.id, lod))
      .map((row) => row.id);
    const contributors =
      partContributors.length > 0
        ? partContributors
        : memberRows
            .filter((row) => row.id === featureId && hasGeometryAt(row.id, lod))
            .map((row) => row.id);
    groups.push({ featureId, members: memberRows, contributors });
  }
  return groups;
}

/**
 * Did this row yield a solid the measures can stand on?
 *
 * TWO questions, and both have to be yes. The CityJSON TYPE is §7.2's "not a
 * solid" (D4), and the PARSE is whether `three_d` could read the WKB — a row
 * the file calls a Solid but whose blob `ST_3DTryFromWKB` returned NULL for has
 * nothing to measure either, and every measure on it is NULL by construction.
 * §7.2 gives the two cases one cause between them, "not a solid", because there
 * is no third skip cause to spend and "the file said Solid and nothing solid
 * came out" is the same news to the user.
 */
export function isMeasurableSolid(row: SolidRow): boolean {
  return row.parsed && SOLID_GEOMETRY_TYPES.has(row.geometry_type ?? "");
}

export interface SolidRollUp {
  readonly volume: number | null;
  readonly envelope: number | null;
  readonly footprint: number | null;
  readonly height: number | null;
  readonly ground: number | null;
  readonly ridge: number | null;
  readonly valid: boolean | null;
  /** At least one contributor parsed but did not validate (§7.2's caveat). */
  readonly hasInvalid: boolean;
}

/**
 * §7's roll-ups from contributors to the feature, over the MEASURABLE rows only.
 *
 * "A contributor that cannot be parsed is left out; an INVALID solid still
 * contributes the measures that do not need validity." So a row that is not a
 * solid does not poison its siblings — it simply is not there — and a feature
 * with no remaining contributor gets `null`, which the caller reports as a skip.
 * The filter is HERE rather than at the call site so neither solids tool can
 * forget it and average a row of NULLs into a building's total.
 *
 * The one asymmetry is VOLUME: "sum over contributors, but NULL for the feature
 * when any contributor's volume is NULL (a partial volume would mislead)". An
 * invalid contributor is exactly that case — the statement withholds its volume
 * — so a building with one invalid part has no volume at all.
 */
export function rollUpSolids(
  contributors: ReadonlyArray<SolidRow>,
): SolidRollUp | null {
  const rows = contributors.filter(isMeasurableSolid);
  if (rows.length === 0) return null;
  let volume: number | null = 0;
  let envelope = 0;
  let footprint = 0;
  let ground = Number.POSITIVE_INFINITY;
  let ridge = Number.NEGATIVE_INFINITY;
  let hasInvalid = false;
  let hasUnknown = false;
  for (const row of rows) {
    if (row.volume_m3 === null) volume = null;
    else if (volume !== null) volume += row.volume_m3;
    envelope += row.envelope_m2 ?? 0;
    footprint += row.footprint_m2 ?? 0;
    if (row.ground_m !== null) ground = Math.min(ground, row.ground_m);
    if (row.ridge_m !== null) ridge = Math.max(ridge, row.ridge_m);
    // READ, never re-derived (finding D1): the statement already guards every
    // report field on `s IS NOT NULL`, so a NULL here means "no report" and a
    // `false` means the engine checked this solid and rejected it.
    if (row.is_valid === false) hasInvalid = true;
    else if (row.is_valid === null) hasUnknown = true;
  }
  // Three-valued AND, decided AFTER the loop so the reader's row ORDER cannot
  // decide it: one contributor the engine checked and REJECTED makes the feature
  // invalid whatever a sibling with no report says; only in the absence of a
  // rejection does an unknown withhold the verdict.
  const valid: boolean | null = hasInvalid ? false : hasUnknown ? null : true;
  const groundOut = Number.isFinite(ground) ? ground : null;
  const ridgeOut = Number.isFinite(ridge) ? ridge : null;
  return {
    volume,
    envelope,
    footprint,
    // §7: "height: combined extent, max ridge over parts minus min ground over
    // parts (never the sum or max of part heights)".
    height:
      groundOut === null || ridgeOut === null ? null : ridgeOut - groundOut,
    ground: groundOut,
    ridge: ridgeOut,
    valid,
    hasInvalid,
  };
}

/** `[]` when the count is zero, so an empty list means "nothing to report". */
export function countsAsSkips(
  entries: ReadonlyArray<readonly [string, number]>,
): ReadonlyArray<SkipCount> {
  return entries
    .filter(([, count]) => count > 0)
    .map(([cause, count]) => ({ cause, count }));
}
