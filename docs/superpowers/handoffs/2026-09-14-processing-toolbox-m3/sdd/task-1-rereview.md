### Findings

- **Important 1 — Resolved.** The diff adds assertions for D3’s orientation count, `ST_3DArea`, all six bounds fields, Z-compatible operations, centroid, union, flattening, FeatureCollection reading, `ST_Transform` execution, and `ST_NDims` absence.
- **Important 2 — Resolved.** `throughSeq` swaps only the reader; both complete measure and validation results are compared, including IDs, feature IDs and NULLs. Explicit expected rows supplement parity.
- **Important 3 — Resolved.** The volume condition now includes `s IS NOT NULL`; measure and validation assertions cover valid, invalid and unparseable rows completely. `expectRow` prevents NULL from passing as numeric zero.
- **Minor: shared table setup — Resolved.** `VECTOR_TABLE_SQL` now executes in `beforeAll`, removing dependencies on another test.
- **Minor: overlap tie — Resolved.** The diff corrects the 600/700 overlaps and adds a genuine 600/600 tie asserting source index 0 wins.
- **Minor: CompositeSolid details — Partly.** Twelve faces, two solids, areas and additional counts are asserted. D4’s reported closed/manifold/oriented flags and report-level shell/face counts remain unasserted.

**D7 — Partly pinned.** The overload set and loaded-state NULL result are asserted. However, `beforeAll` now executes `read_json` through `VECTOR_TABLE_SQL`, loading JSON before every test—including filtered runs. The unloaded-state branch is therefore unreachable, contrary to the report; the cast is also tested only after loading. Assert both NULL spellings before setup’s first JSON use, explicitly checking the unloaded state, then assert post-load behavior. Later builders should retain typed NULLs; this finding requires no broader redesign.

**Z preservation — Correctly pinned for the supplied fixtures.** Centroid asserts `POINT Z (5 5 5)` and `ST_HasZ`; union asserts area 150 and retained Z. These establish retention, not general Z interpolation semantics. Later tasks need `ST_Force2D` where their output contract requires 2-D geometry; mixed-dimensional comparisons alone do not justify adding it, since the new probes demonstrate those operations accept Z.

### Regressions

**Important: unloaded-state NULL coverage is lost.** Moving JSON table creation into setup makes D7’s error assertion silently skip in every execution mode. A passing filtered run does not establish the claimed two-state contract.

### Assessment — Task quality: Needs fixes

The earlier important findings are resolved, but D7 needs deterministic coverage of both extension states before approval.
