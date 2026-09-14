### Spec Compliance

Mostly compliant with Task 9’s scoped requirements:

- All seven descriptors exist; the types support Boolean literals, `< median`, and correctly narrowed plain/function forms.
- `RunFooter` contains no tool-specific branch. Existing numeric styling, empty-value handling, stale precedence, and token/alive guards are preserved.
- `summarise` counts every written column; the footer checks the picked column.
- Residual A4’s import, expectation migration, and real-engine DECIMAL test are present.
- Eager Rules mode and deferred Join/Aggregate behavior respect the controller’s boundaries.

Deterministic most-frequent ties are not implemented.

### Strengths

- Tool-specific choices stay in the registry, with shared execution in the footer.
- Tests render the real footer with seeded runs and inspect resulting drafts.
- Boolean coverage exercises editor Save and the real evaluator with correctly ordered arguments.
- The DECIMAL probe executes the actual SQL builder; the median’s root-row restriction remains unchanged.
- Reported test runs include red/green evidence, type checking, and unchanged lint totals. No tests were rerun during this review.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

- **Most-frequent ties lack a deterministic rule.** [sql.ts](/data2/hideba/multiroof-viewer/src/insights/sql.ts:463) emits unordered `mode(column)`. Equal-frequency values therefore have no explicit, stable tie-break, contrary to the review requirement. Add deterministic ordering and a real-engine regression covering tied root values, reordered input, NULLs, and unequal part counts. The current SQL-string assertions do not establish this behavior.

#### Minor (Nice to Have)

- **The empty-picked-column test uses the first column.** In [styleByResult.test.tsx](/data2/hideba/multiroof-viewer/tests/unit/ui/processing/styleByResult.test.tsx), the case retains `measure-solids`, which picks `solid_volume_m3` at index zero. Despite its comment, it does not distinguish picked-column checking from first-column checking. Use Validate solids with a nonempty first column and empty `solid_valid`.

- **Function-form resolver branches lack behavioral coverage.** Both resolver tests use plain registry values. Add a synthetic descriptor whose operator and value functions return different answers for text and numeric columns; this can test the shared contract without bringing forward Task 16’s footer integration.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The descriptor refactor is sound and preserves the existing footer behavior within the accepted task boundaries. The explicitly required deterministic mode tie-break remains missing and untested.
