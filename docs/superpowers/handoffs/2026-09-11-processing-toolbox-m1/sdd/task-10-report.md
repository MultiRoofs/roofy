# Task 10 report — Height from extent executor (spec §7.4)

Branch `develop`. Two commits on top of `17a6b9f` (the second from the
self-review below):

- `66d5f89` feat(processing): height from extent tool
- `368de10` test(processing): pin that register.ts wires the height tool into the
  queue

`index.html`'s pre-existing uncommitted edit was left untouched (it is the only
thing the working tree still shows, and it is not mine).

## What was implemented

### `src/features/processing/tools/heightFromExtent.ts` (new)

Three exports plus the registration:

- `buildExtentSql(table, ids)` — the one statement the tool sends:

  ```
  SELECT "id", COALESCE("feature_id", "id") AS f, "bbox"."zmin" AS zmin, "bbox"."zmax" AS zmax FROM "t"[ WHERE "id" IN ('a', 'b')]
  ```

  `ids === null` (scope `all`) yields no WHERE. Identifier through `quoteIdent`,
  literals through `quoteLiteral`, like every other statement in the app.

- `rollUpExtents(rows, prefix): { rows, measured, skipped }` — pure. One pass
  builds, per feature (`f`), the min `zmin` / max `zmax` over root and parts and
  the list of member row ids; a second pass writes
  `{ <prefix>height_m, <prefix>zmin_m, <prefix>zmax_m }` onto EVERY member of
  the feature. `measured` counts FEATURES with an extent; a feature with no bbox
  on ANY member gets all-null values on every member and is counted once into
  `[{ cause: "no geometry", count: n }]` (an empty array when nothing was
  skipped). The `if (!extents.has(f))` guard is what makes a null-bbox part
  beside a bbox-carrying root harmless in EITHER arrival order.

- `heightFromExtent: ToolExecutor` — `ctx.phase("compute")`, one
  `ctx.query("Reading extents", …)`, coercion, roll-up, and the three
  `DOUBLE` output columns in the brief's order. It does not log itself (the
  context does) and does not check `signal` (there is no loop; the queue checks
  after the executor returns).

- `registerExecutor("height-from-extent", heightFromExtent)` at module scope.

Why the roll-up is JS and not a `GROUP BY`/window function: the SQL stays a
plain projection that reads cleanly in the run's log, and the two counts the
result card needs (features measured, features skipped) fall out of the same
pass. Documented in the module header.

Deviations from the brief's sketch, both deliberate:

- `if (!out.ok) throw new Error(out.message);` after the `await ctx.query(...)`.
  `ToolContext.query` is declared `Promise<QueryOutcome>` (a union) even though
  the implementation throws on `!ok`, so the brief's `out.rows.map(...)` does not
  compile. Commented as a type guard, not logic.
- Coercion goes through a small `num()` helper: `null`, `undefined` and a
  non-finite/unparseable value all read as `null`, rather than becoming `NaN` in
  a DOUBLE column. `Number("1.5")` still works, so a decimal arriving as a
  string (arrow DECIMAL) is measured.

### `src/features/processing/tools/register.ts` (modified)

`export {};` → `import "./heightFromExtent";`, doc comment untouched. This is the
file `runQueue.ts` already imports, so there is no runtime cycle:
`heightFromExtent` imports only `./index` (for `registerExecutor`), `insights/sql`
and TYPES from `../runQueue` / `insights/computedColumns` / `../types`.

### Not changed: `toolRegistry.ts`

`height-from-extent` is already `implemented: true` (and
`tests/unit/ui/processing/CatalogueView.test.tsx` pins that it is the only one),
so `eligibility.ts`'s `!tool.implemented` gate already lets it through. Nothing
to flip; checked rather than assumed.

## Tests

`tests/unit/features/processing/heightFromExtent.test.ts` — 10 cases:

- `buildExtentSql`: the exact string with and without the scope's ids; a quoted
  identifier (`odd"name`) and an escaped literal (`o'brien`).
- `rollUpExtents`: the brief's part roll-up (8.5 from 0.5/9 on both `B` and
  `B-1`, `C` all-null, `measured: 1`, one "no geometry" skip); the mixed feature
  in BOTH orders (null member first and last → `measured: 1`, `skipped: []`, the
  null member still carrying the feature's values); FEATURES not rows
  (3 rows → `measured: 2`) with `skipped: []` and a non-default prefix `h_`; the
  empty read.
- The executor through a fake `ToolContext` (a cast object, no DuckDB, no store):
  the exact SQL passed to `query`, the label `Reading extents`, the phase
  `compute`, the three `{ name, type: "DOUBLE" }` columns, the rows for a part
  and for a no-geometry feature, `measured`, `skipped`; `featureIds: null`
  producing the WHERE-less statement; and engine-shaped values (BigInt `id`,
  string `zmin`, `undefined` STRUCT fields).
- Registration: `EXECUTORS["height-from-extent"] === heightFromExtent`.

### TDD evidence

1. Test file written first →
   `Failed to resolve import ".../tools/heightFromExtent"` (1 file failed, no
   tests ran). RED for the intended reason.
2. Implemented + `register.ts` → `npx vitest run tests/unit/features/processing`
   = 5 files, 45 tests passing. GREEN.
3. Mutation check on the subtlest line: replacing
   `if (!extents.has(row.f)) extents.set(row.f, null);` with an unconditional
   `extents.set(row.f, null);` failed EXACTLY the "whichever came first" case
   (1 failed / 9 passed). Reverted.

### Results

- `npx vitest run tests/unit/features/processing` → 5 files, 45 tests passing
  (re-run after the pre-commit formatter reflowed one import).
- `npx vitest run tests/unit/features/processing tests/unit/ui/processing tests/unit/insights`
  → 24 files, 330 tests passing. In particular `runQueue.test.ts` is unaffected:
  it registers its own executor per test and deletes it in `afterEach`, and its
  "no executor" case asks for `roof-metrics`, which nothing registers.
- `npx tsc -b --noEmit` → clean.
- Working tree after the commit: only the pre-existing `index.html` edit.

## Self-review

- Hard rules: no `@duckdb/duckdb-wasm` import (the engine is reached only through
  `ctx.query`); no `@navaramap/*`; no new directory; SQL built in one place with
  the shared quoters.
- The executor is a pure function of `run.prefix`, `ctx.table.table`,
  `ctx.featureIds` and the read's rows — no store access, so it cannot pick up
  live selection or filter state after the scope was frozen.
- Every output column is present on every row (nulls allowed), as the Task 9
  contract requires; a wholly empty scope returns `rows.size === 0`, which the
  queue already handles as a done, non-undoable run.
- `Math.min`/`Math.max` never see a null (the guard `continue`s first), so no
  `NaN` can reach a DOUBLE column.
- Member ids are collected even for rows whose feature ends up null, so the write
  covers the whole scope rather than silently leaving rows untouched.

## Concerns for later tasks

1. **`prefix` vs the request's `columns`.** The executor derives its column names
   from `run.prefix`, while the card and the write's `existing` check come from
   the request's `columns` (`RunRequest.columns` → `RunRecord.columns`). Task 11
   must build the request's `columns` from the SAME prefix (`<prefix>height_m`,
   `<prefix>zmin_m`, `<prefix>zmax_m`, all DOUBLE) or the card will name columns
   the write did not create.
2. **A prefix that is not a valid-ish identifier.** `quoteIdent` in the write
   path makes any prefix safe SQL, but a prefix containing `"` produces an
   awkward column name. Validation belongs in the UI (Task 11), not here.
3. **No `bbox` column.** A layer table without `bbox` (or without `feature_id`)
   fails the run with DuckDB's binder message as the error text — the same
   user-visible behaviour Task 9's report already flagged for `resolveScope`.
4. **The value is the file's bbox, not a roof height.** The tool's
   `longDescription` says so; nothing in this module tries to exclude chimneys or
   subtract terrain, by design.

## Contract for Task 11

```ts
// src/features/processing/tools/heightFromExtent.ts
export interface ExtentRow {
  readonly id: string;
  readonly f: string;
  readonly zmin: number | null;
  readonly zmax: number | null;
}
export interface RollUp {
  readonly rows: ReadonlyMap<string, Record<string, number | null>>;
  readonly measured: number; // FEATURES
  readonly skipped: ReadonlyArray<SkipCount>; // [] or [{ cause: "no geometry", count }]
}
export function buildExtentSql(
  table: string,
  ids: ReadonlyArray<string> | null,
): string;
export function rollUpExtents(
  rows: ReadonlyArray<ExtentRow>,
  prefix: string,
): RollUp;
export const heightFromExtent: ToolExecutor; // registered as "height-from-extent"
```

Output columns, in this order, for a run with prefix `p`:
`p + "height_m"`, `p + "zmin_m"`, `p + "zmax_m"`, all `"DOUBLE"`. The tool's
`defaultPrefix` is `extent_`. Registration happens by importing
`src/features/processing/tools/register.ts`, which `runQueue.ts` already does —
Task 11 needs no import of its own.

---

## Fix report — covering test for `register.ts`

Review finding (self-review gap): `register.ts` was the one changed source file
with **no covering test**. The "registers itself for the run queue" case in
`heightFromExtent.test.ts` imports `heightFromExtent` statically at the top of
the file, so `registerExecutor` runs from that import regardless of what
`register.ts` contains — reverting `register.ts` to `export {};` left that test
green. Since `register.ts` is the only wire from `runQueue.ts` to the executor,
that is a real gap, not a nit.

Second commit:

- `368de10` test(processing): pin that register.ts wires the height tool into the
  queue

### `tests/unit/features/processing/register.test.ts` (new)

Imports ONLY the side-effect module
(`import "…/tools/register";`) and `EXECUTORS` from `tools/index` — never
`heightFromExtent` — and asserts
`Object.keys(EXECUTORS)` equals `["height-from-extent"]`. That pins both halves
of the file's doc comment: the height tool IS wired, and nothing else in M1 is
(so a tool added to `register.ts` without its `implemented` flag, or vice versa,
shows up here). Vitest isolates modules per file, so the other suite's static
import cannot leak in.

TDD evidence: written first with `register.ts` temporarily reverted to
`export {};` → `AssertionError: expected [] to deeply equal [ 'height-from-extent' ]`
(1 failed). Restored the import → 1 passed. The backup went to the session
scratchpad this time, not `/tmp`.

Also in the same commit, cosmetic: the coercion case's ids are now `7n` / `8n`
(BigInt, which is what duckdb-wasm actually hands back for a BIGINT column), so
the test's title is honest; `String(7n)` is still `"7"` and the assertion is
unchanged.

### Results after the fix

- `npx vitest run tests/unit/features/processing` → 6 files, 46 tests passing.
- `npx tsc -b --noEmit` → clean.
- Working tree: only the pre-existing `index.html` edit.
