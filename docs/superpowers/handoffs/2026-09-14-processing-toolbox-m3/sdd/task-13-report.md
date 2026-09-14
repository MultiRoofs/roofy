# Task 13 — The per-run vector table — report

**Status:** DONE. Commits `1da2a5e` (`feat: a cross-layer run registers its vector source as a per-run table`) and `665ddf8` (`test: the assembly cancel fails fast, and the probe quotes its identifier`) on `develop`, no trailers of any kind, hooks not bypassed, nothing pushed, `.github/hooks/` / `docs/design-history/` / `.superpowers/` left untracked.

## Implemented

`src/features/processing/vectorTable.ts` (new, 271 lines):

- `vectorTableName(runId)` → `__src_<runId>`.
- `buildVectorTableSql(table, file)` → the ONE statement, `read_json(file, format = 'newline_delimited', columns = {idx: 'BIGINT', sid: 'VARCHAR', fid: 'VARCHAR', props: 'JSON', wkt: 'VARCHAR'})` with `ST_GeomFromText("wkt") AS "geom"`; never `read_json_auto` (a STRUCT `props` answers none of `->>`).
- `buildDropVectorTableSql(table)` → `DROP TABLE IF EXISTS "…"`.
- `encodeProjectedFeatures(features, control?)` — async NDJSON, one `{idx, sid, fid, props, wkt}` object per line, BigInt replacer, bounded by BOTH a feature budget (`ENCODE_BATCH` 1 000) and a BYTE budget (`ENCODE_BYTES` 4 MB); each line is encoded on its own (no `join` into an intermediate batch string), so the byte count is exact; the final buffer is ONE exact allocation filled chunk-by-chunk with each chunk released as it is copied, and the copy itself yields on `COPY_BYTES` (4 MB).
- `createVectorTable({runId, preflight, query, control?, signal?})` → `VectorTableHandle {table, release()}`: encode → `registerBuffer` raced against abort+death → the one CREATE through the run's `query` (so it lands in §6.4's log) → `dropBuffer` the instant the parse is done. `release()` drops the TABLE and then the buffer, both `racedWithDeath`, both swallowed — it never throws and never hangs.

`src/features/processing/runQueue.ts`:

- `ctx.query` lifted out of the context literal into a `const query` before the `try` (body verbatim), so the `"source"` phase can log its statement before the context exists.
- `let vectorSourceHandle: VectorTableHandle | null` beside `log`/`warnings`, and `await vectorSourceHandle?.release()` in the run's `finally`.
- The `"source"` phase's vector branch between the scope's abort check and the compute patch: `patch(phase: "source")` → live geo-layer lookup ("Layer removed") → `raced(ensureModelCrsLoadable(layer.model), signal)` + abort check → `epsgForLayer` → `reprojectGeoLayer(preparedData, epsg, control)` with the run's throwing checkpoint → §7.5/§7.7's two empty-source sentences (by tool) → the "N areas skipped: invalid geometry" warning → `createVectorTable` → `ctx.source` filled with the `kind: "vector"` variant Task 11 left `null`.

## Tested + results

- `tests/unit/features/processing/vectorTable.test.ts` (new): 18 tests — the three builders' exact text, the five-column NDJSON line, a null `fid`, a BigInt property, the feature-batch yield, a throwing checkpoint, the BYTE budget yielding on two features, a timer-delivered cancel after ONE 5 MB feature (the second feature's `wkt` getter is never read), a cancel honoured during the final assembly, and the seven `createVectorTable` lifecycle cases (register/create/drop-buffer order, release order, failed CREATE releases and rethrows, the death-vs-memory split, a lost race dropping a late registration, release never throwing).
- `tests/unit/features/processing/crossLayerRun.test.ts`: +7 cases — created in the source phase and dropped when done; dropped when the run FAILS; "No usable areas in Zones"; §7.7's "The source layer has no features" by tool; the empty source; the skipped-areas warning; a Cancel delivered the instant the phase opens (executor never runs, no CREATE issued). `model()` gained `metadata.referenceSystem` EPSG:28992.
- `tests/integration/duckdb/crossLayer.test.ts`: +1 case running the BUILDER's own text over the ENCODER's own bytes against real DuckDB 1.5.5 + `spatial`, reading back `props->>'name'`, `(props->>'n')::DOUBLE` and `ST_GeometryType(geom)` for a polygon, a point and a `GEOMETRYCOLLECTION (POINT …, LINESTRING …)` line, with a heterogeneous row (missing `n`, null `fid`) and an `idx` gap.

Gates:

```
$ npx vitest run tests/unit/features/processing   → 21 files, 381 passed | 1 todo
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
                                                  → 1 file, 20 passed
$ npx vitest run tests/integration/duckdb/crossLayer.test.ts (offline)
                                                  → 1 skipped (20 skipped) — no duckdb-wasm import
$ npx tsc -b --noEmit                             → tsc: 0
$ npx vp check                                    → Found 0 errors and 56 warnings in 555 files (baseline held)
$ npx vitest run > /tmp/m3-task13-suite.log 2>&1 & wait $!   → suite: 0
  Test Files  257 passed | 4 skipped (261)
  Tests  3261 passed | 75 skipped | 1 todo (3337)
  (re-run after the test-only commit 665ddf8, /tmp/m3-task13-suite2.log → suite: 0, same counts)
```

## TDD evidence

RED 1 — the unit suite, module absent:

```
$ npx vitest run tests/unit/features/processing/vectorTable.test.ts
Error: Failed to resolve import "../../../../src/features/processing/vectorTable"
  from "tests/unit/features/processing/vectorTable.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

RED 2 — the integration probe, module absent (module temporarily moved aside to prove it):

```
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

RED 3 — the queue cases, before `runQueue.ts` was wired:

```
$ npx vitest run tests/unit/features/processing/crossLayerRun.test.ts
 × is created in the source phase and dropped when the run is done
 × drops the table when the run FAILS, not only when it succeeds
 × refuses a source whose every feature is unusable, by name
 × tells §7.7's all-skipped source apart from §7.5's, by tool
 × refuses an EMPTY source with §7.5's other sentence
 × records the skipped areas as a warning the log shows
 × cancels inside the source phase, before the executor ever runs
AssertionError: expected null to match object { kind: 'vector', …(3) }
AssertionError: expected [ Array(1) ] to include 'DROP TABLE IF EXISTS "…"'
      Tests  7 failed | 12 passed | 1 todo (20)
```

GREEN after each step: `18 passed (18)` / `20 passed (20)` / `19 passed | 1 todo (20)`.

MUTATION CHECKS (that the two new bound tests bite, run by hand and reverted):

- removing the checkpoint AFTER the macrotask in `pause` → `× stops after ONE very large feature when Cancel lands on a timer` (1 failed | 17 passed).
- removing the copy-phase `pause` → `× checkpoints during the final assembly, not only during the walk`, in 110 ms: `expected 'resolved with the whole document' to be 'cancelled in assembly'`. Without the checkpoint the encode does NOT hang — it RESOLVES with the whole 10 MB array — so that case reads its outcome through a `try`/`catch` rather than `rejects.toThrow`, which would have spent 30 s serialising the array into the failure message (`665ddf8`).
- changing the pinned `GEOMETRYCOLLECTION` to `GEOMETRY_COLLECTION` in the probe → failed with `- "GEOMETRY_COLLECTION" + "GEOMETRYCOLLECTION"`, so the engine's own spelling is what is pinned (guessed, then confirmed against the engine, not fitted to it).

## Files changed

- `src/features/processing/vectorTable.ts` (new)
- `src/features/processing/runQueue.ts`
- `tests/unit/features/processing/vectorTable.test.ts` (new)
- `tests/unit/features/processing/crossLayerRun.test.ts`
- `tests/integration/duckdb/crossLayer.test.ts`

## How each controller requirement was met

1. **Residual B8 (the encoding half).** Two budgets, not one: `ENCODE_BATCH` 1 000 features and `ENCODE_BYTES` 4 MB, the byte one counted from the ACTUAL encoded length of each line (each line is `TextEncoder.encode`d on its own, so there is no `batch.join` intermediate and no estimate). When either budget trips, the walk `pause()`s — checkpoint, macrotask, checkpoint AGAIN. Both sides deliberately: a cancel can only be delivered while the walk is parked at the yield, so a checkpoint taken only before it reads the state as it was a whole batch ago, and the walk would serialise another 4 MB before noticing. Test `"stops after ONE very large feature when Cancel lands on a timer"`: a `setTimeout(…, 0)` flips the flag, the first feature is a ~5 MB ring, and the SECOND feature's `wkt` getter is proven never to have been read (`seen.reads === 1`). **The final allocation:** the total is already known exactly (counted during the walk), so ONE `new Uint8Array(total)` is allocated and filled chunk by chunk, each chunk released (`chunks[i] = EMPTY`) as it is copied, with a checkpoint+macrotask every 4 MB copied. Stated in the module doc and here: a doubling buffer would buy nothing over a known total and would cost a full re-copy at every grow, while holding the chunk list to the end of the copy would keep a second whole copy of the document alive exactly when the first is at full size — releasing as we go makes the peak fall from two copies towards one. Test `"checkpoints during the final assembly, not only during the walk"` covers the copy phase's cancel.
2. **Residual B17.** The split is `readSource`'s, verbatim in shape: `registration = registerBuffer(file, bytes)` → `await raced(registration, signal)`; on a lost race the still-in-flight hand-off is followed fire-and-forget and `dropBuffer`ed if it lands (`"cancels a registration in flight, and drops what lands afterwards"` — abort, reject with `CancelledError`, then resolve the gate and see the drop, with NO statement ever issued); on `false`, `dropBuffer` first, then `getDuckDBStatus().state !== "ready"` → `EngineDeadError`, else `new Error(SOURCE_OUT_OF_MEMORY)` — both branches tested. Every other engine await is raced: the CREATE goes through the run's `query` (which is `raced(runQuery(sql), signal)`), and both halves of `release()` are `racedWithDeath(...).catch(() => {})`, so the `finally` inside the FIFO slot can neither hang nor throw. **Deviation, requirement-driven:** `createVectorTable` takes an extra `signal?: AbortSignal | null` the brief's signature did not have — without it the registration could only be raced against the death, not the abort, which is not "exactly as `readSource` does". The requirements win over the brief; `runQueue` passes the run's own `signal`.
3. **Residual B12.** The citation reads ``(`getDuckDBStatus`, `duckdb.ts:240`)`` in `createVectorTable`'s refusal comment and ``(`duckdb.ts:240`)`` in the test file's header; `:196` appears nowhere. Confirmed against the checkout: `duckdb.ts:240` is `export function getDuckDBStatus(): DuckDBStatus {`.
4. **The statement and the buffer.** `columns=` spells all five columns with `props: 'JSON'` so `->>` compiles (pinned against the real engine, case 5 below); the buffer is `__src_<runId>.json` (the brief's spelling, which is also `computedColumns`' `__vals_<runId>.json` shape and the name the existing probe constant already uses); it is dropped once when the CREATE has parsed and AGAIN in `releaseVectorTable`, which is the same `finally` that issues the `DROP TABLE IF EXISTS`; both are `racedWithDeath`, never awaited unraced inside the FIFO.
5. **The probe.** `tests/integration/duckdb/crossLayer.test.ts` now runs `buildVectorTableSql(vectorTableName("run_builder"), …)` over `encodeProjectedFeatures`' own bytes and asserts the whole row set: `props->>'name'`, `(props->>'n')::DOUBLE` (null on the row that lacks `n` — the heterogeneous case the explicit column list exists for), and `ST_GeometryType(geom)` = `POLYGON`, `POINT`, `GEOMETRYCOLLECTION`. Task 12's collection WKT therefore parses; Task 17 still owns the distance. The file gets its own throwing `vi.mock` of `insights/duckdb` (the pattern `tests/integration/duckdb/computedColumns.test.ts` already uses) because it is a `node`-environment suite that the default offline run COLLECTS before skipping — a static import of `vectorTable` would otherwise evaluate the browser duckdb-wasm bundle under plain Node on every full-suite run. Verified both ways: `DUCKDB_INTEGRATION=1` → 20 passed; offline → 20 skipped, suite green.
   6a. **`ENCODE_BATCH` is 1 000, not the Global Constraints' 500.** The 500 in constraint line 7 is about walking a layer's GEOMETRY (`reprojectGeoLayer`'s `FEATURE_BATCH`, Task 12), and the brief's own encoder code says 1 000. Here the binding bound is the BYTE budget — a batch of a thousand small lines is well under 4 MB and a batch of large ones trips the byte budget long before the count — so 1 000 stands; a deliberate call, not an oversight.

6. **Mock factories.** The new `vectorTable.test.ts` factory exports everything the module under test and its transitive imports name (`registerBuffer`, `dropBuffer`, `ddl`, `getDuckDBStatus`, `onEngineDeath`, plus the rest of the seam so `sourceRead` and `engineAwait` link); the new `crossLayer.test.ts` factory lists the same seam with throwing stubs; `crossLayerRun.test.ts`'s existing factory already exported all four names `vectorTable` reaches and needed no edit. Every import that transitively reaches `insights/duckdb` in the unit suite is `await import` AFTER the mock-state `let`s (residual A2's TDZ trap).

## Self-review

- `git log -1 --format=%B` is ONE line: no `Co-Authored-By`, no `Claude-Session`, no trailer of any kind. Only the five intended files are in the commit.
- Lint baseline held exactly (0 errors / 56 warnings); `tsc -b --noEmit` clean; full app suite green in the background to a file.
- `noUncheckedIndexedAccess`: the copy loop reads `chunks[i]` as `Uint8Array | undefined` and `continue`s on `undefined`.
- The run's `finally` awaits a `release()` that cannot throw (every await inside it is `.catch(() => {})`) and cannot hang (both are `racedWithDeath`), so it can neither mask a run's error nor strand the shared FIFO.
- Nothing is created for a run that cannot succeed: the executor/table/column pre-flights and the extension phase all precede the vector branch, so an unimplemented or refused run never registers a buffer.
- `release()` is NOT idempotent-guarded, deliberately (the brief's own note): the second `dropBuffer` of a name already dropped is free and is the only cover for a throw between the register and the create.
- The crossLayerRun assertions read the table name off the id `submitRun` returned (`__src_${id}`) rather than the brief's literal `__src_run_1` — run ids are minted per queue, not per test, and that file's earlier cases have already spent fifteen of them.
- `tests/` now holds 42 files with a `vi.mock(".../insights/duckdb")` factory; measured at the base commit, `git grep -l 'vi.mock(".*insights/duckdb"' 292a840 -- tests | wc -l` = 40, so this task added ONE (the integration probe) and the other two came from Tasks 11–12's own suites. The Global Constraints' 32 is the `55e4e00` baseline; Task 21's sweep greps rather than trusting a number.
- `vectorSource.ts` was NOT touched: Task 12's Codex fix round (bounding WKT assembly) resumes on it after this report.

## Concerns for the commander / reviewer

1. **The `signal` parameter is a deviation from the brief's published signature** (requirement 2 forced it). Nothing else in the plan constructs a `createVectorTable` call, so the blast radius is this task's own wiring — but a later task that copies the brief's signature verbatim would drop the abort race.
2. **The source phase runs AFTER `resolveScope`**, as the brief places it, so for a vector-source tool the card stays in its previous state for the length of the scope query and only then shows "Reading source". Matches the brief; noted in case §6.1's phase ordering is read more strictly later.
3. **`ensureModelCrsLoadable` can throw the loader's own sentence** (a CRS that is neither in the fixed list nor on epsg.io, or a non-metric one). That travels to the run's catch as an ordinary failure message — it is not one of §6.1's or §7.5's sentences. The plan has no copy for it, and inventing one was out of scope here.
4. **The two very-large-feature tests allocate ~5 MB strings twice** (the assembly case builds two). They run in well under a second together, green or mutated.
5. Task 15's `SOURCE_NEEDS_AREAS` will replace the literal `No usable areas in …` / `The source layer has no features` pair in the queue when it lands; the branch names that in a comment where the literals are.

---

## Fix round 1 (review of `1da2a5e`/`665ddf8`: Needs fixes)

Rebased on `develop` @ `8204de0` (Task 12's fix round landed first: `vectorSource.ts` now bounds WKT assembly and `YieldControl` checkpoints on both sides of every yield — `vectorTable.ts`'s `pause` already did, and its doc now cites the other). Three commits, no trailers, hooks not bypassed, nothing pushed, no file of anyone else's touched.

- `afe74fc` **fix: the NDJSON is bounded within ONE feature, not only between features**
- `ec195e2` **fix: a vector source enters Reading source before the scope query**
- `8e87e49` **test: the per-run table's lifecycle on the real FIFO, through cancel and death**

### 1. CRITICAL — the byte budget now bounds a SINGLE feature

The finding was right: `JSON.stringify`, `TextEncoder.encode` and `out.set` each ran over a whole feature before any budget was read, so a source of ONE huge WKT never yielded.

`encodeProjectedFeatures` now writes each line in pieces. The head — `{idx, sid, fid, props}`, four keys of scalars — is one small `stringify`; then the geometry is appended as the fifth member in slices of `TEXT_SLICE` (256 KB), each escaped with `JSON.stringify(piece).slice(1, -1)` (the escape is per character, so a piece escapes exactly as the whole would), each encoded as it is produced, with a checkpoint + macrotask whenever `ENCODE_BYTES` (4 MB) has gone by. A slice never splits a surrogate PAIR (an astral character is two code units and a lone half would not read back). The final copy is sliced the same way, so `out.set` is bounded too even when a feature's property bag makes a big chunk.

New tests (all RED first):

- `"yields INSIDE one feature, when that feature is all there is"` — ONE 5 MB feature, `checkpoints > 0` and a `setTimeout` flag turned (nothing here can yield "between features"), and `JSON.parse` of the single line returns the WKT byte-for-byte.
- `"cancels mid-encode of a source that is ONE long WKT"` — exactly one feature, a timer flips the cancel, the encode rejects. Read through a `try`/`catch` so a non-stopping encoder fails in 35 ms instead of spending 18 s printing a 5 MB array.
- `"escapes a value that spans slice boundaries exactly as one piece would"` — a 320 K-character value of quotes, backslashes, newlines, `é` and an emoji: `JSON.parse(line).wkt` is identical, which is the slicing + surrogate guard's proof.

```
RED  $ npx vitest run tests/unit/features/processing/vectorTable.test.ts
     × yields INSIDE one feature, when that feature is all there is
         AssertionError: expected 0 to be greater than 0
     × cancels mid-encode of a source that is ONE long WKT
         AssertionError: expected 'encoded the whole feature' to be 'cancelled'
      Tests  2 failed | 19 passed (21)
GREEN Tests  21 passed (21)
      + DUCKDB_INTEGRATION=1 … crossLayer.test.ts → 20 passed
        (the real engine still reads the piecewise NDJSON: the round-trip case
         runs the builder over these bytes)
```

### 2. CRITICAL — the vector `"source"` phase is entered BEFORE `resolveScope`

The pre-scope guard is now `tool.needsReader || tool.sourceKind === "vector"` (Task 5's reader branch's rule, applied to the other kind of source), and the duplicate `patch` inside the vector branch is gone — the phase is opened once, before the scope query, and held across the reprojection, the encode and the CREATE. The post-scope patch still reads `tool.needsReader ? "source" : "compute"`, which is right for both: a reader-backed run stays in Reading source, a vector-source run has just finished its own.

New test in `crossLayerRun.test.ts`, driven by a scope GATE added to that suite's engine mock (the `COUNT(DISTINCT …)` statement waits on it):

```
RED  × shows Reading source while the SCOPE query is still in flight
       AssertionError: expected { id: 'run_1', … } to match object
         { status: 'running', phase: 'source' }
       -   "phase": "source"
       +   "phase": null
GREEN  npx vitest run tests/unit/features/processing → 387 passed | 1 todo (388)
```

### 3. Important — queue-level lifecycle, on the REAL FIFO

New file `tests/unit/features/processing/vectorTableLifecycle.test.ts` (4 cases). It mocks ONLY `insights/duckdb`; `insights/layerTables` is the shipped module, so the queue is `runOnTableQueue` itself, the registry is the real one and the death watch is the real one. The mocked engine can HOLD a statement (a promise that never settles — what duckdb-wasm leaves behind when its worker dies) and `die()` is a real one-shot dispatch, so `racedWithDeath` has something true to race. Every case ends with `queueIsFree()`, which awaits a task queued afterwards: a stranded FIFO makes that await hang and the case fail on the 5 s timeout rather than pass.

- **Cancel AFTER the CREATE** — the executor is held until the test cancels; the run ends "cancelled", `DROP TABLE IF EXISTS "__src_<id>"` was issued, the buffer name was dropped exactly TWICE (once when the CREATE parsed, once in the `finally`), NO `BEGIN` and no `ALTER TABLE` were ever sent (nothing published), and the slot is free.
- **Death DURING the CREATE** — the CREATE is held, the engine dies under it; the run fails with §6.1's "Analytics engine stopped", the cleanup still ran (a race started after the death hears nothing, and every primitive answers immediately once the engine is gone), and the slot is free.
- **Death DURING the cleanup** — the `DROP TABLE` itself is the held statement; the death releases the race, the buffer is still dropped afterwards, and the slot is free.
- **A run holding BOTH handles** — a reader-backed city table plus a vector source; the executor opens `readSource` and throws; both VFS names (`layer_1_<id>.city.json` and `__src_<id>.json`) were registered and both were dropped, the vector table was dropped, the layer's own table is untouched, and the slot is free.

MUTATION CHECKS (each reverted):

- `release()`'s `DROP TABLE` unraced → `× gives the slot back when the engine dies under the CLEANUP itself` — `Test timed out in 5000ms` (the stranded FIFO, exactly the failure the race exists for).
- removing `await vectorSourceHandle?.release()` from the run's `finally` → the cancel case and the two-handle case both fail.
- removing `createVectorTable`'s `await handle.release()` on a failed CREATE → the death-during-CREATE case fails.

### Gates after the fix round

```
$ npx vitest run tests/unit/features/processing   → 391 passed | 1 todo (392)
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts → 20 passed
$ npx tsc -b --noEmit                             → tsc: 0
$ npx vp check                                    → 0 errors / 56 warnings in 556 files
$ npx vitest run > /tmp/m3-task13-fix1-suite.log 2>&1 & wait $!   → suite: 0
  Test Files  258 passed | 4 skipped (262)
  Tests  3271 passed | 75 skipped | 1 todo (3347)
```

### Notes for the reviewer

- `TEXT_SLICE` is used for the encode AND the copy; the head of a feature with a very large property BAG is still one `stringify` (a bag of scalars the form lists, not an unbounded value — the geometry is the only member whose size is unbounded by nature, which is the same line Task 12 draws).
- The lifecycle suite adds a 43rd `vi.mock(".../insights/duckdb")` factory and is the second suite in the repo to use the real `layerTables` FIFO (`tests/unit/insights/layerTablesQueue.test.ts` is the first, and its mock shape is the model for this one).
- Concern 2 of the original report ("the source phase runs after `resolveScope`") is now withdrawn — the ruling made it a defect and it is fixed.

---

## Fix round 2 (scoped re-review: Needs fixes)

On `develop` @ `480b069` (Task 14 landed after fix round 1). Two commits, no trailers, hooks not bypassed, nothing pushed, no file of anyone else's touched.

- `73a346c` **fix: a feature's head is written in the same slices its geometry is**
- `8243f7b` **test: the cleanup-death case names the finalizer's own buffer drop**

### 1. The head goes through the same sliced writer as the geometry

The finding was right: the geometry was sliced but `write(head…)` still ENCODED the whole property bag in one call, so a feature carrying a multi-megabyte string kept the original defect.

Both halves of a line now go through ONE writer, `writeSliced(text, escape)`: `TEXT_SLICE` (256 KB) pieces, a checkpoint + macrotask whenever `ENCODE_BYTES` has gone by, and the surrogate-pair guard applied to BOTH modes (a lone half encodes as U+FFFD, which would corrupt an emoji in a property value exactly as in a geometry). `escape` is false for the head, which `JSON.stringify` has already escaped, and true for the WKT, whose characters are being written into a JSON string.

**The accepted bound is now stated in the doc comment** rather than implied: the `JSON.stringify` of one feature's `{idx, sid, fid, props}` is a single synchronous call that nothing can interrupt and there is no streaming JSON writer to reach for — the same trade Task 12's rope flatten makes. Everything after it (escaping, UTF-8 encoding, the copy into the final buffer) is sliced.

New test `"cancels mid-encode when the PROPERTIES are the large part"`: ONE feature, a 9 MB property string, a tiny `POINT (1 1)` geometry behind a getter, a `setTimeout` cancel. It asserts BOTH that the encode rejects AND that the geometry getter was never reached — because the old code also "cancelled", just in the final assembly, after every byte had already been serialised and encoded.

```
RED  $ npx vitest run tests/unit/features/processing/vectorTable.test.ts \
         -t "PROPERTIES are the large part"
     × cancels mid-encode when the PROPERTIES are the large part
       AssertionError: expected true to be false   ← reachedGeometry
      Tests  1 failed | 21 skipped (22)
GREEN Tests  22 passed (22)
      + DUCKDB_INTEGRATION=1 … crossLayer.test.ts → 23 passed
```

### 2. The cleanup-death case now distinguishes the finalizer's release

The finding was right: asserting `dropped` merely CONTAINS the buffer name proved nothing, because the post-CREATE drop had already put it there.

The case now pins the state before the death and the change after it:

- `sql` contains `DROP TABLE IF EXISTS "__src_<id>"` BEFORE `die()` — the run is inside its finalizer with a statement in flight that will never answer;
- the buffer had been dropped exactly ONCE at that point (the CREATE's parse), and the run is already `done`;
- after `die()`, that name has been dropped TWICE — the second is the finalizer's own, which could only happen once the death resolved the race;
- and the next FIFO task runs.

MUTATION CHECK (reverted): removing the `dropBuffer` half of `releaseVectorTable` →
`AssertionError: expected [ '__src_run_1.json' ] to have a length of 2 but got 1`
on this case (and the cancel and death-during-CREATE cases fail too), which is the assertion the review asked for.

### Gates after fix round 2

```
$ npx vitest run tests/unit/features/processing   → 411 passed | 1 todo (412)
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts → 23 passed
$ npx tsc -b --noEmit                             → tsc: 0
$ npx vp check                                    → 0 errors / 56 warnings in 558 files
$ npx vitest run > /tmp/m3-task13-fix2-suite.log 2>&1 & wait $!   → suite: 0
  Test Files  259 passed | 4 skipped (263)
  Tests  3295 passed | 78 skipped | 1 todo (3374)
```

### Note for the reviewer

The only synchronous step left in the encode path is that one `JSON.stringify` per feature, and it is now documented as the accepted bound with its reason. Bounding it further would mean writing a streaming JSON serialiser for a property bag the form already lists as scalars — out of proportion to the case, and Task 12 drew the same line for its rope flatten.
