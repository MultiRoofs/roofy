### Task 25

#### Spec Compliance

The implementation matches design (h): one private race in `duckdb.ts`, no new exports or status writer, and all six primitives return their required death fallbacks. Healthy calls retain their values, error formatting and immediate query issuance; the wrappers add promise turns. The real-module ordering test correctly pins `EngineDeadError` winning the outer race.

`retryEngine` captures generation after starting boot, before awaiting it. Tests cover ordinary-boot rebuilding, abandonment after a later generation change, and retained parked sources.

The Undo regression clears the trace before Undo and waits for COMMIT plus the blocked refresh before delivering death. It checks preserved model values and provenance, no “Undone” note, `engineStopped`, and FIFO release.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

- **The requested caller-settlement coverage is incomplete.** The diff exercises the real export dialog, export writer, counts hook and median hook, but contains no corresponding death-settlement cases for the grid query, map-filter synchronization or Stats tab. The primitive tests prove the engine promise settles; they do not prove these consumers release their loading state and expose their failure correctly. Add behavioral cases through those real modules before treating the requested caller verification as complete. See the coverage claim in [duckdb.ts](/data2/hideba/multiroof-viewer/src/insights/duckdb.ts:226).

##### Minor (Nice to Have)

- The Undo test asserts `note !== "Undone"` and `engineStopped`, but does not explicitly assert the controller ruling that the record remains `status: "done"`. Add that assertion in [engineDeath.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/processing/engineDeath.test.ts:265).

### Task 26

#### Spec Compliance

The approved eight palette values are implemented in order. Rotation selects the first unused enabled-rule colour, compares case-insensitively, and wraps by total rule count. Both draft entry points use it, and manual Add reads current rules at click time.

Draft opening leaves Surface and Single modes unchanged. Result-draft submission switches either mode to Rules; manual submission retains `ensureRulesMode`. The deferred-median test covers the undone-run guard.

The `StyleSection` deviation is justified: it makes the draft reachable before the mode changes. Its per-layer `open === true` subscription does not expose an editor on a non-rules layer without an open draft. No new persistence is introduced.

#### Issues

##### Critical (Must Fix)

None found.

##### Important (Should Fix)

None found.

##### Minor (Nice to Have)

- The collision tests omit explicit comparisons against `SINGLE_COLOR_HEX` and `UNMATCHED_COLOR_HEX`. The actual palette is distinct from both, so this is a regression-coverage gap rather than a current collision. Extend [cityColors.test.ts](/data2/hideba/multiroof-viewer/tests/unit/scene/cityColors.test.ts:109).

### Cross-task

No introduced inconsistency found. Task 26 preserves Task 25’s median-failure handling. The two approved Task 24 commits were excluded from findings. The ruled `queryParquetBuffer` and `ensureExtension` residuals remain outside this gate.

No tests were rerun; reported execution results were not independently reproduced.

### Assessment

**Task 25 quality:** Needs fixes — the implementation appears correct, but the requested caller-settlement verification is incomplete.

**Task 26 quality:** Approved — the behavior and justified editor-gate change meet the requirements, with a minor collision-test gap.
