# Task 1 report — The real-engine probes for `three_d` and `spatial`

**Status: DONE_WITH_CONCERNS.** Everything the brief asked for is implemented, committed and green. Four
of the plan's stated engine facts turned out to be WRONG against the real engine; the suites pin what
the engine actually does, and one of them forces a one-clause amendment to the §7.2 SQL that Tasks 6,
7 and 10 code against. Details in "Divergences" below — read that section before dispatching Task 6.

**Commit:** `7429337` `test: probe three_d and spatial against real DuckDB 1.5.5` (on `develop`, not
pushed, no trailers).

---

## 1. What I implemented

| File                                          | What                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures/composite-solid.city.json`          | NEW. Exactly the brief's bytes. One Building, LoD `"2.2"` `CompositeSolid` of two unit cubes sharing the face `x = 1`. Winding verified independently before writing (divergence formula over both members: `+0.9999999999999999` and `+1.0`; per-member half-edge census: every directed edge used once, every reverse present → both members closed and manifold).                                                                  |
| `fixtures/invalid-solid.city.json`            | NEW. Exactly the brief's bytes. `NL.IMBAG.Pand.0001`'s own unclosed solid lifted out of `two-buildings.city.json` with the nine vertices it uses. I diffed the boundaries and the first nine vertices against `two-buildings.city.json`: byte-for-byte the same solid, so the row-level numbers agree across the two files (verified: envelope 388, footprint 80, zmin 0, zmax 8.4, 2 open edges, 1 non-manifold edge on BOTH files). |
| `tests/integration/duckdb/harness.ts`         | `installExtension(db, "spatial" \| "three_d")` appended verbatim from the brief's Step 4, including its doc comment. No other change to the file.                                                                                                                                                                                                                                                                                     |
| `tests/integration/duckdb/solids.test.ts`     | NEW, 16 cases (brief's 14, with the one false case replaced by three truthful ones). `describe.skipIf(!enabled)`, dynamic `await import("./harness")` inside `beforeAll`, `// @vitest-environment node`.                                                                                                                                                                                                                              |
| `tests/integration/duckdb/crossLayer.test.ts` | NEW, 13 cases (brief's 11, plus the boundary-point `ST_CoveredBy` pin the dispatch asked for, plus one bare-NULL binder pin). Same gating and same single harness; the "Tasks 13/14/16/19 append here" comment block is kept verbatim so later tasks land in the right place.                                                                                                                                                         |

**NOT touched, on purpose:** `fixtures/README.md`. The brief says twice that the two provenance rows
are Task 28's ("`fixtures/README.md`'s rows for the two new fixtures are Task 28's", "Both rows go into
`fixtures/README.md` (Task 28)"), and plan Decision 4 agrees ("with its provenance row in
`fixtures/README.md` (Task 28)"). The dispatch's phrase "with their README provenance" reads as
describing the fixtures' eventual documentation, not as an instruction to write it here; I followed the
brief. If the commander wants the rows now, it is a two-line addition.

## 2. TDD evidence

**RED** — `solids.test.ts` written first, before `installExtension` existed:

```
$ export PATH="$HOME/.local/share/mise/shims:$PATH"
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/solids.test.ts
 ❯ tests/integration/duckdb/solids.test.ts (14 tests | 14 skipped) 2253ms
 FAIL  ... > three_d against real DuckDB 1.5.5
TypeError: harness.installExtension is not a function
 ❯ tests/integration/duckdb/solids.test.ts:60:13
 Test Files  1 failed (1)
      Tests  14 skipped (14)
```

Expected for exactly the intended reason: the suite's `beforeAll` reaches for the installer the brief's
Step 4 has not added yet, so every case is unrun.

**RED (second, unplanned and the point of the task)** — after adding the installer, the engine
contradicted three of the brief's assertions:

```
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/solids.test.ts
     × makes ST_3DValidationReport(NULL) NULL, so is_valid is NULL and not false
         Binder Error: Could not choose a best candidate function for the function call
         "st_3dvalidationreport("NULL")" … Candidate functions: (SOLID_3D), (BLOB)
     × runs §7.2's one statement over all three rows and measures each correctly
         AssertionError: expected true to be null   (is_valid of NL.IMBAG.Pand.0001-part1)
     × reports the seven §7.3 fields on a parsed solid, valid or not
         AssertionError: expected true to be null
 Test Files  1 failed (1)
      Tests  3 failed | 11 passed (14)
```

and `crossLayer.test.ts` on its first run:

```
     × parses a MultiPolygon Z … keeping Z
         Catalog Error: Scalar Function with name st_ndims does not exist! Did you mean "st_crs"?
     × returns an EMPTY geometry, not NULL, for a polygon with [] coordinates
         Binder Error: Could not choose a best candidate function for "ST_GeomFromGeoJSON("NULL")"
         Candidate functions: (VARCHAR), (JSON)
      Tests  2 failed | 10 passed (12)
```

Each was then investigated with a throwaway probe file (`tests/integration/duckdb/__probe.test.ts`,
**deleted**, never staged; raw output kept in the session scratchpad) before any assertion was changed.

**GREEN** — both probes, and the whole integration directory, with the extensions:

```
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb
 Test Files  4 passed (4)
      Tests  61 passed (61)
```

Run three times back to back on `solids.test.ts` alone (16/16 each time) to rule out the nondeterminism
found in the garbage-report path.

**Default run still offline and skipped:**

```
$ npx vitest run tests/integration/duckdb
 Test Files  4 skipped (4)
      Tests  61 skipped (61)
   Duration  804ms
```

**Full app suite** (background, to a file, after the final edit):

```
$ npx vitest run > /tmp/m3-task1-suite.log 2>&1 & wait $!; echo "suite: $?"
suite: 0
 Test Files  243 passed | 4 skipped (247)
      Tests  2994 passed | 61 skipped (3055)
```

**Lint / types:** `npx vp check` → **0 errors and 56 warnings in 531 files** (baseline held; one
transient error I introduced and fixed is in §5). `npx tsc -b --noEmit` → clean, exit 0.

---

## 3. Divergences from the plan's stated engine facts — exact values

### D1 (SERIOUS, forces a plan amendment) — a report field read from a RUNTIME NULL solid is UNINITIALISED MEMORY, not NULL

The plan's Facts section states: _"`ST_3DValidationReport(NULL)` is NULL, so `r.is_valid` is NULL rather
than false."_ That holds **only for a constant NULL**. Over a row vector, `three_d` v0.2.0 sets the
report STRUCT's own validity mask but leaves its CHILD vectors untouched, so every field extracted from
it reads whatever was in memory. Verified values for `NL.IMBAG.Pand.0001-part1` (the MultiSurface row,
`s IS NULL`):

| Probe                                      | `is_valid` | counts                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| whole-file vector, run A                   | `false`    | `solid_count 144117620806271230`, `shell_count 4612541580212048000`, `face_count 155377623120236540`, `open_edge_count 225215179548729860`, `non_manifold_edge_count 1730273965676430300`, `degenerate_face_count 3965421847169886700`, `orientation_error_count 792648133147362600` |
| whole-file vector, run B (§7.2 statement)  | **`true`** | —                                                                                                                                                                                                                                                                                    |
| single-row vector (`WHERE id = '…-part1'`) | `true`     | `solid_count 39361794729039704`, `shell_count 39432197832972130`, … `orientation_error_count 39784213352634250`                                                                                                                                                                      |

So the value is nondeterministic garbage, and it is **not** an artefact of mixing solid and non-solid
rows in one vector — a one-row vector does it too. Meanwhile `ST_3DValidationReport(s) IS NULL` **is**
`true` for that row, and the constant path is correct:
`ST_3DValidationReport(NULL::SOLID_3D) IS NULL` → `true`, `.is_valid IS NULL` → `true`.

`r.code` / `r.message` are worse: `length(r.message)` over the same vector returned **2 464 399** on one
run, and on another the statement died with **`RuntimeError: memory access out of bounds`** inside the
wasm module (an earlier spelling produced `malloc of size 536870912 failed`). **Never select `r.code` or
`r.message` without the guard.** I deliberately did NOT put that read in the suite — it can kill the
wasm instance for every later case in the file.

**The fix, verified:** wrap every report-field read in `CASE WHEN s IS NOT NULL THEN … END`. That
restores exactly the output §7.2 specifies:

```
GUARDED  [{"id":"NL.IMBAG.Pand.0001","is_valid":false,"open_n":2},
          {"id":"NL.IMBAG.Pand.0001-part1","is_valid":null,"open_n":null},
          {"id":"NL.IMBAG.Pand.0002","is_valid":true,"open_n":0}]
```

**What I changed, and why I did not block.** `MEASURE_SQL` in `solids.test.ts` now reads
`CASE WHEN s IS NOT NULL THEN r.is_valid END AS is_valid` instead of the plan's `r.is_valid AS is_valid`.
One clause; same column order, same aliases, same outputs as §7.2 demands. I made the change rather
than reporting BLOCKED because the brief's literal is **unpinnable**: no assertion can hold over a column
that returns `false` on one run and `true` on the next, so the brief's text cannot serve as Task 6's
contract in any case, and the guarded text is the only verified way to produce §7.2's required output.
The deviation is called out in a block comment directly above the constant so Task 6's implementer
cannot miss it. The `§7.3 seven fields` case carries the same guard on all seven reads.

**Amendments the commander should carry at pre-flight:**

1. **Task 6** — `buildSolidMeasureSql`'s expected text is the literal now in `solids.test.ts`
   (`MEASURE_SQL`), not the plan's.
2. **Task 7** — the executor's read of `is_valid` must come from the guarded column; a raw `r.is_valid`
   would mark a "not a solid" feature valid or invalid at random.
3. **Task 10** — `buildSolidValidationSql` needs `CASE WHEN s IS NOT NULL THEN … END` on ALL SEVEN
   §7.3 fields, or an unparsed row gets garbage BIGINT counts instead of NULL. It must never select
   `r.code` / `r.message` at all.
4. **Plan "Facts"** — the bullet asserting `ST_3DValidationReport(NULL)` is NULL needs the
   constant-vs-runtime distinction.

### D2 — `ST_3DValidationReport` has TWO overloads; a bare NULL is a Binder Error

`st_3dvalidationreport(SOLID_3D)` and `st_3dvalidationreport(BLOB)`. `ST_3DValidationReport(NULL)` →
`Binder Error: Could not choose a best candidate function`. Pinned as its own case; the cast
(`NULL::SOLID_3D`) is not optional. Same shape in `spatial`: `ST_GeomFromGeoJSON` has VARCHAR and JSON
overloads and `ST_GeomFromGeoJSON(NULL)` is a Binder Error — also pinned, and the brief's case now uses
`NULL::VARCHAR`.

### D3 — the report struct has a THIRTEENTH field the plan does not list

Actual, from the binder's own message:

```
STRUCT(is_valid BOOLEAN, is_closed BOOLEAN, is_manifold BOOLEAN, is_oriented BOOLEAN,
       solid_count BIGINT, shell_count BIGINT, face_count BIGINT, open_edge_count BIGINT,
       non_manifold_edge_count BIGINT, degenerate_face_count BIGINT,
       orientation_error_count BIGINT, code VARCHAR, message VARCHAR)
```

`orientation_error_count` sits between `degenerate_face_count` and `code`; the plan's list omits it. It
is `1` on `NL.IMBAG.Pand.0001` (matching `is_oriented false`) and `0` on `NL.IMBAG.Pand.0002`. No M3
task needs it, but the plan's Facts bullet should carry it.

### D4 — a CompositeSolid's WKB is `GeometryCollection Z`, NOT `PolyhedralSurface Z`

The plan said this was unprobed. Measured on `fixtures/composite-solid.city.json`:

| Probe                                                           | Value                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `cityjson_wkb_geometry_type`                                    | **`"GeometryCollection Z"`**                                       |
| `geometry_properties_lod2_2.type`                               | `"CompositeSolid"`                                                 |
| `ST_3DTryFromWKB`                                               | parses (non-NULL)                                                  |
| report `is_valid` / `is_closed` / `is_manifold` / `is_oriented` | `true` / `true` / `true` / `true`                                  |
| `solid_count` / `shell_count` / `face_count`                    | `2` / `2` / `12`                                                   |
| `ST_3DNumShells` / `ST_3DNumFaces`                              | `2` / `12`                                                         |
| `ST_3DVolume`                                                   | **`2`** exactly (the members' sum — Task 7's roll-up ground holds) |
| `ST_3DSurfaceArea` / `ST_3DFootprintArea`                       | `12` / `2`                                                         |

The WKB string is a live trap: any task that decides "is this a solid?" from
`cityjson_wkb_geometry_type = 'PolyhedralSurface Z'` silently drops every CompositeSolid. The suite now
pins both the WKB string and the properties-struct type, and the comment says why.

### D5 — `ST_NDims` does not exist in this `spatial` build

`Catalog Error: Scalar Function with name st_ndims does not exist! Did you mean "st_crs"?` The case now
uses `ST_HasZ(g)` → `true` and `ST_Dimension(g)` → `2` (topological, not the coordinate count), with
`ST_Area(g)` = `40` for `NL.IMBAG.Pand.0001-part1`. `ST_AsText` confirms Z survives
(`MULTIPOLYGON Z (((85012 446000 0, …`).

### D6 (dispatch instruction, confirmed) — `ST_Within` is interior-only; `ST_CoveredBy` is the boundary-inclusive one

Pinned with a **boundary point**, as the dispatch directed, over the two overlapping areas
(A `0..100`, B `50..150`), point `(50, 50)` interior to A and on B's `x = 50` edge:

| Predicate       | Count |
| --------------- | ----- |
| `ST_Within`     | **1** |
| `ST_CoveredBy`  | **2** |
| `ST_Intersects` | **2** |

§7.6's "a building on a boundary counts in both areas" is therefore `ST_CoveredBy` (or `ST_Intersects`),
never `ST_Within`. The brief's polygon-pair `ST_Within` case is kept as written (it is interior-only and
returns 1, which is correct) — the new case is what makes the distinction visible. This is Task 1's
remit (a FACT), and it does not consume Task 16's append, which pins that task's builder TEXT.

### Facts the plan stated that the engine CONFIRMED, verbatim

- All 17 function names exist and `duckdb_functions()` returns them **lowercase** for `three_d` (the
  brief's `LIKE 'st\_3d%'` works as written; I briefly used `ILIKE` and reverted). There is **no**
  `st_3disvalid`. (Note for later tasks: `spatial` publishes MIXED-CASE names — `ST_CoveredBy`,
  `ST_HasZ` — so a case-sensitive name probe over `spatial` would need `ILIKE`.)
- `ST_3DFromWKB` over a MultiPolygon Z → `Unsupported WKB geometry type for SOLID_3D import`, failing
  the whole statement. `ST_3DTryFromWKB` → NULL for the MultiSurface, for garbage bytes and for NULL.
- `ST_3DVolume` over the unclosed solid → raises `solid is not closed`.
- `read_cityjson(…, lod => '2')` → `LOD '2.0' not found in file`. Columns `geometry_lod2_2` and
  `geometry_properties_lod2_2` exist; the struct's `type` is `"Solid"` / `"MultiSurface"`.
- `NL.IMBAG.Pand.0001`: envelope **388**, footprint **80**, zmin **0**, zmax **8.4**, closed `false`,
  manifold `false`, oriented `false`, 7 faces, 1 shell, **2** open edges, **1** non-manifold edge, 0
  degenerate faces. `NL.IMBAG.Pand.0002`: valid, volume **2178**, envelope **1013.4000000000001**,
  footprint **180**, zmin **0**, zmax **12.1**. `COALESCE(feature_id, id)` rolls the part up to
  `NL.IMBAG.Pand.0001`. `read_cityjsonseq` behaves identically.
- `invalid-solid.city.json` returns ONE row with exactly those `Pand.0001` numbers and a withheld volume.
- `ST_GeomFromWKB` over a PolyhedralSurface Z → `Unsupported geometry type in WKB`.
- `ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[]}')` → NOT NULL, `ST_IsEmpty` **true**.
- `ST_MakeEnvelope(0,0,10,20)` area 200; `ST_Point` prints `POINT`. The NDJSON vector table round-trips
  with `read_json(..., columns = {… props: 'JSON' …})` + `ST_GeomFromText`; `props->>'name'`,
  `(props->>'n')::DOUBLE` and `json_keys(props)` all work. Largest overlap: B wins at 700. Nearest:
  distance 50 to `idx 1`, 0 when touching. `LEFT JOIN` leaves the unmatched row NULL.
  `median(CAST(v AS DOUBLE))` arrives as a JS `number` (2.5).
- `INSTALL three_d FROM community; LOAD three_d;` and `INSTALL spatial; LOAD spatial;` both work through
  the node harness; whole integration directory runs in ~6 s warm.

---

## 4. Files changed

- `fixtures/composite-solid.city.json` (new)
- `fixtures/invalid-solid.city.json` (new)
- `tests/integration/duckdb/harness.ts` (+24 lines: `installExtension`)
- `tests/integration/duckdb/solids.test.ts` (new, 16 cases)
- `tests/integration/duckdb/crossLayer.test.ts` (new, 13 cases)

Nothing else. `.github/hooks/` and `docs/design-history/` were left untracked and unstaged; no
`.superpowers/` file except this report; the plan file was not edited.

## 5. Self-review findings

- **Completeness vs the brief.** Every step done in order. The two fixtures are the brief's exact bytes.
  `installExtension` is the brief's exact code and comment. Both suites keep the brief's file comments,
  constants, case names and the "later tasks append here" block. The only edits to the brief's test text
  are the ones the engine forced (D1 — the `MEASURE_SQL` clause and the §7.3 case's seven guards; D2 ×2;
  D4's two added assertions on the composite case; D5; and the `keys` spread in §5 below) plus the one
  case the dispatch ordered (D6); each carries a comment saying what the engine returned and why.
- **A lint error I introduced and fixed.** The brief's line
  `expect([...(rows[0]?.["keys"] as string[])].sort())` is a spread of a possibly-`undefined`
  optional-chain, which `vp check` rejects as an ERROR (`Found 1 error and 56 warnings`). Replaced with
  `const keys = (rows[0]?.["keys"] ?? []) as Iterable<string>;` +
  `expect(Array.from(keys).sort()).toEqual(["n", "name"])` — still a behaviour assertion (an absent
  column compares `[]` against `["n","name"]` and fails). Baseline restored to 0/56.
- **No new mocks, no fakes.** Every assertion is a real-engine value. The only doubles are the fixture
  bytes themselves.
- **YAGNI.** Three cases beyond the brief: the two bare-NULL binder pins (D2) and the boundary-point
  predicate pin (D6, ordered by the dispatch). The first two are one-line `toThrow`s that catch exactly
  the mistake a unit-test author would make. Nothing else was added.
- **Case count** 14 → 16 in `solids.test.ts`: the brief's single "makes ST_3DValidationReport(NULL) NULL"
  case became three (bare-NULL refused; constant NULL is NULL; a runtime NULL's fields are garbage and
  only `s IS NULL` discriminates), because the brief's one sentence conflated three different engine
  behaviours.
- **`afterAll`** mirrors `computedColumns.test.ts` (`db?.close()` in a block body) so the type-aware
  no-unnecessary-condition rule stays quiet.
- **Output pristine.** No `console.log` left in either suite (the investigation wrote to the scratchpad
  and its probe file is deleted). No stray files: `git status` shows only the two pre-existing untracked
  directories.
- **Fixture bytes.** `git show HEAD:fixtures/*.city.json` matches what the brief spells, character for
  character — the pre-commit `vp check --fix` pass reformatted neither file (`git diff HEAD -- fixtures/`
  is empty).
- **Commit hygiene.** One commit, `test:` prefix, no trailers of any kind, hooks ran (`vp staged` →
  `vp check --fix`, then the pre-push gates were not invoked because nothing was pushed). Both fixtures
  still parse after the hook's formatting pass and the composite probe still reads them (re-ran green
  after the commit).

## 6. Concerns

1. **D1 is a defect in the plan's SQL, and three later tasks rest on it.** Tasks 6, 7 and 10 must carry
   the `s IS NOT NULL` guard. Until the commander's pre-flight carries that, Task 6's implementer could
   still read the plan's §7.2 text rather than this suite's `MEASURE_SQL`. The comment in the file is my
   best mitigation; the amendment is the commander's.
2. **`r.code` / `r.message` can crash the wasm instance.** Not pinned by a test on purpose (it would
   poison the file's shared harness). If any task wants the validation `message` in a result, it needs
   its own investigation first — under the guard it may well be fine, but I did not verify that and the
   failure mode is a dead engine, not a NULL.
3. **The garbage values are nondeterministic**, so a reviewer re-running the probes will see different
   BIGINTs than the ones tabulated above. The assertions were written to survive that (`IS NOT NULL`,
   never a value); the table is evidence, not a contract.
4. **D4's `GeometryCollection Z`** means no WKB-string test can identify "a solid" across all three
   CityJSON solid types. Task 3's `solidLodOptions` / §7's contributor rule should key on the CityJSON
   geometry type (`geometry_properties_lod*.type`, or the plugin's surface tag from Task 2), never on
   `cityjson_wkb_geometry_type`.
5. **`fixtures/README.md` has no rows for the two new fixtures yet** (Task 28 owns them, per the brief
   and Decision 4). Anyone reading `fixtures/` before Task 28 lands sees two undocumented files.

---

## Fix round 1 (review response)

**Commit:** `aa2d122` `test: pin every remaining three_d and spatial engine fact, and CityJSONSeq parity`
(on `develop`, on top of `c6d3b9d`; no trailers, not pushed). No fixture and no harness change in this
round — only the two suites.

Case counts: `solids.test.ts` 16 → 17, `crossLayer.test.ts` 13 → 18, so the directory runs 67 cases
(was 61).

### Important 1 — every stated fact now has a committed probe

| Fact                                     | Where                                                                                                        | What the engine returned                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orientation_error_count` (D3)           | new `VALIDATE_SQL` constant, asserted in the §7.3 case, the CompositeSolid case and the invalid-fixture case | **1** on `Pand.0001`, **0** on `Pand.0002`, **0** on the CompositeSolid, **NULL** on the unparsed row                                                                                                                                                                          |
| `ST_3DArea` = `ST_3DSurfaceArea`         | new case "answers ST_3DArea and ST_3DBounds…"                                                                | equal on BOTH solids (`388` on the invalid, `1013.4000000000001` on the valid); both NULL on the unparsed row                                                                                                                                                                  |
| `ST_3DBounds` fields and values          | same case                                                                                                    | `STRUCT(min_x, min_y, min_z, max_x, max_y, max_z)` confirmed; VALID `85020/446000/0 → 85035/446012/12.1`, INVALID `85000/446000/0 → 85010/446008/8.4` — i.e. in the file's CRS, translate applied. NULL on the unparsed row                                                    |
| `ST_Centroid` on Z                       | new case "centres and flattens a Z geometry…"                                                                | **KEEPS Z**: `POINT Z (5 5 5)`, `ST_HasZ` **true** — the opposite of what I first assumed, so this was a real RED                                                                                                                                                              |
| `ST_Force2D`                             | same case                                                                                                    | drops Z (`ST_HasZ` false), 2-D area unchanged at `100`                                                                                                                                                                                                                         |
| `ST_Union_Agg` on Z                      | new case "dissolves Z geometries…"                                                                           | area `150` for two 10×10 squares overlapping by 5, and the result **KEEPS Z** (`POLYGON Z (…)`) — also a RED                                                                                                                                                                   |
| predicates/measures accept Z             | new case "accepts a Z geometry in every predicate…"                                                          | over the reader's own MultiPolygon Z vs a 2-D envelope: `ST_Intersects` true, `ST_Within` true, `ST_Area(ST_Intersection(…))` `20`, `ST_Area` `40`, `ST_Distance` `84`                                                                                                         |
| FeatureCollection `read_json(columns=…)` | new case "reads a GeoJSON FeatureCollection…"                                                                | the plan's exact `columns = {type: 'VARCHAR', features: 'STRUCT(type VARCHAR, properties JSON, geometry JSON)[]'}` + `unnest(features)` works; `properties->>'name'`, `(…->>'n')::DOUBLE` and `ST_GeomFromGeoJSON(f.geometry)` (the JSON overload) all read back, area `10000` |
| `ST_Transform` exists                    | new case "has ST_Transform, which the design deliberately does not use"                                      | `ST_Transform(ST_Point(85000, 446000), 'EPSG:28992', 'EPSG:4326')` → `POINT (51.9979621078331 4.3678877793076465)` — note it returns **lat/lon order**, not `always_xy`                                                                                                        |
| `ST_NDims` ABSENT                        | asserted beside `ST_HasZ` in the Z case                                                                      | `Catalog Error: Scalar Function with name st_ndims does not exist!`                                                                                                                                                                                                            |

**New divergence found in this round (D7).** `ST_GeomFromGeoJSON(NULL)`'s ambiguity is CONDITIONAL on
whether the `json` extension is loaded — the committed `toThrow` from round 1 was order-dependent and
started failing the moment the FeatureCollection case (which autoloads `json`) was declared before it:

```
1_BEFORE      THREW Binder Error: Could not choose a best candidate function …
2_EXT_BEFORE  [{"extension_name":"json","loaded":false, …}]
3_FC          [{"name":"A"}]                       ← the first read_json autoloads json
4_AFTER_FC    [{"n":true}]                         ← the SAME bare-NULL call now resolves
5_EXT_AFTER   [{"extension_name":"json","loaded":true, …}]
```

The case is now "refuses a bare NULL in ST_GeomFromGeoJSON until `json` is loaded": it asserts the
overload set from `duckdb_functions()` (`[JSON]` and `[VARCHAR]`, stable in both states), asserts the
Binder Error only when `json` is still unloaded (reachable under `-t`, which is why the branch is there
and commented), then `LOAD json;` and asserts the bare NULL resolves to NULL, and that
`NULL::VARCHAR` works in BOTH states — which is why every statement the app emits carries the cast.
`ST_3DValidationReport(NULL)`'s Binder Error is unconditional and its case is unchanged.

### Important 2 — CityJSONSeq parity over complete rows

The old case selected `id` + `parsed` and asserted "some row parsed". It now runs BOTH full statements
through both readers, swapping only the reader call (`throughSeq(sql)`, a single `String.replace` of
`read_cityjson('two.city.json', lod => '2.2')`), and:

- asserts the id list is exactly `[Pand.0001, Pand.0001-part1, Pand.0002]` (the `.jsonl` fixture carries
  the same three objects over two `CityJSONFeature` lines — so a lost part shows up);
- `expect(seqRows).toEqual(cityjsonRows)` for MEASURE_SQL **and** for VALIDATE_SQL — every column of
  every row, feature ids and NULLs included;
- spells the expected values out on the SEQ side as well (all three validation rows, plus the valid and
  the unparsed measure rows), so the parity assertion cannot pass by both readers being wrong alike.

Result: identical, to the last bit, including `envelope_m2 = 1013.4000000000001`.

### Important 3 — the D1 contract is complete

- `MEASURE_SQL`'s volume condition is now `CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END`
  (it read raw `r.is_valid` before). Verified: `2178` / `null` (invalid) / `null` (unparsed) — unchanged
  values, no longer resting on a garbage bit happening to be readable. The same guard went onto the
  CompositeSolid case and the invalid-fixture case.
- `VALIDATE_SQL` is a named constant selecting `id`, `f`, `parsed` and all EIGHT report fields under the
  guard; the §7.3 case asserts every one of them on all three rows (valid: `true,true,true,true,0,0,0,0`;
  invalid: `false,false,false,false,2,1,0,1`; unparsed: all NULL).
- A new `expectRow(row, expected)` helper replaced every `Number(value)` comparison: a `null`
  expectation asserts NULL, an integer (0 included) asserts by identity, and only a non-integral
  measure uses `toBeCloseTo`. `Number(null)` can no longer satisfy an expected 0 anywhere in the file —
  the old `toBeCloseTo(0, 3)` and `toBeCloseTo(388, 0)` spellings are gone.
- The "answers every OTHER measure on an invalid solid" case now asserts `man`, `ori`, `shells` (1) and
  `faces` (7) as exact values instead of `toBeGreaterThan(0)`.

### Minors

- `VECTOR_TABLE_SQL` is a module constant and the `CREATE OR REPLACE TABLE` runs in `beforeAll`; the
  round-trip case only reads back. Verified with `-t` that the predicate, tie, distance, join and
  bare-NULL cases each pass ALONE: `Tests 1 passed | 17 skipped` five times.
- The largest-overlap case: the comment said "overlaps A by 10 and B by 70" — the real overlaps are
  **600 and 700** (A over 60 in x, B over 70, both 10 tall), now asserted as the full ranked list. A real
  TIE was added: `ST_MakeEnvelope(40, 10, 110, 20)` overlaps both by exactly **600**, so `ORDER BY ov DESC,
idx ASC` picks `idx 0` — source order — while `arg_max(idx, ov)` picks either (asserted as "one of"),
  which is why §7.5 spells the ORDER BY out.
- The CompositeSolid case now asserts `faces` **12**, `solid_count` **2**, `open_edge_count` **0**,
  `orientation_error_count` **0**, `ST_3DSurfaceArea` **12** and `ST_3DFootprintArea` **2** beside the
  validity, 2 shells and volume 2 it already had.

### Covering commands

```
$ export PATH="$HOME/.local/share/mise/shims:$PATH"
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts    # first run, RED
 ❯ tests/integration/duckdb/crossLayer.test.ts (18 tests | 3 failed)
     × centres and flattens a Z geometry …        expected true to be false   (ST_Centroid KEEPS Z)
     × dissolves Z geometries with ST_Union_Agg   expected true to be false   (union KEEPS Z)
     × refuses a bare NULL in ST_GeomFromGeoJSON  expected [Function] to throw an error   (json loaded)

$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb                       # GREEN
 Test Files  4 passed (4)
      Tests  67 passed (67)

$ npx vitest run tests/integration/duckdb                                            # still offline
      Tests  67 skipped (67)

$ for t in "answers the three predicates" "ranks overlapping areas" "bare NULL" \
           "nearest source feature" "LEFT JOIN"; do … -t "$t"; done
      Tests  1 passed | 17 skipped (18)      (× 5)

$ npx vitest run > /tmp/m3-task1-fix1-suite.log 2>&1 & wait $!; echo "suite: $?"
suite: 0
 Test Files  243 passed | 4 skipped (247)
      Tests  2994 passed | 67 skipped (3061)

$ npx vp check      → Found 0 errors and 56 warnings in 531 files
$ npx tsc -b --noEmit → clean (exit 0)
```

`solids.test.ts`'s 17 cases passed first try in this round — every expected value there came from the
plan's own Facts section or from round 1's probe output, so there was no RED to stage for them; the
three REDs above are the round's genuine discoveries.

### Concerns after this round

1. **D1's amendment list is unchanged and still outstanding** for Tasks 6, 7 and 10 — plus, now, the
   volume condition's guard: Task 6's builder must emit `CASE WHEN s IS NOT NULL AND r.is_valid THEN
ST_3DVolume(s) END`.
2. **D7 is order-dependent by nature.** The one case with a conditional branch in this suite is the
   bare-NULL one, and it is conditional because the engine's answer genuinely depends on session state.
   If a reviewer prefers no branch, the alternative is to drop the pre-load assertion and keep only the
   overload set plus the post-`LOAD json` behaviour.
3. **`ST_Centroid` and `ST_Union_Agg` keep Z** (newly pinned). Any Task 12–19 SQL that feeds their output
   into something expecting a 2-D geometry needs `ST_Force2D`; the plan does not say so anywhere.
4. `fixtures/README.md` rows remain Task 28's.

---

## Fix round 2 (scoped re-review response)

**Commit:** `208503d` `test: pin the unloaded-json state on its own connection, and the CompositeSolid's
report flags` (on `develop`, on top of `e162753`; no trailers, not pushed). Only the two probe files
changed. `crossLayer.test.ts` 18 → 19 cases, `solids.test.ts` unchanged at 17; the directory runs 68.

### Required 1 — D7's unloaded state is now reachable by construction

**The regression was real.** Round 1 moved `VECTOR_TABLE_SQL` into `beforeAll`, and its `read_json`
autoloads `json` before ANY case in that describe — filtered runs included. My `-t` isolation evidence
proved only that the case passed, not that it took the unloaded branch. It did not.

**The fix** is a second `describe`, declared FIRST in the file, on its OWN engine:

- `describe.skipIf(!enabled)("spatial BEFORE the json extension loads", …)` — its `beforeAll` calls
  `openDuckDB()` again (a separate module instance, so its extension state is independent), installs
  `spatial`, registers the NDJSON bytes, and issues NO JSON expression of any kind.
- Its single case runs, in order, with no conditional anywhere in the body:
  1. `jsonLoaded(db)` → **false**;
  2. `ST_GeomFromGeoJSON(NULL)` → **raises** `Could not choose a best candidate function`;
  3. `ST_GeomFromGeoJSON(NULL::VARCHAR) IS NULL` → **true** (the cast works in the unloaded state, which
     round 1 never showed);
  4. `db.query(VECTOR_TABLE_SQL)` — the transition, by the very statement the suite below runs in setup;
  5. `jsonLoaded(db)` → **true**;
  6. `ST_GeomFromGeoJSON(NULL) IS NULL` → **true**, and the cast still → **true**.
- The main suite's case was rewritten as the loaded-state pin only ("publishes both
  ST_GeomFromGeoJSON overloads, and resolves a bare NULL once json is loaded"): it asserts
  `jsonLoaded(db)` is **true** up front, the overload set `["[JSON]", "[VARCHAR]"]`, and both spellings
  returning NULL. The `if (jsonLoaded())` branch is gone from the file; `jsonLoaded(db: Harness)` is now
  a module-level helper taking the connection, so both describes share it.

**Both branches execute in a normal run and under `-t`**, and a mutation proves the unloaded branch is
not vacuous — adding `db.query("LOAD json;")` to the new describe's `beforeAll` makes the case FAIL:

```
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts \
    -t "refuses a bare NULL until the first read_json"      # with LOAD json injected into beforeAll
⎯⎯⎯ Failed Tests 1 ⎯⎯⎯
AssertionError: expected true to be false // Object.is equality      ← jsonLoaded(db) must be false
      Tests  1 failed | 18 skipped (19)
```

(injection reverted immediately; `git diff --stat` confirmed the file was back to the committed shape).

Unfiltered and filtered runs, all green:

```
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts tests/integration/duckdb/solids.test.ts
      Tests  36 passed (36)
$ -t "refuses a bare NULL until the first read_json"   → Tests  1 passed | 18 skipped (19)
$ -t "publishes both ST_GeomFromGeoJSON overloads"     → Tests  1 passed | 18 skipped (19)
$ -t "answers the three predicates"                    → Tests  1 passed | 18 skipped (19)
$ -t "ranks overlapping areas"                         → Tests  1 passed | 18 skipped (19)
```

### Required 2 — the CompositeSolid's remaining report fields

The case now selects and asserts, beside what it already had: `is_closed` **true**, `is_manifold`
**true**, `is_oriented` **true**, and the report-level `shell_count` **2** and `face_count` **12** —
which agree with the standalone `ST_3DNumShells` / `ST_3DNumFaces` the case already pinned — plus
`non_manifold_edge_count` **0** and `degenerate_face_count` **0**. Every one of them carries the
`s IS NOT NULL` guard, like every other report read in the file. So the shared face `x = 1` does NOT
make the composite non-manifold in `three_d`'s reading.

### Covering commands

```
$ export PATH="$HOME/.local/share/mise/shims:$PATH"
$ DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb
 Test Files  4 passed (4)
      Tests  68 passed (68)

$ npx vitest run tests/integration/duckdb        # default run, offline
      Tests  68 skipped (68)

$ npx vitest run > /tmp/m3-task1-fix2-suite.log 2>&1 & wait $!; echo "suite: $?"
suite: 0
 Test Files  244 passed | 4 skipped (248)
      Tests  3004 passed | 68 skipped (3072)

$ npx vp check        → Found 0 errors and 56 warnings in 533 files
$ npx tsc -b --noEmit → clean (exit 0)
```

### Concerns after this round

1. The second `openDuckDB()` costs one extra engine boot in this file (~1 s; the extension binaries are
   already cached by then). It is the price of a deterministic unloaded state — DuckDB has no `UNLOAD`.
2. D1's amendment list for Tasks 6, 7 and 10 is still outstanding, volume guard included.
3. `ST_Centroid` and `ST_Union_Agg` keeping Z remains a fact no plan task accounts for.
4. `fixtures/README.md` rows remain Task 28's.
