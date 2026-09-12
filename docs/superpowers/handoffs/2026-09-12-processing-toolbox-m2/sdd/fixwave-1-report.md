# M2 fix wave 1 — report

Branch `develop`, seven commits on top of 819309c. No push. Every line number below is
post-fix (`git show <sha>` for the exact hunks).

| #   | commit    | subject                                                                               |
| --- | --------- | ------------------------------------------------------------------------------------- |
| 0   | `7f8f9c4` | `refactor:` the abort+death race moves to `insights/engineAwait.ts`                   |
| 1   | `28d4408` | `fix(insights):` a table build's engine awaits race the engine's death (F1, T1)       |
| 2   | `2cd5d4f` | `fix(insights):` an offline boot says the lazy extensions cannot be fetched (F2, T2)  |
| 3   | `be62e2a` | `fix(processing):` the Style-by-result median is taken over root rows only (F3)       |
| 4   | `eb776f1` | `test:` the resident-set run, the batch yield and the 0-degree threshold (T3, T4, T5) |
| 5   | `b603112` | `docs:` the roadmap's carried-forward list after fix wave 1 (T6)                      |
| 6   | `af22992` | `fix(insights):` `retryEngine` keeps its own unraced boot wait (follow-up to F1)      |

---

## F1 (MAJOR) — build/cleanup awaits never raced engine death

**The hoist (`7f8f9c4`).** New `src/insights/engineAwait.ts` (108 lines): `EngineDeadError`,
`CancelledError`, `raced(promise, signal | null)` and `racedWithDeath(promise)` — the body is
`runQueue.ts`'s verbatim. `runQueue.ts:40-44` imports the three it used to declare; its
`onEngineDeath` import is gone (nothing else there used it — the run-failing watcher is on
`subscribeDuckDBStatus`). Two comment casualties cleaned up in the same commit: the orphaned
`raced` doc block that had been separated from its function, and the
"`CancelledError` is private to this module on purpose" claim in `ToolContext.throwIfCancelled`
(`runQueue.ts:117-120`), now stated as "not reachable from an executor", which is the property
that actually matters and is still true.

**The fix (`28d4408`).**

- `src/insights/layerTables.ts:34-43` imports the four primitives and the boot ALIASED
  (`ddl as sendDdl`, …, `initDuckDB as bootEngine`) plus `EngineDeadError`/`racedWithDeath`.
- `layerTables.ts:65-97` re-declares `runQuery`, `ddl`, `registerBuffer`, `dropBuffer` and
  `initDuckDB` as local wrappers over `racedWithDeath`. Shadowing the names, rather than editing
  14 call sites, is what makes it impossible to reach an unraced primitive from this module —
  now or in a later change. Covered by that one move: `refreshLayerTableColumns`' DESCRIBE,
  `countRows`, `releaseBuffer`, both builders' register/CREATE/ALTER/DESCRIBE, `discardHalfBuilt`'s
  DROP and releases, and `retire`.
- `layerTables.ts:965-…` — the queued task's body is extracted as `const build = async (): Promise<LayerTableOutcome> => {…}`
  (same indentation, so the diff is the two boundary lines) and the task is now
  `try { return await build(); } catch (e) { if (e instanceof EngineDeadError) return abandon(); throw e; }`.
  Two awaits need that outer guard rather than the build's own catch: the `initDuckDB` wait, which
  sits before the inner `try`, and the cleanup INSIDE the inner catch (`discardHalfBuilt`).
  Everything else lands in the inner catch, whose first line is already `if (engineGone()) return abandon()`.
- `layerTables.ts:1247-1262` — `dropLayerTable`'s queued task catches `EngineDeadError` around
  `retire(info)`: a corpse answers no DROP, and the store still has to be cleared by the code below it.
- `runQueue`'s now-redundant `raced(refreshLayerTableColumns(...), null)` is left alone — it is
  correct either way.
- **Follow-up `af22992`**: shadowing the names module-wide had also caught `retryEngine`'s
  `await initDuckDB()`. Both of its callers are `void retryEngine()` (`App.tsx:918,940`), so a death
  during a Retry's boot would have become an UNHANDLED rejection, and the hard rule says that
  function is unchanged. `layerTables.ts:735-742` now awaits the unwrapped `bootEngine()` there.
  Nothing is lost: a release at that await frees no queue, and every build the retry starts is raced
  on its own inside the FIFO. Caught by a post-hoc audit of what the shadowing reached, not by a
  test — worth noting, since no suite would have failed on it (an unhandled rejection in a `void`
  call is a browser-console fact).

**Why the one-shot death listener is enough** (load-bearing, verified in `duckdb.ts`): a `raced`
started AFTER the death hears nothing, but every primitive answers immediately once the engine is
gone — `markEngineDead` nulls `db`/`conn` and publishes `failed`, so `runQuery`/`ddl` return
"not running" (`duckdb.ts:637-639`), `registerBuffer` returns false (`:681`) and `dropBuffer`
returns on `!db` (`:695`). The hazard is only ever the await already in flight.

**Test (T1) — `tests/unit/insights/layerTablesBuild.test.ts:1161`**, "releases a build whose
statement NEVER settles, and the queue behind it": `holdStatement` on
`CREATE OR REPLACE TABLE` with a promise that is **never resolved** (every pre-existing death case
resolves the held request by hand, which is the one thing a real engine never does — that is
exactly the masking Codex found). A second build for `L2` is enqueued BEFORE the death so it is
genuinely stuck behind the stranded one. Asserts: the first build resolves
`{ok: false, message: "Analytics engine stopped"}`; the entry is `failed` with that message; the
registry is empty; `sql.slice(issued)` is `[]` (no cleanup SQL — the VFS release goes to `dropped`,
which is not SQL); and `L2` settles.

- **RED**: `Error: Test timed out in 5000ms` — the FIFO hang itself, not an assertion.
- **GREEN**: 52/52 in that file, 70/70 with `layerTablesQueue`. All ten pre-existing death cases
  (queued-at-death, died-during-cleanup, died-during-init, engine-REPLACED, removal-owns-the-entry)
  still pass unchanged: their paths now reject at the race instead of at `held.resolve()`, and
  their final states are identical.

## F2 (MAJOR) — offline boot left the lazy extensions "unloaded"

**Fix (`2cd5d4f`) — `src/insights/duckdb.ts`.** `downloadFailure(name)` (`:313-315`) spells §5's
sentence, the same one `CatalogueView.chipTitle` and `eligibility.ts` show;
`failLazyExtensionsIfOffline()` (`:336-345`) marks `spatial` and `three_d`
`{state: "failed", error: downloadFailure(name)}` when `typeof navigator !== "undefined" && navigator.onLine === false`,
and only for extensions still `unloaded`. Called from `doInit` at `:444-446`, after the last
`stale()` check and immediately BEFORE `publishReady()`, so the first `ready` status the panel
renders already carries the reason. `navigator.onLine` is advisory and trustworthy in one direction
only, so only `false` acts; the field is `error` (not `reason` — the brief's word; `ExtensionStatus`
has `error`). No change to `loadExtension`/`ensureExtension` and none to
`runQueue.extensionFailure`: Retry offline fails again and records DuckDB's own message, while the
sentence the user reads is derived from `state === "failed"` either way. No `online`-event
auto-clear — Retry is the door.

**Tests (T2) — `tests/unit/ui/processing/extensionChip.test.tsx`**, on the existing
package-level `@duckdb/duckdb-wasm` fake + `vi.resetModules` graph (so every state asserted was
really published by `duckdb.ts` and delivered by `useDuckDBStatus`). `goOffline()` uses
`vi.spyOn(Navigator.prototype, "onLine", "get")`, restored by the suite's `restoreAllMocks`.

- `:236` "mutes BOTH lazy chips when the engine boots OFFLINE": both chips `data-state="failed"`
  with their §5 sentences; 3 Retry links for `spatial`, 2 for `three_d`; the recorded
  `status.extensions.{spatial,three_d}` equal `{state: "failed", error: <sentence>}`; and
  "Roof metrics to attributes" and "Height from extent" still render `aria-disabled="false"`.
- `:281` "recovers an offline boot's extension only when Retry asks": the network coming back
  changes nothing on the panel; the Retry click really loads through `ensureExtension` and the chip
  follows to "The spatial extension is loaded"; `three_d` is untouched.
- **RED**: `data-state` was `"unloaded"` (case 1) and `expected [] to have a length of 3` (case 2).
- **GREEN**: 8/8 in that file; `tests/unit/insights` + `tests/unit/ui` 1140/1140.
- The "onLine true → unchanged" baseline is the pre-existing first case ("offers the loading cost
  while the extension is unloaded"), which still passes untouched.

## F3 (MAJOR) — the Style-by-result median included part rows

**Verification of the root convention, before writing the WHERE.** `layerRows.ts:162,183` writes
`feature_id: rootFeatureId(id, parents)`, which for a root is its own id; the reader's schema is the
same by design (`docs/…duckdb-integration-design.md:68`: "`feature_id` is the root object of the
feature (a part carries its Building's id)"), and `sql.ts`'s own idiom allows a NULL
(`COALESCE("feature_id","id")`). Decisive: `tools/heightFromExtent.ts:90-93` — "The root is the row
whose id IS its feature id (`buildExtentSql` reads `COALESCE("feature_id","id")`, so a root answers
with itself)". That is the test that decided WHICH rows got the value, so it is the test the median
has to use. (`"parents" IS NULL` is equivalent in practice but is not that rule, so it was not used.)

**Fix (`be62e2a`).** `src/insights/sql.ts:420-441` adds `buildMedianSql(table, column)` —
`SELECT median("<col>") AS m FROM "<table>" WHERE "feature_id" IS NULL OR "feature_id" = "id"` —
where every other SQL string in this app lives and is pinned by exact strings.
`src/ui/processing/RunFooter.tsx:52` calls it (the inline `quoteIdent` spelling and that import are gone).

**Tests.**

- `tests/unit/insights/sqlQuery.test.ts:188-200` — exact string, plus an identifier-quoting case.
  RED: `TypeError: buildMedianSql is not a function`. GREEN: 24/24.
- `tests/unit/ui/processing/ToolView.test.tsx:553` — the pinned call, now with the WHERE. RED
  (verified by `git stash push`ing only `RunFooter.tsx` and re-running):
  `expected "vi.fn()" to be called with arguments: [ Array(1) ]`. GREEN: 36/36.
- `tests/integration/duckdb/computedColumns.test.ts:551-578` — "probe 4", against **real DuckDB
  1.5.5**: one table with two measured buildings (10 and 2) where the first has three parts, so the
  rows read 10,10,10,10,2. `median(...)` over every row returns **10** (the bigger building's own
  value, offered as the threshold meant to split them); `buildMedianSql(...)` returns **6**. Both
  `feature_id` spellings are in that table (a part carrying its root's id, and a root carrying
  NULL), so both branches of the predicate are exercised. Run with
  `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/computedColumns.test.ts` → 11/11.
  The first assertion IS the old behaviour, so the probe is its own RED/GREEN pair.
  **New engine fact worth keeping**: an uncast `10.0` literal infers DECIMAL, and `median()` over a
  DECIMAL comes back from the node bindings as a raw `Uint32Array` rather than a number — the probe
  casts to DOUBLE, which is what `writeComputedColumns` declares anyway.

## T3 (MAJOR, new) — a real FCB resident-set run

`tests/unit/features/processing/roofMetricsRun.test.ts`. Scaffolding: the `residentModel` stub is now
driven by a settable `residentObjects` (`:77-92`), the duckdb mock's `registerBuffer` decodes and
keeps the values-file rows (`writtenRows`, `:28-36` / `:160-166`), and there are
`residentRecord(...)` / `streamingLayer()` helpers (`:348-402`) building genuine
`ResidentObjectRecord`s — LoD-tagged `roofMetrics` from the worker plus `geometryLods`.

- `:706` "measures a STREAMING layer from its resident set, root and parts": `isStreaming: true`
  with `model.objects === {}`; SB1 (own 99 m² roof) + SP1 (30 m² at 10°) + SP2 (10 m² flat).
  Asserts the rows the run wrote for all three ids — SB1 = 40/10/2 (its PARTS' sum, not its own
  roof: §7's contributor rule over this path), SP1 = 30/0/1, SP2 = 10/10/1 — that the table is where
  a streaming run publishes (the model stub has no object for `mergeAttributes`), `summary.measured === 1`
  with a `1 building measured · ` line, `summary.detail` = "Over the resident set: the buildings
  loaded when the run started.", and `measuredSurfaces === 0` (no main-thread triangulation).
- `:786` "marks a STREAMING run stale when the next settle rebuilds the table": a real streaming run
  (not a static model with a hand-edited entry), then a rebuilt table under a new name →
  `stale === true`, `undoable === false`. The copy "stale: layer reloaded" is rendered from that flag
  alone and is pinned in `RecentRuns.test.tsx:144` and `ToolView.test.tsx:685,790`; asserting the
  flag here avoids importing a React panel into a feature test (noted as a deviation from the
  addendum's literal wording).
- Behaviour was already correct, so **mutation checks** instead of RED: (a) `roofGeometrySource`'s
  `if (layer.isStreaming)` → `if (false)` fails the first case only; (b) `summarise`'s
  `if (options.streaming)` → `if (!options.streaming)` fails it too; (c) `patch(run.id, {stale: true, undoable: false})`
  → `{stale: true}` fails the second case (and the pre-existing static one). All reverted; GREEN 9/9.

## T4 (minor) — cancellation at the batch boundary, as a macrotask

`roofMetricsRun.test.ts:600` "stops at the next batch when the Cancel lands in the batch's own
yield": the measurement spy schedules `cancelRun` with `setTimeout(…, 0)` at the first batch
boundary, so it lands INSIDE the executor's own `setTimeout(0)` yield — where a user's click lands.
Asserts `measuredSurfaces === ROOF_BATCH_FEATURES` (the second batch never starts), no attribute,
no provenance, no `BEGIN TRANSACTION`. **Mutation check**: swapping `roofMetrics.ts`'s
`await new Promise(setTimeout…)` and `ctx.throwIfCancelled()` fails the new case and leaves the
pre-existing synchronous one passing — which is precisely the gap. Reverted; GREEN.

## T5 (minor) — the threshold's other half

`tests/unit/domain/roofRollUp.test.ts`. The AT-threshold case now also asserts
`azimuthDeg === 90` (a non-flat surface is a candidate for the dominant azimuth — the half flat
area cannot see), and a new case takes a horizontal roof at threshold 0: `flatM2 === 0`,
`flatShare === 0`, `azimuthDeg === 135` (the larger of the two horizontal surfaces), plus the same
roof at threshold 5 for contrast (`flatM2 === 16`, `azimuthDeg === null`). **Mutation check**:
`inclinationDeg < flatThresholdDeg` → `<=` fails both cases. Reverted; GREEN 9/9.

## T6 (docs)

`docs/roadmap.md`: the median line is struck through and recorded as fixed at the M2 gate with the
predicate and both tests; the extension line now says the muted chip and Retry ARE reachable (an
offline boot, scenario 6) and that only the extension-failure RUN copy is not. Also corrected — a
third claim the fixes falsified — the death-path line, which listed "a table build whose statement
is in flight at the death still holds the table FIFO" as one of three gaps; it now reads as two
gaps (`runQuery` callers outside the queue and the builds; `retryEngine`'s missing generation check)
and names `insights/engineAwait.ts`. Flagged below, since only two lines were assigned.

---

## Final counts

- `npx tsc -b --noEmit` — clean (no output).
- `npx vp check` — **0 errors, 56 warnings** in 529 files (baseline held; one new warning,
  `.sort()` without a comparator in the T3 test, was fixed rather than banked).
- Full suite (`npx vp test run`, background, log at
  `…/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/fullsuite.log`, and re-run after `af22992` as
  `fullsuite2.log` with the same numbers):
  **243 files passed | 2 skipped (245); 2983 tests passed | 32 skipped (3015)**, 63.8 s. The two
  skipped files are the opt-in `DUCKDB_INTEGRATION` suites. +9 tests over the 2974 baseline: 1 (F1)
  - 2 (F2) + 2 exact-string + 2 (T3) + 1 (T4) + 1 (T5). Focused runs along the way:
    `tests/unit/insights` + `tests/unit/features/processing` + `tests/unit/ui/processing` 570/570,
    `tests/unit/insights` + `tests/unit/ui` 1140/1140, `runQueue` 55/55, `roofMetricsRun` 9/9,
    `roofRollUp` 9/9, `layerTablesBuild`+`layerTablesQueue` 70/70, `sqlQuery` 24/24,
    `extensionChip` 8/8, `ToolView` 36/36, and `DUCKDB_INTEGRATION=1 tests/integration/duckdb/computedColumns` 11/11.
- Mock-contract audit (the hoist made `engineAwait` a new transitive importer of
  `insights/duckdb`): `grep -rL onEngineDeath $(grep -rl 'vi.mock(.*insights/duckdb' tests/)` is
  EMPTY — every duckdb mock in the suite already exports it.
- Pre-push hook ran on nothing (no push, as instructed); pre-commit `vp staged` ran on all six commits.

## Files changed

Source:

- `src/insights/engineAwait.ts` (new)
- `src/insights/layerTables.ts`
- `src/insights/duckdb.ts`
- `src/insights/sql.ts`
- `src/features/processing/runQueue.ts`
- `src/ui/processing/RunFooter.tsx`

Tests:

- `tests/unit/insights/layerTablesBuild.test.ts`
- `tests/unit/insights/sqlQuery.test.ts`
- `tests/unit/ui/processing/extensionChip.test.tsx`
- `tests/unit/ui/processing/ToolView.test.tsx`
- `tests/unit/features/processing/roofMetricsRun.test.ts`
- `tests/unit/domain/roofRollUp.test.ts`
- `tests/integration/duckdb/computedColumns.test.ts`

Docs: `docs/roadmap.md`. Untouched: `.github/hooks/`, `docs/design-history/`, `.superpowers/`
(this report is written there but deliberately not staged).

## Concerns

1. **Two death-path gaps are still open, and F1 narrowed the blast radius rather than closing them.**
   `runQuery` callers outside the run queue and the table builds — the export dialog and the layer
   counts — still await promises a death strands. `engineAwait.ts` is now the obvious seam for them;
   it was out of this wave's scope.
2. **`retryEngine`'s boot wait is deliberately unraced** (`af22992`, and the hard rule keeps that
   function as-is): its callers are `void retryEngine()`, so a rejection there would be unhandled.
   The consequence is that a worker dying DURING a Retry's boot can still strand that one await —
   `doInit`'s `instantiate`/`connect` are duckdb-wasm requests like any other. It holds no queue and
   blocks nothing else, but the button's caller never learns the outcome. Racing it properly means
   giving `retryEngine` a rejection contract and a caller that handles it — a change of its own.
3. **T3's "stale: layer reloaded" is asserted as the `stale` flag**, not as the string, to avoid
   importing `RecentRuns.tsx` into a feature test. The copy is pinned in `RecentRuns.test.tsx` and
   `ToolView.test.tsx`; if the controller wants the literal in this suite it belongs in a UI test
   for a streaming run instead.
4. **I edited a third roadmap line** (the death-path gaps) beyond the two T6 assigned, because F1
   made its first clause false. Revert if the controller wants that line's wording for themselves.
5. **One F2 edge no test covers, and none needs to.** `ensureExtension` called during the boot
   (a run queued while the engine comes up) can set an extension to `failed` with DuckDB's own
   message BEFORE `failLazyExtensionsIfOffline` runs; the offline check then skips it, because it
   only marks extensions still `unloaded`. The chip still shows §5's sentence (that is derived from
   the STATE), so there is no user-visible difference — only the recorded `error` differs.
6. **F2 is advisory by nature.** `navigator.onLine === false` is reliable, but a captive portal or a
   dead CDN with `onLine === true` still reaches the old path: the chips offer the cost, and the
   reason only appears after a load is attempted. That is unchanged behaviour, not a regression.
7. **The DECIMAL/`median()` binding quirk** (a raw `Uint32Array` from the node bindings) is recorded
   only in the probe's comment. It may deserve a line in `docs/architecture-notes.md`' verified-facts
   list; I did not edit that file.
