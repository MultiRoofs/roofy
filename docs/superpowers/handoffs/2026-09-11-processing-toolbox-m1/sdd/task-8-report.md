# Task 8 report — Computed columns: SQL builders, write-back with backup, undo, registry

Commit: `d673991 feat(insights): computed columns write-back with backup, undo and provenance registry` (on `develop`, not pushed).

## Implemented

`src/insights/computedColumns.ts` — new module, taken from the brief's Step 3 verbatim (differences: formatting/brace style, two added comments, and `columns.map(quoteIdent)` written as `columns.map((c) => quoteIdent(c))` — equivalent, it just avoids passing the map index into a one-parameter function):

- `type ColumnType = "DOUBLE" | "BOOLEAN" | "VARCHAR"`, `interface OutputColumn { name; type }`.
- Pure builders: `buildAddColumnSql`, `buildBackupSql`, `buildUpdateFromValuesSql`, `buildRestoreSql`, `buildNullifySql`. All identifiers go through `quoteIdent` and all ids/filenames through `quoteLiteral` from `src/insights/sql.ts`.
- `writeComputedColumns(input): Promise<WriteOutcome>` — registers the rows as a JSON buffer (`__vals_<runId>.json`, BigInt stringified by the replacer), then ONE transaction: `BEGIN TRANSACTION` → optional `CREATE TABLE "__undo_<runId>" AS SELECT "id", <replaced…> … WHERE "id" IN (…)` → `ALTER TABLE … ADD COLUMN IF NOT EXISTS` per output column → `UPDATE … FROM read_json_auto('__vals_<runId>.json') AS v` → `COMMIT`. Any non-ok outcome issues `ROLLBACK` and returns the engine's message; the buffer is dropped in a `finally`, so it goes on both paths. `backupTable` is `null` when no column is being replaced.
- `undoComputedColumns(input): Promise<QueryOutcome>` — `BEGIN TRANSACTION` → restore UPDATE from the backup (only when there is a backup table AND replaced columns) → `ALTER TABLE … DROP COLUMN IF EXISTS` per created column → `DROP TABLE IF EXISTS <backup>` → `COMMIT`, with `ROLLBACK` + the engine's outcome on failure.
- `useComputedColumnStore` (zustand) with `byLayer` and `setProvenance` / `removeColumns` / `clearLayer`; selectors `computedColumnsOf(layerId)` (shared `EMPTY` set for an untouched layer) and `provenanceOf(layerId, column)`; `Provenance` exactly as specified (`runId`, `toolName`, `summary`, `at`, `partial`, `previous`).

Engine access is only through `runQuery`, `ddl`, `registerBuffer`, `dropBuffer` from `./duckdb`. No new exports were added to `duckdb.ts`; no `@duckdb/duckdb-wasm` import. `quoteLiteral` already accepts `string | number | boolean`, so no overload was needed in `sql.ts` — `sql.ts` is untouched.

## Tests

`tests/unit/insights/computedColumns.test.ts` — 10 tests, `duckdb.ts` mocked at module scope (the brief's factory, with the unused `sql` params dropped from the factory defaults so `vp check` passes):

1. `computed column SQL` (4) — exact strings for every builder, including `'y''z'` escaping in the id list and the `ids === null` (whole-table) backup form.
2. `writeComputedColumns` (2) — the statement sequence (`calls[0] === "BEGIN TRANSACTION"`, the exact backup and ADD COLUMN statements, `calls.at(-1) === "COMMIT"`), the registered buffer's name and decoded JSON payload (`[{id:"x",a:1.5,b:true},{id:"y",a:null,b:false}]`), `dropBuffer` called with the values name; and the failure path (a failing `UPDATE` → `{ok:false, message:"Binder Error: x"}` with `ROLLBACK` in the calls).
3. `undoComputedColumns` (2, added beyond the brief) — the full statement list in order for `{backupTable:"__undo_r1", created:["b"], replaced:["a"]}`, and a failing `ALTER TABLE` returning the engine's message with `ROLLBACK` issued.
4. `computed column registry` (2) — `setProvenance` → `computedColumnsOf`/`provenanceOf`, `removeColumns` clearing both; plus `clearLayer` on one layer leaving another layer's columns intact.

### TDD evidence

- RED (test file written, module absent): `npx vitest run tests/unit/insights/computedColumns.test.ts` → `Error: Failed to resolve import "../../../src/insights/computedColumns" … Does the file exist?` — `Test Files 1 failed (1)`, `Tests no tests`.
- GREEN (after creating the module, no test edits): `Test Files 1 passed (1)`, `Tests 10 passed (10)`.

### Checks

- `npx tsc -b --noEmit` → exit 0 (tests are inside `tsconfig.app.json`'s `include`, so the test file is typechecked under `noUncheckedIndexedAccess`; the `mock.calls[0]` access uses `?.`).
- `npx vitest run tests/unit/insights` → `Test Files 16 passed (16)`, `Tests 264 passed (264)`.
- Pre-commit hook (`vp staged` → `vp check --fix`) ran clean on both staged files; no re-stage was needed.
- `index.html` verified after the hook's stash/restore dance: `git show --stat --format= HEAD` lists exactly the two task paths, and `git status --porcelain -- index.html` still shows ` M index.html` — the unrelated edit was neither staged nor lost.

## Files changed

- `src/insights/computedColumns.ts` (new)
- `tests/unit/insights/computedColumns.test.ts` (new)

## Self-review

- Exported names/shapes match the brief exactly, so Task 9's run queue and the UI (`computedColumnsOf`, `provenanceOf`) bind as planned.
- `ROLLBACK` is sent through `runQuery` even when the failing statement was a `ddl` — `ddl` is `runQuery` in `duckdb.ts`, so this is the same path.
- The `finally`-placed `dropBuffer` cannot mask the outcome (it returns `void` and never throws per `duckdb.ts`), and it does not appear in the recorded statement list, so the "COMMIT is last" assertion stays meaningful.
- `computedColumnsOf` returns a fresh `Set` when the layer has columns; a React caller must not use it as a `useSyncExternalStore` snapshot directly (identity changes per call). Selecting `byLayer[layerId]` and deriving is the safe pattern for the UI task.
- `removeColumns` leaves an empty object behind for the layer (`byLayer[layerId] = {}`) rather than deleting the key. Harmless for `computedColumnsOf` (size 0) but means "has this layer ever had computed columns" is not answerable by key presence; `clearLayer` does delete.

## Concerns (for the controller / Task 9)

1. **Empty `rows` is not guarded, by design.** With `rows.size === 0` and a replaced column, `buildBackupSql` emits `WHERE "id" IN ()`, which is a DuckDB syntax error, and `read_json_auto` over a `[]` payload bind-fails the `UPDATE`; the transaction rolls back and the call returns the engine's message. I deliberately did not add a guard because the exported shapes are binding and the caller decides what "a run that produced no rows" means — Task 9's run queue should short-circuit before calling `writeComputedColumns`.
2. **`UndoInput.ids` is declared but unused**, and `buildNullifySql` has no in-module caller. Both are presumably for a partial undo (nullify the touched ids of a column created by an earlier run). Left exactly as the brief specifies.
3. **A row whose own key is `"id"`** would override the map key in the payload (`{ id, ...row }` spreads after `id`). Tool outputs are not expected to declare an `id` output column; worth rejecting in Task 9's output-spec validation if that can happen.
4. **`__undo_<runId>` / `__vals_<runId>` names are not sanitised.** Safe as long as `runId` stays an app-minted id; they are quoted for SQL, so the risk is a collision, not injection.
5. **No integration test against a real DuckDB** was added (the brief did not ask for one). Two specific things to probe on DuckDB 1.5.5 before the UI relies on this module — neither is a code change here, because the brief's test pins the SQL text exactly:
   - The `UPDATE`'s `read_json_auto('__vals_<runId>.json')` is BARE — it carries none of `READ_JSON_OPTIONS` from `sql.ts`, which that file documents as measured 1.5.5 failures. `field_appearance_threshold` is not the risk (every row carries every column, per `WriteInput`'s contract), but the default `sample_size` (20480 rows) is: a run over a large layer whose output column is NULL for the first ~20k rows and populated later would have its type inferred from the NULL sample. The neighbouring case worth the same probe is an output column that is all-NULL in the payload being assigned into a `DOUBLE` column.
   - Statement ORDER is load-bearing: the `ALTER TABLE … ADD COLUMN IF NOT EXISTS`s precede the `UPDATE` inside the transaction. Confirm 1.5.5 accepts an ALTER on a table not yet modified in that transaction (it refuses the reverse), so nobody later "tidies" the UPDATE ahead of the ADD COLUMNs.
