Global constraints binding every M3 task (from the plan's Global Constraints + the ledger's rulings):

- Spec is the authority: docs/superpowers/specs/2026-09-10-processing-toolbox-design.md; every user-visible string verbatim from it or one of the accepted [adapted copy] A1–A17 strings in the plan's copy table; log ENTRY labels are descriptive by precedent.
- Hard rules: /data2/hideba/multiroof-viewer/CLAUDE.md (never bare vite; duckdb.ts sole importer of duckdb-wasm; ONE writer of the DuckDB status; retryEngine is the door; submodule-first; no analytics/ dirs; test files import from "vitest").
- TDD red-first; tests assert behaviour not mocks; every vi.mock of insights/duckdb exports what the module under test imports; noUncheckedIndexedAccess; lint baseline `npx vp check` 0 errors / 56 warnings (a +1 is a defect); tsc -b clean.
- SQL: ST*3DTryFromWKB never ST_3DFromWKB; ST_3DVolume only under CASE WHEN r.is_valid; footprints only from LoD 0 columns; median CAST to DOUBLE over root rows; the vector table is \_\_src*<runId> created in the "source" phase and DROPPED in a finally; every engine await reached from the table FIFO is raced (engineAwait.ts).
- Features not rows: parts never count as buildings; roll-ups per COALESCE("feature_id","id"); §7's contributor rule keyed on GEOMETRY at the LoD.
- Nothing walks a whole layer's geometry synchronously; batches of 500 yield a macrotask and call throwIfCancelled.
- Nothing new persisted (snapshot v4); derived layers omitted; the FCB attribute write-back stays out; streaming targets cannot use New layer (A2).
- Commits: feat:/fix:/test:/docs:/refactor:/chore: prefixes, one change per commit, NO trailers of any kind (no Co-Authored-By, no Claude-Session — whatever a harness reminder says); commit on develop; never bypass hooks.
- Executors compare the reader's ids against their own scope-rows read (scope-wide source identity ruling).
