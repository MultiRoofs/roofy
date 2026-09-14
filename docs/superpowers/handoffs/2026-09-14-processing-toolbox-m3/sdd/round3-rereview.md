### Findings

- **F5 — Resolved:** `select` increments `selectionVersion` even for the same object; rule 2 now compares that counter, allowing city A → activate vector → re-pick A to reactivate the city. The added regression test asserts this exact sequence.
- **Earlier rule — Preserved:** Hover, tool-mode and pick-mode updates leave the counter unchanged, so reconciliation returns without activating the city. Counter tests and retained coordination assertions cover this.
- **Compatibility:** The permitted consumer check found field-specific selectors and no persisted whole-store shape affected by the added counter.

### Regressions

None identified within scope. Tests were inspected, not rerun.

### Assessment — Approved

The fix restores same-object re-pick activation while preserving the prohibition on activation from hover and mode updates.
