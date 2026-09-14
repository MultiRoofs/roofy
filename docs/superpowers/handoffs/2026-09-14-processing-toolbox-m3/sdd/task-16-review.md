### Spec Compliance

The implementation satisfies the main Task 16 requirements: per-feature joins copied to roots and parts, scope-wide identity checks, B7 field validation, boundary-inclusive predicates, deterministic overlap ties, typed SQL reads, card accounting, registration, and both real-footer styling branches.

One end-to-end value-preservation requirement fails during the shared write step.

### Strengths

- Real-engine tests exercise the builder’s predicates, equal-overlap tie, footprint contributors, and no-proxy behavior.
- Real-queue tests assert model publication, cancellation, engine death, resource cleanup, and FIFO release.
- Reuses existing identity, column-definition, and styling interfaces without widening the footer contract.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- **Copied text can acquire JSON quotes during publication.** The executor’s typed results pass through [computedColumns.ts:67](/data2/hideba/multiroof-viewer/src/insights/computedColumns.ts:67), which uses untyped `read_json_auto`. An in-memory probe against the installed engine confirmed that when the first 20,480 values are NULL and the next is an empty string, inference chooses JSON and the VARCHAR destination receives `""`—two literal quotation marks—instead of an empty string. Ordinary all-NULL and early-empty cases preserve their values correctly.

  This violates §7.5 and makes table values disagree with the model’s published values. Preserve the declared column types when reading the values file, and add an engine-backed write regression for text appearing after an all-NULL sample. Existing join engine tests stop before this write; the queue test mocks it.

#### Minor (Nice to Have)

- The count-only test starts with `writeMatchCount: true`, so it does not prove that count-only **forces** the checkbox’s false value to true. Add that input and assert the resulting count column and value.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The join computation and lifecycle are well covered, but the verified values-file inference defect corrupts valid copied text during publication. Typed write preservation needs fixing before this task passes.
