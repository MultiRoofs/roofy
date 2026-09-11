# Task 5 report: `bbox` column on the flat fallback rows

## Implemented

`src/insights/layerRows.ts`

- `BboxStruct` interface + `bboxStruct(bbox: BBox3 | null | undefined)` helper: the domain's
  `[minX, minY, minZ, maxX, maxY, maxZ]` tuple → `{ xmin, ymin, zmin, xmax, ymax, zmax }`,
  `null` for an object with no extent. Key ORDER is the schema `read_json_auto` infers.
- `"bbox"` appended to `FLAT_PREFIX_COLUMNS` (after `"children"`), which also makes a source
  attribute named `bbox` a dropped-and-reported reserved name through the existing `RESERVED`
  set — no extra code.
- `readonly bbox: BboxStruct | null` on `FlatRow`.
- `flatRowsFromModel` pushes `bbox: bboxStruct(obj.bbox)`.
- `flatRowsFromRecords` pushes `bbox: bboxStruct(r.bbox)` — `ResidentObjectRecord.bbox`
  (`packages/.../navara-flatcitybuf/src/workerProtocol.ts:39`) is a NON-nullable `BBox3`, so the
  streaming path always emits a struct, never `null`. (The brief allowed either.)

`src/insights/layerTables.ts` — NOT in the brief's file list, but REQUIRED (see Concerns #1)

- `FLAT_COLUMN_TYPES.bbox = "STRUCT(xmin DOUBLE, ymin DOUBLE, zmin DOUBLE, xmax DOUBLE, ymax DOUBLE, zmax DOUBLE)"`.
  One entry serves both consumers of that map: `EMPTY_FALLBACK_DDL` (an empty streaming table now
  declares `bbox` as the struct instead of falling through to `VARCHAR`) and the per-column ALTER
  loop in `buildFromRows` (which iterates `FLAT_PREFIX_COLUMNS` and would otherwise have emitted
  `ALTER COLUMN "bbox" TYPE undefined`).

## Tests + results

`tests/unit/insights/layerRows.test.ts` (extended — the brief's Step 1 snippet is not runnable as
written: `src/domain/citymodel/parsers` does not exist; `parseCityJSON` now lives in
`@cityjson/navara-core`, and the file already has a hand-built `model()` with `bbox: [0,0,0,1,1,1]`,
so the same intent is asserted without fixture I/O)

- "carries each object's extent as the reader's own bbox struct" — `FLAT_PREFIX_COLUMNS` contains
  `bbox`; `Object.keys` order is `xmin, ymin, zmin, xmax, ymax, zmax`; values; `zmax > zmin`.
- "writes NULL for an object with no extent".
- "drops a source attribute named bbox, like every other fixed column" — the struct survives, the
  attribute is dropped, warned ONCE with the existing sentence.
- Updated the two exact-shape `toEqual`s (`flatRowsFromRecords` vocabulary, `encodeRowsAsJson`).

`tests/unit/insights/layerTablesBuild.test.ts` (brief Step 4's "update it to include bbox")

- `BBOX_TYPE` constant; `FALLBACK_DESCRIBE` gains the `bbox` row; the empty-table DDL string;
  the ALTER list is now six statements (`sql.slice(1, 7)`), DESCRIBE moved to `sql[7]`; the
  "five ALTERs" comment corrected.

`tests/integration/duckdb/layerTables.test.ts` (opt-in, real DuckDB 1.5.5 + cityjson v0.4.0 — it
RAN here, the extension was cached; 20/20 pass)

- "declares the reader's bbox EXACTLY as the flat fallback forces it" — the real reader's column
  type is, measured, `STRUCT(xmin DOUBLE, ymin DOUBLE, zmin DOUBLE, xmax DOUBLE, ymax DOUBLE, zmax DOUBLE)`,
  identical to `FLAT_COLUMN_TYPES.bbox`. This is the alignment claim the whole task rests on, and no
  unit test can make it (they all mock DESCRIBE).
- "types an ALL-NULL bbox column as the reader's STRUCT on the flat-fallback path" — measured:
  `read_json_auto` types an all-NULL `bbox` as JSON (same hazard as `parents`), the ALTER casts
  JSON → STRUCT successfully, and `"bbox"."zmin"` then selects (NULL per row).
- "carries an INTEGER-coordinate bbox through the ALTER as DOUBLE" — measured: integer coordinates
  infer `STRUCT(... BIGINT)`, the ALTER casts to the DOUBLE struct without losing values
  (`zmin: 3, zmax: 9`).
- Pre-existing "keeps every attribute as its OWN column" count 305 → 306 (six fixed columns now).

### RED / GREEN evidence

- RED: `npx vitest run tests/unit/insights/layerRows.test.ts` → `Tests 5 failed | 15 passed (20)`,
  every failure a missing/undefined `bbox` (e.g. `expected [Array(1)] to deeply equal [Array(1)]`
  with the whole `bbox` struct on the Expected side only). Failed for the intended reason.
- GREEN after the implementation: `npx vitest run tests/unit/insights` → 15 files, 252 tests passed.
- `npx tsc -b --noEmit` → clean.
- Full suite once: `npx vitest run` → `1 failed | 2653 passed | 19 skipped`; the single failure is
  the pre-existing `tests/unit/app/appCityParquetLayers.test.tsx` drop-zone failure on `develop`,
  untouched by this change.
- `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` → 20 passed.

## Files changed

- `src/insights/layerRows.ts`
- `src/insights/layerTables.ts`
- `tests/unit/insights/layerRows.test.ts`
- `tests/unit/insights/layerTablesBuild.test.ts`
- `tests/integration/duckdb/layerTables.test.ts`

Step 5's `git add` list was stale (it names only `layerRows.ts` and its test); the commit carries
the five files above.

## Self-review

- Task 10 can now write `"bbox"."zmin"` / `"bbox"."zmax"` on EVERY layer kind: reader-backed
  (already had it, type verified identical), flat from a `CityModel`, flat from resident records,
  and an empty streaming table (typed DDL, so the column binds before the first cell lands).
- `src/ui/table/ExportDialog.tsx` builds `FIXED_COLUMNS` as `new Set([...FLAT_PREFIX_COLUMNS,
"children_roles", "bbox", "address", "other"])` — `bbox` was ALREADY hidden there for the reader
  tables, so the new entry is a harmless duplicate in a Set and the flat tables now hide it for the
  same reason. Left the literal in place: it still documents the reader-only names. No behaviour
  change, verified by the passing export/table tests.
- `columnKind` classifies a `STRUCT(...)` as `nested`, so the filter bar offers the new column no
  comparison it cannot honour — same treatment the reader's `bbox` already got.
- `CITYPARQUET_REQUIRED_COLUMNS` in `sql.ts` already lists `bbox`; unrelated path, untouched.
- No new `duckdb.ts` export, no persistence change, no UI string — Global Constraints unaffected.
- The ALTER loop's `FLAT_COLUMN_TYPES[column]` has no `?? "VARCHAR"` fallback (unlike the empty
  DDL). Left as is deliberately: every `FLAT_PREFIX_COLUMNS` entry now has a type, and a silent
  VARCHAR fallback there would be a worse failure mode than a loud one.

## Concerns

1. The brief scoped this to `layerRows.ts`, but adding `"bbox"` to `FLAT_PREFIX_COLUMNS` without
   the `FLAT_COLUMN_TYPES` entry would have emitted `ALTER TABLE ... ALTER COLUMN "bbox" TYPE
undefined` (a template-literal interpolation of `undefined` — legal TypeScript) and every
   POPULATED flat table would have failed to build. The mocked unit tests would not have caught it.
   Hence the `layerTables.ts` change. Worth noting in case another task also plans to touch
   `FLAT_COLUMN_TYPES`.
2. Nothing left unverified: both risky casts (JSON → STRUCT, STRUCT(BIGINT) → STRUCT(DOUBLE)) and
   the reader/fallback type equality were measured against real DuckDB, not assumed.

## Addendum (post-commit checks)

- `docs/architecture-notes.md` spelled the flat table's aligned column list as
  `id, feature_id, object_type, parents, children`. Updated to name `bbox` and its struct
  (commit `eb9a5b4`, `docs:`), per CLAUDE.md's rule that the flat-table decision record lives there.
- Resident-path frame question settled, not left open: `buildObjectRecords`
  (`packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/objectRecords.ts:52`) assigns
  `bbox: obj.bbox` straight from the PARSED `CityObject` — before any ENU bake or geoid
  `heightOffset` — so a resident row's `bbox` is the same quantity, in the same CRS, as the reader's.
  (That file also skips an object with no bbox, which is why `ResidentObjectRecord.bbox` is
  non-nullable and the streaming path never emits `bbox: null`.)
