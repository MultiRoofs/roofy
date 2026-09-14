/**
 * Roof metrics' parameters, and the column names they resolve to (spec §7.1).
 *
 * It is a module of its OWN, outside `tools/`, because four places need the
 * same answer at four different times and none of them may pull in a tool
 * module's `registerExecutor` side effect: the registry (`outputColumns` and
 * `normaliseParams`, pure data), the form (which prints the names before any
 * run exists), `submitRun` (which FREEZES the normalised bag) and the executor
 * (which writes the columns).
 *
 * Everything here is pure.
 */

import type { OutputColumn } from "../../insights/computedColumns";

export type RoofMeasure =
  | "area"
  | "flatArea"
  | "flatShare"
  | "slope"
  | "azimuth"
  | "surfaces";

export interface RoofMeasureSpec {
  readonly key: RoofMeasure;
  /** The checkbox's label. */
  readonly label: string;
  /**
   * The explanation §7.1 carries that the label trims, as the label's
   * `title`. Null where the label already says everything.
   */
  readonly hint: string | null;
  /** Appended to the prefix: `roof_` + `area_m2`. */
  readonly suffix: string;
}

/**
 * Spec §7.1's measures, in spec §7.1's order — which is also the order of
 * `roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg,
 * roof_azimuth_deg, roof_surfaces_n` and therefore the order §6.2's Style by
 * result walks to find "the first column the run actually wrote".
 */
export const ROOF_MEASURES: ReadonlyArray<RoofMeasureSpec> = [
  {
    key: "area",
    label: "Total roof area (m²)",
    hint: "Combined area of all roof surfaces, measured along their slopes in square metres.",
    suffix: "area_m2",
  },
  {
    key: "flatArea",
    label: "Flat roof area (m²)",
    hint: "Surfaces with a slope under the flat threshold",
    suffix: "flat_m2",
  },
  {
    key: "flatShare",
    label: "Flat share",
    hint: "0-1: the flat area over the total roof area",
    suffix: "flat_share",
  },
  {
    key: "slope",
    label: "Mean slope (deg)",
    hint: "Area-weighted over every roof surface",
    suffix: "slope_deg",
  },
  {
    key: "azimuth",
    label: "Dominant azimuth (deg)",
    hint: "Of the largest non-flat surface",
    suffix: "azimuth_deg",
  },
  {
    key: "surfaces",
    label: "Roof surface count",
    hint: "Number of roof surfaces used to calculate this building’s metrics.",
    suffix: "surfaces_n",
  },
];

export interface RoofMetricsParams {
  readonly measures: ReadonlyArray<RoofMeasure>;
  /** Spec §7.1: "flat threshold slider 0-15 deg, default 5". */
  readonly flatThresholdDeg: number;
}

export const FLAT_THRESHOLD_MIN = 0;
export const FLAT_THRESHOLD_MAX = 15;
const FLAT_THRESHOLD_DEFAULT = 5;

/**
 * All six ticked. The spec does not state a default; the tool's own job —
 * "materialises the roof metrics the app already computes" — plus §7.1's own
 * Style-by-result rule (`roof_area_m2 >` median, which needs area written)
 * make every measure the honest default.
 */
export const DEFAULT_ROOF_PARAMS: RoofMetricsParams = {
  measures: ROOF_MEASURES.map((m) => m.key),
  flatThresholdDeg: FLAT_THRESHOLD_DEFAULT,
};

/**
 * A draft's untyped `params` bag as this tool's parameters.
 *
 * A draft starts as `{}` (`useToolForm`), so "absent" has to mean "the
 * defaults" or the form would open promising no columns. An EMPTY array is NOT
 * absent: it is the state the user reaches by unticking everything, and
 * `validateParams` refuses Run for it rather than silently writing all six.
 *
 * Idempotent, because `submitRun` freezes the NORMALISED bag (so the run log
 * shows the measures and threshold that were actually used, not an empty
 * object) and the form then re-normalises what it stored.
 */
export function roofParams(
  raw: Readonly<Record<string, unknown>>,
): RoofMetricsParams {
  const known = new Set<string>(ROOF_MEASURES.map((m) => m.key));
  const picked = raw["measures"];
  const measures = Array.isArray(picked)
    ? // Re-ordered into the spec's order, not the user's click order: the
      // column order and Style by result's first column both depend on it.
      ROOF_MEASURES.map((m) => m.key).filter(
        (key) => picked.some((p) => p === key) && known.has(key),
      )
    : DEFAULT_ROOF_PARAMS.measures;

  // `Number(undefined)` is NaN, so an absent threshold falls to the default
  // through the same branch as a junk one.
  const rawThreshold = Number(raw["flatThresholdDeg"]);
  const flatThresholdDeg = Number.isFinite(rawThreshold)
    ? Math.min(FLAT_THRESHOLD_MAX, Math.max(FLAT_THRESHOLD_MIN, rawThreshold))
    : FLAT_THRESHOLD_DEFAULT;

  return { measures, flatThresholdDeg };
}

/**
 * The columns this run will write, prefix applied, in the spec's order.
 *
 * Every roof measure is a number, so every column is DOUBLE — but the type is
 * stated here rather than assumed downstream, because the registry is the one
 * place a tool declares what it writes (§7: "Output columns are DOUBLE,
 * BOOLEAN or VARCHAR").
 */
export function roofColumnNames(
  prefix: string,
  params: RoofMetricsParams,
): ReadonlyArray<OutputColumn> {
  const ticked = new Set(params.measures);
  return ROOF_MEASURES.filter((m) => ticked.has(m.key)).map((m) => ({
    name: `${prefix}${m.suffix}`,
    type: "DOUBLE",
  }));
}
