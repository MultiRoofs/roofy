Read M2 sequentially through line 3640, the full spec and hard rules; skimmed M1 and checked its ledger. Findings below reference the [M2 plan](/data2/hideba/multiroof-viewer/docs/superpowers/plans/2026-09-11-processing-toolbox-m2.md).

1. **MAJOR — Wrong contributor rule (232–235, 2638–2641, 2683–2691).** §7 selects parts when any part has **geometry**, not specifically roof surfaces. A root roof plus a wall-only part at the same LoD incorrectly measures the root. Carry geometry-presence-by-LoD separately, including in resident records; test this case and align LoD eligibility/counts.

2. **MAJOR — Streaming support is incomplete, not merely an unchanged seam (204–214, 3481–3485).** The M1 ledger deferred streaming Details/rules write-back **to M2**; it did not approve indefinite exclusion. §7.1/§8 require those results. Keep streaming, but add publication/Undo support or obtain an explicit renewed scope exception. LoD tagging itself is small and sound, subject to finding 1.

3. **MAJOR — Style-by-result reuse is incorrect for nullable measures (69, 3600).** Azimuth-only runs over flat roofs have `measured > 0` but every output NULL. The existing `summary.measured === 0` gate leaves Style enabled. Track non-null values for the first written column within the run; test azimuth-only and zero-area slope/share cases.

4. **MAJOR — Form tests remain placeholders (2810–2867, 3078, 3611).** `addRoofLayer`, imports, mocks and setup are omitted. Worse, Task 6’s suggested fixture represents **one** roof-bearing feature across two LoDs, contradicting the “two buildings” description. Supply complete fixtures and runnable tests; remove the false placeholder-scan claim.

5. **MAJOR — Subscription tests do not establish the promised behaviour (301–332, 823–1008).** Unsubscribe is never followed by a transition; the render test starts after a previous test already left the engine failed. Chips simulate the publisher instead of testing `ensureExtension` publication. Use a controlled package-level fake beneath real `duckdb.ts`; assert observed initializing/ready/loading/failed/loaded transitions, retry deduplication and no notifications after unsubscribe. Use `act` unconditionally.

6. **MAJOR — Resident type change breaks existing producers (1417, 1514–1554).** Adding required `lod` preserves compatibility for readers, not for hand-built records. Existing typed metrics in `tests/unit/ui/drawer/layerSummary.test.ts:79–86` and `tests/unit/insights/computeStats.test.ts:147–179` lack it. Include these fixture updates with the pointer bump; do not misdiagnose resulting errors as an incorrectly written extension type.

7. **MAJOR — Invalid JSX (3320–3324).** The semicolon inside `{condition && (...)}` prevents compilation. Remove it and explicitly add the `RoofMetricsParams` import, also missing from Task 10’s integration instructions.

8. **MAJOR — CPU work is underestimated (1834–1872, 2737–2743, 2939–2960).** Merely opening the LoD select measures every roof at every LoD; execution repeats that for the whole layer even for Selected scope. These synchronous walks block interaction and cancellation. Count eligibility from tags alone; measure only scoped contributors at the chosen LoD, with bounded batches and cancellation checks.

9. **MAJOR — Engine-death recovery disappears from the handoff (33, 3411–3497, 3609).** M1 ledger line 139 explicitly assigns this design task to M2. Publishing existing status assignments does not detect a dead worker, fail queued runs, rebuild tables or invalidate Undo. Add that task, or explicitly seek a scope deferral and retain the gap in documentation.

10. **MAJOR — Unimplemented tools display fabricated geometry facts (2203, 2930–2937, 3008–3017).** Measure/Validate get a visible “No solid geometry in this layer” without inspecting geometry. Their forms remain reachable. Hide the unsupported LoD control until implemented, or provide truthful deferred-state copy flagged for approval.

11. **MAJOR — Offline smoke promises an unsupported path (3549–3556).** Cold reload needs CDN worker/WASM assets; reader-backed tables also need `cityjson`. Neither working tool is guaranteed runnable offline. Distinguish cached-engine/ready-table tests from cold offline reload, explicitly record prerequisites, and label cold-offline acceptance unmet.

12. **MAJOR — Roof lifecycle coverage stops at pure helpers (2309–2505, 3537–3543).** No test drives the actual executor through publication, replacement, Undo or streaming invalidation. Add behaviour tests with unequal roof-bearing parts, scoped replacement preserving outside values, and cancellation/rebuild preventing publication. The current single-part fixture cannot establish cross-part weighting.

13. **MINOR — Activation precedes its prerequisites (29, 2225–2229).** Task 7 enables Roof before its executor, LoD field and validation exist; the prose simultaneously claims the same commit and separate commits. Enable it after Tasks 8–10, with a registration/usable-form check.

14. **MINOR — Result/log coverage is incomplete (2729–2743, 3539–3541).** The streaming qualifier appears only in the form, although scenario 4 requires it on the card. Untouched parameters remain `{}`, so the log omits the actual default measures/threshold. Freeze normalized parameters at submission and retain resident-scope context in the result.

15. **MINOR — Several “exact facts” and rationales are wrong (75–77, 97, 117, 179, 354–355, 566–568).** `getDuckDBStatus()` returns the same stored object between transitions; mock allocation is not a production need for a version counter. A version counter can work, but fix the rationale or use the stable status snapshot. `aggregate.ts` already has area-weighted slope and the correct ordinary surface count; reject reuse for azimuth, threshold and empty-value semantics. Correct citations: initializing is `duckdb.ts:199`, failed `:242`, cityjson load `:236`; source-column revalidation is `runQueue.ts:419–442`, not `352–372`.

16. **MINOR — Copy and review assertions overclaim (1343–1346, 2211–2212, 3568–3573, 3630).** The strict-threshold comment reverses its own logic; the roof long description is non-spec copy absent from the adaptation list; “none blocks execution” conflicts with question 9. Correct these. Include the submodule diff in the milestone review and require MAJOR findings resolved, matching M1’s gate.

Citation spot-checks included `runQueue.ts:85–108,510–514,575–589`, `scope.ts:126–137`, `types.ts:18–49`, `useToolForm.ts:57–72,131–152`, `ToolView.tsx:74–85`, `duckdb.ts:91–109,139–154,275–290`, `objectRecords.ts:33–35`, `fcb.worker.ts:408`, and `residentModel.ts:46–53`. Wrong claims are reported above.

Final questions: **1–3:** accept proposed copy. **4:** keep the advisory offline sentence and retain the engine error in the log. **5:** accept labels, but expose “0–1”, weighting and largest-surface explanations. **6:** all six on. **7:** strict `<`, matching “under”; correct the contradictory comment. **8:** keep streaming with findings 1–2 addressed. **9:** approve the single-owner subscription rule change; retain `retryEngine()` for boot/engine Retry and the sole-importer rule. Correct the snapshot rationale first.

**Fix first**
