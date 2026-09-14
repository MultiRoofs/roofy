### Findings

- **Critical — single-feature byte budget: Partly resolved.** The `vectorTable.ts` diff adds `TEXT_SLICE`, slices WKT escaping/encoding, and bounds each `out.set`. Exactly-one-long-WKT cancellation coverage is added. However, `JSON.stringify({ …, props: f.properties })` and the subsequent `write(head…)` still serialize and encode the entire property bag synchronously. Scalar strings and property counts have no demonstrated size bound. A single feature with large properties therefore retains the original responsiveness defect.

- **Critical — `"source"` before `resolveScope`: Resolved.** The `runQueue.ts` diff extends the pre-scope guard to `tool.needsReader || tool.sourceKind === "vector"` and removes the later duplicate patch. The new scope-gate test asserts `status: "running", phase: "source"` while the scope query remains pending.

- **Important — lifecycle on the real FIFO: Partly resolved.** The new `vectorTableLifecycle.test.ts` uses the shipped `layerTables` queue, dispatches engine death, covers all four requested scenarios, and awaits a subsequent FIFO task. However, the death-during-cleanup test only asserts `dropped` contains the vector buffer name—which is already recorded after successful CREATE. It therefore cannot establish its claimed buffer release **after** death interrupts table cleanup. Assert the held DROP was reached before `die()`, then verify an additional buffer-drop call afterward.

### Regressions

None identified in the supplied diff. The remaining property-budget defect predates this fix. No tests were rerun.

### Assessment — Task quality: Needs fixes

The phase ordering is fixed, but property serialization remains unbounded and the cleanup-death test needs an assertion that distinguishes finalizer cleanup from the earlier buffer drop.
