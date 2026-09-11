### Finding verdicts

- **[1 — Geometry-based contributors]** — ADDRESSED: LoD counts now apply execution’s contributor rule (1899–1902, 2409–2445).
- **[4 — Complete form tests]** — NOT ADDRESSED: scaffolding is supplied, but the empty-state query matches both option and footer text (4442–4448, 4592–4594, 4623–4624).
- **[5 — Real subscription coverage]** — NOT ADDRESSED: real publication and boot failure are covered; chip tests retain loaded extension state between cases (388–403, 1077–1079, 1136–1265).
- **[7 — Invalid JSX/import]** — ADDRESSED: valid fragments and explicit component import replace the broken snippets (4611–4642, 4948–4987).
- **[12 — Executor lifecycle coverage]** — NOT ADDRESSED: fixture arithmetic, threshold, registration and rebuild setup remain defective; cancellation still precedes CPU computation (3584–3825).
- **[13 — Activation ordering]** — ADDRESSED: Task 12 follows prerequisites; opening constraint corrected (29, 5076, 5194–5200).
- **[15 — Incorrect facts/rationales]** — NOT ADDRESSED: prescribed comments still imply Retry reboots a ready engine and cancellation requires the new method (1368–1371, 5256–5258).
- **[16 — Copy/review overclaims]** — NOT ADDRESSED: assembly limitations are acknowledged, but “runnable as given” and verified-type claims remain inaccurate (5483–5503).
- **[N1 — Existing protocol tests/producers]** — ADDRESSED: preserves existing coverage and updates the identified submodule producer (1670–1693, 1843–1869).
- **[N2 — Shared fixture consistency/types]** — ADDRESSED: B3, five rows and correctly imported scalar `ColumnInfo` supplied (4174–4179, 4213–4291).
- **[N3 — Tasks 10–12 scaffolding]** — ADDRESSED: working registry mock, imports and resets supplied, with explicit reuse/removal instructions (4304–4415, 4686, 5080–5135, 5198).
- **[N4 — Invented UI helper]** — ADDRESSED: checkout confirms `runFixture`, `doneRun` and `addCityLayer`; positive summaries preserved (3951–4020).
- **[N5 — Ineffective lifecycle examples]** — NOT ADDRESSED: deferred gate shape is corrected, but replacement expectations remain impossible and cancellation never reaches a batch (3590, 3600–3618, 3741–3790).
- **[N6 — Cancellation rationale/check placement]** — NOT ADDRESSED: checks are correctly placed after query/yield, but the prescribed architecture note retains the false rationale (3541–3557, 5256–5258).
- **[N7 — Acceptance/explanatory work]** — ADDRESSED: known-flat fixture procedure, measure hints and retained engine error are specified (919–931, 2640–2676, 4880–4884, 5375).

### New problems introduced by this amendment

1. **MAJOR — Chip suite shares a loaded singleton** (1077–1079, 1136–1148, 1172–1224). The successful spatial load makes subsequent failure/Retry cases return immediately as loaded. **Fix:** reset modules and re-import the complete consumer/store graph per case; use a controlled deferred for the loading assertion (1244–1270).

2. **MAJOR — Lifecycle geometry and threshold contradict assertions** (3600–3618, 3663, 3718–3720, 3741–3762). The pitched surface’s area is `30√2`, not 30; threshold 50 clamps to 15, leaving its 45° roof non-flat. **Fix:** construct a true 30 m² roof at, for example, 10°, then compare thresholds 5 and 15.

3. **MAJOR — Lifecycle scaffolding still cannot support its cases** (3584–3588, 3793–3825). The cited `runQueue.test.ts:1–235` excludes `deferred`, `request` and resets, which extend through line 301. Deleting the executor after each case loses its one-time registration. Reassigning `tableInfo` after preflight triggers no further rebuild check; the stale test lacks an initial table-store entry. **Fix:** copy through line 301, register the real executor in each `beforeEach`, test rebuild at the supported boundary, and seed the stale watcher’s prior state.

4. **MINOR — Empty-LoD assertion has multiple matches** (4442–4448, 4592–4594, 4623–4624). **Fix:** assert the disabled combobox’s option and footer reason separately using scoped queries.

### Residuals

- Repair lifecycle scaffolding, geometric fixture and replacement/Undo expectations.
- Isolate chip-test module state and deterministically hold the loading transition.
- Add cancellation coverage after at least one real CPU batch, asserting no subsequent batch or publication.
- Scope the empty-LoD test queries.
- Remove surviving false cancellation/Retry explanations and revise runnable/verification claims.

### Verdict

Fix first.
