### Spec Compliance

Most Task 5 requirements are satisfied: the exported contracts, three failure sentences, decimal 100 MB threshold, build-time byte capture, LoD lookup, registration refusal split, cancellation/death races, late-registration cleanup, and fixture sweep match the requirements.

The source phase follows extension loading and pre-flight refusals inside `runOnTableQueue`, but starts **after `resolveScope`**, contrary to the explicit ordering required by this review dispatch. The brief’s replacement snippet also places it there; this is a requirements discrepancy the implementation did not resolve.

The workload-note `implemented` gate remains Task 8’s responsibility under the commander’s ruling.

### Strengths

- VFS naming agrees with the existing build/export conventions. Each read calls the provider; returning the same detached array twice would violate the existing `SourceProvider` contract.
- Column suffixes come exclusively from `LayerTable.lods`; unknown labels fail without guessing.
- Cleanup is idempotent, swallows rejection, races engine death, and handles registrations that succeed after cancellation.
- Residual A2 is fixed with `vi.hoisted`. Tests exercise real exception classes and observable queue state, including the non-reader executor’s `compute` entry.
- Reader-statement failures retain engine detail through `ctx.warn`.

### Issues

#### Critical (Must Fix)

None identified.

#### Important (Should Fix)

- **Enter `source` before scope resolution.** [runQueue.ts](/data2/hideba/multiroof-viewer/src/features/processing/runQueue.ts:637) updates the phase only after the scope await. While that query is pending, a reader-backed run remains marked queued when its extension was already loaded, or continues displaying extension loading otherwise. Move the reader-backed phase transition before `resolveScope`, retaining the preceding refusals and extension checks. Add a real-queue test that holds scope resolution pending and checks the phase; the current executor-entry assertion cannot detect this ordering defect.

#### Minor (Nice to Have)

- **Correct the race explanation.** [sourceRead.ts](/data2/hideba/multiroof-viewer/src/features/processing/sourceRead.ts:270) and its corresponding test say `raced` handles abort only. It also handles engine death, as the implementation and death tests demonstrate.
- **Add repeated-read coverage.** The “FRESH array” test performs only one read with a non-detaching registration mock. Two reads with simulated transfer would better protect the provider contract.

### Assessment

**Task quality:** Needs fixes  
**Reasoning:** The shared source-reading infrastructure is sound, but the dispatch’s explicit phase-order requirement is unmet and untested. Executor-owned `finally` cleanup remains an integration obligation for Tasks 7/10; this diff provides the release mechanism but cannot establish those future exit paths. Tests were not rerun.
