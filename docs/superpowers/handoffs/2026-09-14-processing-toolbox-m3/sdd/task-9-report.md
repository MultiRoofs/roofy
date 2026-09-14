# Task 9 — ONE Style-by-result seam — report

**Status:** COMPLETE. One commit on `develop`: `6a8275a refactor: Style by result reads one descriptor, not a branch per tool` (not pushed).

---

## 1. What was implemented

### `src/features/processing/types.ts`

- `StyleValueSource = { kind: "median" } | { kind: "mostFrequent" } | { kind: "literal"; value: number | string | boolean }`.
- `StyleByResult` with `kind: "rule" | "attribute"`, `operator: ConditionOperator | ((picked: OutputColumn) => ConditionOperator)`, `value: StyleValueSource | ((picked) => StyleValueSource)` and `pick: (written: ReadonlyArray<OutputColumn>) => OutputColumn | null`.
- Exported resolvers `resolveStyleOperator` / `resolveStyleValueSource` — the ONE place either function-union field is read.
- `ToolDefinition.styleByResult: StyleByResult | null`, REQUIRED on every entry.
- `RunSummary.firstColumnNonNull: number` → `nonNullByColumn: Readonly<Record<string, number>>`.
- Added `import type { ConditionOperator } from "../rules/types"`; the module header's "the one import below is TYPE-ONLY" claim was corrected to describe two type imports plus the two three-line resolvers (the module stays engine-free — no DuckDB, Navara or React).

### `src/features/processing/toolRegistry.ts`

Descriptors on **all seven** tools (see §5 "brief vs. requirements"), plus the shared `firstWritten` helper and `import type { OutputColumn }`:

| tool                                                   | descriptor                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `roof-metrics`, `measure-solids`, `height-from-extent` | `rule`, `>`, `{kind:"median"}`, `pick: firstWritten`                                                           |
| `validate-solids`                                      | `rule`, `=`, `{kind:"literal", value:false}`, `pick`: first column whose lowercased name `endsWith("valid")`   |
| `join-by-location`                                     | `rule`, `=`, `{kind:"mostFrequent"}`, `pick`: first `type === "VARCHAR"`                                       |
| `distance-to-nearest`                                  | `rule`, `<`, `{kind:"median"}`, `pick`: first name ending `distance_m`                                         |
| `aggregate-per-area`                                   | `attribute`, `=`, `{kind:"literal", value:true}` (both stated, unused for `"attribute"`), `pick: firstWritten` |

### `src/features/processing/runQueue.ts`

`summarise` counts non-NULLs for EVERY written column in the same single pass over `result.rows`, and returns `nonNullByColumn`.

### `src/insights/sql.ts`

- `buildMedianSql` now emits `median(CAST(<col> AS DOUBLE))` (the M2 DECIMAL trap), root rows only, doc comment's root-row paragraph unchanged plus a new CAST paragraph.
- New `buildMostFrequentSql(table, column)`: `SELECT mode("c") AS m FROM "t" WHERE ("feature_id" IS NULL OR "feature_id" = "id") AND "c" IS NOT NULL`.

### `src/ui/processing/RunFooter.tsx`

- `writtenColumns(run)` rebuilds the written columns' TYPES from `toolById(run.toolId).outputColumns?.(run.prefix, run.params)`, matched case-insensitively, keeping the record's spelling; fallback `"DOUBLE"`.
- `readMedian` → `readStyleValue(layerId, column, source)`: a `literal` returns `{ literal }` with no engine call at all; otherwise `buildMedianSql` or `buildMostFrequentSql`.
- `start(run, column: OutputColumn, descriptor: StyleByResult)`; after the existing token and layer-alive guards, a new `runById(run.id)` guard refuses a run that is unknown, stale or no longer `done`.
- Value extraction accepts a finite number, a string or a boolean; `kind: "attribute"` opens the STYLE section and returns; otherwise the draft is written with `resolveStyleOperator(descriptor, column)` and the resolved value.
- `const descriptor = toolById(run.toolId).styleByResult; const styleColumn = descriptor?.pick(writtenColumns(run)) ?? null;` — the disabled reason reads `run.summary.nonNullByColumn[styleColumn.name] ?? 0`, stale still outranking empty. The button is rendered under `descriptor !== null && styleColumn !== null` (no `!`).
- `grep -n "toolId ===" src/ui/processing/RunFooter.tsx` → **no match** (exit 1).
- `updateLayer(layerId, { colorBy: "rules" })` left EAGERLY where it was (Task 26's change).
- The hook's doc comment was updated: it claimed "a read that does not produce a NUMBER opens nothing", which is no longer true (text and boolean values are legal), and it now names the descriptor as the source of column/operator/value.

---

## 2. Tests and results

New / changed test files:

- `tests/unit/ui/processing/styleByResult.test.tsx` (new, 7 cases) — the brief's file verbatim, plus one strengthening: the first case also asserts the STATEMENT the footer issued (`SELECT median(CAST("solid_volume_m3" AS DOUBLE)) AS m FROM "layer_1" WHERE …`), which gives the `statements` array the reader the brief's header promises and pins `buildMedianSql` reaching the footer through the descriptor.
- `tests/unit/insights/sqlQuery.test.ts` — both `buildMedianSql` expectations migrated to the CAST form; new `describe("buildMostFrequentSql")` with two cases; `buildMostFrequentSql` added to the import list.
- `tests/integration/duckdb/computedColumns.test.ts` — real-engine DECIMAL probe added inside probe 4's `describe`.
- `tests/unit/ui/layers/RulesEditor.test.tsx` — the BOOLEAN `=` Save/evaluate case, with `import { evaluateRule } from "@cityjson/navara-core"`.
- `tests/unit/features/processing/runQueue.test.ts` — three `summarise` cases migrated to `nonNullByColumn`, plus a NEW two-column case where the counts differ (`{roof_area_m2: 2, roof_azimuth_deg: 0}`), which is the behaviour the refactor buys and which nothing else pinned.
- `tests/unit/ui/processing/{ToolView,LogView,RecentRuns,engineStopped}.test.tsx` — `firstColumnNonNull: N` fixtures → `nonNullByColumn: { extent_height_m: N }` (every one of those fixtures' `columns[0]` is `extent_height_m`, checked), and ToolView's uncast median expectation updated.

Results:

```
npx vitest run tests/unit/insights tests/unit/ui/processing \
  tests/unit/features/processing tests/unit/ui/layers/RulesEditor.test.tsx
  → Test Files 49 passed (49)   Tests 759 passed (759)

DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/computedColumns.test.ts
  → Test Files 1 passed (1)     Tests 12 passed (12)

npx vitest run > /tmp/m3-task9-suite.log 2>&1 & wait $!; echo "suite: $?"
  → suite: 0    Test Files 252 passed | 4 skipped (256)
               Tests 3142 passed | 71 skipped (3213)

npx tsc -b --noEmit   → clean (no output)
npx vp check          → Found 0 errors and 56 warnings in 547 files  (baseline: 0 / 56)
grep -n "toolId ===" src/ui/processing/RunFooter.tsx → nothing
```

---

## 3. TDD evidence (RED → GREEN)

**RED 1 — the median CAST** (expectations changed first, no new import yet, so the failure is a string mismatch and not a collection error):

```
npx vitest run tests/unit/insights/sqlQuery.test.ts
 FAIL  buildMedianSql > quotes a column whose name would otherwise end the identifier
 Expected: "SELECT median(CAST("roof""area" AS DOUBLE)) AS m FROM "layer_1" WHERE …"
 Received: "SELECT median("roof""area") AS m FROM "layer_1" WHERE …"
 Tests  2 failed | 22 passed (24)
```

**RED 2 — the real-engine DECIMAL trap**, through the BUILDER, before the CAST existed:

```
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/computedColumns.test.ts
 FAIL  probe 4 > reads a DECIMAL column back as a NUMBER through buildMedianSql
 AssertionError: expected 'object' to be 'number'
 Tests  1 failed | 11 passed (12)
```

This is the plan's engine fact reproduced first-hand on this checkout: DuckDB 1.5.5 hands an uncast DECIMAL `median()` to JS as an object, which is exactly what would have made `typeof value === "number"` in `RunFooter` report "All values are empty" over a column full of numbers.

**RED 3 — the descriptor seam** (`npx vitest run tests/unit/insights/sqlQuery.test.ts tests/unit/ui/processing/styleByResult.test.tsx`): `Tests 8 failed | 25 passed (33)`, with `TypeError: resolveStyleOperator is not a function`, `expected element not to be enabled` on the empty-chosen-column case, and the `sqlQuery` suite failing on the missing `buildMostFrequentSql` export.

**GREEN:** both suites and the full app suite above.

**Two additions were NOT red-first drivers, and are disclosed as such:**

- the `RulesEditor.test.tsx` BOOLEAN Save/evaluate case was GREEN from the start, deliberately. The plan's verified facts already state that "a BOOLEAN `=` rule works end to end today; Validate solids needs no editor change", and design decision (e) asks Task 9 to PIN that rather than assume it. It is a regression pin.
- the new two-column `summarise` case ("counts each column separately, not the first one for all of them") was written AFTER Step 4's `runQueue.ts` change, during the fixture sweep. It pins the behaviour the refactor buys — two written columns whose non-NULL counts differ — which nothing else covered; it did not drive the change.

**What RED 3's eight failures actually discriminated.** Three of the seven footer cases would also have passed under the OLD code (case 1, because `columns[0] >` median was the old behaviour too; case 2, because `solid_footprint_m2` is `columns[0]` either way; case 7, because empty `columns` meant no button either way — they failed in RED 3 only because `nonNullByColumn` did not yet exist on `RunSummary`). The cases that genuinely drove the seam are the literal/BOOLEAN one, the Join-descriptor-direct one, the plain-resolver one and the chosen-column-empty one. Stated so "8 failed" is not read as seven independent proofs.

---

## 4. Files changed

`git show --stat HEAD`, verbatim:

```
 src/features/processing/runQueue.ts              |  21 +-
 src/features/processing/toolRegistry.ts          |  61 ++++
 src/features/processing/types.ts                 |  96 +++++-
 src/insights/sql.ts                              |  26 +-
 src/ui/processing/RunFooter.tsx                  | 280 +++++++++++-----
 tests/integration/duckdb/computedColumns.test.ts |  21 ++
 tests/unit/features/processing/runQueue.test.ts  |  32 +-
 tests/unit/insights/sqlQuery.test.ts             |  40 ++-
 tests/unit/ui/layers/RulesEditor.test.tsx        |  82 +++++
 tests/unit/ui/processing/LogView.test.tsx        |   2 +-
 tests/unit/ui/processing/RecentRuns.test.tsx     |   2 +-
 tests/unit/ui/processing/ToolView.test.tsx       |  24 +-
 tests/unit/ui/processing/engineStopped.test.tsx  |   2 +-
 tests/unit/ui/processing/styleByResult.test.tsx  | 400 +++++++++++++++++++++++
 14 files changed, 956 insertions(+), 133 deletions(-)
```

Nothing under `.github/hooks/`, `docs/design-history/` or `.superpowers/` was staged (both untracked dirs are still untracked). The plan was not edited. No submodule change. No push. Hooks ran normally on the commit and on the amend; none was bypassed.

---

## 5. Brief vs. requirements — one discrepancy, resolved in favour of the tests

The dispatch's Context says descriptors are added for "the four tools that exist … `validate-solids`/Join/Distance/Aggregate get theirs in their own tasks", while the brief's Step 6 gives all seven and Requirement 3 says "pin … Join's descriptor shape only if the brief says so".

**All seven were implemented**, because the brief's own tests require it and the type is `styleByResult: StyleByResult | null` REQUIRED on every entry:

- the third case drives `validate-solids` through the footer end to end (`solid_valid = false`, `expect(runQuery).not.toHaveBeenCalled()`), which is impossible without its descriptor;
- the fourth case reads `toolById("join-by-location").styleByResult!` directly — so the brief does say so, and Requirement 3's condition is met;
- a required field with no value on three entries would not compile.

Distance and Aggregate's descriptors are pure data on tools that are `implemented: false`; they cost nothing now and stop the footer from silently guessing on their behalf later. Tasks 16/17/19 swap in the function forms and the real `pick`s as their tools ship.

## 6. How each controller requirement was met

1. **Residual A4** — `buildMostFrequentSql` IS imported by `tests/unit/insights/sqlQuery.test.ts` (there is no `sql.test.ts`); `ToolView.test.tsx`'s median expectation was updated to the CAST form in this commit; the real-engine DECIMAL probe was added to `tests/integration/duckdb/computedColumns.test.ts` and run under `DUCKDB_INTEGRATION=1` (RED then GREEN, output above).
2. **Seeded runs** — every case in `styleByResult.test.tsx` goes through `seed()`, which writes the record into `useProcessingStore` before rendering, so the new `runById` guard finds it. `evaluateRule(attributes, metrics, rule)` is called with attributes FIRST in the RulesEditor case. The BOOLEAN `=` rule is pinned end to end: the footer writes `value: false` as a BOOLEAN (asserted with `typeof … === "boolean"`), the schema round-trips it through `setDraft` → the editor's "Add" → `layer.rules[0].conditions`, and `evaluateRule` answers `true` for `{solid_valid:false}` and `false` for `{solid_valid:true}` (the strict `===`).
3. **`mostFrequent` at footer level is Task 16's** — `buildMostFrequentSql` and both resolvers are pinned here; Join's descriptor is pinned DIRECTLY (its `pick` over columns the test types itself, plus the two resolvers), never through the footer; no Join `outputColumns` was added.
4. **`nonNullByColumn`** is computed in `summarise` for every written column; the button's "All values are empty" is keyed on the PICKED column (`nonNullByColumn[styleColumn.name] ?? 0`), pinned by the case where `solid_volume_m3: 0` while `solid_envelope_m2: 2`; `run.stale` still outranks it (ToolView's "BOTH stale and empty" case still passes).
5. **`Color by = Rules` stays EAGER** — `updateLayer(layerId, { colorBy: "rules" })` is untouched, still immediately before `requestSection`.
6. **duckdb mock** — the new file's factory exports the same twenty names `ToolView.test.tsx`'s working factory does (`runQuery`, `ddl`, `registerBuffer`, `dropBuffer`, `readFile`, `getDuckDBStatus`, `getDuckDBStatusVersion`, `subscribeDuckDBStatus`, `getEngineGeneration`, `onEngineDeath`, `isExtensionLoaded`, `ensureExtension`, `formatDuckDBError`, `queryDuckDB`, `queryParquetBuffer`, `initDuckDB`), which covers everything `RunFooter` and its transitive imports reach. No other duckdb mock factory was touched.

---

## 7. Self-review and concerns

- **`writtenColumns`' `"DOUBLE"` fallback.** For `validate-solids` today (no `outputColumns` until Task 10) every column is typed DOUBLE, including the BOOLEANs. It does not matter here — that descriptor's `pick` is by NAME and its value is a literal — but Task 10 must add `outputColumns` for its own reason, and Task 15 must embed Join's `fieldTypes` in the frozen params before Join's VARCHAR `pick` can work through the footer. The brief says exactly this; recorded so it is not forgotten. The fallback comment was reworded from the brief's "unreachable" to "the honest default", because it is in fact reachable today for the three unimplemented tools.
- **`kind: "attribute"` is a dead branch** until Aggregate ships (Task 19/23). It opens the STYLE section and returns without writing a draft; it still pays for the value read (Aggregate's descriptor uses a literal, so no query is issued). Noted in the code.
- **Rendering cost.** `writtenColumns(run)` runs per render of a done card — a `Map` over at most seven names. Not memoised on purpose; memoising would need a dependency on the frozen record, which is more machinery than the work it saves.
- **`statements` in the new suite** is now actually asserted (first case). Without that it would have been an unused fixture that lint happens to tolerate.
- **Commit shape.** Left as the brief's single `refactor:` commit rather than split into `fix:` (CAST) + `refactor:` (seam): the two changes live in the same two files (`sql.ts`, `sqlQuery.test.ts`) and residual A4 asks for the CAST and the ToolView expectation in the same commit. The alternative was staging hunks, which cannot be done without interactive git here.
- No other consumer of `RunSummary` exists in `src/` — `grep -rn "firstColumnNonNull" src/ tests/` returns nothing.

---

## Fix round 1 (review of 2026-09-13)

Two commits on top of `bb1178c` (Task 10's Validate-solids landing), tree clean before and after, nothing pushed, no trailers:

- `aed0682 fix: the Style-by-result modal value breaks a tie on the lowest value`
- `25df384 test: the picked column and the function-form resolvers, where they differ`

### Important — deterministic `mostFrequent` ties

**The defect was real and the engine proved it.** The regression was written first and RAN RED against the old `mode()` builder:

```
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/computedColumns.test.ts
 FAIL  probe 5 > gives the same answer when the same rows are inserted in reverse
 AssertionError: expected [ { m: 'B' } ] to deeply equal [ { m: 'A' } ]
 Tests  1 failed | 14 passed (15)
```

The SAME seven rows, inserted in the opposite order, made DuckDB 1.5.5's `mode()` answer `'B'` instead of `'A'` — so the threshold prefilled into a user's rule depended on row order, which a table rebuild is free to change.

`buildMostFrequentSql` now emits the commander's shape, keeping the root-row restriction and the explicit NULL exclusion:

```sql
SELECT "v" AS m FROM (SELECT "c" AS "v", count(*) AS "n" FROM "t"
  WHERE ("feature_id" IS NULL OR "feature_id" = "id") AND "c" IS NOT NULL
  GROUP BY "v") ORDER BY "n" DESC, "v" ASC LIMIT 1
```

The doc comment states the tie rule (most frequent first, then the LOWEST value under DuckDB's natural ordering for the column's type), says why `mode()` was rejected, and cites the probe.

New real-engine `describe("probe 5: the Style-by-result modal value over root rows")` in `tests/integration/duckdb/computedColumns.test.ts`, three cases over one shared fixture (four roots — `'A'`, `'B'`, and two NULLs — plus three parts of the first feature all carrying `'Z'`):

1. **tie + NULLs + parts, in one assertion.** `'Z'` is the most frequent string in the table and loses (parts only); NULL is the most frequent ROOT value and loses (excluded); `'A'` and `'B'` are tied among roots and `'A'` wins. Covers "tied root values", "NULLs ignored" and "many parts not outvoting one with none".
2. **reversed insertion order** — the same rows via `[...ROWS].reverse()`, same answer `'A'`. This is the case that was red.
3. **frequency beats alphabet** — two roots `'B'` against one `'A'` answers `'B'`, so the builder is a modal value with a tie-break and not an alphabetical minimum. (Without this, `ORDER BY "v" ASC` alone would have passed cases 1 and 2.)

`tests/unit/insights/sqlQuery.test.ts`'s `buildMostFrequentSql` string expectation was migrated first and ran red on the string mismatch before the builder changed.

### Minor — the empty-picked-column test now distinguishes the two answers

`tests/unit/ui/processing/styleByResult.test.tsx`'s "CHOSEN column is empty" case was rebuilt on **Validate solids**, whose descriptor picks `solid_valid` — the FOURTH column written — with `nonNullByColumn: { solid_closed: 2, solid_manifold: 2, solid_oriented: 2, solid_valid: 0 }`. The first column written now has values and the picked one does not, so a footer that had kept `columns[0]` would leave the button ENABLED and the case would fail. The old fixture (measure-solids, `solid_volume_m3` at index 0) could not tell the two rules apart, exactly as the review said.

### Minor — the function forms, through the real footer

No registry tool carries function-form `operator`/`value` until Task 16, so the branches had no behavioural coverage. The file now replaces ONE tool definition — `distance-to-nearest`, unimplemented and used by no other case — via a `vi.mock` that `importActual`s the registry and delegates every other id to it. The synthetic descriptor has the §7.5 SHAPE: `=` + `mostFrequent` on a VARCHAR, `<` + `median` on a DOUBLE, `pick` = first written. What is substituted is the tool's own DATA; the footer, both resolvers, both SQL builders and the draft store are the real ones.

The new case drives both branches end to end:

- columns `["near_name","near_distance_m"]` → the VARCHAR is picked → draft `{field:"near_name", operator:"=", value:"Centrum"}` and the statement is the modal builder's, verbatim including the new `ORDER BY "n" DESC, "v" ASC LIMIT 1`;
- columns `["near_distance_m"]` → the DOUBLE is picked → draft `{field:"near_distance_m", operator:"<", value:4.2}` and the statement is `median(CAST(… AS DOUBLE))`.

It also asserts the resolvers directly on that descriptor for both column types. The file header's "the `mostFrequent` path is not exercised through the footer here" paragraph was corrected — it now is; only JOIN's own descriptor stays a direct assertion, for the `fieldTypes` reason that is still Task 15's.

Note on the brief/coordinator wording: the review said the synthetic-descriptor test could stay a pure resolver test, the coordinator said "through the real footer". The footer route was taken (coordinator wins), and the resolver assertions were kept alongside it, so both readings are satisfied.

### Verification

```
npx vitest run tests/unit/insights/sqlQuery.test.ts        → Tests 26 passed (26)
npx vitest run tests/unit/ui/processing/styleByResult.test.tsx → Tests 8 passed (8)
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/computedColumns.test.ts
                                                          → Tests 15 passed (15)
npx vitest run > /tmp/m3-task9-fix1-suite.log 2>&1 & wait $!; echo "suite: $?"
   → suite: 0   Test Files 254 passed | 4 skipped (258)
                Tests 3180 passed | 74 skipped (3254)
npx tsc -b --noEmit  → clean
npx vp check         → Found 0 errors and 56 warnings in 550 files (baseline held)
git log -2 … grep -i "co-authored|claude-session" → no trailers
```

### Concerns carried forward

- The synthetic-tool mock is the one place a test substitutes registry DATA. When Task 16 ships Join's real function forms, that mock should be retired in favour of Join's own footer case; the comment on it says so.
- `"v" ASC` relies on DuckDB's natural ordering for whatever type the column has. That is the commander's ruling and is right for VARCHAR and for numerics; if a future joined column is ever a STRUCT or LIST, the ordering is DuckDB's own and no longer obviously meaningful to a user. Not reachable today — §7.5 copies VARCHAR/BOOLEAN/DOUBLE only.
