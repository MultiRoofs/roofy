# Task 15 — Milestone gate (implementer side: Steps 1–3) — report

Branch `develop`, base `af22992`. **Three commits, not pushed**, no trailers:

- `b84bf57` docs(smoke): record the M13.2 browser smoke
- `279da34` docs: the DECIMAL median fact, and where the M13.2 smoke lives
- `4076ec5` docs(smoke): correct the streaming note to what was observed

No source code was touched. `.github/hooks/`, `docs/design-history/` and
`.superpowers/` were left alone. Scratch (logs, screenshots, the CDP scripts)
lives in
`/tmp/claude-1020/-data2-hideba-multiroof-viewer/9d7538d6-bee9-4194-bf86-967da2bad364/scratchpad/`
— note this session's own scratchpad id, not the `e57ba222…` one the brief
named (that is the previous task's).

---

## Part A — full verification

Node 24.14.1 (`mise` shims on PATH).

| run                                                                  | result                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npx vp check`                                                       | **0 errors, 56 warnings** in 529 files (3.8 s) — the expected baseline         |
| `npx tsc -b --noEmit`                                                | **clean**, exit 0                                                              |
| `npx vitest run` (full app suite, background → `full-suite-t15.log`) | **243 files passed, 2 skipped; 2983 tests passed, 32 skipped**, 64.77 s        |
| `cd packages/cityjson-navara-plugins && pnpm typecheck`              | **clean**                                                                      |
| `… && pnpm vitest run`                                               | **61 files passed; 840 tests passed, 1 skipped**, 6.06 s                       |
| `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb`       | **2 files passed; 32 tests passed**, 5.48 s (real DuckDB 1.5.5, needs network) |

No skips were added by this task. The app suite grew by 9 tests over Task 13's
2974 (the fix wave's additions), and the 2 skipped files / 32 skipped tests are
the pre-existing opt-in integration ones.

---

## Part B — browser smoke

Written to **`scripts/smoke/processing-m2.md`** (the deliverable; it carries the
full recipe, prerequisites, per-step observations and the deviation labels).
Screenshots in `…/scratchpad/smoke-m2/`, 32 of them. Environment: dev server
`npm run dev -- --port 5210 --strictPort --host 127.0.0.1`, hand-launched
Playwright Chromium 151 headless with SwiftShader on CDP 9333, `agent-browser
connect 9333`, plus **two raw-CDP node scripts** for what `agent-browser` cannot
express. Both the Chromium and the dev server were killed at the end (port 5210
free, CDP 9333 down).

### Setup cost, and the one trap worth carrying forward

The first ~hour went to a dead end that is now the first bullet of the smoke
recipe: **`agent-browser set viewport 1600 1000` breaks the app.** It applies
`Emulation.setDeviceMetricsOverride`, Navara's canvas does not follow (960×600
canvas inside a 1600×1000 page), the globe renders pure black, and the FCB
stream never leaves `too-far`. Relaunching Chromium with `--window-size` and
never calling `set viewport` fixed it outright — the globe, the basemap and the
streaming all came up.

Two more prerequisites the brief could not have known, both now in the recipe:
`fixtures/delft.fcb` covers **south Delft** (4.3607–4.3775 °E, 51.9961–52.0069
°N — extracted by reading the header through a throwaway vitest file, since
"Delft, South Holland" lands ~1.5 km north of it), and a streaming layer's
DuckDB table is only rebuilt on a commit **while the table panel is open**, so
the tool form reads `All 0 buildings` until the panel has been open across one
camera nudge.

### Scenario 4 — `fixtures/delft.fcb`, 1,115 buildings resident

| step                        | observed                                                                                                                                                                                            | shot                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| catalogue                   | Roof metrics `aria-disabled="false"`, no reason; Height from extent the same; **Measure solids reads "Not available yet"** (DEVIATION, `eligibility.ts:44`), as do Validate/Join/Aggregate/Distance | `16-delft-catalogue.png`                        |
| LoD select                  | `2.2 (1,115 buildings with roof surfaces)`, `1.3 (…)`, `1.2 (…)`, default 2.2, opens instantly                                                                                                      | `17-…`, `20-roof-form-1115.png`                 |
| streaming note              | **"Runs over the 1,115 currently loaded buildings, not the whole dataset."**                                                                                                                        | `20-roof-form-1115.png`                         |
| parameters / columns        | six measures ticked, `Flat threshold 5°`, the six column names                                                                                                                                      | `20-roof-form-1115.png`                         |
| Run                         | `✓ 1,115 buildings measured · 7.7 s` / **"Over the resident set: the buildings loaded when the run started."** / `Wrote 6 columns to delft.fcb.`                                                    | `21-roof-run-card.png`                          |
| Tools dot                   | `.tools-button__dot[data-tone="running"]` present through `Reading source ✓ · Computing … · Writing results`, absent before and after                                                               | —                                               |
| table                       | six columns appended and badged, each titled `Roof metrics to attributes · LoD 2.2 · All 1,115 buildings · 2026-09-12 05:51`; real values (5301.97 / 2813.32 / 0.53 / 13.71 / 157.09 / 189)         | `22-table-six-columns.png`                      |
| Details                     | **no COMPUTED group, no `roof_*` attribute anywhere** — DEVIATION, decision 11                                                                                                                      | `23-details-no-computed.png`                    |
| Height from extent          | `✓ 1,115 buildings measured · 5.4 s`, same resident-set line, `Wrote 3 columns`                                                                                                                     | `24-height-streaming-card.png`                  |
| camera move → table rebuild | both cards read **`stale: layer reloaded`**, Style by result **disabled with that `title`**, Undo gone; RECENT RUNS shows both as `done` + `stale: layer reloaded` with `Log`/`Re-run`/`Edit & run` | `25-stale-card.png`, `26-recent-runs-stale.png` |

Wording note: the card's re-run button is labelled **`Run again`**; the RECENT
RUNS row's is **`Re-run`**. Both exist; the brief's "Re-run" is the run-row one.

### Scenario 6 — as narrowed

**Warm engine offline — PASS.** With the engine booted, `cityjson` loaded and
the table ready, `agent-browser set offline on` (page confirms
`navigator.onLine === false`): Roof metrics ran (`✓ 1,115 buildings measured ·
7.3 s`) and Height from extent ran (`✓ … 5.0 s`), both with the resident-set
line. Chips stay `unloaded` with the COST tooltip and their rows read "Not
available yet" — the documented deviation (the download sentence reaches no row
until 13.3). Shots `27`–`29`.

**Cold boot with `navigator.onLine === false` — PASS (F2 verified in a real
browser).** `agent-browser` has no init-script command, so raw CDP:
`Page.addScriptToEvaluateOnNewDocument` with an `onLine` getter returning false,
`Page.reload`, **holding the WebSocket open across the boot** (Chrome drops
injected scripts on client detach — the first attempt failed exactly there).
Result: all five chips `data-state="failed"` with
`"The spatial extension could not be downloaded; check the connection and
retry"` / the `three_d` sentence; **five `Retry` buttons** rendered, each
`aria-label="Retry loading the <name> extension"`; **Roof metrics and Height
from extent rows enabled**. Shot `30-cold-offline-catalogue.png`.

**"Retry while still offline fails again" — UNMET, labelled.** Tried:
`agent-browser set offline on` (Playwright `setOffline` →
`Network.emulateNetworkConditions`) on top of the faked `navigator.onLine`, then
the `spatial` Retry. Observed: chip `loading` (captured mid-flight) → **`loaded`**,
tooltip "The spatial extension is loaded". **The emulation does not reach the
DuckDB worker's fetches**, and `ensureExtension` memoises one INSTALL/LOAD per
extension per engine, so it cannot be re-attempted on that engine. Recorded as a
driver limit, not an app failure — and it positively verifies §5's Retry wiring
(`ensureExtension` called, chip re-renders `failed → loading → loaded`, decided
"loaded" copy) in a real browser. Shot `31-retry-offline.png`.

### Regression spot checks

1. **Scenario 1 on `two-buildings.city.json` — PASS.** `✓ 2 buildings measured ·
0.7 s`, three `EXTENT_*` columns in the table, **Undo** removes all three and
   the card reads `Undone` and loses its Undo. Shots `02`, `03`.
2. **Tools dot — PASS** (above).
3. **Engine death — PASS, driven for real** (the brief called it optional). The
   DuckDB worker is the one `blob:` target among ~108 Navara tile workers;
   `Target.setAutoAttach({autoAttach:true, waitForDebuggerOnStart:false,
flatten:true})` on the page session exposes it, and `Runtime.evaluate` on
   that session with `setTimeout(()=>{throw new Error("smoke: killed")},0)`
   raises an uncaught exception at the worker's global, which is the `error`
   event `duckdb.ts:410-414` listens for. Fired ~250 ms into a Height-from-extent
   run. All three behaviours appeared:
   - every implemented row disabled with **"Not available while DuckDB is
     unavailable"** (the five unimplemented keep "Not available yet"), and the
     open form's footer with the same sentence;
   - the in-flight run landed **`failed`** with **"Analytics engine stopped"**
     (`Height from extent · two-buildings.city.json · 0.5 s · failed`);
   - the earlier run's **Undo disabled** with
     `title="Unavailable: the analytics engine stopped"`.

   Shot `32-engine-dead.png`. This upgrades what the plan expected to remain
   unit-test-only evidence. The RECOVERY half stays deliberately unbuilt
   (decision 12).

### Performance note

The LoD select opens instantly on the 1,115-building stream; the page stays
responsive through a run (the phase line ticks while the panel is polled from
outside). `ROOF_BATCH_FEATURES` unchanged. **Cancel was not exercised** — at
1–2 fps the run lands in 7 s and the window is not worth the timing games;
recorded as such in the smoke file.

---

## Part C — docs addendum

`docs/architecture-notes.md`, M13.2 section, two additions and nothing else:

- the engine fact from the fix wave's probe — `median()` over a DECIMAL column
  comes back from the node bindings as a raw `Uint32Array` rather than a number
  (measured, DuckDB 1.5.5), which is why the probe and `writeComputedColumns`
  pin the column to DOUBLE — citing
  `tests/integration/duckdb/computedColumns.test.ts:555-559`;
- the closing "Browser acceptance procedure" line now names both
  `scripts/smoke/processing-m1.md` (M13.1) and `scripts/smoke/processing-m2.md`
  (M13.2).

---

## Files changed

- `scripts/smoke/processing-m2.md` — NEW (the smoke record and recipe)
- `docs/architecture-notes.md` — the two lines above

(The pre-commit hook's `vp check --fix` reflowed the new markdown's tables; no
content changed.)

---

## Concerns and defects for the controller

1. **One unexplained session, NOT in processing code, n = 1, cause not
   attributed.** `delft.fcb` added into an empty workspace read
   `0 resident cells · Settled` immediately, at a whole-globe camera — `idle`
   where the planner should have said `too-far` (which it did say at a
   comparable camera in another session). Nothing unstuck it afterwards: "Zoom
   to layer" (which moved the camera not at all), the address search (which DID
   fly, to inside the file's extent), the zoom buttons, a real mouse wheel — 0
   resident cells throughout. The identical add-by-URL in the next session
   streamed on its first fly. Zoom to layer was clicked into an already-silent
   stream, so it is not the trigger; the candidates that cannot be told apart
   from outside are the first-stream auto-fit (`fitFirstStream` → a `flyTo` that
   did not move the camera) leaving `withSettleSuppressed` latched — CLAUDE.md's
   rule about returning the `flyTo` promise — or a driver that never subscribed.
   **Not proven, not reproduced on demand**, and it is layer-panel/viewport
   territory, not M13.2's. Recorded in the smoke file's closing section with a
   recognition cue for the next runner.
2. **Scenario 4's "Measure solids is disabled with the FlatCityBuf reason" is
   unreachable in 13.2** — reads "Not available yet". Expected, recorded, and it
   resolves when 13.3 implements an extension tool.
3. **§7.1/§8 on a streaming layer** — Details shows none of the six computed
   values; confirmed visually. Decision 11's future consideration, unchanged.
4. **Scenario 6's third clause cannot be driven on this host.** Closing it needs
   either a Playwright route that covers worker requests or a host-level network
   cut for the run, AND 13.3's first extension-declaring tool so the download
   reason reaches a row. Recorded as UNMET with the reason, not claimed.
5. **Environment noise the next runner will see**, neither ours: the dev server's
   `☠ [MISSING_ENV_FILE] missing file (.env)` (only `.env.local` exists here, so
   Google tiles are disabled) and the page's `THREE.WARNING: Multiple instances
of Three.js being imported`.
6. Nothing in the gate found a defect in the M13.2 code itself. Every M13.2
   sentence checked in the browser matched the decided copy exactly.
