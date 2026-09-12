### Finding Verdicts

**(4a) Every build carries and checks its engine generation** — NOT ADDRESSED completely. The shared counter is exported at `src/insights/duckdb.ts:232`, and guards now cover cleanup, parking and restoration (`src/insights/layerTables.ts:1030`, `:1037`, `:1051`, `:1064`). However, builds enqueued during initialization capture `null` (`:885`), making every generation check ineffective until adoption at `:971`. A worker death during the initialization await can therefore still park the source and write `ENGINE_NOT_RUNNING` at `:954–964`.

**Narrowing readiness checks to generation checks** — NOT ADDRESSED as a general equivalence. It is sound for a build already bound to a ready engine: production death advances the generation (`src/insights/duckdb.ts:154`). It is insufficient while `engine === null`, including initialization deaths. Preserving mocks that change readiness without advancing generation does not establish correctness for that case.

**(4b) Abandonment establishes the failed state idempotently** — ADDRESSED. `abandon()` deletes the registry entry and writes `{ state: "failed", message: ENGINE_STOPPED }` only when necessary (`src/insights/layerTables.ts:906–912`). The readiness-only publish branch invokes it at `:1009–1010`.

**Minor: hot disposal beside subscription installation** — ADDRESSED. The installed subscription’s disposer is captured and registered with `import.meta.hot?.dispose` (`src/insights/layerTables.ts:456–465`).

### New Breakage in the Fix Diff

- **Important — deferred adoption can revive an invalidated queued build.** Enqueue two builds before boot finishes; both capture `null`. Let the first start building after initialization, then kill its engine while the second remains queued. The subscriber invalidates both, but the second’s head guard cannot detect the death (`src/insights/layerTables.ts:896`, `:923`). Once the queue advances, it writes `building`, invokes initialization and adopts the replacement (`:928`, `:943`, `:971`). This regresses the previous death-counter protection and violates the required abandonment behavior.

- **Minor — abandonment can overwrite removal.** In the catch, abandonment now writes state before checking `superseded()` (`src/insights/layerTables.ts:1030–1038`). If removal and engine death occur during a failing build or its cleanup, it recreates a failed entry after removal cleared it. The queued drop eventually clears it again, but the intermediate write violates removal ownership.

The 27 additional mock-factory edits only supply a constant generation export; the build-test mock supplies a mutable generation. No independent breakage was found in those additions.

The report records **184 covering tests passed**, clean typechecking, **0 lint errors / 56 warnings**, and **2897 passed / 31 skipped** overall (`task-4-report.md:647–657`). The diff adds the three reported tests, but none covers pre-ready generation adoption. Additionally, the replacement test’s `DESCRIBE` wait can match SQL from its initial L1 build (`tests/unit/insights/layerTablesBuild.test.ts:1144–1149`), so it does not reliably establish that L2 reached the intended await. Tests were not rerun.

### Out-of-Scope Observations

Previously reported never-settling table-build/query awaits and unguarded `refreshLayerTableColumns`/`retryEngine` continuations remain outside this fix review.

### Verdict

**Fix round:** Findings remain open
