# Task 16 — Join attributes by location — report

Branch `develop`, base `f256428`, five commits (no trailers, not pushed):

- `704af4c` feat: Join attributes by location copies area attributes onto buildings
- `ec7485b` test: a cancelled or engine-killed Join releases its reader and its vector table
- `8f77a22` test: the join statement's predicates and tie rules against a real DuckDB
- `8db5d98` test: the Join form runs against the real registry entry now that it ships
- `b208f1b` docs: the catalogue's outranking comments stop saying every spatial tool is unimplemented

## Implemented

`src/features/processing/tools/joinByLocation.ts` (new):

- `buildJoinSql(input)` — ONE statement, per FEATURE: `b` (`buildFeatureProxySql`'s
  `(f, g)`), `j` (LEFT JOIN to `__src_<runId>` under the predicate, carrying
  `ST_Area(ST_Intersection(…))` only when the tie rule needs it), `r`
  (`ROW_NUMBER() OVER (PARTITION BY "f" ORDER BY …)` + `COUNT("idx") OVER
(PARTITION BY "f")`), `m` (`rn = 1`), then back to the table's rows by
  `COALESCE(t."feature_id", t."id") = m."f"` so root and parts carry the
  feature's answer. `within` → `ST_CoveredBy`; `intersects` and `centreWithin` →
  `ST_Intersects`; `centreWithin` FORCES the centre proxy and drops the reader
  clause entirely. Copied fields: `m."props"->>'k'` for VARCHAR (and therefore
  the JSON text of a nested object), `TRY_CAST(… AS DOUBLE|BOOLEAN)` otherwise.
  `<prefix>matches_n` is `CASE WHEN m."no_proxy" THEN NULL ELSE m."matches_n" END`.
  The frozen ids restrict BOTH relations.
- `joinByLocation: ToolExecutor` — refuses a non-vector source with §5's own
  sentence; re-validates the frozen `fields` against `source.propertyKeys`
  (every LIVE feature's keys, kept and skipped alike) with §6.1's sentence;
  opens `readSource` for the footprint proxy under `ctx.phase("source")` and
  releases it as soon as the parse is done AND in a `finally`; issues the
  scope-rows + reader-ids statements and `assertSourceIds` BEFORE the compute on
  that path only; rolls the per-ROW result up per FEATURE key `f`; writes NULL
  for no proxy and 0 for no match; batches of `JOIN_BATCH_ROWS` (500) with a
  macrotask yield and `throwIfCancelled`; returns `line` = "<n> buildings
  joined" and the caveat `{cause: "outside every area", count}`, `skipped` =
  `{cause: "no geometry", count}`.
- `registerExecutor("join-by-location", joinByLocation)`; `tools/register.ts`
  imports it.

`src/features/processing/toolRegistry.ts`: `implemented: true` for
`join-by-location` in the executor's own commit, with §7.5's Style by result as
the milestone's first FUNCTION-form descriptor — `operator` and `value` are
functions of the picked column (`=` + `mostFrequent` on a VARCHAR, `>` + a
literal `0` on `<prefix>matches_n`), `pick` prefers the first copied VARCHAR and
falls back to a case-insensitive `…matches_n`. No change to `types.ts`,
`RunFooter.tsx` or any resolver.

## Tested + results

- `tests/unit/features/processing/joinByLocation.test.ts` (new, 28 cases): the
  SQL text (six cases) and the executor over a fake `ToolContext` (22), with the
  REAL `readerQuery`/`assertSourceIds` (only `readSource` stubbed).
- `tests/unit/features/processing/joinByLocationRun.test.ts` (new, 5 cases): the
  real executor on the real queue and the real table FIFO — the happy path's
  publication and card line, a Cancel and an engine DEATH under the held join
  statement, and §6.1's id-join failure; each asserting both handles dropped,
  `DROP TABLE IF EXISTS "__src_<id>"`, no `BEGIN`/`ALTER TABLE`, and a free FIFO.
- `tests/integration/duckdb/crossLayer.test.ts` (+6 cases, 29 total): the
  builder's own statement text against real DuckDB 1.5.5.
- Migrations: `register.test.ts` (EXECUTORS pin), `eligibility.test.ts` (the two
  Join cases now use the REAL entry, plus a new "accepts the real Join entry"
  case), `CatalogueView.test.tsx` (the row's real reason), `styleByResult.test.tsx`
  (synthetic mock retired, direct case's second half, two end-to-end footer
  cases), `useToolForm.test.tsx` (Join leaves the patched set).

Results:

```
npx vitest run tests/unit/features/processing tests/unit/ui/processing
  → 42 files, 672 passed | 1 todo
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
  → 29 passed
npx vitest run > /tmp/m3-task16-suite.log 2>&1   (background, waited; re-run
  after the last commit)
  → suite: 0 — 263 files passed | 4 skipped; 3405 passed | 84 skipped | 1 todo
npx vp check → 0 errors and 56 warnings   (baseline)
npx tsc -b --noEmit → clean
```

## TDD evidence

**Probe first (the brief's own open question).** The degenerate-extent case was
appended and run BEFORE any executor code, because a raise there would have
moved the fix into `buildingProxy.ts`:

```
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts -t "DEGENERATE"
  → Tests 1 passed | 23 skipped
```

`ST_MakeEnvelope(5,5,5,5)` parses, has area 0 and answers both predicates true —
so no change to the rectangle branch was needed.

**RED.** `joinByLocation.test.ts` written first:

```
npx vitest run tests/unit/features/processing/joinByLocation.test.ts
 FAIL  Failed to resolve import ".../src/features/processing/tools/joinByLocation"
 Test Files  1 failed (1) | Tests  no tests
```

**GREEN** after the executor: `Tests 28 passed (28)` (one intermediate failure,
`released` = ["run_1","run_1"], was the test STUB not being idempotent as the
real handle is — fixed in the stub, not in the executor).

**RED → GREEN on the run suite.** First run: `1 failed` — `"0 buildings joined ·
1 outside every area"`. The defect was in the new suite's engine mock (its
`includes("COUNT(")` branch answered the join statement's own windowed
`COUNT("idx")` with a row count); fixed by ordering the `WITH b AS (` branch
first. `Tests 5 passed (5)`.

**RED → GREEN on the engine suite.** First run of the six new cases: `3 failed`
— `Binder Error: Cannot mix values of type INTEGER and VARCHAR in COALESCE` —
because a `VALUES` fixture whose `feature_id` is NULL on every row infers
INTEGER (a real browsing table's column is VARCHAR). Fixed with `NULL::VARCHAR`
in the fixtures. `Tests 29 passed (29)`.

**RED → GREEN on `styleByResult.test.tsx`.** After the registry flip the direct
case failed on `expect(descriptor.pick([count])).toBeNull()` — the exact
assertion Task 9 left for this task — and was replaced by §7.5's other half.

## Files changed

- `src/features/processing/tools/joinByLocation.ts` (new)
- `src/features/processing/tools/register.ts`
- `src/features/processing/toolRegistry.ts`
- `tests/unit/features/processing/joinByLocation.test.ts` (new)
- `tests/unit/features/processing/joinByLocationRun.test.ts` (new)
- `tests/unit/features/processing/register.test.ts`
- `tests/unit/features/processing/eligibility.test.ts`
- `tests/unit/ui/processing/CatalogueView.test.tsx`
- `tests/unit/ui/processing/styleByResult.test.tsx`
- `tests/unit/ui/processing/useToolForm.test.tsx`
- `tests/integration/duckdb/crossLayer.test.ts`
- `src/ui/processing/CatalogueView.tsx` (comments only)
- `tests/unit/ui/processing/extensionChip.test.tsx` (comment + one new case)

## How each controller requirement was met

1. **Scope-wide source identity (B1 + ruling).** On the footprint path only, the
   executor reads its OWN scope rows off the table
   (`buildScopeRowsSql(ctx.table.table, ctx.featureIds)` — Task 7's spelling,
   imported rather than re-written) and the reader's ids
   (`buildSourceIdsSql`), and calls `assertSourceIds(scopeIds, readerIds)`
   BEFORE the compute — never `ctx.featureIds`, and never off the join's own
   result. Six parameterised cases: a missing ROOT and a missing PART under All
   (`featureIds: null`), Selected and Matching, each asserting
   `SOURCE_IDS_DIFFER` through the REAL `assertSourceIds` and that the join
   statement never ran. Plus the end-to-end case in `joinByLocationRun.test.ts`.
   The two bbox proxies read the browsing table only — there is no re-read whose
   identity could differ — so they issue neither statement and call neither
   door; asserted ("leaves both doors alone…", `sql` has length 1) and stated in
   the module comment.
2. **B7.** The frozen-field check reads `source.propertyKeys`, which Task 12
   builds from EVERY live feature's properties, kept or skipped. Two cases: a
   field carried only by a SKIPPED feature (built through the real
   `reprojectGeoLayer`, `preflight.skipped === 1`) runs normally; a field that
   truly disappeared fails with §6.1's sentence verbatim, "Layer changed while
   running; run again", with no statement sent.
3. **B9 + ruling.** `within` is `ST_CoveredBy`; the engine case that demonstrates
   the distinction uses a BOUNDARY POINT — the centre proxy at (50, 50), interior
   to A and exactly on B's edge — where the builder's statement answers
   `matches_n = 2` (winner A, by `idx`) and a raw `ST_Within` answers 1. No
   polygon pair is asserted anywhere. `centreWithin` forces the centre proxy
   (unit-tested on the text: `ST_Point(` present, `read_cityjson(`/`ST_GeomFromWKB(`
   absent) and the engine case runs the forced statement and gets the same rows.
4. **Multi-match.** `first` → `ORDER BY "idx" ASC NULLS LAST`; `largestOverlap` →
   `ORDER BY "overlap" DESC NULLS LAST, "idx" ASC NULLS LAST` (engine-pinned:
   700 vs 600 picks B; 600 vs 600 picks A); `countOnly` writes no fields and the
   count is forced on by `joinParams`. `matches_n` = 0 for no match, NULL for
   `g IS NULL` (Task 14's one no-proxy signal — no second `ST_IsEmpty` opinion).
   Types from the FROZEN `fieldTypes`; a nested object comes back as JSON text
   and a non-numeric value under a DOUBLE column comes back NULL rather than
   failing the statement (both engine-pinned). Evaluated once per feature and
   copied to the part's row (engine-pinned on `B1`/`B1P` and `P1`/`P1-0`).
5. **Card + Style by result.** `line` = `"<n> buildings joined"` (`toLocaleString`,
   so 1,143), one caveat `{cause: "outside every area", count}`, skipped
   `{cause: "no geometry", count}`; `summarise` renders
   "1 building joined · 1 outside every area · 0.0 s" (asserted through the real
   queue). The descriptor is the function form; Task 9's synthetic
   `distance-to-nearest` mock is RETIRED and both halves now run through the real
   footer on Join — the `mostFrequent` case Task 9 deferred (asserting
   `buildMostFrequentSql`'s own statement) and the `matches_n > 0` case (no query
   at all).
6. **The flip.** `implemented: true` lands in the same commit as the executor and
   the descriptor; Join has no LoD field (`needsLod: false`), so `useLodOptions`
   is untouched. The catalogue row's reasons are pinned against the REAL entry
   (`Add a vector layer to join with` as the row's title and second line in
   `CatalogueView.test.tsx`; the same sentence and the `spatial` download reason
   in `eligibility.test.ts`, plus an `ok: true` case), the EXECUTORS list is
   pinned in `register.test.ts`, and `crossLayer.test.ts` runs the BUILDER's text
   under `DUCKDB_INTEGRATION=1`. `useToolForm.test.tsx` no longer patches Join's
   `implemented`, so its form and readiness reasons come from the real registry.
7. **Cleanup, cancel and death.** The reader handle is released in a `finally` on
   every exit (and eagerly once the parse is done — the stub is idempotent like
   the real handle); the vector table is the queue's `finally`, exercised here.
   `joinByLocationRun.test.ts` drives the REAL executor through the real queue
   for a Cancel and an engine death under a held join statement, asserting both
   VFS names dropped, the `DROP TABLE`, no write transaction and a free FIFO.
   Every `vi.mock(".../insights/duckdb")` factory written here carries the full
   export list its module graph reads.

## Deviations from the brief (the requirements won)

- **Identity.** The brief's executor called
  `assertSourceIds(ctx.featureIds ?? [], <ids from the join result>)`, which is
  vacuous on scope "all" and reads ids back through the browsing-table join.
  Replaced by the scope-rows + reader-ids pair before the compute (residual B1
  and the commander's ruling); the brief's two mock-call assertions became real
  behavioural ones.
- **Mocks.** The brief mocked `readerQuery`/`assertSourceIds` wholesale; this
  suite `importActual`s them and wraps them in delegating spies
  (`measureSolids.test.ts`'s precedent), so §6.1's sentence is what the cases
  assert.
- **Engine test.** The brief's `within` case used a polygon pair with
  `within: false`, which is wrong on DuckDB 1.5.5 (B9). Replaced by the boundary
  point, and the degenerate-extent case was kept and run first.
- **`mostFrequent` statement.** The brief's Step 4b expected `mode("zones_name")`;
  `buildMostFrequentSql` has emitted the deterministic
  `SELECT "v" AS m FROM (… GROUP BY "v") ORDER BY "n" DESC, "v" ASC LIMIT 1`
  form since Task 9's fix round. The real text is asserted.
- **`JOIN_BATCH_ROWS`.** 500, not the brief's 5000 — the Global Constraint's
  batch size, and the same as every other executor here.
- **Extra file.** `joinByLocationRun.test.ts` is not in the brief's file list; it
  is requirement 7's "cancel and death through the real executor and queue".
- **`columns`** come from `joinColumns(run.prefix, params)` rather than being
  rebuilt in the executor, so the executor and the registry cannot disagree
  about what the frozen request promised.

## Self-review

- The three statements are labelled "Reading features", "Checking source ids" and
  "Joining attributes" — the first two are Task 7's own labels, so §6.4's log
  reads the same for a footprint join as for a solids run.
- `buildScopeRowsSql`/`buildSourceIdsSql` are imported from `solidSql.ts`. That
  module is named for the solids tools but both builders are generic and pure
  (its own doc calls the second one "spec §6.1's id join"), and a second spelling
  is exactly the drift the round-2 review flagged. Worth a rename to something
  neutral in a later sweep; not this task's file.
- `ctx.phase("compute")` is called even when no reader was opened. It is a no-op
  in practice (the queue already put a vector-source run in `compute` before the
  executor ran) and it keeps the phase honest if that ever changes.
- A run whose statement returns no rows returns an empty map; the queue's own
  "nothing to write" branch handles it as a done run with no Undo.

## Concerns / notes for the commander

- **`resolveCrossLayerParams` does not yet force the centre proxy for "centre
  within"** — that is Task 15's fix round (its review item 2). The SQL builder
  forces it, so a frozen bag that still says `footprint` computes the CORRECT
  centre join; until Task 15's fix lands, §6.4's log line ("building geometry")
  would name the footprint for such a run, and the workload note may be shown.
  Nothing here depends on the outcome; when it lands, `needsReader` in the
  executor (`proxy === "footprint" && predicate !== "centreWithin"`) simply stops
  being reachable by its second conjunct.
- **Task 17 should reuse this identity shape**, not the `ctx.featureIds ?? []`
  one in its brief (the same residual B1 applies to it verbatim).
- **`largestOverlap` + `centreWithin` is not refused by `crossLayerParamsError`.**
  It refuses `largestOverlap` + `proxy: "centre"`, but a bag carrying
  `predicate: "centreWithin"` with a footprint or rectangle proxy passes. The
  builder forces the centre, so `ST_Area(ST_Intersection(point, area))` is 0 for
  every area and the tie collapses to `idx` — correct behaviour, not a crash,
  but the log says "largest overlap" while the run behaved as "first". Task 15's
  fix round item 2 (which makes "centre within" force the proxy in the displayed
  and frozen params) is the place to refuse it; both halves belong in one fix.
- The unbounded `IN` list on a Selected/Matching scope (Task 7's parked concern
  (c)) applies here too: the frozen ids reach three relations. Same park.
- Two comments that claimed "every spatial tool is `implemented: false`" were
  falsified by the flip (`CatalogueView.tsx`'s `ToolRow`, `extensionChip.test.tsx`);
  both corrected in `b208f1b`, with the case the old comment promised: Join's row
  now carries §5's download sentence while Aggregate's still carries the release
  note.

---

## Fix round 1 (review: Needs fixes)

Base for this round: `98f1388` (Task 15's fix round, which landed after the
commits above — validation now refuses `largestOverlap` + `centreWithin` and the
form forces the centre proxy, so this report's first concern is closed by it).

Two commits (no trailers, not pushed):

- `b9faf0c` fix: the write reads the values file at the columns' declared types
- `5028433` test: count only forces the match count on from a bag that had it off

### Important — the values file is read at its DECLARED types (finding D9)

`writeComputedColumns` handed the UPDATE an untyped `read_json_auto`, so the
publication's types were INFERRED from a document the writer had just built.
Reproduced on this checkout's real engine BEFORE the fix, with the old builder
and 20,480 NULLs ahead of the value:

```
- Expected                     + Received
  { id: "b20480", zones_name: "" }     → zones_name: "\"\""
  { id: "b20481", zones_name: "Centrum" } → zones_name: "\"Centrum\""
```

i.e. worse than the review described: a NON-empty string is quoted too, because
`read_json_auto` infers `JSON` for a column that is NULL through the whole
20,480-row sample and a JSON-typed value renders with its quotes.

The fix: `buildUpdateFromValuesSql(table, valuesFile, columns: OutputColumn[])`
emits

```
UPDATE "layer_1" SET "a" = v."a", "b" = v."b"
FROM read_json('__vals_r1.json', columns = {"id": 'VARCHAR', "a": 'DOUBLE', "b": 'VARCHAR'}) AS v
WHERE "layer_1"."id" = v."id"
```

— the run's own `OutputColumn[]`, which `writeComputedColumns` already holds, so
inference decides nothing. `"id"` is declared as well (it is the join key, and a
file of numeric-looking ids would otherwise be inferred as numbers and match
nothing). Struct keys go through `quoteIdent`, so a column name carrying a
quotation mark cannot end the key.

Tests:

- `tests/unit/insights/computedColumns.test.ts`: the builder's exact string, plus
  a new case for a name that needs quoting in the `columns=` list.
- `tests/integration/duckdb/computedColumns.test.ts`, new `probe 6: the write
preserves the DECLARED column types` (4 cases): text first appearing past the
  sample (empty string and `Centrum`) stored unquoted with the 20,480 NULLs still
  NULL; an early empty string, a quote-bearing string and a JSON-object string
  stored as themselves; DOUBLE and BOOLEAN past the sample; a column name that
  needs quoting. The four existing call sites were migrated to `OutputColumn[]`.

**What the engine now does with the old probes (all still green, 19/19).** The
`read_json_auto` inference facts are unchanged and still pinned (`JSON` for an
all-NULL column, `VARCHAR` for the replacer's BigInt string, `DOUBLE` past the
sample, `BIGINT` for whole numbers) — the DESCRIBE helper still asks
`read_json_auto`. What changed is that the WRITE no longer depends on them, and
the typed read produces the same values in every one of those cases:

- (a) all-NULL → NULL, (a-big) the same past the sample;
- (a-late) a double just past an all-NULL sample → 12.5, written;
- (b) the replacer's `12345678901234567890n` as a JSON STRING still casts into
  DOUBLE under `columns={… 'DOUBLE'}` — `12345678901234567000`, and `42n` → 42;
  (b-big) the same past the sample. So the typed read did NOT break the
  BigInt-string behaviour the M1 facts describe;
- (c) whole numbers → 12 and 7.

Probe 2's header now says that the two halves came apart at D9 (the inference is
still pinned, the write no longer depends on it), and my new block is `probe 6`
because Task 9 had already added a `probe 5`.

### Minor — count only FORCES the match count on

`joinByLocation.test.ts`'s count-only case now starts from
`{ tie: "countOnly", writeMatchCount: false }` with both fields still ticked, and
asserts the run writes `zones_matches_n` (column, value 2 and the `AS
"zones_matches_n"` projection) and no field column.

### Verification

```
npx vitest run tests/unit/insights tests/unit/features/processing → 807 passed | 1 todo
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb → 4 files, 88 passed
npx vitest run > /tmp/m3-task16-fix1-suite.log 2>&1  (background, waited)
  → suite: 0 — 263 files passed | 4 skipped; 3425 passed | 88 skipped | 1 todo
npx vp check → 0 errors and 56 warnings   (baseline)
npx tsc -b --noEmit → clean
```

### Notes

- `buildUpdateFromValuesSql` is exported and its signature changed; the only
  callers are `writeComputedColumns` and the two test suites above, all migrated.
- The values file is a JSON ARRAY (not NDJSON) and `read_json` with an explicit
  `columns=` and no `format=` reads it — verified by every probe in the suite.
- Task 15's fix round closed this report's `largestOverlap` + `centreWithin`
  concern; the remaining note for the commander is Task 17's identity shape.
