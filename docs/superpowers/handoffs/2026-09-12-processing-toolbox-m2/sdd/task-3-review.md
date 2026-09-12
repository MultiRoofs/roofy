### Spec Compliance

The implementation matches the requested state copy, muted failure styling, and extension-gated Retry, including on unimplemented tools. `!implemented` retains priority (`src/ui/processing/CatalogueView.tsx:52`, `:123`; `src/features/processing/eligibility.ts:44`).

Both controller requirements are implemented: per-case module resets followed by dynamic consumer/store imports, and a controlled deferred holding the loading assertion (`tests/unit/ui/processing/extensionChip.test.tsx:156`, `:284`).

⚠️ Browser verification of both themes and narrow layouts remains unverified; it is required by `docs/ui-consistency.md:10`. Reported test and type-check results were not independently rerun.

### Strengths

- Chip state comes directly from the subscribed eligibility context, without another publisher or stored copy (`src/ui/processing/CatalogueView.tsx:95`; `src/ui/processing/useEligibilityContext.ts:35`).
- Retry uses the existing loader. Failure is recorded and republished, and the in-flight memo is cleared for subsequent attempts (`src/ui/processing/CatalogueView.tsx:163`; `src/insights/duckdb.ts:194`, `:345`).
- Sibling buttons avoid invalid nesting. Retry retains shared keyboard focus styling; its token-based colour override is justified by the global `!important` rule (`src/ui/processing/CatalogueView.tsx:127`, `:154`; `src/ui/processing/processing.css:197`; `src/app/flatControls.css:26`, `:70`).
- Reusing existing types is sound. Tests import from `vitest`, and dynamic imports refresh DuckDB’s module-local state alongside its consumers (`src/ui/processing/CatalogueView.tsx:31`; `tests/unit/ui/processing/extensionChip.test.tsx:18`, `:156`; `src/insights/duckdb.ts:76`).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- **Retry test waits for loading, not completion.** Retry disappears as soon as the extension enters `loading`, so waiting for zero Retry buttons does not establish success. The subsequent loaded assertions can race the remaining queries. Keep `waitFor`, but wait for the loaded tooltip inside it (`tests/unit/ui/processing/extensionChip.test.tsx:268`). This is a fragile test, despite the reported passing runs.

- **The failure explanation is unavailable through keyboard focus.** The newly essential download reason exists only in a non-focusable chip’s native `title`; the focusable row exposes “Not available yet,” and Retry has no associated explanation. Provide the same reason through an accessible description and a tooltip available on focus (`src/ui/processing/CatalogueView.tsx:132`, `:142`, `:154`).

#### Minor (Nice to Have)

- All Retry buttons have the same accessible name without extension context. The three spatial actions perform the same operation, reducing ambiguity, but associating each with its extension would improve navigation (`src/ui/processing/CatalogueView.tsx:154`).
- Expected fake failures emit real engine warnings without a scoped spy/assertion, adding avoidable test noise (`tests/unit/ui/processing/extensionChip.test.tsx:225`, `:251`; `src/insights/duckdb.ts:197`).

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The core implementation and mandated isolation/deferred requirements are sound. Fix the Retry test’s completion condition and make the failure explanation accessible from keyboard focus.
