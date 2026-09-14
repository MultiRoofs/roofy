# Task 7 report — The Measure solids executor

Commits (on `develop`, not pushed, no trailers):

- `696c17c` `feat: Measure solids computes volume, envelope, footprint and height`
- `a61d327` `fix: a rejected solid outranks an unchecked sibling, whatever the row order` — two gaps my own
  self-review missed, found in the post-implementation advisor pass and closed red-first (below).

## Implemented

- **`src/features/processing/solidRollUp.ts`** (new, pure — one TYPE-only plugin import): `SOLID_GEOMETRY_TYPES`
  (D4's three CityJSON solid types, declared `ReadonlySet<string>` over a `Set<CityJSONGeometryType>` literal so the
  literal is union-checked while the reader's untyped VARCHAR needs no cast), `FeatureRow`, `SolidRow` (now carrying
  `geometry_type: string | null`), `FeatureGroup`, `groupContributors`, `isMeasurableSolid`, `SolidRollUp`,
  `rollUpSolids`, `SKIP_NOT_A_SOLID`, `skipNoGeometry(lod)`, `CAVEAT_INVALID_SOLIDS`, `countsAsSkips`.
- **`src/features/processing/tools/measureSolids.ts`** (new): the executor, `SOLID_BATCH_FEATURES = 500`, and
  `registerExecutor("measure-solids", measureSolids)`. THREE statements: the layer-table scope rows, an id-only
  source statement for §6.1's scope-wide id join, then the guarded contributor-scoped measure statement.
- **`src/features/processing/solidSql.ts`**: `buildSourceIdsSql({ from, ids })` — `SELECT "id" FROM <reader>` with
  the scope's `WHERE "id" IN (…)`, or no `WHERE` at all for scope "all". No parse, no report.
- **`src/features/processing/solidGeometrySource.ts`**: its private `SOLID_TYPES` replaced by an import of
  `SOLID_GEOMETRY_TYPES`, so the MODEL's tag test and the READER's type test are one list (see self-review).
- **`src/features/processing/runQueue.ts`**: `ToolResult.line?` and `ToolResult.caveats?` (the milestone's ONE
  caveat channel) plus the single `summarise` edit — `result.line ?? plural(...)`, then the caveats, then the
  skipped count, then the elapsed time.
- **`src/features/processing/tools/register.ts`**: `import "./measureSolids";` appended.

## Tested + results

- `tests/unit/features/processing/measureSolids.test.ts` (new, 33 cases): the brief's `rollUpSolids` and
  `groupContributors` cases, plus the executor over a stubbed `ToolContext` — happy path (phases, the three
  statement labels, columns, 2 features over 3 rows, the root carrying its part's roll-up, `release`), the three
  §7.2 outcomes, the two D4 classification cases, the invalid-solid caveat and its volume gate, the skip
  arithmetic, the ticked-measures column set, contributor-only measure scoping, the identity statement's shape and
  the FOUR missing-id cases of requirement 1, the SECOND threshold (a measure answer that drops a contributor the
  id check saw), three-valued AND in both row orders, the reader-failure sentence and the Binder-error passthrough,
  the cancel path, and the no-LoD refusal.
- `tests/unit/features/processing/solidSql.test.ts`: 3 cases appended for `buildSourceIdsSql` (ids only / no
  `ST_3D`; no `WHERE` for "all" and the scope's ids otherwise; quote escaping).
- `tests/unit/features/processing/runQueue.test.ts`: 3 cases appended — two pure `summarise` cases (the caveat
  between the measured and skipped counts, and the caveat NOT joining the skip breakdown; a tool's own `line`) and
  one real-queue case (the field survives `canonicalise` and the publication and reaches `summary.line`).
- `tests/unit/features/processing/register.test.ts`: the EXECUTORS pin is now the three shipped executors in
  `register.ts`'s import order.
- `tests/integration/duckdb/solids.test.ts`: one case appended, run against REAL DuckDB 1.5.5 — `buildSourceIdsSql`
  returns a row per object (3 unscoped, 2 scoped, and an id the file does not hold simply does not come back, which
  is the whole mechanism of the join), with `Object.keys(row) === ["id"]`.

Results (Node 24 shims):

- `npx vitest run tests/unit/features/processing/measureSolids.test.ts` → 33 passed.
- `npx vitest run tests/unit/features/processing tests/unit/ui/processing` → 27 files, 373 passed at `696c17c`; 375 after `a61d327`.
- `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/solids.test.ts` → 19 passed (18 + the new case).
- Full app suite once, background to a file: `248 passed | 4 skipped (252)`, `3102 passed | 70 skipped (3172)`,
  `suite: 0` (`/tmp/m3-task7-suite.log`), at `696c17c`. Task 6's baseline was 247 files / 3065 passed / 69 skipped:
  +1 file, +37 PASSED unit tests (31 + 3 + 3) and +1 SKIPPED (the integration case, which the default offline run
  collects and skips — the 69 → 70 delta). `a61d327` adds two more passing cases in one existing file; the full
  suite was not re-run for it, since nothing outside `solidRollUp.ts` and its own suite moved (both were re-run,
  plus the whole processing + UI-processing selection, `tsc -b` and `vp check`).
- `npx tsc -b --noEmit` → clean. `npx vp check` → **0 errors / 56 warnings** (baseline; the only `--fix` changes
  were Prettier line breaks in the two test files I had just written).

## TDD evidence

RED 1 — the two modules did not exist:

```
$ npx vitest run tests/unit/features/processing/measureSolids.test.ts
Error: Failed to resolve import "../../../../src/features/processing/solidRollUp" from
"tests/unit/features/processing/measureSolids.test.ts". Does the file exist?
 Test Files  1 failed (1)   Tests  no tests
```

GREEN 1 — after `solidRollUp.ts`, `measureSolids.ts`, `buildSourceIdsSql` and the `ToolResult` fields:
`Test Files 1 passed (1) — Tests 30 passed (30)`.

MUTATION 1 — requirement 1 is load-bearing. Narrowing the identity check's `requested` to exclude the two ids
(i.e. anything short of the whole scope):

```
 ❯ tests/unit/features/processing/measureSolids.test.ts (30 tests | 5 failed)
   × fails with §6.1's id sentence when the source matches NOTHING
   × detects a missing ROOT under scope 'all', which measures no root row
   × detects a missing ROOT under a frozen id list too
   × detects a missing NON-CONTRIBUTING part under scope 'all'
   × detects a missing NON-CONTRIBUTING part under a frozen id list too
```

MUTATION 2 — requirement 3's detector. A 31st case was added after GREEN 1 (a row that PARSED but whose CityJSON
type is `CompositeSurface`), and each half of `isMeasurableSolid` was then removed in turn:

```
# return row.parsed;                                   → × skips a row that PARSED but is not a solid in the CityJSON model
# return SOLID_GEOMETRY_TYPES.has(row.geometry_type);   → × skips a solid-typed row the parser could not read
      Tests  1 failed | 30 passed (31)   (each mutation)
```

MUTATION 3 — the `summarise` edit. Reverting the caveat loop and the `result.line ??`:

```
   × prints a caveat between the measured count and the skipped count
   × lets a tool speak its OWN first phrase instead of the default
   × survives the queue and reaches the finished run's summary
      Tests  3 failed | 60 passed (63)
```

RED 2 / GREEN 2 (`a61d327`) — three-valued AND. The case was written first and failed on the committed code:

```
$ npx vitest run tests/unit/features/processing/measureSolids.test.ts
   × lets FALSE dominate an unknown, in either order
      Tests  1 failed | 32 passed (33)
```

`[false, null]` ended at `null` because the loop's last write won. Deciding `valid` AFTER the loop
(`hasInvalid ? false : hasUnknown ? null : true`) makes it 33 passed. Unreachable through the guarded SQL today
(a parsed solid's report is never NULL), but it was an order-dependent answer in a shared module Task 10 inherits.

MUTATION 4 — the SECOND threshold now has a test of its own. Deleting
`assertSourceIds(contributorIds, new Set(byId.keys()))`:

```
   × fails when the MEASURE answer drops a contributor the id check saw
      Tests  1 failed | 32 passed (33)
```

(Before that case existed the line was dead-by-test: both earlier id cases now fail at the identity statement
first.)

GREEN 3 — everything restored: 33 / 375 / 19, and 3102 for the full suite at the feature commit.

## Files changed

- `src/features/processing/solidRollUp.ts` (new)
- `src/features/processing/tools/measureSolids.ts` (new)
- `src/features/processing/solidSql.ts`, `src/features/processing/solidGeometrySource.ts`,
  `src/features/processing/runQueue.ts`, `src/features/processing/tools/register.ts` (modified)
- `tests/unit/features/processing/measureSolids.test.ts` (new)
- `tests/unit/features/processing/{solidSql,runQueue,register}.test.ts`,
  `tests/integration/duckdb/solids.test.ts` (modified)

## How each controller requirement was met

1. **Scope-wide source identity (A1).** `requested` is `rows.map(r => r.id)` — the ids the executor's OWN
   `buildScopeRowsSql` read returned, every scoped row, roots and non-contributors included. `ctx.featureIds` is
   used ONLY as the scope filter of the two statements, never as `requested`. `returned` is the id set of a
   dedicated reader statement (`buildSourceIdsSql`) issued through `readerQuery` BEFORE the expensive parse, over
   the same scope. Four tests: a missing root and a missing non-contributing part, each under scope "all" and under
   a frozen `featureIds`; plus a test that the identity statement carries NO `WHERE` under "all" (the pin that
   `ctx.featureIds` was not smuggled in as `requested`), plus the "matches nothing" and "partial answer" cases. The
   contributor-level `assertSourceIds(contributorIds, byId.keys())` is kept as the second, cheap threshold over the
   rows that are actually measured. **Deviation from the brief, forced by this requirement:** the brief had ONE
   reader statement and validated contributors only — see "Brief / requirements conflicts" below.
2. **D1.** The SQL is Task 6's `buildSolidMeasureSql` unchanged (not one character of it moved). The executor reads
   `is_valid` and never re-derives it: `parsed` is used for "did `three_d` read the WKB", the caveat is
   `is_valid === false` (which the statement's `CASE WHEN s IS NOT NULL` makes impossible for an unparsed row), and
   `valid` is NULL — never false — whenever the report was not taken. A comment in `rollUpSolids` says so.
3. **D4 / §7's contributor rule.** `isMeasurableSolid` = `parsed && SOLID_GEOMETRY_TYPES.has(geometry_type)`, keyed
   on the reader's CityJSON type (`Solid` | `CompositeSolid` | `MultiSolid`), never on the WKB name. The contributor
   RULE stays "geometry of any kind at the LoD" from `geometryLodsByObject`, so "not a solid" is a verdict ON the
   chosen contributors and never an input to choosing them. `two-buildings` at LoD 2.2 is a test whose layer model
   is built from the FIXTURE itself (`layerFromFixture` reads each CityObject's own `geometry[].{type, lod}` and
   `parents`): Pand.0001's MultiSurface part is the contributor, the feature is skipped "not a solid", the measure
   statement's `WHERE "id" IN ('…-part1', '…Pand.0002')` excludes the root, and the run is 1 measured / 1 skipped.
   The invalid-solid outcome is a test on `fixtures/invalid-solid.city.json`, again with the fixture's own model and
   the probe suite's own numbers (volume NULL, envelope 388, footprint 80, ground 0, ridge 8.4, height 8.4,
   `valid` false, `caveats: [{ cause: "invalid solids (no volume)", count: 1 }]`, `skipped: []`). A CompositeSolid
   case covers D4's positive half, and two mutation-verified cases cover each half of the detector.
4. **Roll-ups.** `rollUpSolids`: volume = sum but NULL if any contributor's is NULL; envelope and footprint = sum;
   ground = min, ridge = max; height = `ridge − ground` computed app-side (no SQL expression exists for it, exactly
   as Task 6's report warned); `valid` = three-valued AND, decided after the loop so the reader's row ORDER cannot
   change it — any contributor the engine rejected makes the feature `false`, otherwise any contributor without a
   report makes it `null`, otherwise `true` (both orders asserted; this was `a61d327`'s fix). The ROOT row gets the
   feature roll-up; every other row gets `rollUpSolids([own])`, which for a non-contributor is NULL everywhere.
5. **`line` / `caveats` / `skipped`.** Declared once on `ToolResult` with the brief's names, types and doc
   comments; `summarise` renders `line ?? default`, then each caveat as `"<count> <cause>"`, then the skipped count
   (§6.2's card order), and the caveat is deliberately NOT added to the skip breakdown detail line (asserted).
   Skips are `no geometry at LoD <lod>` and `not a solid`, `[]` when zero.
6. **Phase and release.** The run enters "source" in the queue before the scope query (Task 5, untouched);
   `ctx.phase("compute")` is called as soon as `readSource` returns the handle — see the interpretation note below.
   `handle.release()` is called after the parse AND in a `finally` on every exit path; tests cover success, the id
   failure, the reader failure, the Binder passthrough and a cancel thrown from `throwIfCancelled`.
7. **Mocks and wiring.** The new suite's `vi.mock(".../insights/duckdb")` factory carries all 17 exports (it is
   loaded because `sourceRead` is `importActual`'d); no other factory needed a change, and `register.test.ts` needed
   none at all (verified: it now loads the real `duckdb.ts` through `sourceRead` and passes). The executor is wired
   in `register.ts` and the EXECUTORS pin updated. `toolRegistry.ts` is untouched, so `measure-solids` is still
   `implemented: false` and unreachable from the UI until Task 8.

## Brief / requirements conflicts (resolved in favour of the requirements)

1. **ONE reader statement (brief) vs. scope-wide identity (requirement 1).** The brief validated
   `assertSourceIds(contributorIds, …)` off the measure statement, which by construction can only ever see the
   contributors — exactly what Strand A round-2 finding 1 rejects. Resolved with a THIRD statement,
   `buildSourceIdsSql`, because finding 1 also says "while retaining contributor-only measurement": the measure
   statement stays scoped to the contributors (Task 6's builder and the brief's "not.toContain('B1')" test both
   survive untouched) and the join gets its own cheap, id-only pass. **Cost, stated plainly:** a second
   `read_cityjson` pass over the registered bytes. The rejected alternative was passing `ids: ctx.featureIds` to
   `buildSolidMeasureSql` for one statement — which parses every displaced root's solid (on 3D BAG, roughly doubling
   the `ST_3DValidationReport` work, since the root and the part carry the same solid) and buries the identity
   guarantee in a side effect of the scope. Design decision (b)'s "the run issues exactly one statement per tool"
   is a sentence about why the bytes are dropped early, not a budget; the bytes are still dropped as soon as the
   measure returns.
2. **`ctx.phase("compute")` placement.** Requirement 6 says "after the reader statement returns"; the brief, the
   ledger's Task 5 note ("call `ctx.phase("compute")` after the read") and the committed comment in `runQueue.ts`
   ("its executor calls `ctx.phase("compute")` once its handle is open") all say after `readSource`. I followed the
   latter — §6.1 spells the phase "Reading source (registering bytes)", and the handle being open is what that
   phase promised. If the controller meant the measure statement literally, it is a one-line move plus one test
   expectation; flagging it rather than guessing silently.
3. **`SolidRow.parsed` as the "not a solid" detector (brief) vs. `geometry_type` (requirement 3).** Requirement 3
   wins: `SolidRow` gained `geometry_type` and the detector is the type AND the parse (the doc comment explains why
   §7.2's two skip causes absorb the unparseable-solid case). The brief's `layerWith` heuristic
   (`id.includes("P") → "BuildingPart"`) was also replaced — it mislabels every `Pand.*` id and never set
   `parents`, which is what `featureIdsByObject` actually reads.

## Self-review

- `solidRollUp.ts` stays pure: one type-only plugin import and one type-only `./types` import; nothing engine,
  store or React. `measureSolids.ts`'s only runtime imports are the pure params/SQL/roll-up modules,
  `roofGeometrySource` (tags), `sourceRead` and `tools/index`; `runQueue` is type-only.
- **One extra file touched beyond the brief's list**, deliberately: `solidGeometrySource.ts` now imports
  `SOLID_GEOMETRY_TYPES` instead of keeping a private copy. The MODEL's tag test (which decides which LoDs the
  select offers) and the READER's type test (which decides what the run measures) answer the same question about
  the same file; two lists would let the select promise an LoD whose every feature the run then skips. Its own suite
  is unchanged and green.
- Two things this self-review MISSED and the advisor pass caught, both now fixed and tested in `a61d327`: the
  order-dependent `valid` above, and the post-measure `assertSourceIds` having no test of its own (the brief's
  "partial answer" case used to reach it; with the identity statement in front, that case now fails earlier).
- `rollUpSolids` filters to measurable rows ITSELF rather than trusting the call site, so neither solids tool can
  average a row of NULLs into a building's total, and the per-member `rollUpSolids([own])` call is correct by
  construction. Task 10 inherits that.
- The caveat is gated on `volume` being ticked: nothing is withheld from a run that never asked for a volume
  (tested).
- `buildSourceIdsSql` is skipped entirely for an empty scope, so a 0-row run issues one statement and no source
  read work; the queue's existing "nothing to write" path then finishes it as done.
- The `line` field is declared but unset here — Task 10 is its first user, as the brief says. No later task needs to
  re-edit `summarise`.
- No new lint warning (56, unchanged). No trailers. `.github/hooks/`, `docs/design-history/` and `.superpowers/`
  left untracked and unstaged. Nothing pushed. Hooks ran on the commit (pre-commit `vp staged`).

## Concerns for later tasks

- **Task 10 (Validate solids) should use the same three-statement shape**: its brief has the contributor-only
  `assertSourceIds` this task replaced. `buildSourceIdsSql` and `isMeasurableSolid` are exported for it, and its
  own skip/caveat arithmetic should read `geometry_type` the same way (its statement already selects it).
- **The second reader pass is a real cost on a very large source.** If it ever matters, the only shape that removes
  it without weakening the join is a single statement that selects every scoped id while parsing only the
  contributors (`ST_3DTryFromWKB(CASE WHEN "id" IN (…) THEN geom END)`), which would change Task 6's engine-pinned
  `MEASURE_SQL`. Not done here: requirement 2 pins that statement.
- **The contributor-id IN list is still unbounded** on scope "all" (the brief's shape): a 100k-building run puts
  every contributor id into the measure statement and thence into §6.4's log. The identity statement no longer adds
  to that (it carries no `WHERE` for "all"), but the measure statement is unchanged from the brief. Worth a look
  when Task 8's browser smoke runs on a big layer.
- `measureSolids.test.ts` builds its fixture-derived layers with `readFileSync`, like six existing unit suites. If
  a fixture's ids or geometry types change, those two cases fail loudly — which is the point.

---

## Fix round 1 (review `task-7-review.md`)

Base: `develop` @ `40215da` (Task 8's three commits landed on top of mine; Measure solids is now
`implemented: true`, which is what makes the new real-queue suite possible at all).

Commits:

- `ac744af` `fix: an area no contributor measured is NULL, not a measured zero` (the Important finding)
- `9b822e5` `test: a cancelled or engine-killed solids run drops its bytes and holds nothing` (the Minor finding)

### Important — all-NULL area measures became zero

`rollUpSolids` started `envelope` and `footprint` at `0` and accumulated `value ?? 0`, so a feature whose
contributors ALL returned NULL for an area read as a measured `0`. Both now start at `null` and only become a
number when a contributor actually supplies one (`if (row.envelope_m2 !== null) envelope = (envelope ?? 0) + …`),
which keeps a genuine `0 m²` a zero. `volume` deliberately still starts at `0`: §7 makes it STRICTER (any NULL
poisons the whole sum), not laxer — a comment now says so. `ground`, `ridge` and `height` were already correct
(the ±Infinity sentinels collapse to `null`), and the new case asserts all five together rather than trusting that.

RED (the case written first, on the committed code):

```
$ npx vitest run tests/unit/features/processing/measureSolids.test.ts
   × gives NULL, not 0, for a measure NO contributor supplied
      Tests  1 failed | 35 passed (36)
```

GREEN, with the two companion cases the review asked for and one end-to-end case: `gives NULL, not 0, for a
measure NO contributor supplied` (areas, both elevations and the height), `sums the contributors that HAVE an area
and ignores those that do not` (mixed NULL/numeric), `keeps a genuine zero a zero`, and
`writes NULL for an area the engine did not answer for, never 0` through the executor. 37 passed.

### Minor — cleanup through the REAL executor and the REAL queue

New file `tests/unit/features/processing/measureSolidsRun.test.ts` (3 cases), scaffolded like
`roofMetricsRun.test.ts` but over a READER-BACKED table, so `readSource` really registers bytes and the run really
enters §6.1's "Reading source" phase. Its duckdb mock records BOTH `registerBuffer` and `dropBuffer` names and
answers the three statements apart (`COUNT(DISTINCT`, `AS f FROM`, `SELECT "id" FROM read_cityjson(`,
`ST_3DTryFromWKB`); its `layerTables` mock keeps the real FIFO chain.

- `registers the source, drops it when the parse is done, and publishes` — one provider read, the source name
  registered AND dropped, the values in the model, and §6.4's log reading
  `Reading features · Checking source ids · Measuring solids · Writing results`.
- `releases the source and publishes NOTHING when cancelled mid-read` — the measure statement is gated, Cancel
  lands while it is pending: status `cancelled`, the source name dropped, no `ALTER TABLE`, no model attribute, no
  provenance, `undoable: false`, and a NEXT run submitted afterwards reaches `done` (the FIFO moved on).
- `releases the source and publishes NOTHING when the engine dies mid-read` — same gate, `killEngine()` while the
  statement can never settle: status `failed` with "Analytics engine stopped", the source dropped (the release is
  itself death-raced, so it settles rather than stranding the queue), nothing published, and after
  `reviveEngine()` the next run reaches `done`.

MUTATION — removing the executor's `finally { await handle.release(); }`:

```
   × releases the source and publishes NOTHING when cancelled mid-read
   × releases the source and publishes NOTHING when the engine dies mid-read
      Tests  2 failed | 1 passed (3)
```

### Verification

```
$ npx vitest run tests/unit/features/processing/measureSolids.test.ts     → 37 passed
$ npx vitest run tests/unit/features/processing/measureSolidsRun.test.ts  → 3 passed
$ npx vitest run tests/unit/features/processing tests/unit/ui/processing  → 30 files, 399 passed
$ npx tsc -b --noEmit                                                     → clean
$ npx vp check                                                            → 0 errors, 56 warnings
$ (npx vitest run > /tmp/m3-task7-fix1-suite.log 2>&1 & wait $!; echo "suite: $?")
suite: 0 — Test Files 251 passed | 4 skipped (255); Tests 3128 passed | 70 skipped (3198)
```

### Not changed (second Minor, explicitly parked by the reviewer)

The unbounded contributor `IN (…)` on scope "all" stays as it is — the reviewer's own note keeps it as the
commander's large-layer smoke item, and narrowing it would mean either a second statement shape or the
`ids: null` widening that requirement 2's pinned `MEASURE_SQL` rules out.
