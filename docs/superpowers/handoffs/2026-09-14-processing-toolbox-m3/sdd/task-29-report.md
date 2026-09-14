# Task 29 — milestone gate (implementer part): verification + browser smoke

**Branch:** `develop` @ `910a06c`. **Date:** 2026-09-13 / 14.
**Deliverable:** `scripts/smoke/processing-m3.md` (the full recipe and record).
Codex reviews are the commander's; this report covers the evidence only.

---

## 1. Verification gates — ALL GREEN

Everything under Node 24 (`v24.14.1`, `$HOME/.local/share/mise/shims`).

| gate                                                           | result                                                                            | log                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------- |
| `npx vp check`                                                 | **0 errors, 56 warnings**, 592 files, 4.1 s — the expected counts                 | —                          |
| `npx tsc -b --noEmit`                                          | clean, exit 0                                                                     | —                          |
| `npx vitest run` (app, backgrounded, waited)                   | 282 files passed / 4 skipped · **3767 passed / 97 skipped** · exit **0** · 77.0 s | `/tmp/m3-gate-suite.log`   |
| `pnpm vitest run` (plugins, backgrounded, waited)              | 62 files passed · **845 passed / 1 skipped** · exit **0** · 6.0 s                 | `/tmp/m3-gate-plugins.log` |
| `pnpm typecheck` (plugins)                                     | clean, exit 0                                                                     | —                          |
| `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` | 4 files passed · **97 passed** · exit **0** · 8.2 s                               | `/tmp/m3-gate-probes.log`  |

No gate failure. The warning count is exactly the 56 the plan expects.

---

## 2. Browser smoke — environment

Dev server `npm run dev -- --port 5210 --strictPort --host 127.0.0.1`
(5173–5177, 5199, 5390 were taken). Hand-launched Playwright Chromium
151.0.7922.34 `--headless=new` with SwiftShader on CDP 9333, driven by
`agent-browser connect 9333`. Screenshots in
`…/scratchpad/smoke-m3/` (14 PNGs). Chrome and the dev server were killed by PID
at the end (never `pkill -f` — other sessions' Chromiums also match
`remote-debugging-port=9333` on this host).

**One process finding that changes the recipe:** launched with `setsid`, Chrome
and the dev server **survive across Bash calls** (verified: launch, return,
`curl 127.0.0.1:9333/json/version` → 200 in a fresh call). The M1/M2 "whole
scenario in one call" rule is therefore no longer needed, and the 600 s Bash cap
makes it impossible for the Delft scenarios anyway. `agent-browser eval` also
shares one JS world across calls. Both facts are written into the record.

---

## 3. Scenario results

| scenario                                 | result                          | note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2A** Measure solids on `two-buildings` | **PASS** 7/7                    | `2.2 (1 building with a solid)`; `✓ 1 building measured · 1 skipped · 27.7 s`; `1 skipped: 1 not a solid`; `0002` → 2178/1013.40/180/12.10/true, `0001` empty; no part row; draft on `solid_volume_m3` with the map unchanged; Save flips Color by `Surface type` → `Rules` (C6).                                                                                                                                                                                                       |
| **2B** Measure solids on `invalid-solid` | **PASS** 3/3, one copy defect   | volume NULL, `solid_valid=false`, envelope 388 / footprint 80 / height 8.40; caveat segment not a skip. Defect **F2** (plural).                                                                                                                                                                                                                                                                                                                                                         |
| **3** Join + Aggregate cross-layer       | **PASS** 2/2                    | `✓ 1 building joined · 1 outside every area · 11.4 s`; `bld_buildings_n = 1` in the records panel (badged), in Details' COMPUTED group and in Color by attribute. Footprint proxy unavailable on this fixture (no LoD 0) → extent centre used.                                                                                                                                                                                                                                          |
| **5** second half — two runs, one prefix | **PASS**                        | run 2 keeps Undo, run 1 loses it; run 2's Undo restores 2178 (not NULL). The "not the second run's values" clause is not discriminable — both runs write identical values on this fixture.                                                                                                                                                                                                                                                                                              |
| **8** remote Delft CityJSONSeq           | **PASS except its LoD 2.2 run** | roll-up (volume summed, height combined), part→building scope, unchanged building count, Aggregate counting each Building once (1,143 = 1,115 + 28) and the D10 non-zero distances all PASS. LoD 2.2 measurement **FAILS** — defect **F1**.                                                                                                                                                                                                                                             |
| **10** New layer, city target            | **PASS** 8/8                    | derived layer under the parent, active, columns + Details, parent untouched, Undo removes it, Save toast verbatim, Export offers CityParquet and the CSV holds exactly 81 Buildings + 82 Parts with the five `solid_*` columns, and Measure solids RUNS on the copy. Zoom to layer: the control is present and was pressed on the derived copy, but the camera move is asserted on the layer panel's own Zoom to layer on `two-buildings` (scale bar 500 km → 50 m), not on the card's. |
| **11** New layer, vector target          | **PARTIAL**                     | everything passes on scope **Matching 81**; `Selected (2)` is **UNREACHABLE** — defect **F5**.                                                                                                                                                                                                                                                                                                                                                                                          |
| **12** duplicate name, the `" (2)"` rule | **PASS** 3/3                    | A14 flag + Run disabled; renamed during the run; published `Delft · solids 2 (2)` with A15 verbatim.                                                                                                                                                                                                                                                                                                                                                                                    |
| streaming New layer disabled (A2)        | **PASS**                        | radio `disabled` with the A2 sentence as note and `title`; scenario 10's streaming variant **UNMET by design**.                                                                                                                                                                                                                                                                                                                                                                         |
| catalogue has no "Not available yet"     | **PASS**                        | zero occurrences in three layer states, including the streaming FCB one.                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## 4. Defects found (for the commander's fix wave)

**F1 — CRITICAL. `Measure solids` fails outright on the Delft sample at LoD 2.2.**

- File: `src/features/processing/solidSql.ts` (`buildSolidMeasureSql`).
- Symptom: `✕ Failed after 9.5 s — Invalid Error: ST_3DSurfaceArea: solid
contains degenerate faces`. Reproduced 5×: scope Matching 81, scope All 1,115
  (7.4 s), and on the derived 81-building copy at LoD 2.2 and LoD 1.3. LoD 1.2
  always succeeds; a run scoped to ONE building succeeds at LoD 2.2 — so
  specific solids trigger it and, because the scope is one statement, one bad
  solid aborts the whole run.
- Cause (reading the code beside the log): the validation-report fields and the
  volume are guarded `CASE WHEN s IS NOT NULL …` per D1, but
  `ST_3DSurfaceArea(s)`, `ST_3DFootprintArea(s)`, `ST_3DZMin(s)` and
  `ST_3DZMax(s)` are called bare, and `ST_3DSurfaceArea` RAISES on a degenerate
  face instead of returning NULL. §7.2's caveat rule cannot hold while one such
  row aborts the statement. The raw DuckDB string also reaches the card as the
  error text rather than a §6 sentence.
- **The fix must NOT be the volume's guard.** Scenario 2B proves
  `ST_3DSurfaceArea` returns **388** for an unclosed `is_valid = false` solid, so
  a `CASE WHEN … r.is_valid` wrapper on these four would break §7.2's caveat rule
  (the invalid solid would lose its envelope, footprint and height too). The fix
  needs something degenerate-specific — a `TRY`, or a report field flagging the
  degenerate faces — so only the raising row goes NULL.
- Screenshot: `11-delft-measure-failed.png`.

**F2 — MINOR (copy). The caveat noun is not singularised.**

- File: `summarise` in `src/features/processing/runQueue.ts` (the `caveats` branch).
- Symptom: `✓ 1 building measured · 1 invalid solids (no volume) · 8.2 s`. The
  skipped counts on the same card DO singularise (`1 skipped: 1 not a solid`).
- Screenshot: `10-invalid-solid-card.png`.

**F3 — MINOR. "Style by result" stays live on an UNDONE run's card and does nothing.**

- File: `src/ui/processing/RunFooter.tsx`.
- Symptom: after Undo the button reads `disabled:false`, no `aria-disabled`, no
  `title`; clicking opens no draft (`.rules-editor` stays null). A STALE run
  disables it with the reason as `title` (M2), so undone is the inconsistent case.

**F4 — MAJOR, observed ONCE, NOT reproduced in 4 attempts. A layer's
computed-column provenance was lost while its table kept the columns.**

- Files: `src/features/processing/runQueue.ts` (`installStaleWatcher`, `:2364`
  stale-marking and `:2368` `clearLayer`) and `src/ui/processing/useToolForm.ts:512`.
- Symptoms, all together on `two-buildings.city.json` after a good run: the grid
  dropped the five `SOLID_*` columns while the card still read `done` (NOT
  `stale`) and kept its Undo; Details listed the values under **Attributes** with
  no COMPUTED group; and re-running the same tool with the same prefix was
  blocked by `'solid_volume_m3' belongs to the source data; choose another
prefix`. That combination means `clearLayer` ran without the stale marking.
- Reproduction attempts that all failed: Open table from the layer panel and
  from the card, Zoom to layer, a Style-by-result Save, Run again, a row
  selection, and the original order replayed end to end.
- **The one condition no replay reproduced exactly**: the card's Open table as
  the FIRST drawer open of the page session (session 1 had never opened the
  drawer; the replay closed an already-open one first). Worth naming because
  Task 27's reveal channel keys on the grid's first `<th>` landing.
- User-visible half: a second run of the same tool becomes impossible until the
  page is reloaded.

**F5 — MAJOR (design conflict). A cross-layer tool with a VECTOR target can never
be scoped to "Selected".**

- Files: `src/features/workspace/layerCoordination.ts` (rules 1 and 2, `:6`/`:9`,
  `reconcileSelection` at `:134`) vs `src/features/processing/eligibility.ts`
  (Aggregate needs a vector ACTIVE layer).
- Symptom: Aggregate is only offered while the vector layer is active, and
  activating it clears a selection owned by the city SOURCE layer (rule 1).
  The form reads `Selected 0` with the radio disabled and
  `title="Nothing selected on this layer"`.
- **Rules 1 and 2 close the loop, so this is not a driver limit.** Rule 2 is "a
  pick activates the layer it landed on", so picking a city building on the MAP
  puts the CITY layer back in charge — exactly the state in which Aggregate is
  ineligible. Select-then-activate hits rule 1; activate-then-select hits rule 2.
  No ordering leaves a city selection alive with the vector layer active, and
  the table drawer follows the active layer, so §10.11's `Selected (2)` is
  unreachable through the UI however it is attempted.

---

## 5. The PARKED unbounded contributor-id list — MEASURED

Scope-**All** Measure solids over 1,115 buildings (LoD 1.2, This layer), read
statement by statement out of the run log:

| log entry                   | length                  | quoted ids | time                   |
| --------------------------- | ----------------------- | ---------- | ---------------------- |
| `Reading features`          | 99 chars                | 0          | 0.6 s · 2,231 rows     |
| `Checking source ids`       | 117 chars               | 0          | 2.4 s · 2,231 rows     |
| **`Measuring solids`**      | **40,830 chars**        | **1,116**  | 2.5 s · 1,116 rows     |
| `Writing results (1/9)`     | 47 (BEGIN)              | 0          | 0.0 s                  |
| **`Writing results (2/9)`** | **78,204 chars**        | **2,231**  | 0.0 s                  |
| `Writing results (3–7/9)`   | ~100 each               | 0          | 0.0 s each             |
| `Writing results (8/9)`     | 501 (typed `read_json`) | 0          | 0.0 s                  |
| `Writing results (9/9)`     | 49 (COMMIT)             | 0          | **5.2 s** · 2,231 rows |

Whole run **15.9 s**.

**Verdict: the run is acceptable on 1,115+ features.** Both big statements parse
and plan in well under a second; the run's time is the reader pass and the
COMMIT, not statement size. Scaling is ~36.6 chars per id → a 100k-feature layer
would build a **~3.7 MB** measure statement and a **~3.5 MB** write statement.
That is where pushing contributor selection into SQL would start to matter;
nothing measured here argues for doing it now.

---

## 6. The D10 check — PASS

Distance to nearest, **footprint (LoD 0) proxy** on Delft against a **polygon**
layer placed north of the model extent (so no building is inside it, which is
what makes a 0 meaningful):

`✓ 81 buildings measured · 61 none within 500 m · 13.0 s`, values
**210.04 / 240.58 / 322.78 / 442.06 m**, **zero zeros**.

Core `ST_Distance` returns 0 for ANY polygon↔polygon pair on DuckDB 1.5.5 (D10),
so a constant 0 was the failure mode. `ST_Distance_GEOS` is doing its job, and
the 61 NULLs beyond the default 500 m limit confirm real distances rather than a
constant. A line-layer run was prepared but the polygon pairing is the one that
actually discriminates D10, so it is the one recorded.

---

## 7. Observations (not defects)

1. A Style-by-result draft on a single-valued column styles nothing: the drafted
   rule is `solid_volume_m3 > 2178` where 2178 is the median of the one non-NULL
   value and `>` is strict, so after Save the legend reads
   `solid_volume_m3  0 / Unmatched  4` and the layer turns grey. The recolour is
   real; the outcome on a small layer is "everything unmatched".
2. Details prints raw floats where the grid formats them
   (`1013.4000000000001` vs `1013.40`).
3. Retargeting a tool to another layer keeps `scope = "selected"`, leaving Run
   disabled under `Nothing selected on this layer` until the user clicks All.

---

## 8. Not covered, and why

- Scenario 10's **streaming variant** — unmet by design (Decisions item 1); the
  refusal itself is verified (A2 verbatim, radio disabled).
- **§6's workload note** — fires only above 100 MB (`sourceRead.ts:72`); the
  largest source here is the 6.6 MB Delft sample. Correctly absent.
- **Cancel** — unchanged from M2: runs land in 7–16 s at 1–2 fps.
- **Engine death** — driven for real in M2 and extended by Task 25's suites.
- **Scenario 8 at LoD 2.2 over a whole scope** — blocked by F1, not by the driver.

---

## 9. Commit

`scripts/smoke/processing-m3.md` only, message
`docs: record the milestone 13.3 browser smoke and gate results`, no trailers,
hooks not bypassed, not pushed. `.github/hooks/`, `docs/design-history/`,
`.superpowers/` and the scratchpad were left unstaged.
