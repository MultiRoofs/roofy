# CityParquet On-Demand Attributes (performance task 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REVISED 2026-09-23, against the shipped tree: THERE IS NOTHING TO BUILD. The five implementation tasks are deleted; two documentation tasks remain.**
>
> The plan was deferred behind task 5 (object families) and was to be revised against it. Revising it meant measuring the premise, and the premise is false on three independent axes — each of which kills the milestone by itself:
>
> 1. **The bytes are not there.** Deferring the footer's attribute columns out of a fetch saves **0.25 %** of what a Yokohama fetch reads (0.79 MB of 318.93 MB compressed; **0.62 %** at rung 0, the cheapest geometry) and **0.99 %** on Nishitokyo (**2.35 %** at rung 0). The plan's OWN decision gate (Task 1 Step 3) named 5 % of bytes as the threshold below which "deferral buys little". Both real datasets are under it at every rung.
> 2. **The heap is not there either.** `readAttributes` (`navara-cityparquet/src/decodeTable.ts`) already writes **one entry per NON-NULL footer-declared column** — asserted by `tests/decodeTable.test.ts:234`, "A null cell contributes no key at all". Yokohama's footer declares seven attributes (`measuredHeight`, `creationDate`, `class`, `function`, `yearOfConstruction`, `height`, `averageHeight`) and only `measuredHeight` is ever populated, so a resident record on the real data carries **exactly one attribute key**. There is no per-object retention to trim.
> 3. **The proposed transport is strictly WORSE than what ships.** A one-row attribute read (`rowStart = row, rowEnd = row + 1, useOffsetIndex: true`, attribute columns only — the plan's Architecture paragraph verbatim) costs **0.40 MB over 23 HTTP range requests in ~470–710 ms warm**, measured against the real Yokohama table. The identical read for **2000 rows costs the same 0.40 MB and the same 23 requests**: pages and offset indexes are the granularity, not rows. So the plan would have spent, per click, about what reading those attributes for two thousand objects costs — to deliver 182 bytes of JSON containing one useful number. This is structural, not a PLATEAU artefact: a WIDER attribute table makes it worse, because each additional column adds another offset-index fetch plus another whole page per click.
>
> **What the shipped work actually changed about the plan's premises.** Object families (`docs/plans/2026-09-22-cityparquet-object-families.md`) did NOT make the inspector's attributes come from a view — and does not need to. The division of labour on the tree today is: the FETCH delivers every footer-declared attribute into `ResidentObjectRecord.attributes`, where `DetailsPanel` reads them for the clicked object; the family VIEW delivers table access to every row of the file, resident or not, for the table panel, filters, statistics and export. On the two datasets measured, nothing POPULATED is missing from the inspector that a fetch could have supplied (the columns the fetch does not project — `address`, `children_roles`, `other` — are inferred null from their compressed size; see open question 4), and nothing is retained that the record will not show, because a null cell never becomes a key.
>
> **Seven of the Codex review's eight findings die with the deferral, not despite it** (`.superpowers/sdd/notes/codex-plan4-review.txt`); the eighth — that Task 1 was a measurement dressed as a gate, since both of its outcomes implemented deferral — was right, and this revision is what applying it looks like. Its Critical — "a rule added after load recolours from the cached model (`streamLayer.ts` `setRules` → `recolorCells`) and would style objects from attributes that were never read" — is a hazard created ONLY by deferring columns. Today the fetch reads every footer attribute, so the cached model has what any rule can reference, and `volumeCuM`'s dependency on `measuredHeight` (`objectRecords.ts`) is satisfied by construction. Likewise the ancestor-hydration, serialised-reader, row-map-eviction, source-version and cache-byte-budget findings: every one of them is a cost of the machinery this revision deletes.
>
> **What remains is bookkeeping**, and it matters only because a measurement nobody can find gets re-proposed: record the numbers where the next reader of the streaming path will hit them, and retire the forward references that still promise this milestone. Task count: **5 → 2**, both documentation, neither TDD-able.

**Goal:** The tree states, durably and with numbers, that a streamed CityParquet layer reads its attribute columns WITH its geometry because per-row attribute reads cost more than they save — so that the idea is not proposed a third time.

**Non-goal:** any change to `streamReader`, `tableReader`'s projection, the worker protocol, `ResidentObjectRecord`, `DetailsPanel` or the streaming hooks. No code ships from this plan.

**Tech Stack:** Markdown only.

**Spec:** the performance handoff (task 4: "on-demand attributes for clicked objects"; "Retain a compact mapping from picked object to source file, row group, and row position. Highlight immediately on click. Fetch only the required attribute columns from the known source location. Use a bounded cache and avoid redundant requests. Ensure source identity/version remains valid for cached locations."). The handoff asked for a benchmark before the build (`docs/plans/2026-09-22-cityparquet-bounded-loading.md` §"Roadmap for tasks 4–6", Task 4: "Gate: two separate benchmarks on the real Yokohama file"). The benchmark was run; it refused the build. Task 4 is answered by that measurement, not by an implementation.

## Global Constraints

- `CLAUDE.md` in full: commit prefix `docs:`; `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; commit on `develop`; the pre-commit hook runs and is never bypassed.
- **Nothing under `src/` or `packages/` is touched.** If a task here seems to need a code change, it has left its scope — stop and re-open the question with the controller.
- **The numbers are quoted as MEASURED, with their method, never rounded into a slogan.** Each figure below carries the file, the row count and the date, because the one thing that would justify revisiting this is a dataset whose attribute columns are genuinely wide, and a reader must be able to tell whether theirs is one.
- **The handoff's own text is not rewritten.** `docs/performance/cityparquet-2026-09-21/README.md`'s original findings and recommendation list are a record of what was asked on 2026-09-21; this milestone APPENDS its answer rather than editing the question.

## The measurement (2026-09-23, this Linux host, Node, real HTTP)

Method: the per-column figures come from each file's Parquet footer — the sum of `total_compressed_size` over every row group, per top-level column — classified exactly as the reader classifies them (`tableReader.ts`: `IDENTITY_COLUMNS` = `id, feature_id, object_type, parents, children, bbox`; geometry = the `geometry`/`geometry_properties`/`material`/`texture` family; attributes = the rest). The read figures come from the package's own vendored hyparquet (`navara-cityparquet/src/vendor/hyparquet`), the same primitive `readRows` calls, driven through a counting `AsyncBuffer` over real ranged HTTP. The package's built `dist/` is stale (it reports `epsg: 32654` and carries no `tables` field), so the vendored reader was used directly rather than the package entry point.

**Yokohama** (`https://cityparquet.open3d.city/data/plateau/yokohama-shi/building.parquet`, 319.35 MB, 884 106 rows, 14 row groups, 37 columns):

| kind      | compressed  | share      |
| --------- | ----------- | ---------- |
| geometry  | 262.55 MB   | 82.32 %    |
| identity  | 55.59 MB    | 17.43 %    |
| attribute | **0.79 MB** | **0.25 %** |

Attribute share of a full projection, per bake rung: rung 0 **0.62 %**, rung 1 0.27 %, rung 2 0.25 %, rungs 3–4 0.25 %.
Largest attribute column: `measuredHeight`, 0.74 MB — 94 % of the attribute bytes. The other six together are 13.8 KB across 884 106 rows.

**Nishitokyo** (`…/nishitokyo-shi/building.parquet`, 29.29 MB, 84 862 rows): identity 5.27 MB, attributes **0.29 MB**; attribute share per rung: rung 0 **2.35 %**, rung 1 1.02 %, rungs 2–4 0.99 %.

**The click-path read** (Yokohama, `columns = id + the footer's seven attributes`, `useOffsetIndex: true`):

| read                                     | ranged bytes | HTTP requests | warm ms | decoded |
| ---------------------------------------- | ------------ | ------------- | ------- | ------- |
| 1 row (`rowStart 500000, rowEnd 500001`) | 416 154      | 23            | 468–510 | 183 B   |
| 1 row, different row group (100 000)     | 411 641      | 23            | 468–713 | 183 B   |
| **2000 rows** (500 000–502 000)          | **416 154**  | **23**        | 662     | 355 KB  |

One row and two thousand rows read the same bytes over the same number of requests. Decoded attributes are 182 B a row, of which one value (`measuredHeight`) is non-null — mean non-null attribute values per row over 2000 sampled rows: **1.00**.

## What the plan promised, and what happened to it

| Plan item                                                                                                              | Verdict                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task 1** — measure what deferring attributes saves                                                                   | **DONE, here, and it refused the rest of the plan.** Run against real HTTP rather than the local copy, so it also measures the request count the plan's transport would pay. Its own 5 %-of-bytes gate is met by both datasets at every rung.                                                     |
| **Task 2** — `streamReader.readAttributes(rows, signal)` + `header.attributeColumns`                                   | **CUT.** A capability with no caller and a negative payoff. The precedent is already on the tree: `useObjectSurfaces` (`src/features/streaming/useResidentSurfaces.ts`) is a correct on-demand read with NO production caller, kept alive by its own test. A second one is not wanted.            |
| **Task 3** — worker projects identity + geometry + rule columns; `attributes` message; `ATTRIBUTE_ROW_MAP_LIMIT`       | **CUT.** It exists only to make Task 2 reachable, and it is what creates the review's Critical (a rule added after load recolours from a model whose columns were never read) and its row-map eviction, serialised-reader and source-version findings. Deleting the deferral deletes all of them. |
| **Task 4** — `useObjectAttributes`, a loading row in `DetailsPanel`, the resident-table disclaimer in `DetailsSection` | **CUT.** There is no attribute to wait for: `DetailsPanel` builds its `CityObject` from `ResidentObjectRecord.attributes`, which the fetch already filled. The disclaimer is moot twice over — its own ruling said task 5 would replace the arrangement, and task 5 did.                          |
| **Task 5** — click-latency benchmark, browser smoke, docs, Codex review                                                | **Docs survive as Task A below; the rest is CUT.** There is no click path to smoke and no diff to review.                                                                                                                                                                                         |
| **Ruling (transport): the reader, not DuckDB httpfs**                                                                  | **MOOT** — and worth recording as moot rather than as decided, because it was chosen without the benchmark and the benchmark now says neither transport should run per click.                                                                                                                     |
| **Ruling (resident table): identity + rule columns until task 5**                                                      | **SUPERSEDED by the shipped family view**, which reads every column of the file (minus geometry, appearance and `template`) for every row, resident or not.                                                                                                                                       |

---

### Task A: Record the measurement where the streaming path is documented

**Files:** `docs/architecture-notes.md` (the "Open reads an index, not the table" bullet of the CityParquet streaming section, around line 867), `docs/performance/cityparquet-2026-09-21/README.md` (append).

**No TDD step: this task writes prose, and there is no behaviour to red-green.** Its verification is that the numbers in the file match the table above and that `npx vp check` passes on the changed Markdown.

- [ ] **Step 1:** In `docs/architecture-notes.md`, extend the bullet that ends "…so a range inside a row group decodes only its pages (1 000 rows: 2.47 MB vs 21.1 MB without)" with the reason attributes travel WITH the geometry rather than on demand. It must state, in the note's own voice: that the footer's attribute columns are 0.25 % of Yokohama's compressed bytes and 0.62 % at the cheapest rung; that a one-row attribute read costs 0.40 MB over 23 range requests, the same as a 2000-row read, because offset indexes and pages are the granularity; that a resident record holds only NON-NULL attributes, one key on the real PLATEAU data; and that a wider attribute table makes the per-row read worse, not better. Name the date and the two files so a future reader can re-run it.
- [ ] **Step 2:** Append a section to `docs/performance/cityparquet-2026-09-21/README.md` — "Task 4 (on-demand attributes): measured 2026-09-23, not built" — carrying the two tables above verbatim, the method paragraph (vendored hyparquet over real ranged HTTP; `dist/` stale), and the sentence that the handoff's task-4 gate was run and refused the build. Do not edit the README's original findings or its numbered recommendation list.
- [ ] **Step 3:** `npx vp check`; commit (app, `docs:`).

### Task B: Retire the forward references that still promise this milestone

**Files:** `docs/plans/2026-09-22-cityparquet-bounded-loading.md` (§"Roadmap for tasks 4–6", the "**Task 4 — attributes on demand**" paragraph, line 383).

**No TDD step**, same reason as Task A.

- [ ] **Step 1:** Rewrite that paragraph so it records the outcome instead of a promise. It currently specifies the transport, the worker message, the inspector's separate loading state and a 512-entry LRU — every one of which this revision deleted. Replace it with one short paragraph: the gate was run on 2026-09-23, attributes are 0.25–2.35 % of a fetch, a one-row read costs the same bytes as a 2000-row read, so streamed CityParquet reads its attribute columns with its geometry; pointer to this plan and to the architecture note. Leave the Task 5 and Task 6 paragraphs alone — both shipped and both are accurate.
- [ ] **Step 2:** Confirm nothing else forward-references the milestone. `docs/roadmap.md` does not (checked 2026-09-23: no "performance task", "task 4" or "bounded loading" entry), and no module under `src/` or `packages/` mentions on-demand attributes. Re-run the sweep before committing rather than trusting this line: `grep -rn "on-demand attribute\|attributes on demand\|deferred attribute" docs/ src/ packages/cityjson-navara-plugins/packages/ | grep -v node_modules`.
- [ ] **Step 3:** `npx vp check`; commit (app, `docs:`).

## Open questions for the controller

Rule on these before anyone acts on this plan; none of them is settled by the measurement.

1. **The one case a view-backed lookup would genuinely improve.** A RESTORED selection — a share link or a saved workspace whose selected object is not resident, because the camera has not delivered its cell — leaves `useResolvedBuilding` at `loading: true` until the camera returns there. A `SELECT … FROM <family view> WHERE id = ?` would fill the inspector immediately, and the family view already exists, so it costs a query rather than a reader. It is also the only remaining place a per-object lookup has POSITIVE value, and plausibly what the handoff's "Highlight immediately on click" meant. **Deliberately NOT planned here:** it is a different feature (resolve a non-resident object) from the one this plan was for (avoid reading attributes), and it needs the family's view to be ready when the selection restores. **The ruling must be one of two things, never a third:** (a) nobody has reported it, and task 4 is closed; or (b) it is reopened as a NEW plan under its own name — "resolve a non-resident selection from its family view" — and never as a revision of this one. Either way the deferral idea stays dead.
2. **`other` vs `other_attributes`.** The Yokohama file carries a column named `other`; the reader diverts spill-over attributes from a column named `other_attributes` (`tableReader.ts`). `other` is null in every sampled row, so nothing is lost today, but the two names should be reconciled against the CityParquet spec. Not this plan's — flagging it.
3. **Does the family view intend to keep `address`?** The families work was briefed as dropping geometry/appearance/template/**address** columns, but `isDroppedColumn` (`src/insights/columnKind.ts`) drops only `template`, a bare `geometry` and the LoD-suffixed family — `address` is KEPT and published in the view. Intended, or a brief the code did not follow?
4. **An inference, stated as one.** `address` and `children_roles` are judged all-null on Yokohama from their compressed size (24 417 B and 2 713 B across 884 106 rows, i.e. run-length-encoded nulls); `parquetReadObjects` silently omitted both from a row read, so they were not confirmed by decoding. If that matters to a future decision, decode them properly first.

## Verification performed for this revision

- `npx vp test run` (app root): **301 files passed, 5 skipped; 4 084 tests passed, 120 skipped.**
- `cd packages/cityjson-navara-plugins && pnpm vitest run`: **80 files passed; 1 071 tests passed, 1 skipped.**
- The null-skipping claim is the assertion at `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/decodeTable.test.ts:234` ("A null cell contributes no key at all"), which passes in the run above.
- The byte and latency figures were produced by throwaway scripts in the session scratchpad, not committed; the method paragraph above is enough to reproduce them.
