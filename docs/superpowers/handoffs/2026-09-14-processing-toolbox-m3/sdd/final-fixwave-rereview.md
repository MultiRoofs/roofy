### Findings

- **S2 — Resolved:** Diff adds shared A20 refusal at form and queue, permits full-coverage migration, and NULLs skipped model rows with Undo capture; same-type replacements bypass refusal.
- **F5 — Partly:** `layerCoordination.ts` now ignores hover/tool-mode updates, with regression tests, but also suppresses legitimate picks whose layer/object identity is unchanged.
- **F1 — Resolved:** `solids.test.ts` probes three degenerate shapes plus the repeated-ring control, asserting footprint answers per shape; leaving footprint unguarded follows the ruling.
- **Final #1 — Resolved:** Queue and derived-copy changes align skipped-row model NULLs with migrated tables; tests cover provenance’s `partial: null`, original-type/value Undo, and unchanged parents.
- **Final #2 — Resolved:** Source checks precede This-layer writing/no-match completion and New-layer publication; tests cover both tools/destinations, preparation-time relinking, table cleanup and FIFO progress. Normal preparation tracks source inputs; engine consumption does not routinely replace `preparedData`.

### Regressions

- **F5 — Same-object picks lose activation:** Select city object A → activate vector → pick A again leaves the vector active because the new identity-key early return suppresses reconciliation; the added positive test covers only picking a different object.

### Assessment — Needs fixes

Preserve activation for actual same-object picks while continuing to ignore hover and tool-mode updates.
