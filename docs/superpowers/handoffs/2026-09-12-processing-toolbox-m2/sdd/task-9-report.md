# Task 9 report — The Roof metrics executor, in bounded batches

Branch `develop`. Two commits on top of 6d3c0c7:

- `351ac3b` feat(processing): Roof metrics computes the six columns in bounded batches
- `5f7f1e8` test(processing): a Roof metrics run, end to end over a real model

## What was implemented

**`src/features/processing/tools/roofMetrics.ts` (new).** The brief's module, unchanged in
substance:

- `ROOF_BATCH_FEATURES = 500`.
- `buildFeatureRowsReadSql(table, ids)` — the run's ONE statement
  (`SELECT "id", COALESCE("feature_id", "id") AS f FROM …[ WHERE "id" IN (…)]`), built through
  `quoteIdent`/`quoteLiteral` exactly as `heightFromExtent` builds its own.
- `groupRowsByFeature(rows)`, `computeRoofRows(input)` — spec §7's contributor rule (parts with
  GEOMETRY at the LoD displace the root; otherwise the root alone), §8's row rule (the ROOT row
  carries the feature roll-up, every other row its own), per-FEATURE counting, and the skip cause
  `no roof surfaces at LoD <lod>` with the run's LoD substituted. Columns are one `DOUBLE` per
  ticked measure in `ROOF_MEASURES` order.
- `roofMetrics: ToolExecutor` — phase `compute`, the one read through `ctx`, `ctx.throwIfCancelled()`
  after the read, then `computeRoofRows` with an `onBatch` that yields a MACROTASK
  (`setTimeout(…, 0)`) and checks the abort AFTER the yield. `run.lod === null` throws
  "No roof surfaces in this layer" (unreachable through the form).
- `registerExecutor("roof-metrics", roofMetrics)`, wired from `tools/register.ts` by side-effect
  import after `heightFromExtent`.

Params come from `roofParams(run.params)` (idempotent), so the run works whether or not the caller
froze a normalised bag; freezing it is Task 12's step and `submitRun` was left untouched.

**`src/features/processing/runQueue.ts`.** `ToolContext.throwIfCancelled(): void` plus its
implementation in the `ctx` literal (`if (signal.aborted) throw new CancelledError()`), located by
the quoted code, not by line number. Its doc comment says only what the plan's residual allows: the
method buys an early EXIT and responsiveness — `execute` already refuses to publish an aborted run.
The same framing is used in `roofMetrics.ts`'s module comment (the brief's "outrun the Cancel
button" sentence was dropped).

## Tests

**`tests/unit/features/processing/roofMetricsTool.test.ts` (new, 13 cases).** The brief's pure suite
verbatim: the two SQL shapes, the contributor rule in all three configurations (part wins, wall-only
part wins and then finds no roof, fall back to root), unequal-part sums with area-weighted slope,
the all-NULL skip, an unknown row, "a row for every row the table gave it", the threshold changing
both `roof_flat_m2` and the dominant azimuth, column order, and the batch boundary (`onBatch` twice
for 1200 features; a throwing `onBatch` aborts the computation).

**`tests/unit/features/processing/roofMetricsRun.test.ts` (new, 6 cases).** Scaffolding copied from
`runQueue.test.ts` lines 1–347 (its header now extends past the brief's ":1-235": through `deferred`,
`request`, `attributesOf` and the `beforeEach`/`afterEach`), with the four residual fixes:

1. The fixture geometry is true — `roofSurface(lod, area, slopeDeg)` builds a 3D rectangle whose Newell
   area is exactly `area` and whose inclination is exactly `slopeDeg` (verified against the real
   `computeRoofMetrics` in a throwaway before use). P1 is a TRUE 30 m² roof at 10°, P2 a flat 10 m²,
   B1's own (ignored) roof 99 m², B2 a flat 12 m² with no parts, B3 a roof at 1.2 only.
2. The threshold comparison is **5 vs 15** (15 is `FLAT_THRESHOLD_MAX`, so it survives `roofParams`'
   clamp), and `roof_flat_m2` really moves: B1 10 → 40.
3. The real executor is registered in `beforeEach` (`registerExecutor("roof-metrics", roofMetrics)`)
   and deleted in `afterEach`, so the module's one-time load registration is not consumed by the
   first case.
4. The rebuild case is tested at the boundary the code supports — the head-of-queue re-validation:
   run 1 is held inside the real executor's own read, `tableInfo` is replaced, and run 2 fails with
   "Layer changed while running; run again" without ever issuing its read. The stale-watcher case
   seeds `useLayerTableStore` with the current table BEFORE `installStaleWatcher()`, because the
   watcher fires on a transition.

Plus the required cancellation coverage after real CPU work: a scope of `ROOF_BATCH_FEATURES * 2`
single-roof buildings, with `@cityjson/navara-core` spied on (NOT replaced — `importActual` +
counter) so `cancelRun` can be fired at the exact moment the first batch's last feature is measured.
The assertion is `measuredSurfaces === ROOF_BATCH_FEATURES`: the second batch never starts, nothing
is merged into the model, no provenance is registered, and no `BEGIN TRANSACTION` is sent.

**`tests/unit/features/processing/register.test.ts`** — the `EXECUTORS` pin is now
`["height-from-extent", "roof-metrics"]`.

**`tests/unit/features/processing/runQueue.test.ts`** — one harness change, forced by the new
registration: `tools/register` now registers a REAL `roof-metrics` executor at module load, and that
file's "fails a tool with no executor rather than hanging" case used `roof-metrics` as its
executor-less tool (it started failing with "No roof surfaces in this layer"). `beforeEach` now does
`delete EXECUTORS["roof-metrics"]` with a comment, and the case's stale comment was corrected. No
assertion was weakened; `roof-metrics` and `height-from-extent` are the only two tools with
`extension: null`, so no other tool could stand in without changing what the case tests.

## TDD evidence

- **RED (Step 2).** `npx vitest run roofMetricsTool.test.ts register.test.ts` →
  2 files failed: `Failed to resolve import ".../tools/roofMetrics". Does the file exist?` and
  `expected [ "height-from-extent" ] to deeply equal [ "height-from-extent", "roof-metrics" ]`.
  Both are the intended reasons.
- **GREEN (Steps 3–5).** After `throwIfCancelled`, the executor and the `register.ts` import:
  `roofMetricsTool` 13/13, `register` 1/1, `heightFromExtent` unchanged and passing, `runQueue`
  49/50 → the one documented harness break above → 50/50 after the `beforeEach` delete.
- **Lifecycle suite.** 5 of its 6 cases passed on first run; the sixth failed on a log assertion that
  was wrong about the queue, not about the tool (the run's log also carries the write's "Writing
  results" entry) — the assertion now reads "the log contains `Reading features`, and the TOOL
  issued exactly one statement".
- **Mutation check on the lifecycle suite** (reverted immediately): forcing `contributors` to the
  root and renaming `onBatch` away gave
  `expected 99 to be close to 40`, `expected 99 to be close to 10`, `expected 1000 to be 500` —
  3 of 6 failed, so the contributor rule and the batch bound are both load-bearing in this file,
  not incidentally satisfied.
- `npx tsc -b --noEmit` clean; `npx vp check` 0 errors / 56 warnings (baseline) before each commit;
  `npx vitest run tests/unit/features/processing` 145/145 across 10 files.
- **Full suite once, at the end:** `npx vp test run` → 240 files passed, 2 skipped;
  2947 tests passed, 31 skipped; exit 0. (It ran against `119e581`, which was then amended to
  `5f7f1e8` for a comment-only wording fix; the processing suite re-ran 145/145 afterwards.)

## Files changed

- `src/features/processing/tools/roofMetrics.ts` (new)
- `src/features/processing/tools/register.ts` (one side-effect import)
- `src/features/processing/runQueue.ts` (`ToolContext.throwIfCancelled` + its `ctx` implementation)
- `tests/unit/features/processing/roofMetricsTool.test.ts` (new)
- `tests/unit/features/processing/roofMetricsRun.test.ts` (new)
- `tests/unit/features/processing/register.test.ts` (the pin)
- `tests/unit/features/processing/runQueue.test.ts` (harness: unregister the real roof executor)

## Self-review

- The tool stays `implemented: false`; nothing in the UI changes, and the executor is reachable only
  through the queue. `heightFromExtent` is untouched and its suite still passes — its fake context is
  `as unknown as ToolContext`, so the new required method broke no hand-built context.
- `throwIfCancelled` is the only addition to the context, and `CancelledError` stays private.
- The batch comment says exactly what the plan's residual permits (responsiveness + early exit), and
  no more.
- The lifecycle file's header names the one thing it deliberately duplicates from `runQueue.test.ts`
  (the rebuilt-table case) and why it is not the same test.
- No `@duckdb/duckdb-wasm` import anywhere near this code; the executor reaches the engine only
  through `ctx.query`.

## Concerns / notes for later tasks

1. **`runQueue.test.ts` now deletes `roof-metrics` in `beforeEach`.** If a future task needs the real
   roof executor inside that file, that line has to go. It exists because only two tools have
   `extension: null`, and an executor-less tool is needed for the "Not available yet" case — when
   Task 13 flips `implemented: true`, that case may be worth moving to a tool whose extension load is
   stubbed instead.
2. **Task 10 (the all-NULL case)** gets what it expects: a feature with no contributor surfaces at
   the LoD produces a row with NULL in every column and a skip counted under
   `no roof surfaces at LoD <lod>`; a run where EVERY feature is like that still returns rows (so it
   is a normal write, not the `rows.size === 0` short-circuit) and `summary.measured` is 0.
3. **`run.params` normalisation** is still Task 12's (`ToolView`'s `run()` freezes
   `normaliseParams(draft.params)`). The executor is defensive anyway (`roofParams` is idempotent),
   but until Task 12 lands, a run submitted with a raw bag would log `{}` rather than the measures
   used.
4. The batch yield uses `setTimeout(…, 0)`. Any future suite that runs this executor under
   `vi.useFakeTimers()` will hang at the first boundary unless it advances timers.
