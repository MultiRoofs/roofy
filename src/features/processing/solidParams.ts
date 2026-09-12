/**
 * Measure solids' and Validate solids' parameters, and the columns they
 * resolve to (spec §7.2, §7.3).
 *
 * A module of its OWN, outside `tools/`, because four places need the same
 * answer at four different times and none of them may pull in a tool module's
 * `registerExecutor` side effect: the registry (`outputColumns` and
 * `normaliseParams`, pure data), the form (which prints the names before any
 * run exists), `submitRun` (which FREEZES the normalised bag) and the executor
 * (which writes the columns).
 *
 * Everything here is pure.
 */
import type { OutputColumn } from "../../insights/computedColumns";

export type SolidMeasure =
  | "volume"
  | "envelope"
  | "footprint"
  | "height"
  | "ground"
  | "ridge";

export interface SolidMeasureSpec {
  readonly key: SolidMeasure;
  /** The checkbox's label. */
  readonly label: string;
  /** What the label trims, as the label's `title`. Null when it says it all. */
  readonly hint: string | null;
  /** Appended to the prefix: `solid_` + `volume_m3`. */
  readonly suffix: string;
}

/**
 * Spec §7.2's measures, in spec §7.2's order — which is also the order of
 * `solid_volume_m3, solid_envelope_m2, solid_footprint_m2, solid_height_m,
 * solid_ground_m, solid_ridge_m` and therefore the order §6.2's Style by
 * result walks to find "the first column the run actually wrote".
 *
 * `volume_m3` is §7.2's own name; `envelope_m2`, `footprint_m2` and `height_m`
 * are the mockup's SQL; `ground_m` and `ridge_m` follow §7's unit-suffix rule
 * (`_m` for a length), being the only two neither states.
 */
export const SOLID_MEASURES: ReadonlyArray<SolidMeasureSpec> = [
  {
    key: "volume",
    label: "Volume (m³)",
    hint: "Only for a closed, valid solid",
    suffix: "volume_m3",
  },
  {
    key: "envelope",
    label: "Envelope area (m²)",
    hint: null,
    suffix: "envelope_m2",
  },
  {
    key: "footprint",
    label: "Footprint area (m²)",
    hint: null,
    suffix: "footprint_m2",
  },
  {
    key: "height",
    label: "Height (m)",
    hint: "Ridge minus ground at this LoD",
    suffix: "height_m",
  },
  {
    key: "ground",
    label: "Ground elevation (m)",
    hint: null,
    suffix: "ground_m",
  },
  { key: "ridge", label: "Ridge elevation (m)", hint: null, suffix: "ridge_m" },
];

/** §7.2: "Always written: `<prefix>valid` BOOLEAN." */
const VALID_SUFFIX = "valid";

export interface SolidParams {
  readonly measures: ReadonlyArray<SolidMeasure>;
}

/**
 * The mockup's four: Volume, Envelope area, Footprint area and Height ticked;
 * Ground elevation and Ridge elevation left off
 * (`design/processing-toolbox-wireframe.html`, the Measure solids form and its
 * done card). The two elevations are a secondary tier — the four primaries are
 * exactly what §7.2's own one-line summary names.
 */
export const DEFAULT_SOLID_PARAMS: SolidParams = {
  measures: ["volume", "envelope", "footprint", "height"],
};

/**
 * A draft's untyped `params` bag as this tool's parameters.
 *
 * A draft starts as `{}` (`useToolForm`), so "absent" has to mean "the
 * defaults" or the form would open promising only the validity flag. An EMPTY
 * array is NOT absent: it is the state the user reaches by unticking
 * everything, and `validateParams` refuses Run for it rather than silently
 * writing four columns nobody asked for.
 *
 * Idempotent, because `submitRun` freezes the NORMALISED bag and the form then
 * re-normalises what it stored.
 */
export function solidParams(
  raw: Readonly<Record<string, unknown>>,
): SolidParams {
  const picked = raw["measures"];
  if (!Array.isArray(picked)) return DEFAULT_SOLID_PARAMS;
  // Re-ordered into §7.2's order, not the user's click order: the column order
  // and Style by result's first column both depend on it.
  return {
    measures: SOLID_MEASURES.map((m) => m.key).filter((key) =>
      picked.some((p) => p === key),
    ),
  };
}

/**
 * §7.2's columns for a prefix and a tick list, ALWAYS ending with the validity
 * flag — "Always written: `<prefix>valid` BOOLEAN", which is also what makes
 * §7.2's "invalid solid" outcome expressible at all.
 */
export function solidColumns(
  prefix: string,
  params: SolidParams,
): ReadonlyArray<OutputColumn> {
  const ticked = new Set(params.measures);
  return [
    ...SOLID_MEASURES.filter((m) => ticked.has(m.key)).map((m) => ({
      name: `${prefix}${m.suffix}`,
      type: "DOUBLE" as const,
    })),
    { name: `${prefix}${VALID_SUFFIX}`, type: "BOOLEAN" as const },
  ];
}

/**
 * §7.3's seven columns, verbatim and in the spec's order: four BOOLEAN flags,
 * then the three diagnostic counts behind them. Validate solids has no
 * parameters, so this takes only the prefix.
 *
 * The report's `orientation_error_count` is deliberately NOT a column: the
 * statement reads it (it is what makes `is_oriented` false explicable) but §7.3
 * names seven columns and this list is the promise the form prints.
 */
export function validationColumns(prefix: string): ReadonlyArray<OutputColumn> {
  return [
    { name: `${prefix}closed`, type: "BOOLEAN" },
    { name: `${prefix}manifold`, type: "BOOLEAN" },
    { name: `${prefix}oriented`, type: "BOOLEAN" },
    { name: `${prefix}${VALID_SUFFIX}`, type: "BOOLEAN" },
    // DOUBLE because `ColumnType` has no integer: `_n` is §7's count suffix
    // and DuckDB stores them exactly at these magnitudes.
    { name: `${prefix}open_edges_n`, type: "DOUBLE" },
    { name: `${prefix}nonmanifold_edges_n`, type: "DOUBLE" },
    { name: `${prefix}degenerate_faces_n`, type: "DOUBLE" },
  ];
}
