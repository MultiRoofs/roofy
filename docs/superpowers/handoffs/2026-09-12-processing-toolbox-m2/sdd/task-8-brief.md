### Task 8: The roof parameters, and the registry entry that promises their columns

**Files:**

- Create: `src/features/processing/roofMetricsParams.ts`
- Modify: `src/features/processing/types.ts:18-49`, `src/features/processing/toolRegistry.ts:5-18` (and one line on each of the other six entries)
- Test: `tests/unit/features/processing/roofMetricsParams.test.ts`, and an addition to `tests/unit/features/processing/eligibility.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `roofMetricsParams.ts`: `export type RoofMeasure = "area" | "flatArea" | "flatShare" | "slope" | "azimuth" | "surfaces"`; `export interface RoofMeasureSpec { readonly key: RoofMeasure; readonly label: string; readonly hint: string | null; readonly suffix: string }`; `export const ROOF_MEASURES: ReadonlyArray<RoofMeasureSpec>`; `export interface RoofMetricsParams { readonly measures: ReadonlyArray<RoofMeasure>; readonly flatThresholdDeg: number }`; `export const DEFAULT_ROOF_PARAMS: RoofMetricsParams`; `export const FLAT_THRESHOLD_MIN = 0`; `export const FLAT_THRESHOLD_MAX = 15`; `export function roofParams(raw: Readonly<Record<string, unknown>>): RoofMetricsParams`; `export function roofColumnNames(prefix: string, params: RoofMetricsParams): string[]`.
  - `types.ts`: `ToolDefinition.needsLod: boolean` (required, on all seven entries); `ToolDefinition.validateParams?`; `ToolDefinition.normaliseParams?`.
- Tasks 9, 11, 12 and 13 all consume these.

**`implemented` stays `false` here.** The registry entry gains its columns and its validation, but the tool is NOT switched on until its executor (Task 9), its LoD select (Task 11) and its parameters (Task 12) exist — Task 13 is the single step that flips it and proves the form works. Enabling it earlier would put a runnable Run button in front of a form with no parameters and no LoD.

**The default is all six measures ON.** The spec does not say, and the mockup has no Roof metrics form state (`design/processing-toolbox-wireframe.html` shows only the catalogue row). Three reasons for ON: §7.1 calls the tool one that "materialises the roof metrics the app already computes", and a half-materialised default contradicts that; §7.1's own Style-by-result rule is "`roof_area_m2 >` median", which only holds if area is written by default; and Measure solids' mockup ticks its four primary measures and leaves only its two _elevation_ extras off — roof metrics has no such secondary tier. Decided by the repo owner (decision 6).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/roofMetricsParams.test.ts`:

```ts
/**
 * ONE answer to "which columns will this run write, and in what order".
 * The registry promises them before any run exists, the form prints them, and
 * the executor writes them; three literal lists is how a form comes to promise
 * a name a run never writes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOF_PARAMS,
  ROOF_MEASURES,
  roofColumnNames,
  roofParams,
} from "../../../../src/features/processing/roofMetricsParams";

describe("roofParams", () => {
  it("reads an EMPTY draft as every measure at the default threshold", () => {
    // `useToolForm` mints a fresh draft with `params: {}`, and the form's
    // column list is printed from it before the user touches anything.
    expect(roofParams({})).toEqual(DEFAULT_ROOF_PARAMS);
    expect(DEFAULT_ROOF_PARAMS.measures).toHaveLength(6);
    expect(DEFAULT_ROOF_PARAMS.flatThresholdDeg).toBe(5);
  });

  it("keeps the user's ticks, in the spec's order rather than click order", () => {
    expect(roofParams({ measures: ["slope", "area"] }).measures).toEqual([
      "area",
      "slope",
    ]);
  });

  it("keeps an EMPTY tick list empty — that is the state Run refuses", () => {
    expect(roofParams({ measures: [] }).measures).toEqual([]);
  });

  it("drops a measure key it does not know", () => {
    expect(roofParams({ measures: ["area", "volume"] }).measures).toEqual([
      "area",
    ]);
  });

  it("clamps the threshold into 0-15 and falls back for a non-number", () => {
    expect(roofParams({ flatThresholdDeg: 12 }).flatThresholdDeg).toBe(12);
    expect(roofParams({ flatThresholdDeg: -3 }).flatThresholdDeg).toBe(0);
    expect(roofParams({ flatThresholdDeg: 99 }).flatThresholdDeg).toBe(15);
    expect(roofParams({ flatThresholdDeg: "5" }).flatThresholdDeg).toBe(5);
    expect(roofParams({ flatThresholdDeg: Number.NaN }).flatThresholdDeg).toBe(
      5,
    );
  });

  it("is idempotent, so freezing a normalised bag changes nothing", () => {
    const once = roofParams({ measures: ["azimuth"], flatThresholdDeg: 9 });
    expect(roofParams({ ...once })).toEqual(once);
  });
});

describe("roofColumnNames", () => {
  it("is spec §7.1's list, in spec §7.1's order", () => {
    expect(roofColumnNames("roof_", DEFAULT_ROOF_PARAMS)).toEqual([
      "roof_area_m2",
      "roof_flat_m2",
      "roof_flat_share",
      "roof_slope_deg",
      "roof_azimuth_deg",
      "roof_surfaces_n",
    ]);
  });

  it("prints only the ticked measures, still in the spec's order", () => {
    expect(
      roofColumnNames("roof_", {
        measures: ["surfaces", "area"],
        flatThresholdDeg: 5,
      }),
    ).toEqual(["roof_area_m2", "roof_surfaces_n"]);
  });

  it("honours a different prefix", () => {
    expect(
      roofColumnNames("dak_", { measures: ["area"], flatThresholdDeg: 5 }),
    ).toEqual(["dak_area_m2"]);
  });

  it("has one spec entry per measure, and no duplicate suffix or label", () => {
    expect(new Set(ROOF_MEASURES.map((m) => m.suffix)).size).toBe(
      ROOF_MEASURES.length,
    );
    expect(new Set(ROOF_MEASURES.map((m) => m.label)).size).toBe(
      ROOF_MEASURES.length,
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/features/processing/roofMetricsParams.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the params module**

Create `src/features/processing/roofMetricsParams.ts`:

```ts
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
    hint: null,
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
    hint: null,
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

/** The columns this run will write, prefix applied, in the spec's order. */
export function roofColumnNames(
  prefix: string,
  params: RoofMetricsParams,
): string[] {
  const ticked = new Set(params.measures);
  return ROOF_MEASURES.filter((m) => ticked.has(m.key)).map(
    (m) => `${prefix}${m.suffix}`,
  );
}
```

- [ ] **Step 4: Widen `ToolDefinition`**

In `src/features/processing/types.ts`, inside `ToolDefinition` (after `needsVectorSource` at `:33`):

```ts
  /**
   * Does the form offer a LoD select (spec §6)?
   *
   * True for the tools that read GEOMETRY at one level of detail. False for
   * Height from extent (the bbox is unioned across every LoD in the file) and
   * for the cross-layer tools, whose building geometry is a PROXY radio rather
   * than a LoD. An UNIMPLEMENTED tool never renders the control whatever this
   * says — it has no source of truthful counts (see `useLodOptions`).
   */
  readonly needsLod: boolean;
```

and after `outputColumns` (`:46`):

```ts
  /**
   * Spec §6: "Validation is inline and blocks Run". The message, or null when
   * the parameters are runnable. Absent for a tool with no parameters.
   */
  readonly validateParams?: (
    params: Readonly<Record<string, unknown>>,
  ) => string | null;

  /**
   * The draft's parameter bag with every default filled in, for FREEZING.
   *
   * Spec §6.1 freezes "everything the run needs", and §6.4 makes the log "the
   * reproducible record of the run: a planner can read it back and rerun by
   * hand". A draft the user never touched is `{}`, so without this the log
   * would print "Parameters: —" for a run that used six measures and a 5°
   * threshold. Absent for a tool with no parameters.
   */
  readonly normaliseParams?: (
    params: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
```

- [ ] **Step 5: Fill in the registry**

In `src/features/processing/toolRegistry.ts`, add `needsLod` to every entry: `true` for `roof-metrics`, `measure-solids` and `validate-solids`; `false` for `height-from-extent`, `join-by-location`, `aggregate-per-area` and `distance-to-nearest`. Then replace the `roof-metrics` entry (`:5-18`) with:

```ts
  {
    id: "roof-metrics",
    name: "Roof metrics to attributes",
    group: "roof",
    description: "Roof area, slope, azimuth per building",
    longDescription:
      "Writes the roof metrics Roofy already computes as attributes of each building.",
    extension: null,
    needsReader: false,
    target: "city",
    needsVectorSource: false,
    needsLod: true,
    defaultPrefix: "roof_",
    outputColumns: (prefix, params) =>
      roofColumnNames(prefix, roofParams(params)),
    validateParams: (params) =>
      roofParams(params).measures.length === 0
        ? "Pick at least one measure"
        : null,
    normaliseParams: (params) => ({ ...roofParams(params) }),
    // Task 13 flips this, once the executor, the LoD select and the parameters
    // all exist. Until then the row reads "Not available yet" and a run of it
    // fails with the same words rather than hanging.
    implemented: false,
  },
```

with `import { roofColumnNames, roofParams } from "./roofMetricsParams";` at the top.

- [ ] **Step 6: Extend the eligibility test**

Append to `tests/unit/features/processing/eligibility.test.ts`. Roof metrics is still `implemented: false`, and `eligibility.ts:44` outranks everything — so these two assert the rules that will apply the moment Task 13 flips it, over an enabled COPY of the definition:

```ts
/** The M2 registry entry, as Task 13 will switch it on. */
const enabledRoof = { ...toolById("roof-metrics"), implemented: true };

it("lets Roof metrics run on a streaming layer with no reader", () => {
  // Spec §7.1: "works on every city layer kind including streaming (resident
  // set) and CityGML". Nothing about it needs a reader or an extension.
  expect(
    toolEligibility(enabledRoof, {
      targetKind: "streaming",
      sourceEncoding: "flatcitybuf",
      hasReader: false,
      sourceAvailable: false,
      tableState: "ready",
      engineState: "ready",
      hasVectorLayer: false,
      extensionState: { spatial: "unloaded", three_d: "unloaded" },
    }),
  ).toEqual({ ok: true });
});

it("refuses Roof metrics on a vector layer", () => {
  expect(
    toolEligibility(enabledRoof, {
      targetKind: "vector",
      sourceEncoding: null,
      hasReader: false,
      sourceAvailable: false,
      tableState: "none",
      engineState: "ready",
      hasVectorLayer: true,
      extensionState: { spatial: "unloaded", three_d: "unloaded" },
    }),
  ).toEqual({ ok: false, reason: "Needs a city model layer" });
});

it("still reads 'Not available yet' until Task 13 switches it on", () => {
  expect(
    toolEligibility(toolById("roof-metrics"), {
      targetKind: "city",
      sourceEncoding: "cityjson",
      hasReader: true,
      sourceAvailable: true,
      tableState: "ready",
      engineState: "ready",
      hasVectorLayer: false,
      extensionState: { spatial: "unloaded", three_d: "unloaded" },
    }),
  ).toEqual({ ok: false, reason: "Not available yet" });
});
```

(Import `toolById` from `toolRegistry` if the file does not already.)

- [ ] **Step 7: Run everything that touches the registry**

```bash
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS. `tsc` will name every registry entry still missing `needsLod` — that is the point of making it required.

- [ ] **Step 8: Commit**

```bash
git add src/features/processing/roofMetricsParams.ts src/features/processing/types.ts \
  src/features/processing/toolRegistry.ts \
  tests/unit/features/processing/roofMetricsParams.test.ts \
  tests/unit/features/processing/eligibility.test.ts
git commit -m "feat(processing): Roof metrics' parameters and the columns they promise"
```

---
