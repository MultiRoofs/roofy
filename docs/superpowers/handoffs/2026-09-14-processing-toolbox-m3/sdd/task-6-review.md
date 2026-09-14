### Spec Compliance

Matches Task 6 and the controller rulings:

- Six measures use A5 labels/hovers verbatim and §7.2 order. Numeric columns are DOUBLE; `<prefix>valid` is BOOLEAN and always last.
- Untouched drafts normalise to volume/envelope/footprint/height. Empty selections return “Pick at least one measure”.
- Default prefix remains `solid_`; `implemented` remains false.
- SQL satisfies D1 guards, uses geometry-properties `type` for D4, and includes D3’s eighth guarded validation field. Height calculation remains Task 7’s responsibility.
- The probe extension is additive; existing expectations and reader-parity checks remain intact.

### Strengths

- Pure modules centralise parameters, column definitions and SQL without executor-registration side effects.
- Tests assert exact builder output, registry behaviour and real-engine results, without mocks.
- Both builders are pinned to probe constants; existing probes cover invalid and unparseable rows comprehensively.
- Reported TDD and verification evidence is sufficient for this task. No tests were rerun.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

None.

### Assessment

**Task quality:** Approved  
**Reasoning:** The implementation satisfies the task’s requirements and accepted controller amendments. Behavioural tests adequately protect defaults, output ordering, SQL guards and engine compatibility.
