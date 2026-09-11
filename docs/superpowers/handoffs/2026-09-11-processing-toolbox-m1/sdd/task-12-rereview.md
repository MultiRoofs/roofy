### Finding Verdicts

1. **Customised column lists gain the run’s output columns** — ADDRESSED. `src/ui/drawer/columnPolicy.ts:65` appends missing names without mutation or duplicates, preserves identity when unchanged, and leaves null unchanged. `src/ui/processing/RunFooter.tsx:124` applies it on Open table. Helper and click coverage appears in `tests/unit/ui/drawer/columnPolicy.test.ts:75` and `tests/unit/ui/processing/ToolView.test.tsx:426`.

2. **COMPUTED literals are fixed, but the heading still lacks a mono font** — NOT ADDRESSED. Both literals are correct at `src/ui/details/LayerAttributesSection.tsx:66` and `src/ui/layers/RulesEditor.tsx:730`, with literal assertions updated. However, `src/app/app.css:6277` uses `var(--font-mono)`, which resolves through `src/app/brand.css:54` to the sans-serif UI family at line 52. The scoped override therefore does not satisfy the required mono font.

3. **Buildings-mode base-name collision is tested once and last** — ADDRESSED. `tests/unit/ui/drawer/columnPolicy.test.ts:47` registers `measuredHeight` as computed in buildings mode and asserts both uniqueness and final position.

The appended fix report names the covering tests and records their results, including **44 files, 472 passed, 0 failed**, and TypeScript exit 0. Coverage matches the changed tests; no tests were rerun.

### New Breakage in the Fix Diff

None.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** Findings remain open — finding 2: the Details COMPUTED heading still requires an actual monospace font.
