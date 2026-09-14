### Spec Compliance

Partially compliant. The diff implements the required table shape, explicit `props: 'JSON'`, stable IDs, GeoJSON IDs, raced registration and cleanup, both registration-failure classifications, and the corrected `:240` citation. The real-engine probe runs the actual builder over the encoder’s bytes and verifies heterogeneous properties and `GEOMETRYCOLLECTION`.

Two binding requirements remain unmet: entering `"source"` before `resolveScope`, and bounding serialization/copying within one large feature.

### Strengths

- SQL generation is centralized, quoted, and exercised against real DuckDB.
- Buffer cleanup happens after CREATE; the run’s finalizer releases both table and buffer through death-raced calls.
- Static tracing shows death during CREATE reaches cleanup and releases the real FIFO. Reader and vector handles use separate names and finalizers, so neither clobbers the other.
- Tests verify meaningful output and cancellation behavior, including late registration cleanup and the death-versus-memory distinction.

### Issues

#### Critical (Must Fix)

1. **The byte budget does not bound a single feature.** In [vectorTable.ts](/data2/hideba/multiroof-viewer/src/features/processing/vectorTable.ts:156), `JSON.stringify`, UTF-8 encoding, and `out.set` each process an entire feature before checking their budgets. For a source containing exactly one huge WKT, both loops skip their yield entirely. Cancel cannot arrive during that work, contrary to residual B8.

   Serialize/encode long values and copy buffers in bounded pieces with checkpoints and macrotask yields. Add a timer-delivered cancellation test containing **exactly one** long WKT; the current test adds a second feature and only proves cancellation between features.

2. **The vector source phase still starts after the scope query.** [runQueue.ts](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:869) enters `"source"` after `resolveScope`; the earlier phase guard covers only `tool.needsReader`. This directly violates the commander’s ruling and leaves vector runs displaying queued or extension status while scope resolution holds the FIFO.

   Extend the pre-scope phase guard to vector sources and test the displayed phase while scope resolution is held pending.

#### Important (Should Fix)

1. **Lifecycle tests do not establish the claimed queue guarantees.** [crossLayerRun.test.ts](/data2/hideba/multiroof-viewer/tests/unit/features/processing/crossLayerRun.test.ts:594) uses a replacement FIFO and inert death listeners. Its cancellation case exits before creating resources; success/failure cases assert table-drop statements without verifying buffer cleanup. The module tests likewise never deliver engine death during CREATE or cleanup.

   Add queue-level cases for cancellation after CREATE, death during CREATE and cleanup, and simultaneous reader/vector handles. Assert resource cleanup and that a subsequent FIFO task executes.

#### Minor (Nice to Have)

None.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The table representation and ordinary lifecycle are well structured, but single-feature work remains unbounded and the explicit phase-order ruling is unmet. The reported passing runs do not cover the missing queue lifecycle guarantees; no tests were rerun.
