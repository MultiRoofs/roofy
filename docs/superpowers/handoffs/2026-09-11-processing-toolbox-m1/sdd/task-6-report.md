# Task 6 report: `runOnTableQueue` — one FIFO for table builds and tool runs

**Status:** implemented, verified and committed (`af6534e`). **Push is blocked by an
unrelated uncommitted `index.html` edit** — see "Push" below. Nothing in the task's
own two files needs further work.

## What the diff contains

The previous implementer's pending change matched the brief exactly; no adjustment
was needed.

`src/insights/layerTables.ts` (+6): an exported generic door placed directly under
the private `enqueue`, with the brief's docblock:

```ts
/** Public door onto the ONE queue for work that must not interleave with a
 *  table build: a processing run's ALTER/UPDATE on a layer table. */
export function runOnTableQueue<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(task);
}
```

It delegates to the same `enqueue`, so a run shares the ONE `chain` the builds
use — a run's `ALTER`/`UPDATE` can never interleave with a `CREATE OR REPLACE`
of the same table. `enqueue`'s tail already discards both branches, so a failed
run cannot wedge later builds.

`tests/unit/insights/layerTablesQueue.test.ts` (+36): `runOnTableQueue` added to
the existing dynamic-import destructuring, plus a `describe("runOnTableQueue")`
with the brief's two cases, written against the file's existing `makeGate()`
helper (`{ promise, open }`) rather than a new `deferred<void>`:

1. _runs after work already queued and before work queued later_ — holds the
   first task on a local gate, asserts the second resolves to `42` only after,
   and `order` is `["first", "second"]`. A door that merely called the task
   would let the second finish while the first was still held.
2. _propagates a rejection without stalling the queue_ — `rejects.toThrow("boom")`,
   then a following task still resolves.

The test deliberately uses a local gate, not the module-level `gate` (the mock's
hold-the-`CREATE` hook), since these tasks send no SQL.

## Verification (Node v24.18.1, via mise shims)

- `npx vitest run tests/unit/insights/layerTablesQueue.test.ts` → **1 file passed,
  18 tests passed** (1.29 s). The two new cases are included.
- `npx tsc -b --noEmit` → **clean**, exit 0.
- `npx vp check src/insights/layerTables.ts tests/unit/insights/layerTablesQueue.test.ts`
  → "All 2 files are correctly formatted", **0 errors**. One pre-existing _warning_
  outside this diff (`unicorn(no-useless-spread)` at `layerTables.ts:569`, in
  `dropLayerTable`'s `for (const name of [...scratch])`); warnings do not fail the
  check and it was left alone.
- The full suite was not run in the foreground by design; the pre-push hook runs it.

## Commit

```
af6534e feat(insights): runOnTableQueue shares the table FIFO with tool runs
 2 files changed, 42 insertions(+)
```

Only the two task paths were staged (`git diff --cached --stat` confirmed two files
before committing). The pre-commit `vp staged` hook ran `vp check --fix` on those
two staged files and rewrote nothing, so a single commit sufficed. `index.html` was
never touched, staged, formatted or reverted, and remains modified in the working
tree.

## Push — BLOCKED, cause outside task scope

`git push origin develop` was attempted once, in full, with hooks enabled:

```
error: Formatting issues found
index.html (35ms)

Found formatting issues in 1 file (2543ms, 14 threads). Run `vp check --fix` to fix them.
VITE+ - pre-push script failed (code 1)
error: failed to push some refs to 'github.com:MultiRoofs/roofy.git'
```

The pre-push hook is `vp check && tsc -b --noEmit && vp test run`; `vp check` runs
repo-wide over the working tree and fails on the first step, so `tsc` and the test
suite never ran.

The cause is the unrelated in-progress launch-screen edit to `index.html`
(+45 lines, uncommitted, owned by someone else). This was verified, not assumed:
`git show HEAD:index.html` written to a temp path passes `vp check`
("All 1 file are correctly formatted"), so HEAD's copy is clean and the pending
45-line addition is what is unformatted.

There is no in-scope fix: the failure is not in either task file, and every route
around it is explicitly forbidden — formatting, reverting, stashing or moving
`index.html` aside (stashing was also denied by the permission classifier), or
`--no-verify`. So the push was left blocked rather than forced.

**State:** `develop` is `[ahead 1]` of `origin/develop` with `af6534e` committed
locally. Once the owner of the `index.html` change commits or formats it
(`npx vp check --fix index.html`), a plain `git push origin develop` will go
through with no further work on this task.
