# Task 6 report — Measure solids' parameters, its SQL, and its registry entry

Commit: `5aea39a` `feat: Measure solids' parameters, columns and guarded SQL` (on `develop`, not pushed).

## Implemented

- **`src/features/processing/solidParams.ts`** (new, pure, no engine import): `SolidMeasure`,
  `SolidMeasureSpec`, `SOLID_MEASURES` (the six measures in §7.2 order with the accepted A5 labels
  and the two accepted hovers), `SolidParams`, `DEFAULT_SOLID_PARAMS` (the mockup's four),
  `solidParams(raw)` (absent → defaults, empty array kept empty, unknown keys dropped, re-ordered
  into §7.2 order, idempotent), `solidColumns(prefix, params)` (always ends with
  `<prefix>valid` BOOLEAN), `validationColumns(prefix)` (§7.3's seven).
- **`src/features/processing/solidSql.ts`** (new, pure; imports only `quoteIdent`/`quoteLiteral`):
  `SolidSqlInput` (`from`, `geometryColumn`, `propertiesColumn`, `ids`), `buildScopeRowsSql`,
  `buildSolidMeasureSql`, `buildSolidValidationSql`, with one shared `parsedRows` subquery
  (one parse, one report and the CityJSON geometry type per row) and a shared `idFilter` that
  puts the scope INSIDE the subquery.
- **`src/features/processing/toolRegistry.ts`**: the `measure-solids` entry gained
  `outputColumns`, `validateParams` (`"Pick at least one measure"`) and `normaliseParams`;
  `implemented` stays `false` with a comment naming Task 8 as the flip.

## Tested + results

- `tests/unit/features/processing/solidParams.test.ts` (new, 17 cases): the brief's params and
  column cases verbatim, plus two copy pins (the six A5 labels in order; the two hovers verbatim
  and every other hint null) and a four-case block on the registry entry (promised columns,
  the Run-blocking message, the frozen bag, `implemented === false`).
- `tests/unit/features/processing/solidSql.test.ts` (new, 10 cases): both statements pinned to
  their exact text, the "no unguarded parser / no unguarded volume" case, a generic D1 case that
  walks every `r.<field>` in the statement and asserts each sits directly behind a
  `CASE WHEN s IS NOT NULL …` (and that `r.code` / `r.message` are absent), the geometry-TYPE
  case, the scoped cases, and `buildScopeRowsSql`.
- `tests/integration/duckdb/solids.test.ts`: one case appended — `runs the APP's own builders,
not this file's literals` — asserting `buildSolidMeasureSql(...) === MEASURE_SQL` and
  `buildSolidValidationSql(...) === VALIDATE_SQL`, then RUNNING both against real DuckDB 1.5.5:
  3 rows, §7.2's three outcomes per row including `geometry_type` (`Solid` / `MultiSurface`),
  and a scoped validation run returning exactly the one asked-for row.

Results:

- `npx vitest run tests/unit/features/processing tests/unit/ui/processing` → 26 files, 336 passed.
- `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/solids.test.ts` → 18 passed
  (17 + the new case), run BEFORE the commit so the edited constants are engine-verified.
- Full app suite once, in background to a file: `247 passed | 4 skipped (251)`,
  `3065 passed | 69 skipped (3134)`, `suite: 0` (`/tmp/m3-task6-suite.log`).
- `npx tsc -b --noEmit` → clean. `npx vp check` → 0 errors / 56 warnings (baseline; the only
  `--fix` changes were Prettier line breaks in two files I had just written).

## TDD evidence

RED 1 — the two modules did not exist:

```
$ npx vitest run tests/unit/features/processing/solidParams.test.ts tests/unit/features/processing/solidSql.test.ts
Error: Failed to resolve import "../../../../src/features/processing/solidSql" …
 Test Files  2 failed (2)   Tests  no tests
```

GREEN 1 — after `solidParams.ts` and `solidSql.ts`: `Test Files 2 passed (2) — Tests 23 passed (23)`.

RED 2 — the registry block, written before the entry was wired:

```
TypeError: solids.outputColumns is not a function
TypeError: solids.validateParams is not a function
TypeError: solids.normaliseParams is not a function
      Tests  3 failed | 14 passed (17)
```

GREEN 2 — after the `toolRegistry.ts` entry: the whole processing + UI-processing selection green
(336 passed), then the probe suite green against the real engine, then the full suite green.

## Files changed

- `src/features/processing/solidParams.ts` (new)
- `src/features/processing/solidSql.ts` (new)
- `src/features/processing/toolRegistry.ts` (modified)
- `tests/unit/features/processing/solidParams.test.ts` (new)
- `tests/unit/features/processing/solidSql.test.ts` (new)
- `tests/integration/duckdb/solids.test.ts` (modified)

## How each controller requirement was met

1. **D1.** Every report field is `CASE WHEN s IS NOT NULL THEN r.<field> END`; the volume is
   `CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END`; `r.code` and `r.message`
   are never selected. The measure statement is byte-identical to the probe's `MEASURE_SQL`
   (`expect(built).toBe(MEASURE_SQL)`), and it is RUN in the probe suite. The D1 unit case is a
   loop over every `r.<field>` rather than a `toContain`, so a future field added without a guard
   fails even if the pinned literal is updated. **Deviation from the brief, deliberate:** the
   brief's own step-2 test text asserted `CASE WHEN r.is_valid THEN ST_3DVolume(s) END` and
   `r.is_valid AS is_valid` — i.e. the exact pre-D1 shape the guard exists to prevent. The
   requirements win; the literals were written in the guarded form.
2. **D4.** Both statements select `"<propertiesColumn>".type AS geometry_type`, from the
   `ReadSourceHandle.propertiesColumn` Task 5 added (no string surgery), so the executor can tell
   "not a solid" from "no geometry" by the CityJSON type. `cityjson_wkb_geometry_type` is never
   used, and a unit case asserts it is absent.
3. **D3.** `orientation_error_count` is the 8th guarded report field of
   `buildSolidValidationSql` — the SEPARATE validation statement, not the shared `parsedRows`
   subquery (the two builders share only the parse+report subquery and the row-identity prefix).
   `validationColumns` stays at §7.3's seven columns, so the field is read and written nowhere
   yet; Task 10 spends it (a second statement to fetch it would parse every solid twice). Noted
   in both the source and the probe's `VALIDATE_SQL` comment.
4. `ST_3DTryFromWKB` only, in both builders and pinned by a negative assertion; the `from` clause
   and both column names come straight from `ReadSourceHandle`.
5. Copy verbatim: the six A5 labels (`Volume (m³)`, `Envelope area (m²)`, `Footprint area (m²)`,
   `Height (m)`, `Ground elevation (m)`, `Ridge elevation (m)`), the two hovers
   (`Only for a closed, valid solid`, `Ridge minus ground at this LoD`),
   `Pick at least one measure`, `defaultPrefix: "solid_"`, and the mockup's four defaults. Each is
   pinned by a test.

## Brief / requirements conflicts (all resolved in favour of the requirements)

1. **`MEASURE_SQL` byte-identity vs. selecting the properties `type` column.** Requirement 1 pins
   the builder to the probe's literal; requirement 2 requires a column that literal does not have.
   Resolved ADDITIVELY: `geometry_type` was inserted into `MEASURE_SQL` and `VALIDATE_SQL` (and
   the properties `.type` select into their shared subquery) at the same position the builder
   emits it, and the probe suite was re-run against the real engine before the commit, so the
   edited constants are verified and not circular. Nothing about the D1/volume/parser guards
   moved. The rejected alternative was a nullable `propertiesColumn` (null → the old literal),
   which would have left a branch only the test exercises and pinned a statement the app never
   issues. All three existing `MEASURE_SQL`/`VALIDATE_SQL` consumers survive an extra column:
   `expectRow` checks named columns only, the seq-parity case compares the same edited SQL through
   both readers, and `throughSeq`'s replaced substring (the reader call) is untouched.
2. **The brief's `buildSolidValidationSql` text** had no D1 guards, omitted
   `orientation_error_count` and used `closed`/`manifold`/`open_edges_n` aliases. It is written
   here aimed at the probe's engine-verified `VALIDATE_SQL` shape and aliases
   (`is_closed`, `open_n`, `nm_n`, `deg_n`, `ori_n`) instead, and pinned in both suites. The probe's
   comment that "the TEXT is Task 10's to pin" was updated: the builder exists now, so the
   constant and the builder are one statement.
3. **Naming.** The controller's context mentioned `solidColumnNames`; the brief's given tests use
   `solidColumns` (the roof module's name is `roofColumnNames`). Followed the brief's tests.

## Self-review

- Nothing here reaches an engine: `solidParams.ts` imports one type, `solidSql.ts` imports two
  quoting helpers. No `vi.mock` of `insights/duckdb` was needed anywhere, including in the probe.
- `buildScopeRowsSql` is the deliberate second copy of `roofMetrics.ts`'s
  `buildFeatureRowsReadSql` (importing it would fire that module's `registerExecutor` side effect
  and break `register.test.ts`'s single-wire assertion); the reason is in the doc comment.
- The scope filter sits inside the subquery in both statements, so a scoped run parses only the
  scoped rows.
- `geometry_type` is an alias of our own over a subquery whose select list is
  `id, feature_id, geometry_type, s, r` — no shadowing of a reader column is possible.
- `solidParams({})` returns the shared `DEFAULT_SOLID_PARAMS` object (same as `roofParams`); all
  types are `readonly`, and the registry's `normaliseParams` spreads it before freezing.
- No new lint warning; the baseline is unchanged. No trailers on the commit. `.github/hooks/`,
  `docs/design-history/` and `.superpowers/` left untracked and unstaged. Nothing pushed.

## Concerns for later tasks

- **Task 7** must compute `height_m` itself: the statement returns `ground_m` and `ridge_m`
  always, and `height` is a ticked measure without its own SQL expression. It must also read
  `geometry_type` (against `SOLID_TYPES` in `solidGeometrySource.ts` — `Solid`, `CompositeSolid`,
  `MultiSolid`) rather than `parsed` to decide "not a solid": `parsed` answers "did three_d
  understand the WKB", which is a different question.
- **Task 10** inherits `buildSolidValidationSql` already written and probed; if it changes the
  text it must update `VALIDATE_SQL` and re-run the probe in the same commit. Its `ori_n` column
  is selected and currently unused.
- The probe suite now imports app source (`solidSql.ts`). That is safe today because the module is
  engine-free; a future import into `solidSql.ts` of anything touching `@navaramap/*` or
  `@duckdb/duckdb-wasm` would break the node-environment probe.
