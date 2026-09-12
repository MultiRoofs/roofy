### Finding Verdicts

**(1) Target changes reset the previous target’s LoD** — ADDRESSED. `src/ui/processing/useToolForm.ts:96` clears LoD on automatic replacement; `:113` uses that normalized value; `:223–229` clears it on explicit target changes. `tests/unit/ui/processing/lodSelect.test.tsx:225–279` covers both paths with displayed and submitted LoD assertions, plus preservation across same-target edits.

**(2) Stream-version coverage** — ADDRESSED. `tests/unit/ui/processing/lodSelect.test.tsx:281–321` changes resident geometry and increments the stream version, asserting updated counts, fallback selection, and submitted LoD.

The report’s `task-11-report.md:233–248` records the expected two regression failures, then 106 passing processing tests, clean typechecking, and 2,972 passing full-suite tests. The four added tests match the diff. Tests were not rerun.

### New Breakage in the Fix Diff

None found.

- The wrapper spreads the patch last (`useToolForm.ts:226–229`), preserving an explicit `{ targetLayerId, lod }` pair.
- Edit & run writes that pair directly (`RecentRuns.tsx:108–114`). Existing targets retain qualifying choices; missing targets receive the replacement’s default. Retry uses its frozen request (`runQueue.ts:392–398`), unaffected by draft normalization.
- The fixture merges existing table entries before adding the new layer (`roofLayerFixture.tsx:117–119`), preserving both targets’ readiness.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage
