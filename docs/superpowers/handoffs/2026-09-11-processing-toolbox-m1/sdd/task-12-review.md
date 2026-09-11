### Spec Compliance

- ❌ Issues found: customised table visibility (`src/ui/table/TablePanel.tsx:243`), streaming Details/rules support (`src/ui/details/LayerAttributesSection.tsx:43`, `src/ui/layers/RulesEditor.tsx:141`), and required COMPUTED presentation (`src/ui/details/LayerAttributesSection.tsx:65`, `src/ui/layers/RulesEditor.tsx:730`).
- ✅ Default visibility is implemented for the buildings view, with computed columns appended and excluded from duplicate base entries (`src/ui/drawer/columnPolicy.ts:32`).
- ⚠️ Cannot verify from diff: export inclusion, snapshot round-trip exclusion, or upstream feature-count correctness. The change introduces no DuckDB imports or exports, persistence implementation, or counting logic.
- ⚠️ Test passes and TDD history are reported, not independently verified. No test-output warnings were supplied; tests were not rerun.

### Strengths

- Centralised provenance formatting handles local timestamps and partial runs, with explicit expected-string tests (`src/insights/computedColumns.ts:299`, `tests/unit/insights/computedColumns.test.ts:217`).
- Layer-scoped subscriptions preserve provenance isolation; the grid test verifies another layer’s column remains unbadged (`src/ui/table/DataGrid.tsx:85`, `tests/unit/ui/table/DataGrid.test.tsx:300`).
- Optional badge and trailing-content slots reuse existing attribute rendering rather than duplicating it (`src/ui/inspector/attrDisplay.tsx:12`, `src/ui/details/AttributesSection.tsx:20`).

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

1. **New results remain hidden after column customisation.**  
   `src/ui/table/TablePanel.tsx:236` applies computed defaults only while `query.columns` is unset; line 243 retains the previous explicit list unchanged. After hiding or reordering a column, running another tool and clicking Open table therefore omits its new columns, contrary to the dispatch addendum and §6.2.

   **Focused risk check:** `src/ui/processing/RunFooter.tsx:103` only activates the target and opens the drawer; it does not append output columns.

   **Fix:** append the run’s output columns to the current visible order when Open table is invoked, without duplicates. Users can subsequently hide them; a continuously enforced visibility set is unnecessary. Add a customised-list integration test.

2. **Streaming results are absent from Details and rules.**  
   `src/ui/details/LayerAttributesSection.tsx:43` intersects provenance with supplied attribute keys, and `src/ui/layers/RulesEditor.tsx:141` intersects it with collected resident fields. Registry entries alone cannot make missing result values available.

   **Focused risk check:** `src/features/processing/runQueue.ts:404` looks up results exclusively in `layer.model.objects`, skips missing objects, then registers provenance at line 421. It does not publish those values into streaming residents.

   This leaves supported streaming runs with table results but no corresponding Details/rules entries. §8’s disposal-on-rebuild rule does not exempt results before rebuilding.

   **Fix:** provide computed values through the streaming attribute path consumed by Details and rule evaluation, then test a streaming run across all three surfaces.

3. **Required COMPUTED copy and typography are deliberately changed.**  
   `src/ui/details/LayerAttributesSection.tsx:65` renders `Computed`; `src/app/app.css:6269` restores spacing only.

   **Focused risk check:** `src/app/workspace.css:45` applies the UI font and line 49 disables uppercase transformation. The heading therefore fails both the literal COMPUTED and mono requirements.

   Additionally, `src/ui/layers/RulesEditor.tsx:730` uses `label="Computed"` instead of the authoritative spec’s COMPUTED. **Plan-mandated:** the brief requests this sentence-case optgroup, but the spec takes precedence.

   **Fix:** use COMPUTED for both labels and explicitly apply the mono font to the Details sub-heading. Update the assertions accordingly.

#### Minor (Nice to Have)

- **Default-column tests do not exercise the claimed collision handling.**  
  `tests/unit/ui/drawer/columnPolicy.test.ts:46` checks duplication only in raw mode, which bypasses the modified buildings logic. **Fix:** test a computed column named `measuredHeight` in buildings mode and assert its single occurrence and final position.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The ordinary in-memory path is implemented cleanly, but customised tables and streaming layers miss required behaviour. The deliberate heading deviations also conflict with the authoritative specification.

Review remained read-only. No changed source file was read separately; the diff was retrieved again because the initial combined output was truncated.
