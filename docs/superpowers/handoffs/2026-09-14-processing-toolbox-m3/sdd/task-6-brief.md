### Task 6: Measure solids' parameters, its SQL, and its registry entry

**Files:**

- Create: `src/features/processing/solidParams.ts`, `src/features/processing/solidSql.ts`
- Modify: `src/features/processing/toolRegistry.ts` (the `measure-solids` entry)
- Test: `tests/unit/features/processing/solidParams.test.ts`, `tests/unit/features/processing/solidSql.test.ts`, and one case appended to `tests/integration/duckdb/solids.test.ts`

**Interfaces:**

- Produces:

```ts
// src/features/processing/solidParams.ts
export type SolidMeasure =
  | "volume"
  | "envelope"
  | "footprint"
  | "height"
  | "ground"
  | "ridge";
export interface SolidMeasureSpec {
  readonly key: SolidMeasure;
  readonly label: string;
  readonly hint: string | null;
  readonly suffix: string;
}
export const SOLID_MEASURES: ReadonlyArray<SolidMeasureSpec>;
export interface SolidParams {
  readonly measures: ReadonlyArray<SolidMeasure>;
}
export const DEFAULT_SOLID_PARAMS: SolidParams;
export function solidParams(
  raw: Readonly<Record<string, unknown>>,
): SolidParams;
export function solidColumns(
  prefix: string,
  params: SolidParams,
): ReadonlyArray<OutputColumn>; // always ends with `${prefix}valid` BOOLEAN
export function validationColumns(prefix: string): ReadonlyArray<OutputColumn>;

// src/features/processing/solidSql.ts
export interface SolidSqlInput {
  readonly from: string;
  readonly geometryColumn: string;
  readonly ids: ReadonlyArray<string> | null;
}
export function buildSolidMeasureSql(input: SolidSqlInput): string;
export function buildSolidValidationSql(input: SolidSqlInput): string;
```

The `measure-solids` registry entry gains `outputColumns`, `validateParams` (`"Pick at least one measure"`), `normaliseParams`; `implemented` stays `false`.

**One extra export, named so no reviewer has to wonder:** `solidSql.ts` also exports `buildScopeRowsSql(table, ids)`, the `SELECT "id", COALESCE("feature_id","id") AS f FROM <table>` question Tasks 7 and 10 both ask of the LAYER TABLE before they touch the reader. `roofMetrics.ts` already has an identical builder (`buildFeatureRowsReadSql`), but importing it would fire that module's `registerExecutor("roof-metrics", …)` side effect and break `tools/register.ts`'s single-wire contract (and `register.test.ts`'s ordering assertion). Two solids tools needing it is what makes it an export here rather than a third copy.

**Where each column name comes from.** `solid_volume_m3` is §7.2 verbatim; `solid_envelope_m2`, `solid_footprint_m2`, `solid_height_m` and `solid_valid` are the mockup's own SQL (`design/processing-toolbox-wireframe.html`, the log's steps 3-5); `solid_ground_m` and `solid_ridge_m` are inferred from §7's unit-suffix rule (`_m` for a length), being the only two the spec and the mockup do not spell. The seven §7.3 names are all verbatim.

**The default is the mockup's four.** `design/processing-toolbox-wireframe.html`'s Measure solids form ticks Volume, Envelope area, Footprint area and Height and leaves Ground elevation and Ridge elevation unticked, and its done card reads "Volume ✓ · Envelope area ✓ · Footprint area ✓ · Height ✓ · Ground elevation ✗ · Ridge elevation ✗". The two elevations are a secondary tier; the four primaries are what §7.2's own summary line names.

- [ ] **Step 1: Write the failing params test**

Create `tests/unit/features/processing/solidParams.test.ts`:

```ts
/**
 * ONE answer to "which columns will this run write, and in what order".
 * The registry promises them before any run exists, the form prints them, the
 * frozen request carries them and the executor writes them; four literal lists
 * is how a form comes to promise a name a run never writes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOLID_PARAMS,
  SOLID_MEASURES,
  solidColumns,
  solidParams,
  validationColumns,
} from "../../../../src/features/processing/solidParams";

describe("solidParams", () => {
  it("reads an EMPTY draft as the mockup's four primary measures", () => {
    expect(solidParams({})).toEqual(DEFAULT_SOLID_PARAMS);
    expect(DEFAULT_SOLID_PARAMS.measures).toEqual([
      "volume",
      "envelope",
      "footprint",
      "height",
    ]);
  });

  it("keeps the user's ticks in §7.2's order, not click order", () => {
    expect(solidParams({ measures: ["ridge", "volume"] }).measures).toEqual([
      "volume",
      "ridge",
    ]);
  });

  it("keeps an EMPTY tick list empty — that is the state Run refuses", () => {
    expect(solidParams({ measures: [] }).measures).toEqual([]);
  });

  it("drops a measure key it does not know", () => {
    expect(solidParams({ measures: ["volume", "slope"] }).measures).toEqual([
      "volume",
    ]);
  });

  it("is idempotent, so freezing a normalised bag changes nothing", () => {
    const once = solidParams({ measures: ["ground"] });
    expect(solidParams({ ...once })).toEqual(once);
  });

  it("has one spec entry per measure, with no duplicate suffix or label", () => {
    expect(new Set(SOLID_MEASURES.map((m) => m.suffix)).size).toBe(
      SOLID_MEASURES.length,
    );
    expect(new Set(SOLID_MEASURES.map((m) => m.label)).size).toBe(
      SOLID_MEASURES.length,
    );
  });
});

describe("solidColumns", () => {
  it("is §7.2's list in §7.2's order, always ending with the validity flag", () => {
    expect(solidColumns("solid_", DEFAULT_SOLID_PARAMS)).toEqual([
      { name: "solid_volume_m3", type: "DOUBLE" },
      { name: "solid_envelope_m2", type: "DOUBLE" },
      { name: "solid_footprint_m2", type: "DOUBLE" },
      { name: "solid_height_m", type: "DOUBLE" },
      { name: "solid_valid", type: "BOOLEAN" },
    ]);
  });

  it("writes the two elevations when they are ticked, still in order", () => {
    expect(
      solidColumns("solid_", { measures: ["ridge", "ground", "volume"] }),
    ).toEqual([
      { name: "solid_volume_m3", type: "DOUBLE" },
      { name: "solid_ground_m", type: "DOUBLE" },
      { name: "solid_ridge_m", type: "DOUBLE" },
      { name: "solid_valid", type: "BOOLEAN" },
    ]);
  });

  it("writes `<prefix>valid` even with nothing ticked — §7.2 says always", () => {
    expect(solidColumns("s_", { measures: [] })).toEqual([
      { name: "s_valid", type: "BOOLEAN" },
    ]);
  });

  it("honours a different prefix", () => {
    expect(solidColumns("vol_", { measures: ["volume"] })).toEqual([
      { name: "vol_volume_m3", type: "DOUBLE" },
      { name: "vol_valid", type: "BOOLEAN" },
    ]);
  });
});

describe("validationColumns", () => {
  it("is §7.3's seven columns, four BOOLEAN flags then three counts", () => {
    expect(validationColumns("solid_")).toEqual([
      { name: "solid_closed", type: "BOOLEAN" },
      { name: "solid_manifold", type: "BOOLEAN" },
      { name: "solid_oriented", type: "BOOLEAN" },
      { name: "solid_valid", type: "BOOLEAN" },
      { name: "solid_open_edges_n", type: "DOUBLE" },
      { name: "solid_nonmanifold_edges_n", type: "DOUBLE" },
      { name: "solid_degenerate_faces_n", type: "DOUBLE" },
    ]);
  });
});
```

- [ ] **Step 2: Write the failing SQL test**

Create `tests/unit/features/processing/solidSql.test.ts`:

```ts
/**
 * The two guarded statements §7.2 and §7.3 issue, pinned to the exact text the
 * real-engine probe (`tests/integration/duckdb/solids.test.ts`) asserts against
 * DuckDB 1.5.5. If these strings and that suite's `MEASURE_SQL` ever disagree,
 * one of them is describing an engine nobody has run.
 *
 * The two guards this file exists to defend:
 *  - `ST_3DTryFromWKB`, NEVER `ST_3DFromWKB`: the second RAISES on a
 *    MultiPolygon Z, and one such row fails the whole statement.
 *  - `ST_3DVolume` ONLY under `CASE WHEN r.is_valid`: it RAISES "solid is not
 *    closed" on a parsed-but-unclosed solid, and one such row fails the whole
 *    statement. Every OTHER three_d measure is safe on an invalid solid.
 */
import { describe, expect, it } from "vitest";
import {
  buildScopeRowsSql,
  buildSolidMeasureSql,
  buildSolidValidationSql,
} from "../../../../src/features/processing/solidSql";

const FROM = "read_cityjson('two.city.json', lod => '2.2')";
const G = "geometry_lod2_2";

describe("buildSolidMeasureSql", () => {
  it("is the probed statement, verbatim, for the whole layer", () => {
    expect(
      buildSolidMeasureSql({ from: FROM, geometryColumn: G, ids: null }),
    ).toBe(
      `SELECT "id", COALESCE("feature_id", "id") AS f, s IS NOT NULL AS parsed, ` +
        `r.is_valid AS is_valid, CASE WHEN r.is_valid THEN ST_3DVolume(s) END AS volume_m3, ` +
        `ST_3DSurfaceArea(s) AS envelope_m2, ST_3DFootprintArea(s) AS footprint_m2, ` +
        `ST_3DZMin(s) AS ground_m, ST_3DZMax(s) AS ridge_m ` +
        `FROM (SELECT "id", "feature_id", ST_3DTryFromWKB("geometry_lod2_2") AS s, ` +
        `ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r ` +
        `FROM read_cityjson('two.city.json', lod => '2.2'))`,
    );
  });

  it("never mentions the unguarded parser or an unguarded volume", () => {
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: G,
      ids: null,
    });
    expect(sql).not.toMatch(/[^y]ST_3DFromWKB/);
    expect(sql).toContain("CASE WHEN r.is_valid THEN ST_3DVolume(s) END");
    // Exactly one ST_3DVolume, and it is the guarded one.
    expect(sql.match(/ST_3DVolume/g)).toHaveLength(1);
  });

  it("restricts to the contributor rows, quoting each id", () => {
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: G,
      ids: ["a", "b'c"],
    });
    // INSIDE the subquery, so the parse happens for the scoped rows only — a
    // WHERE on the outer select would parse the whole file first.
    expect(sql).toContain(
      `FROM read_cityjson('two.city.json', lod => '2.2') WHERE "id" IN ('a', 'b''c'))`,
    );
  });

  it("addresses the geometry column it is given, quoted", () => {
    const sql = buildSolidMeasureSql({
      from: FROM,
      geometryColumn: "geometry_lod0_0",
      ids: null,
    });
    expect(sql).toContain('ST_3DTryFromWKB("geometry_lod0_0")');
  });
});

describe("buildSolidValidationSql", () => {
  it("selects §7.3's four flags and three counts off ONE report", () => {
    expect(
      buildSolidValidationSql({ from: FROM, geometryColumn: G, ids: null }),
    ).toBe(
      `SELECT "id", COALESCE("feature_id", "id") AS f, s IS NOT NULL AS parsed, ` +
        `r.is_closed AS closed, r.is_manifold AS manifold, r.is_oriented AS oriented, ` +
        `r.is_valid AS valid, r.open_edge_count AS open_edges_n, ` +
        `r.non_manifold_edge_count AS nonmanifold_edges_n, ` +
        `r.degenerate_face_count AS degenerate_faces_n ` +
        `FROM (SELECT "id", "feature_id", ST_3DTryFromWKB("geometry_lod2_2") AS s, ` +
        `ST_3DValidationReport(ST_3DTryFromWKB("geometry_lod2_2")) AS r ` +
        `FROM read_cityjson('two.city.json', lod => '2.2'))`,
    );
  });

  it("never calls ST_3DVolume — §7.3 reports validity and never measures", () => {
    expect(
      buildSolidValidationSql({ from: FROM, geometryColumn: G, ids: null }),
    ).not.toContain("ST_3DVolume");
  });
});

describe("buildScopeRowsSql", () => {
  it("asks the TABLE which rows belong to which feature", () => {
    expect(buildScopeRowsSql("layer_3", null)).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_3"',
    );
    expect(buildScopeRowsSql("layer_3", ["a", "b"])).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f FROM "layer_3" WHERE "id" IN (\'a\', \'b\')',
    );
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/solidParams.test.ts \
  tests/unit/features/processing/solidSql.test.ts
```

Expected: FAIL — neither module exists.

- [ ] **Step 4: Write `solidParams.ts`**

Create `src/features/processing/solidParams.ts`:

```ts
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
```

- [ ] **Step 5: Write `solidSql.ts`**

Create `src/features/processing/solidSql.ts`:

```ts
/**
 * The guarded `three_d` statements §7.2 and §7.3 issue, and the layer-table
 * question that precedes them. Pure; every string here is pinned by
 * `tests/unit/features/processing/solidSql.test.ts` and run against a real
 * DuckDB 1.5.5 by `tests/integration/duckdb/solids.test.ts`.
 *
 * TWO GUARDS, both measured on the real engine, both statement-fatal if broken:
 *
 *  - `ST_3DTryFromWKB`, never `ST_3DFromWKB`. The second RAISES "Unsupported
 *    WKB geometry type for SOLID_3D import: type code 1006" on a MultiPolygon Z
 *    — which is what a MultiSurface at a solid LoD is — and ONE such row fails
 *    the whole statement. The `Try` form returns NULL, and `s IS NULL` is then
 *    §7.2's "not a solid" outcome.
 *  - `ST_3DVolume` only under `CASE WHEN r.is_valid`. It RAISES "ST_3DVolume:
 *    solid is not closed" on a parsed-but-unclosed solid, and ONE such row
 *    fails the whole statement. Every other measure — surface area, footprint
 *    area, ZMin/ZMax — returns a value on an invalid solid, which is exactly
 *    what §7.2's "invalid solid" outcome requires.
 *
 * `r.is_valid` is NULL (not false) when the solid did not parse, because
 * `ST_3DValidationReport(NULL)` is NULL. The "not a solid" row is therefore
 * told from the "invalid" row by `parsed`, never by the report.
 */
import { quoteIdent, quoteLiteral } from "../../insights/sql";

export interface SolidSqlInput {
  /** The reader clause from `readSource`: `read_cityjson('…', lod => '2.2')`. */
  readonly from: string;
  /** The reader's own spelling: `geometry_lod2_2`. */
  readonly geometryColumn: string;
  /** CONTRIBUTOR row ids, or null for every row the reader returns. */
  readonly ids: ReadonlyArray<string> | null;
}

/**
 * The scoped rows of the LAYER TABLE, each beside its FEATURE root.
 *
 * The TABLE is the authority on which rows exist and what `feature_id` means —
 * it is what the write targets — so the contributor rule is resolved against it
 * and never against the reader. Spelled here rather than imported from
 * `tools/roofMetrics.ts`, whose identical builder cannot be reached without
 * firing that module's `registerExecutor` side effect.
 */
export function buildScopeRowsSql(
  table: string,
  ids: ReadonlyArray<string> | null,
): string {
  const where =
    ids === null
      ? ""
      : ` WHERE "id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
  return `SELECT "id", COALESCE("feature_id", "id") AS f FROM ${quoteIdent(table)}${where}`;
}

/** The subquery both statements share: one parse and one report per row. */
function parsedRows(input: SolidSqlInput): string {
  const g = quoteIdent(input.geometryColumn);
  const where =
    input.ids === null
      ? ""
      : ` WHERE "id" IN (${input.ids.map((id) => quoteLiteral(id)).join(", ")})`;
  // The WHERE is INSIDE the subquery, so only the scoped rows are ever parsed;
  // filtering on the outer select would parse the whole file first.
  return (
    `(SELECT "id", "feature_id", ST_3DTryFromWKB(${g}) AS s, ` +
    `ST_3DValidationReport(ST_3DTryFromWKB(${g})) AS r ` +
    `FROM ${input.from}${where})`
  );
}

/** §7.2's one statement: every measure, with volume guarded by validity. */
export function buildSolidMeasureSql(input: SolidSqlInput): string {
  return (
    `SELECT "id", COALESCE("feature_id", "id") AS f, s IS NOT NULL AS parsed, ` +
    `r.is_valid AS is_valid, CASE WHEN r.is_valid THEN ST_3DVolume(s) END AS volume_m3, ` +
    `ST_3DSurfaceArea(s) AS envelope_m2, ST_3DFootprintArea(s) AS footprint_m2, ` +
    `ST_3DZMin(s) AS ground_m, ST_3DZMax(s) AS ridge_m ` +
    `FROM ${parsedRows(input)}`
  );
}

/** §7.3's one statement: the four flags and the three counts behind them. */
export function buildSolidValidationSql(input: SolidSqlInput): string {
  return (
    `SELECT "id", COALESCE("feature_id", "id") AS f, s IS NOT NULL AS parsed, ` +
    `r.is_closed AS closed, r.is_manifold AS manifold, r.is_oriented AS oriented, ` +
    `r.is_valid AS valid, r.open_edge_count AS open_edges_n, ` +
    `r.non_manifold_edge_count AS nonmanifold_edges_n, ` +
    `r.degenerate_face_count AS degenerate_faces_n ` +
    `FROM ${parsedRows(input)}`
  );
}
```

- [ ] **Step 6: Fill in the registry entry (still `implemented: false`)**

In `src/features/processing/toolRegistry.ts`, add to the imports:

```ts
import { solidColumns, solidParams } from "./solidParams";
```

and replace the `measure-solids` entry's tail. Find:

```ts
    defaultPrefix: "solid_",
    implemented: false,
  },
  {
    id: "validate-solids",
```

and replace with:

```ts
    defaultPrefix: "solid_",
    outputColumns: (prefix, params) => solidColumns(prefix, solidParams(params)),
    validateParams: (params) =>
      solidParams(params).measures.length === 0
        ? "Pick at least one measure"
        : null,
    normaliseParams: (params) => ({ ...solidParams(params) }),
    // Task 8 flips this, in the SAME commit that teaches `useLodOptions` about
    // solids — a flip without the hook renders an empty LoD select, and §6's
    // rule is that an unimplemented tool claims no fact about the user's data.
    implemented: false,
  },
  {
    id: "validate-solids",
```

- [ ] **Step 7: Pin the builder against the real engine**

Append to `tests/integration/duckdb/solids.test.ts`, inside its `describe`, and add the import at the top of that file:

```ts
import {
  buildSolidMeasureSql,
  buildSolidValidationSql,
} from "../../../src/features/processing/solidSql";
```

```ts
it("runs the APP's own builders, not this file's literal", () => {
  // The literal in MEASURE_SQL and the builder must be one statement. This
  // is where that stops being a convention and becomes a test.
  const built = buildSolidMeasureSql({
    from: `read_cityjson('${SOURCE}', lod => '${LOD}')`,
    geometryColumn: "geometry_lod2_2",
    ids: null,
  });
  expect(built).toBe(MEASURE_SQL);
  const rows = db.query(built);
  expect(rows).toHaveLength(3);

  const scoped = db.query(
    buildSolidValidationSql({
      from: `read_cityjson('${SOURCE}', lod => '${LOD}')`,
      geometryColumn: "geometry_lod2_2",
      ids: [VALID],
    }),
  );
  expect(scoped).toHaveLength(1);
  expect(scoped[0]).toMatchObject({ valid: true, closed: true });
});
```

`solidSql.ts` imports only `quoteIdent`/`quoteLiteral` from `sql.ts`, which reaches no engine — so this suite's `vi.mock` of `insights/duckdb` is not needed for it. (If the file has one, leave it as it is.)

- [ ] **Step 8: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/solids.test.ts
```

Expected: PASS everywhere. Measure solids is still "Not available yet" in the catalogue — that is correct until Task 8.

- [ ] **Step 9: Commit**

```bash
git add src/features/processing/solidParams.ts src/features/processing/solidSql.ts \
  src/features/processing/toolRegistry.ts \
  tests/unit/features/processing/solidParams.test.ts \
  tests/unit/features/processing/solidSql.test.ts \
  tests/integration/duckdb/solids.test.ts
git commit -m "feat: Measure solids' parameters, columns and guarded SQL"
```

---
