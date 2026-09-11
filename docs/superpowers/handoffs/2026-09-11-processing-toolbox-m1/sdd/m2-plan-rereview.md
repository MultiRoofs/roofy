Read the full plan through line 4946, full spec, hard rules, and prior review; spot-checked checkout sources. All line numbers below refer to the amended plan.

### Finding verdicts

1. **[1 — Geometry-based contributors]** — NOT ADDRESSED: execution is corrected (3229–3241), but LoD counts still include excluded root roofs (2213–2245).
2. **[2 — FCB Details/rules write-back]** — DEFERRAL STATED (212–218, 4881, 4945).
3. **[3 — Nullable Style-by-result gate]** — ADDRESSED: centrally counts first-column values and updates the footer gate (3656–3716); test defect below.
4. **[4 — Complete form tests]** — NOT ADDRESSED: omitted scaffolding and invalid activation shim remain (3886–3917, 4196–4310); fixture defects below.
5. **[5 — Real subscription coverage]** — NOT ADDRESSED: Task 1 improves coverage, but chips still simulate publication, `act` remains conditional, and boot failure is untested (372–475, 1001–1018, 1137–1153).
6. **[6 — Parent resident fixtures]** — ADDRESSED: explicitly updates both identified parent fixtures (1740–1757); additional submodule breakage below.
7. **[7 — Invalid JSX/import]** — NOT ADDRESSED: import added, but illegal expression semicolons remain at 4150, 4462, 4477.
8. **[8 — Excessive CPU work]** — ADDRESSED: tag-only options, scoped measurement, macrotask batches (2124–2245, 3229–3313); cancellation placement caveat below.
9. **[9 — Engine-death recovery]** — DEFERRAL STATED: mechanism and open question present (4859–4877, 4946).
10. **[10 — Fabricated solid-geometry verdict]** — ADDRESSED: unimplemented tools return no LoD choices and render no LoD field (4050–4051, 4125).
11. **[11 — Unsupported offline smoke]** — ADDRESSED: warm prerequisites explicit; cold reload labelled UNMET (4811–4819).
12. **[12 — Executor lifecycle coverage]** — NOT ADDRESSED: unfinished fixture, ineffective replacement/Undo case, and no demonstrated cancellation during computation (3339–3483).
13. **[13 — Activation ordering]** — ADDRESSED: Task 12 follows prerequisites (4559–4629); correct stale “Task 8” instruction at line 29.
14. **[14 — Result/log completeness]** — ADDRESSED: resident qualifier and normalized submitted parameters specified (3652–3699, 4481–4485).
15. **[15 — Incorrect facts/rationales]** — NOT ADDRESSED: corrected overview conflicts with prescribed comments/docs (494–498, 571–575, 704–711); stale citations remain at 119 and 181.
16. **[16 — Copy/review overclaims]** — NOT ADDRESSED: threshold and review gate corrected (1486–1492, 4835–4845), but completeness claims remain false; “none is a prerequisite” conflicts with “do block” (4911–4934).

### New problems introduced by the amendment

1. **MAJOR — Task 5 would overwrite existing protocol tests and misses producers (1553, 1570, 1686–1737).** `navara-flatcitybuf/tests/objectRecords.test.ts` already exists. Its exact payload-key and metric-equality assertions reject both additions; `streamLayer.test.ts:152–165` constructs a required-field record without `geometryLods`. **Fix:** extend the existing suite, preserve its coverage, update payload expectations and all typed producers before the submodule gate.

2. **MAJOR — Shared fixture is inconsistent and fails typing (3768–3770, 3822–3832, 3868–3882).** It promises four features including a wall-only building but supplies three features/four rows, omitting B3. Both columns omit required `ColumnInfo.kind`; that type lives in `columnKind.ts`, not the cited module. **Fix:** include B3, set `rowCount: 5`, use typed objects and `kind: "scalar"`, and align mocked feature counts.

3. **MAJOR — Tasks 10–12 lack executable test setup (3886–3917, 4196, 4571–4611).** The copied `ToolView.test.tsx:1–60` range stops before the complete counts mock. The getter spy targets a plain data property and is never called. Parameters/activation suites omit imports and reset/cleanup setup. **Fix:** supply complete scaffolding and one working registry mock for Tasks 10–11; remove it in Task 12 and test the real registry with isolated state.

4. **MAJOR — Task 9 invents its UI helper (3612–3619).** `renderDoneRun` does not exist in `ToolView.test.tsx`; the checkout uses `doneRun`, `runFixture`, rendering and `act`-wrapped store updates. The production `summarise` interface and both call-site updates are otherwise consistent. **Fix:** write the test using those actual helpers; update positive summary fixtures with positive counts rather than mechanically defaulting them to zero.

5. **MAJOR — New lifecycle examples cannot establish their claims (3379–3483).** Changing threshold while writing only area leaves values unchanged; B2’s outside-scope value is already NULL. `gate?.resolve()` is invalid for the cited `{ needle, promise }` gate, and immediate cancellation never establishes entry into a compute batch. **Fix:** provide the complete fixture and deferred handles, replace a threshold-dependent value, preserve a non-null outside value, and synchronize cancellation/rebuild after execution demonstrably starts.

6. **MINOR — Cancellation rationale and check placement are wrong (2682, 3035–3044, 3301–3313).** M1 already prevents aborted publication at `runQueue.ts:515` and recognizes `signal.aborted` in its catch. `heightFromExtent` remains compatible. The new check occurs before yielding, allowing another batch after cancellation arrives during that yield. **Fix:** check after the query and after each macrotask yield; describe the method as improving responsiveness, not enabling cancellation correctness.

7. **MINOR — Acceptance and explanatory work remains unspecified (4805, 4939–4940).** A 15° threshold cannot guarantee all roofs become flat. Required measure explanations remain “Not yet placed”; offline handling discards the underlying engine error rather than recording it. **Fix:** use a known flat-roof fixture, specify the explanatory UI text, and explicitly retain the engine failure in the log.

### Verdict

Fix first.
