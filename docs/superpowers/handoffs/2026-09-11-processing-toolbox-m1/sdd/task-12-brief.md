### Task 12: Computed badges in the table and Details, and the COMPUTED groups (spec §8)

**Files:**

- Modify: `src/ui/table/DataGrid.tsx` (header badge when the column is in `computedColumnsOf(layerId)`), `src/ui/table/ColumnsPanel.tsx` (same), `src/ui/details/LayerAttributesSection.tsx` (split into ATTRIBUTES and a COMPUTED sub-heading with badge + provenance tooltip), `src/ui/layers/RulesEditor.tsx` (COMPUTED optgroup in the attribute select)
- Test: extend `tests/unit/ui/table/DataGrid.test.tsx` (or the grid's test file), `tests/unit/ui/details/*LayerAttributesSection*.test.tsx`, `tests/unit/ui/layers/RulesEditor*.test.tsx`

**Interfaces:**

- Consumes: `useComputedColumnStore`, `computedColumnsOf`, `provenanceOf`, `ComputedAttributeBadge`.
- Produces: `formatProvenance(p: Provenance): string` in `computedColumns.ts` → `"Measure solids · LoD 2.2 · 2026-09-10 14:02"` plus `" · 312 of 1,204 buildings in this run; the rest from <previous toolName> · <time>"` when partial.

- [ ] **Step 1: Failing tests**
  - DataGrid: seed `useComputedColumnStore` with `{ L1: { extent_height_m: provenance } }`, render the grid with a column `extent_height_m` for layer `L1`, expect `screen.getByRole("img", { name: "Computed by Roofy" })` inside that header cell and its `title` to equal `formatProvenance(p)`.
  - LayerAttributesSection: with attributes `{ function: "x", extent_height_m: 4.2 }` and the registry seeded, expect a heading "COMPUTED" containing `extent_height_m` with the badge, and `function` NOT under it.
  - RulesEditor: with the layer's model carrying `extent_height_m` on an object and the registry seeded, expect the attribute `<select>` to have an `<optgroup label="Computed">` containing `extent_height_m`.

- [ ] **Step 2: Implement**
  - `computedColumns.ts`: `export function formatProvenance(p: Provenance): string` (date via `new Date(p.at)` formatted `YYYY-MM-DD HH:mm` local).
  - `ComputedAttributeBadge`: add an optional `title?: string` prop (default the current text) so the provenance can replace the generic sentence.
  - DataGrid / ColumnsPanel: read `useComputedColumnStore((s) => s.byLayer[layerId])` and render `<ComputedAttributeBadge title={formatProvenance(p)} />` beside the header label for those columns (keep the existing badge for the synthetic `__roofy_*` columns).
  - LayerAttributesSection: partition `Object.entries(attributes)` by membership in the registry; render the existing list for the rest and, when the computed set is non-empty, `<h4 className="details-section-title">COMPUTED</h4>` + rows with the badge and `title`.
  - RulesEditor: after `orderFields`, split into `computed` (in the registry for this layer) and `rest`; render `<optgroup label="Computed">` after the existing options.

- [ ] **Step 3: Run** the three test files + `npx tsc -b --noEmit` → PASS. **Step 4: Commit** `git commit -am "feat(processing): computed badges and COMPUTED groups in table, Details and rules"`.

---
