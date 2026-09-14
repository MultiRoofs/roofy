### Spec Compliance

The implementation satisfies B4, B6 and Aggregate’s B11 requirements. Source reasons follow preparation → emptiness → geometry kind; disabled sources retain a fallback selection; Run requires a source. Aggregate uses SOURCE building counts and A12, with A17 and duplicate errors associated with the offending row.

The three tools remain `implemented: false`. Resolved defaults and `fieldTypes` survive normalization with `BAG_ONLY`, and copied-field inference uses the shared `geoPropertyTypes` rule, including VARCHAR for nested objects.

Compliance is incomplete in the cases below.

### Strengths

- Shared parameter readers, column builders and validation keep the form and submitted request consistent.
- Aggregate errors use `aria-describedby`, with tests checking the association rather than merely finding text.
- Stateful component tests exercise edits, count-only behavior and row removal.
- Existing LoD eligibility gating, workload-note guards and single-layer Run-reason precedence are retained.

### Issues

#### Critical (Must Fix)

None found.

#### Important (Should Fix)

1. **Changing a target now erases single-layer parameters.** In [useToolForm.ts](/data2/hideba/multiroof-viewer/src/ui/processing/useToolForm.ts), `...(retarget || resource ? { params: {} } : {})` applies to every tool. Changing layers after selecting roof measures, a roof threshold or solid measures restores defaults, whereas the previous implementation reset only LoD. Restrict this parameter reset to cross-layer tools and add a regression test that changes targets with nondefault single-layer parameters.

2. **“Centre within” does not force the effective centre proxy.** Both predicate handlers in [CrossLayerParams.tsx](/data2/hideba/multiroof-viewer/src/ui/processing/CrossLayerParams.tsx) change only `predicate`; [resolveCrossLayerParams](/data2/hideba/multiroof-viewer/src/features/processing/crossLayerParams.ts) retains the footprint or rectangle. Consequently, the form and submitted bag can say `centreWithin` with `proxy: "footprint"`, retain the footprint workload warning and allow largest overlap. Resolve the forced proxy consistently in the displayed and frozen parameters, and test that combination for Join and Aggregate.

3. **Unimplemented tools now display promised columns and geometry verdicts.** The new registry column builders feed the unconditional column list in [ToolView.tsx](/data2/hideba/multiroof-viewer/src/ui/processing/ToolView.tsx). Its cross-layer PARAMETERS branch also renders proxy availability and the “LoD 0 footprints are not in this layer…” verdict without an implementation guard. This violates the binding global constraint for unimplemented tools. Add coverage using the real, unmodified registry; the render-suite mock currently hides this distinction.

4. **Aggregate can default to a disabled point layer despite an available polygon target.** [useToolForm.ts](/data2/hideba/multiroof-viewer/src/ui/processing/useToolForm.ts) chooses `defaultTarget` from `eligibleVectorTargets` before applying `hasAreas` in `rowFor`. With points first and polygons second, no stored target and no applicable active target, the form selects the disabled points. Incorporate area eligibility into default selection while retaining disabled rows for explanation. Test mixed point/polygon candidates.

#### Minor (Nice to Have)

1. **Join collisions are not flagged beside the second field.** [CrossLayerParams.tsx](/data2/hideba/multiroof-viewer/src/ui/processing/CrossLayerParams.tsx) renders Join’s duplicate error beneath the entire section; neither colliding checkbox is marked or associated with it. §6 explicitly requires copied-field collisions to be flagged on the second field. Apply field-associated validation analogous to Aggregate’s row errors.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The implementation has strong shared logic and meaningful behavioral tests, but misses several explicit form requirements and regresses single-layer parameter retention. No tests were rerun; the reported successful runs do not cover the identified cases.
