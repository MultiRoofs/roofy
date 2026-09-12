### Task 14: Documentation

**Files:**

- Modify: `docs/architecture-notes.md` (the "Processing toolbox seam (M13.1, 2026-09-11)" section), `docs/roadmap.md:605-640`

No tests: this task changes no behaviour. It is its own task because a reviewer should be able to reject the prose without rejecting the code.

- [ ] **Step 1: Extend the architecture note**

Append to the "Processing toolbox seam" section, after Task 1's status paragraph:

```markdown
**A tool's extension loads inside the run, in its own phase (M13.2).** A run
whose tool declares an `extension` calls `ensureExtension` under
`phase: "extension"` before its scope is resolved, and a failed load fails the
run before the executor sees it. Two placement decisions: it sits AFTER the
cheap pre-flight refusals, so a run that cannot succeed never triggers a 24 MB
download; and it sits INSIDE `runOnTableQueue`, so that download blocks table
builds for its duration. The second is the deliberate trade — loading outside
the queue would take the phase out of §6.1's sequence and would let the run
start against a table being rebuilt underneath it. `ensureExtension` cannot be
aborted, so a Cancel pressed during the download is honoured on the far side of
it. No tool in M13.2 declares an extension; the seam exists so M13.3's three_d
and spatial tools are a registry entry and an executor, nothing more.

**Roof metrics is computed app-side, in JS, and measures only what it writes
(M13.2).** Roof area, inclination and azimuth are derived from ring geometry
and exist nowhere in DuckDB, so the tool issues exactly ONE statement — "which
rows are in scope, and which feature does each belong to" — and does everything
else in memory. The table is the authority on rows; `roofGeometrySource.ts` is
the authority on geometry, and it has two halves on purpose: `roofLodOptions`
fills the LoD select from surface TAGS alone (`type`, `lod`) and never calls
`computeRoofMetrics`, while `roofSurfacesAt` measures on demand, memoised per
(object, LoD), so a run touches only its scoped features' contributors at the
one LoD it was given. Features roll up in batches of 500 that yield a macrotask
and check the run's `AbortSignal` through the new `ToolContext.throwIfCancelled`
— the only way a long, query-free executor can be cancelled at all.

**§7's contributor rule is about GEOMETRY, not about roofs.** "If any part of
the feature has geometry [at the chosen LoD], the PARTS are the contributors" —
so a Building with a roof at 2.2 whose BuildingPart has only WALLS at 2.2
selects the part and is then skipped for having no roof. Using the root's roof
instead would report exactly the 3D BAG double-storage the rule exists to
avoid. The FCB records carry `geometryLods` (all surfaces' LoDs, any type)
beside their LoD-tagged `roofMetrics` for this reason alone.

**Two roof aggregations, on purpose.** `domain/roofMetrics/aggregate.ts` keeps
the Details panel's area-weighted CIRCULAR mean azimuth with its hard-coded 1°
flat threshold, and its area-weighted mean slope and surface count agree with
§7. What it cannot give the toolbox is §7's azimuth (the largest non-flat
surface), the user's own threshold, or NULL where a measure could not be
evaluated — so `domain/roofMetrics/roofRollUp.ts` exists beside it rather than
replacing it.

**A dead worker is detected, announced and contained — and not recovered
from (M13.2).** `doInit` creates the Worker itself, so `duckdb.ts` attaches its
own `error`/`messageerror` listeners beside the ones `AsyncDuckDB.attach`
registers (both use `addEventListener`), and `markEngineDead` drops the
connection, clears the boot memo and publishes `failed` through the same
`setStatus` writer. A failed QUERY is not the signal: duckdb-wasm's own worker
error handler clears its pending-request map without rejecting the promises, so
a query in flight when the worker dies never settles, and `postTask` on a
detached worker logs and returns `undefined` rather than rejecting. That is
also why `runQueue`'s engine watcher ABORTS a running run's controller instead
of awaiting it. Containment then falls out of code that already exists:
`runQuery` refuses on a non-`ready` status, and `toolEligibility` already
disables every row with "Not available while DuckDB is unavailable". What is
deliberately NOT built is §6.1's recovery — the status bar's Retry reboots the
engine but does not rebuild the tables that were `ready` when the worker died
(`retryEngine` only revives what it parked in `pendingSources`), so those
layers stay table-less and every tool stays disabled until the page is
reloaded. Undo is taken away session-wide through one `engineStopped` flag on
the processing store rather than per run, because every backup table died with
the database.

**Style by result gates on values, not on a count.** `RunSummary` carries
`firstColumnNonNull`, computed centrally in `summarise` from the run's first
output column. §6.2 disables the button "when the chosen column is NULL for
every object in the run", which is NOT `measured === 0`: a Roof metrics run
with only Dominant azimuth ticked over flat roofs measures every building and
writes NULL to all of them.
```

- [ ] **Step 2: Refresh the roadmap**

In `docs/roadmap.md`, add after the 13.1 paragraph (`:605-613`):

```markdown
**Milestone 13.2 implemented 2026-09-11** — **Roof metrics to attributes** as
the second tool (LoD select with per-LoD feature counts, six measure
checkboxes, the flat-threshold slider, §7's geometry-keyed contributor rule and
roll-ups, skip accounting by LoD, Style by result on `roof_area_m2`), computed
app-side on every city layer kind including streaming; the "Loading extension"
run phase with `ensureExtension` and the spec's failure copy; and a published
DuckDB status, so the catalogue's capability chips track an extension's state
and offer Retry. A dead DuckDB worker is now DETECTED (its own `error` event,
published as `failed`): every queued and running run fails with §6.1's
"Analytics engine stopped", every Undo is disabled, and the tool rows go dark
with the existing "Not available while DuckDB is unavailable". §6.1's RECOVERY
is deliberately not built — the status bar's Retry reboots the engine without
rebuilding the tables that were ready when the worker died, so tools stay
disabled until the page is reloaded. Acceptance scenarios 4 and 6, as far as
this milestone reaches, are smoked in `scripts/smoke/processing-m2.md`.
```

Then **fix the stale carried list** (`:615-640`). Remove the item claiming "§6.1 re-validation of an output column that has come to belong to the file itself is not implemented" (`runQueue.ts:419-442` does it), and remove any other item fix wave 1 closed — check each against the code before deleting it, and leave anything you cannot verify. Extend the existing elapsed-timer bullet so it names the new case: "…so it can jump back once — and again at the hand-off from Loading extension to Computing, which re-stamps `startedAt`; the elapsed the finished card reports is measured from the run's real start and does include the download." Then add:

```markdown
- **Streaming (FCB) runs still write to the table only, and that is now a
  DEFERRAL with a design, not a gap.** A streaming layer's `model.objects` is
  empty, so a run's values show in the grid, the filter and exports but not in
  Details, the rule editor or a colour rule — which §7.1 and §8 do ask for.
  Closing it means an attribute-overlay seam in the FCB plugin and worker (so a
  re-fetched cell keeps the values) plus an Undo path; see the M2 plan's Design
  decision (b) and the plan's "Future consideration" section. The repo owner
  has ruled it a future consideration rather than scheduling it.
- **A dead DuckDB worker is DETECTED and contained, but not recovered from.**
  13.2 publishes `failed` from the worker's own `error`/`messageerror` event,
  fails every queued and running run with §6.1's "Analytics engine stopped",
  disables every Undo with "Unavailable: the analytics engine stopped"
  (adapted: §6.1's own sentence assumes a restart) and lets the catalogue's
  existing "Not available while DuckDB is unavailable" reason disable the rows.
  What §6.1 also asks for and 13.2 does NOT do is the recovery: the status
  bar's Retry reboots the engine but does not rebuild the tables that were
  `ready` when the worker died, so those layers stay table-less and every tool
  stays disabled until the page is reloaded.
- **No tool needs an extension yet**, so the muted chip, its Retry link and the
  extension-failure run copy are covered by unit tests and cannot be reached
  through the UI until a three_d or spatial tool ships (13.3). While those
  tools stay `implemented: false`, "Not available yet" outranks the download
  reason on the row, so that sentence is only ever seen as the chip's tooltip.
- The chip tooltips for the loaded and loading states, the LoD option noun
  ("with roof surfaces"), the empty-LoD text, the extension-failure sentences,
  the measure labels, the Roof metrics long description and the card's
  resident-set clause are ADAPTED from the spec's patterns, not verbatim spec
  copy, written to the spec's patterns and decided by the repo owner — see
  the M2 plan's "Decisions recorded (2026-09-11)".
- Roof metrics' six measures are all ticked by default (the spec states no
  default), and its flat threshold is STRICT, so at 0° a horizontal roof counts
  as not flat.
```

- [ ] **Step 3: Commit**

```bash
npx vp check
git add docs/architecture-notes.md docs/roadmap.md
git commit -m "docs: record M13.2's seams, and refresh the carried-forward list"
```

---
