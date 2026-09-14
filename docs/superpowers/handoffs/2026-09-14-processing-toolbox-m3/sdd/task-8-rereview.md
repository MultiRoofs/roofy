### Findings

- **Important — Resolved.** The diff adds `&& f.eligibility.ok` to ToolView’s LoD gate and substitutes `NO_LOD` only for ineligible targets. New real-registry tests cover streaming FlatCityBuf and CityParquet: no LoD control or geometry verdict, Run disabled, exact reader reason retained. Roof metrics also gains failed-eligibility coverage; eligible-but-no-solids coverage remains intact.
- **Minor — Resolved.** Hover assertions now locate Volume and Height independently and check each checkbox’s enclosing label for its prescribed title, so swapped hints fail.

### Regressions

None found by inspection. Eligible Roof metrics retains `lodAnswer`, its LoD select, and unchanged default selection rules. Run still prioritizes eligibility, then `lods.emptyReason`, then form validation; eligible targets therefore retain the LoD contribution to Run’s reason. The new failed-engine mock is reset before each test. No tests were rerun.

### Assessment — Task quality: Approved

Both findings are resolved, with scoped regression coverage and no regression identified.
