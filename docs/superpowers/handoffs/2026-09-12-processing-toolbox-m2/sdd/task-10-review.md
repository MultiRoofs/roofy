### Spec Compliance

The implementation matches the task’s functional requirements:

- `summarise` counts non-null values in the first written column; the footer gates on that count instead of `measured`.
- Explicit null/undefined checks correctly count computed `0` as a value. Zero-area slope/share return NULL and therefore disable styling.
- Counting written rows is appropriate for this internal emptiness check: a root with a value and NULL parts keeps styling enabled. It does not replace the feature-based `measured` count.
- Both completion paths pass `layer.isStreaming` from the layer captured during execution.
- The accepted resident-set copy appears in the card’s detail paragraph, alongside skip details. Toasts retain `summary.line`; the separate “Undone” note remains intact.
- Positive fixtures have positive counts, ToolView tests use existing helpers, and test imports use `"vitest"`. Indexed access is guarded.

### Strengths

The change is small and centralised, preserves stale-state precedence, and retains the readable disabled reason. Both empty-output and successful-publication paths were updated consistently.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

- Expand the [summary tests](/data2/hideba/multiroof-viewer/tests/unit/features/processing/runQueue.test.ts:1793) with computed `0`, zero-area slope/share, root-value/NULL-parts, and two-column cases. The current “FIRST output column” test supplies only one column, so it cannot detect accidentally counting another column. These behaviours are correct by inspection but lack explicit regression coverage.

### Assessment

**Task quality:** Approved  
**Reasoning:** The implementation satisfies the gate and resident-set requirements without an identified functional regression. Test coverage could better pin the boundary cases; reported suite and lint results were not independently rerun, as instructed.
