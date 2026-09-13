# Browser smoke: the processing toolbox, milestone 13.3

Spec §10 acceptance scenarios **2** (Measure solids on `two-buildings` and on
`invalid-solid`), **3** (the two cross-layer directions over a GeoJSON polygon),
**5**'s second half (two runs, one prefix, the stolen Undo), **8** (the remote
Delft CityJSONSeq by URL), **10**, **11** and **12** (the New layer
destination, the derived vector layer and the `" (2)"` rename at publication),
plus the streaming New-layer refusal and the catalogue's clean state. Navara
needs real WebGL and DuckDB-wasm needs real WASM, so this is a **browser smoke**
rather than a jsdom test. This file is both the recipe and the record of its
last run.

---

## Last run

|            |                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-09-13 / 14 (one session across midnight)                                                                                                                                                                                                                                                                    |
| Branch     | `develop` @ `910a06c`                                                                                                                                                                                                                                                                                            |
| Browser    | Chrome/151.0.7922.34 headless (`--headless=new`), SwiftShader, 1–2 fps                                                                                                                                                                                                                                           |
| Driver     | `agent-browser connect 9333` against a hand-launched Chromium                                                                                                                                                                                                                                                    |
| Dev server | `npm run dev -- --port 5210 --strictPort --host 127.0.0.1` (5173–5177, 5199 and 5390 were taken by other sessions)                                                                                                                                                                                               |
| DuckDB     | `duckdb-eh.wasm` + the `cityjson` community extension; `three_d` loaded on the first Measure solids run (27.7 s cold, ≈ 8 s warm), `spatial` on the first Join                                                                                                                                                   |
| Result     | **Scenarios 2, 3, 5 (second half), 10 and 12 PASS in full.** **Scenario 8 passes except its LoD 2.2 whole-scope run, which FAILS** (defect **F1**). **Scenario 11's `Selected (2)` scope is UNREACHABLE** (defect **F5**); the rest of 11 passes on scope `Matching`. Five defects and three observations below. |

### Automated gates, same checkout

| gate                                                           | result                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npx vp check`                                                 | **0 errors, 56 warnings**, 592 files, 4.1 s                              |
| `npx tsc -b --noEmit`                                          | clean, exit 0                                                            |
| `npx vitest run` (app)                                         | 282 files passed / 4 skipped; **3767 passed / 97 skipped**; exit 0; 77 s |
| `pnpm vitest run` (plugins)                                    | 62 files passed; **845 passed / 1 skipped**; exit 0; 6.0 s               |
| `pnpm typecheck` (plugins)                                     | clean, exit 0                                                            |
| `DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb` | 4 files passed; **97 passed**; exit 0; 8.2 s                             |

Both suites ran in the background with their output to a file and were waited on
for the exit status, per the M2 process rule.

Screenshots went to the run's scratch directory (`…/scratchpad/smoke-m3/`), not
into the repo — re-running the recipe regenerates them. They are named below as
`NN-…png`.

---

## Prerequisites

Two console lines every run of this recipe produces, neither of them the
toolbox's business (unchanged from M2): the dev server prints
`☠ [MISSING_ENV_FILE] missing file (.env)` (only `.env.local` exists on this
host, so `VITE_GOOGLE_MAPS_API_KEY` is unset and the page logs
`[googleTiles] … Tiles disabled`), and the page logs
`THREE.WARNING: Multiple instances of Three.js being imported`.

- The whole scenario set needs the **internet**: the remote Delft sample and the
  `three_d` / `spatial` extension downloads. Run every browser call with the
  Bash sandbox disabled.
- **`fixtures/delft.fcb` and the two city fixtures load over HTTP**
  (`http://127.0.0.1:5210/fixtures/…`) rather than through the file input, which
  sidesteps M1's "the second upload of a session fails" trap and keeps the file
  input free for the GeoJSON layers.

---

## Running it

```bash
# 1. dev server. ALWAYS through the npm script (a bare `vp dev` inlines the
#    dotenvx ciphertext as the env values). Pick a free port with `ss -ltn`;
#    NEVER 5173.
npm run dev -- --port 5210 --strictPort --host 127.0.0.1   # background task

# 2. a Chromium of your own, with `setsid` so it OUTLIVES the shell call.
setsid "$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" \
  --headless=new --remote-debugging-port=9333 --remote-allow-origins='*' \
  --no-sandbox --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
  --disable-dev-shm-usage --user-data-dir=<scratch>/profile \
  --window-size=1600,1000 about:blank &

agent-browser connect 9333
agent-browser open "http://127.0.0.1:5210"
```

### Four process facts this run established or re-established

- **`setsid` really does keep Chrome and the dev server alive ACROSS Bash
  calls.** Verified at the start of this run: launch, return, then
  `curl 127.0.0.1:9333/json/version` in a fresh call → 200. That means the
  scenarios can be driven **incrementally**, one step per call, instead of the
  "whole scenario in one call" M1/M2 rule — a broken selector then costs one
  step, not a 90 s reload. The 600 s Bash cap makes the one-call rule impossible
  for the Delft scenarios anyway.
- **Foreground `sleep` is blocked**; wait with `python3 -c "import time;
time.sleep(N)"`.
- **`agent-browser eval` shares ONE JavaScript world across calls** (`window.__x`
  set in one call is readable in the next), which is what makes the blob-capture
  trick below work.
- **Kill by PID at the end, never `pkill -f`.** `pgrep -f
"remote-debugging-port=9333"` on this host also matches OTHER sessions'
  Chromiums; identify your own by its `--user-data-dir` in `/proc/<pid>/cmdline`
  before killing.

### Driving facts, beyond M1's and M2's

- **A completed run LOCKS the tool form.** All `<fieldset class="processing-section">`
  go `disabled`, and a disabled fieldset makes its inputs fire **no click events
  at all** while `input.disabled` still reads `false` — a synthetic `.click()`
  on a scope radio silently does nothing and so does `agent-browser find text …
click`. Press **Run again** first (§6.2's "Run again unlocks the form with the
  same values"); it only dismisses the card, it does not submit. This cost ~20
  minutes.
- **Selects and text inputs need the native setter**, not `.value =`:
  `Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value')
.set.call(el, v)` then `dispatchEvent(new Event('change',{bubbles:true}))`.
- **Multi-select in the table is SHIFT+click** (`DataGrid.tsx:253` passes
  `e.shiftKey` to `onRowClick`), not ctrl/meta. A plain click replaces.
- **The landing page's "Add layer" needs Detect first.** Type the URL into
  `.fcb-url-input`, click **Detect**, wait for `Detected: CityJSON`, then
  **Add layer** (it is `disabled` until Detect answers). Inside the Add-layer
  DIALOG the URL field only exists after clicking the **URL** tab.
- **The layer row menu is `.layer-row-menu-btn[aria-label="Layer actions for
<name>"]`**, and its items (Zoom to layer / Open table / Show run log / Rename /
  Remove) only appear on the NEXT tick — open the menu in one call, click
  `Rename` in the next. The rename input is `.layer-row-name-input`.
- **To read an export without a download directory**, patch
  `URL.createObjectURL` and `HTMLAnchorElement.prototype.click` from a previous
  `eval`, press Export, then `await window.__blobs.at(-1).text()`.
  `agent-browser download` reported "Element not found" for `.export-submit`
  even while the element was in the DOM.
- **Synthetic clicks on the canvas still cannot pick a building** under
  SwiftShader (unchanged from M1/M2). Select through a table row cell.

---

## Scenario 2 — Measure solids, on `two-buildings` and on `invalid-solid`

### Part A — `fixtures/two-buildings.city.json` — PASS (7/7)

| #   | check (spec §10.2 / brief step 3)                      | observed                                                                                                                                                                                                          |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | LoD select offers 2.2 with the solids noun and count 1 | PASS — the ONLY option is **`2.2 (1 building with a solid)`**. `0001` does not qualify (its LoD 2.2 contributor is a MultiSurface part).                                                                          |
| 2   | four primary measures ticked, two elevations not       | PASS — Volume / Envelope area / Footprint area / Height `checked`; Ground elevation, Ridge elevation unchecked.                                                                                                   |
| 3   | the card                                               | PASS — **`✓ 1 building measured · 1 skipped · 27.7 s`** (cold `three_d`; a warm re-run of the same scope took 8.4 s), then `Wrote 5 columns to two-buildings.city.json.` `02-measure-solids-card.png`             |
| 4   | the values in the table                                | PASS — `NL.IMBAG.Pand.0002` → **2178** / 1013.40 / 180 / 12.10 / **true**; `NL.IMBAG.Pand.0001` → `—` in all five. `03-table-solids.png`                                                                          |
| 5   | the skip's cause, and no part row of its own           | PASS — **`1 skipped: 1 not a solid`**; the grid has exactly TWO rows and `NL.IMBAG.Pand.0001-part1` is not one of them.                                                                                           |
| 6   | Style by result opens a DRAFT; the map does not change | PASS — the rule editor opens with Rule name `solid_volume_m3`, colour **`#7cb518`** (the palette's first), condition `solid_volume_m3 > 2178`, and `Color by` stays **`Surface type`**. `05-style-draft-open.png` |
| 7   | Save recolours the map                                 | PASS — Add → `Color by` = **`Rules`** (from `Surface type`, i.e. C6's "from ANY mode") and the roofs go from `#D9481C` to the unmatched grey. `06-style-after-save.png`                                           |

Badge on each written column:
`Measure solids · LoD 2.2 · All 2 buildings · 2026-09-13 22:11`.
Details for `0002` shows a **COMPUTED** group holding all five.

### Part B — `fixtures/invalid-solid.city.json` — PASS (3/3), one copy defect

| #   | check                                                | observed                                                                                                                                                                                                          |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | the LoD select offers 2.2 with a count of 1          | PASS — `2.2 (1 building with a solid)`, scope `All 1 building`.                                                                                                                                                   |
| 9   | NULL volume, `solid_valid = false`, the rest present | PASS — `solid_volume_m3` **`—`**, `solid_envelope_m2` **388**, `solid_footprint_m2` **80**, `solid_height_m` **8.40**, `solid_valid` **false**.                                                                   |
| 10  | the CAVEAT segment, not a skipped count              | PASS in substance — **`✓ 1 building measured · 1 invalid solids (no volume) · 8.2 s`**, with no skipped count. **DEFECT F2: the noun is plural at count 1** ("1 invalid **solids**"). `10-invalid-solid-card.png` |

The card also carried **`All values are empty`** beside Style by result, which
is the right guard for a picked column that is entirely NULL.

---

## Scenario 3 — the two cross-layer directions — PASS (2/2)

Source polygon written into the scratch directory and added through the file
input: one `Polygon` in EPSG:4326 covering only `NL.IMBAG.Pand.0002`
(RD box 85017–85040 × 445996–446016; `0001` ends at x 85010 and its part at
85016), with `name: "Zone East"`, `zone_code: "ZE-1"`, `owner: "City of Delft"`.

1. **Join attributes by location — PASS.** Card
   **`✓ 1 building joined · 1 outside every area · 11.4 s`** (§10.3's own
   sentence). Table: `0002` → `Zone East` / `ZE-1` / `City of Delft`; `0001` →
   `—` in all three. `08-join-card.png`
   **Deviation (fixture, not code):** `two-buildings` has no LoD 0, so the
   **Footprint (LoD 0)** radio is `disabled` and the form states
   `LoD 0 footprints are not in this layer; the bounding-box centre is used.`
   The join therefore ran on the **extent-centre** proxy. The footprint proxy is
   exercised instead in scenario 8 on Delft, which does have LoD 0.
2. **Aggregate buildings per area — PASS.** Scope radios sit under TARGET with
   the muted line **`Scope applies to the source layer's buildings.`** (A12).
   Card `✓ 1 area aggregated over 1 building · 2.9 s`. The polygon carries
   **`bld_buildings_n = 1`**, shown in the vector layer's **records panel** with
   the badge `Aggregate buildings per area · All 2 buildings · 2026-09-13 22:48`
   (`09-aggregate-records.png`), in **Details** under a **COMPUTED** group, and
   in **Color by attribute**'s select (`None / name / zone_code / owner /
bld_buildings_n`).

---

## Scenario 5, second half — two runs, one prefix — PASS

Run 1: Measure solids, scope **All 2 buildings**, prefix `solid_`.
Run 2: same tool, same prefix `solid_`, scope **Selected 1**
(`NL.IMBAG.Pand.0002`, the layer's one qualifying feature, picked through a
table cell).

- Run 2's card offers **Undo**; RECENT RUNS shows run 1 with **`Log · Edit &
run` and NO Undo** — stolen exactly as §6.2 words it. `07-recent-runs-two.png`
- Pressing run 2's Undo leaves `NL.IMBAG.Pand.0002` at **2178 / 1013.40 / 180 /
  12.10 / true** — the first run's values, **not NULL** — and `0001` still empty.
  Run 2's own Undo then disappears and its card reads `Undone`.

**Limit of this fixture, recorded rather than smoothed over:** both runs measure
the same building at the same LoD, so they write IDENTICAL values. "Restores the
first run's values" is therefore verified as "does not null the column out"; the
"and not the second run's values" clause is not discriminable here. Making it
discriminable needs two runs whose values differ (different LoDs, or a measure
set that differs), which `two-buildings` cannot give at one LoD.

---

## Scenario 8 — the remote Delft CityJSONSeq, by URL

`https://storage.googleapis.com/cityjson/delft.city.jsonl` (6,605,724 bytes,
1,115 buildings, 1,116 BuildingParts, EPSG:7415), added through the landing
page's URL field. Load to `1,115 buildings · LoD 2.2` took ≈ 80 s under
SwiftShader.

| #   | check (§10.8)                                                    | observed                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Measure solids at **LoD 2.2** on a filtered scope                | **FAIL — defect F1.** `✕ Failed after 9.5 s · Invalid Error: ST_3DSurfaceArea: solid contains degenerate faces` on scope Matching 81, and again on scope **All 1,115** (7.4 s) and on the derived 81-building copy at 2.2 and at 1.3. LoD **1.2** succeeds. `11-delft-measure-failed.png`                                                                                                                                                  |
| 1a  | volume is the SUM of the parts' volumes                          | PASS — the sample's ONE multi-part building, `NL.IMBAG.Pand.0503100000030621` (2 parts). At **LoD 2.2**, scope Selected: parts 6360.20 + 6301.18 → building **12661.38**. At LoD 1.2: 6364.86 + 6302.15 → **12667.00**, against 3DBAG's own `b3_volume_lod12 = 12667.88` (0.007 % apart). Envelope and footprint roll up the same way (2076.07 + 2061.95 = 4138.02; 406.93 + 403.31 = 810.25).                                             |
| 1b  | height is the COMBINED extent, never a sum                       | PASS — LoD 1.2 parts read 15.64 and 15.63, the building **15.64** (not 31.27). The file's own LoD 1.2 z-extents are −0.44 … 15.201 and −0.44 … 15.186, i.e. a combined 15.641.                                                                                                                                                                                                                                                             |
| 2   | select a PART, scope **Selected** → the run covers its Building  | PASS — selecting `…030621-0` alone reads `Selected 1`, the card says **`1 building measured`**, and BOTH parts plus the building row gain the new `psel_*` columns with the roll-up. The badge reads `Measure solids · LoD 2.2 · Selected 1 building · … · 1 of 81 buildings in this run`.                                                                                                                                                 |
| 3   | the table's building count is unchanged                          | PASS — 1,115 throughout (and 81 on the derived copy); parts stay child rows under the `▸` expander.                                                                                                                                                                                                                                                                                                                                        |
| 4   | Aggregate counts each Building **once**, whatever its part count | PASS — over three zones with scope **All 1,115**, footprint proxy: `✓ 3 areas aggregated over 1,115 buildings · 28 buildings counted in more than one area · 11.7 s`, and 686 + 308 + 149 = **1,143 = 1,115 + 28**. Not 2,231 (rows) and not 1,116 (parts).                                                                                                                                                                                |
| 5   | Distance to nearest is NON-ZERO with a polygon proxy (**D10**)   | PASS — footprint proxy against a **polygon** layer placed north of the extent: `✓ 81 buildings measured · 61 none within 500 m · 13.0 s`, values **210.04 / 240.58 / 322.78 / 442.06 m**, **zero zeros**. Core `ST_Distance` would have returned 0 for every one of these polygon↔polygon pairs (D10); `ST_Distance_GEOS` is doing its job, and the 61 NULLs beyond the default 500 m limit confirm real distances rather than a constant. |

### The PARKED unbounded contributor-id list — measured

Ledger item (c) under Task 7, and the roadmap's carried list. Measured on the
scope-**All** run over 1,115 buildings (LoD 1.2, This layer), read statement by
statement out of the run log:

| log entry                   | statement length                  | quoted ids in the `IN (…)` | time                   |
| --------------------------- | --------------------------------- | -------------------------- | ---------------------- |
| `Reading features`          | 99 chars                          | 0                          | 0.6 s · 2,231 rows     |
| `Checking source ids`       | 117 chars                         | 0                          | 2.4 s · 2,231 rows     |
| **`Measuring solids`**      | **40,830 chars**                  | **1,116**                  | 2.5 s · 1,116 rows     |
| `Writing results (1/9)`     | 47 (BEGIN)                        | 0                          | 0.0 s                  |
| **`Writing results (2/9)`** | **78,204 chars**                  | **2,231**                  | 0.0 s                  |
| `Writing results (3–7/9)`   | ~100 chars each (ADD COLUMN)      | 0                          | 0.0 s each             |
| `Writing results (8/9)`     | 501 chars (the typed `read_json`) | 0                          | 0.0 s                  |
| `Writing results (9/9)`     | 49 (COMMIT)                       | 0                          | **5.2 s** · 2,231 rows |

Whole run **15.9 s**. **Verdict: acceptable on 1,115+ features** — the two big
statements parse and plan in well under a second each, and the run's time is
dominated by the reader pass and the COMMIT, not by statement size. The scaling
is ~36.6 chars per id, so a 100k-feature layer would build a **~3.7 MB** measure
statement and a **~3.5 MB** write statement; that is where pushing contributor
selection into SQL would start to matter. Nothing here argues for doing it now.

The log is also good evidence for §6.4: the proxy row, the reader `FROM` clause,
the `CASE WHEN s IS NOT NULL` guards (D1) and each write statement are all
present and copyable.

---

## Scenario 10 — destination New layer, on a city target — PASS (8/8)

Filter `b3_opp_dak_plat > 200` → `All 1,115 · Matching 81`. Measure solids,
scope **Matching**, destination **New layer**, name `Delft · solids`
(the suggested name was `delft.city.jsonl · solids`).

| #   | check                                                                       | observed                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | a new layer of exactly the matching buildings, directly under Delft, active | PASS — `Delft · solids` · `81 buildings · LoD 2.2 · Derived from delft.city.jsonl` · `Derived · not saved in workspaces`, inserted immediately under the parent and activated. Card `✓ Created Delft · solids · 81 buildings · 13.6 s`. `12-derived-layer-created.png`                                                                                                                                                                                           |
| 2   | the columns in its table and in Details                                     | PASS — `All 81 · Matching 81`, the five `SOLID_*` columns each badged `Measure solids · LoD 1.2 · Matching 81 buildings · 2026-09-13 23:06`; Details shows a COMPUTED group with the values.                                                                                                                                                                                                                                                                     |
| 3   | **Delft's own table has no new columns**                                    | PASS — `ID · STATUS · ROOF AREA · MEAN SLOPE · PARTS`, unchanged.                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | Zoom to layer                                                               | PASS for the control, PARTLY asserted for the flight. The card's button is present and was pressed on the derived VECTOR copy in scenario 11, but no camera move was asserted there (no scale-bar read, and M2 records Zoom to layer NOT moving the camera in two sessions). The camera move itself is verified on the layer panel's own Zoom to layer on `two-buildings`: scale bar 500 km → **50 m** with the buildings on screen (`04-map-before-style.png`). |
| 5   | **Undo removes it**                                                         | PASS — demonstrated twice: on the derived VECTOR layer (scenario 11) and on the derived CITY layer `Delft · solids 2 (2)` (scenario 12). Both vanish from the layer list and the card reads `Undone`.                                                                                                                                                                                                                                                            |
| 5b  | the Undo block reason once the copy has been used                           | PASS — after a later run against the copy, the creation run's Undo is `disabled` with `title="Used by a later run; remove the layer from the layer list instead"`.                                                                                                                                                                                                                                                                                               |
| 6   | Save warns                                                                  | PASS — the toast reads **`Workspace saved — you'll find it here next time you open Roofy. 1 derived layer is not saved; export it to keep it`**.                                                                                                                                                                                                                                                                                                                 |
| 7   | its Export offers CityParquet and holds only its own buildings              | PASS — FORMAT lists `CityParquet package (.zip) · Parquet · CSV · JSON · CityJSON · CityJSONSeq · FlatCityBuf`; ROWS reads `Whole layer · 81 buildings including parts`; `solid_volume_m3` is in ATTRIBUTES. The captured CSV (`Delft_solids.csv`) has **58 columns including all five `solid_*`**, and **163 rows = 81 Building + 82 BuildingPart** — exactly the copy's own content.                                                                           |
| 8   | **Measure solids runs on the derived layer**                                | PASS — `✓ 81 buildings measured · 6.9 s` → `Wrote 5 columns to Delft · solids.`, at LoD 1.2 through the parent's reader. This is the clause that proves `sourceFeatureIds` reached `readSource`; the LoD 2.2 attempt on the same copy reached the reader too and then hit **F1**.                                                                                                                                                                                |

The New-layer form also prints `⚠ 1 inherited computed column will be replaced
in the new layer` when the copy would overwrite a column it inherits.

---

## Scenario 11 — destination New layer, on a vector target — PARTIAL

Aggregate buildings per area, TARGET `delft-zones.geojson` (3 polygons banding
the sample's extent), SOURCE `delft.city.jsonl`, destination **New layer**.

**The `Selected (2)` scope is UNREACHABLE — defect F5.** Aggregate is only
offered while a VECTOR layer is active ("Needs a vector layer" otherwise), and
activating that vector layer clears a selection that belongs to the city
layer — rule 1 of `src/features/workspace/layerCoordination.ts` ("Activating a
layer clears a selection that belongs to another layer"). Selecting two Delft
buildings and then activating `delft-zones.geojson` leaves the form at
`Selected 0`, with the radio `disabled` and `title="Nothing selected on this
layer"`.
**Rules 1 and 2 close the loop between them, so this is not a driver limit.**
Rule 2 is "a pick activates the layer it landed on"
(`layerCoordination.ts:9`, `reconcileSelection` at `:134`), so picking a city
building on the MAP would activate the city layer — which is exactly the state
in which Aggregate reads "Needs a vector layer". Selecting first and activating
second hits rule 1; activating first and selecting second hits rule 2. There is
no ordering that leaves a city selection alive with the vector layer active, and
the table drawer follows the active layer, so no route exists through the UI at
all.

Run on scope **Matching 81** instead, which exercises everything else:

- `✓ Created delft-zones.geojson · buildings · 3 areas aggregated over 81
buildings · 6 buildings counted in more than one area · 13.2 s`
- The new vector layer holds **every** area of the target — `3 features ·
Derived from delft-zones.geojson · Derived · not saved in workspaces` — inserted
  directly under its parent.
- `bld_buildings_n` counts only the SCOPED buildings: 28 + 33 + 26 = **87 = 81 +
  6** (the 6 that straddle a zone boundary under the footprint proxy).
- **The target itself is unchanged**: `delft-zones.geojson`'s records panel still
  reads `NAME · ZONE_CODE · DISTRICT` with no `BLD_BUILDINGS_N`. This is the
  browser evidence for ruling C1 — the New-layer branch precedes the vector
  This-layer publication.
- **Undo removes the derived vector layer**; the card reads `Undone`.

---

## Scenario 12 — the duplicate name and the `" (2)"` rule — PASS (3/3)

1. With `Delft · solids` in the layer list, Measure solids → New layer → Name
   `Delft · solids`: the form flags **`A layer is already called that`** (A14)
   in the Name field and **Run is `disabled`**.
2. Renamed to `Delft · solids 2` → Run (LoD 1.2, scope Matching 81). **While the
   run was in flight** (`Loading extension ✓ · Reading source ✓ · Computing …`),
   the existing layer was renamed through its row menu to `Delft · solids 2`.
3. The run published as **`Delft · solids 2 (2)`** and the card carried the A15
   line verbatim: **`Renamed to "Delft · solids 2 (2)": a layer already had that
name`**. `13-rename-collision.png`

Both layers then stood side by side (`Delft · solids 2 (2)` above
`Delft · solids 2`, both `Derived from delft.city.jsonl`), and the new one's
**Undo removed it** cleanly.

---

## The streaming refusal and the catalogue

- **New layer is DISABLED on a streaming target, with A2 — PASS.** With
  `fixtures/delft.fcb` (`Streaming · 2,231 currently loaded`) active, Roof
  metrics' OUTPUT shows the `New layer` radio `disabled:true` with both an
  inline note and a `title` reading **`New layer is not available for a
streaming layer: its loaded buildings carry no geometry to copy.`** The
  streaming note `Runs over the 1,115 currently loaded buildings, not the whole
dataset.` is there too. `14-streaming-newlayer-refused.png` **Scenario 10's
  streaming variant is UNMET by design** (Decisions item 1).
- **The catalogue reads no "Not available yet" anywhere — PASS.** Zero
  occurrences in three states: a static CityJSON layer (all four one-layer tools
  enabled, the three cross-layer ones reading `Add a vector layer to join with`
  / `Needs a vector layer`), a vector layer active, and the streaming FCB layer
  (Measure and Validate solids read **`Needs a CityJSON or CityJSONSeq source;
this layer was loaded from a streaming FlatCityBuf`**). `01-catalogue.png`
- **The §6 workload note was NOT exercised.** `sourceWorkloadNote`
  (`sourceRead.ts:72`) only fires above 100 MB and the largest source in this run
  is the 6.6 MB Delft sample. Correctly absent, not a miss.

---

## Defects for the fix wave

**F1 — CRITICAL. Measure solids fails outright on the real Delft sample at LoD
2.2.**
`✕ Failed after 9.5 s — Invalid Error: ST_3DSurfaceArea: solid contains
degenerate faces`. Reproduced five times: scope Matching 81 (9.5 s), scope All
1,115 (7.4 s), and on the derived 81-building copy at LoD 2.2 (5.0 s) and LoD
1.3 (4.2 s). LoD 1.2 succeeds everywhere, and a run scoped to a SINGLE building
succeeds at LoD 2.2 — so the trigger is one or more specific solids, and because
the whole scope is one statement, **one bad solid fails the entire run**.
File: `src/features/processing/solidSql.ts` — `buildSolidMeasureSql` guards
every `ST_3DValidationReport` field and the volume with
`CASE WHEN s IS NOT NULL …` (D1), but `ST_3DSurfaceArea(s)`,
`ST_3DFootprintArea(s)`, `ST_3DZMin(s)` and `ST_3DZMax(s)` are called bare — and
`ST_3DSurfaceArea` RAISES on a degenerate face rather than returning NULL.
§7.2's own caveat rule ("an invalid solid is still measured for everything but
volume") cannot hold while one such row aborts the statement. The error also
reaches the card as a raw DuckDB string rather than a §6 sentence.
**The fix must NOT be the volume's guard.** Scenario 2B proves
`ST_3DSurfaceArea` returns **388** for an unclosed, `is_valid = false` solid, so
wrapping these four in `CASE WHEN … r.is_valid` would break §7.2's caveat rule
(the invalid solid would lose its envelope, footprint and height too). What is
needed is something degenerate-specific — a `TRY`, or a report field that flags
the degenerate faces — so that only the raising row goes NULL.
Screenshot `11-delft-measure-failed.png`.

**F2 — MINOR (copy). The caveat noun is not singularised.**
`✓ 1 building measured · 1 invalid solids (no volume) · 8.2 s` on
`fixtures/invalid-solid.city.json`. §6.2's form is `"<count> <cause>"` and the
ledger's ruling (Decisions item 6 (i)) says "the singular/plural noun is picked
by the same count". The skipped counts on the same card DO singularise
(`1 skipped: 1 not a solid`). File: `summarise` in
`src/features/processing/runQueue.ts` (the `caveats` branch).
Screenshot `10-invalid-solid-card.png`.

**F3 — MINOR. "Style by result" is live on an UNDONE run's card and does
nothing.** After Undo the card keeps the button with `disabled:false`, no
`aria-disabled` and no `title`; clicking it opens no draft and changes nothing
(`document.querySelector('.rules-editor')` stays null). A STALE run disables it
with the reason as its `title` (M2 scenario 4 step 10), so the undone case is
the inconsistent one. File: `src/ui/processing/RunFooter.tsx`.

**F4 — MAJOR, observed ONCE and NOT reproduced. A layer's computed-column
provenance was lost while its table kept the columns.** Three symptoms appeared
together in the first session, all on `two-buildings.city.json` after a
successful Measure solids run:
(a) the grid dropped all five `SOLID_*` columns while the run card still read
`done` (**not** `stale`) and kept its Undo;
(b) Details listed `solid_volume_m3 …` under **Attributes** with **no COMPUTED
group** (the healthy state, re-verified minutes later, shows the group);
(c) re-running the same tool with the same prefix was blocked by
**`'solid_volume_m3' belongs to the source data; choose another prefix`** —
which is `useToolForm.ts:512`'s branch for a column that is on the target's
table but NOT in `computedColumnsOf(targetLayerId)`.
That combination means `useComputedColumnStore.clearLayer` ran for the layer
without `installStaleWatcher` marking the run stale — the watcher does both
(`runQueue.ts:2368` and `:2364`), so either the two got separated or a second
caller cleared the store. **Four reproduction attempts failed** (Open table from
the layer panel and from the card, Zoom to layer, a Style-by-result Save, Run
again, a row selection, and the original order replayed end to end); the
provenance survived every one. **The one condition none of the replays
reproduced exactly** is the card's **Open table being the FIRST drawer open of
the page session** — session 1 had never opened the drawer before pressing the
card's button, while the card-path replay closed an already-opened drawer first.
That is worth naming because Task 27's reveal channel keys on the grid's first
`<th>` landing. Recorded here with its symptoms rather than smoothed over — the
prefix block is the user-visible half and it makes a second run of the same tool
impossible until the page is reloaded.

**F5 — MAJOR (design conflict). A cross-layer tool with a VECTOR target can
never be scoped to "Selected".** Aggregate buildings per area is only eligible
while the vector layer is active (`eligibility.ts`, "Needs a vector layer"), and
`src/features/workspace/layerCoordination.ts`'s first two rules close the loop:
rule 1 ("activating a layer clears a selection that belongs to another layer",
`:6`) kills a city selection the moment the vector layer is activated, and rule 2
("a pick activates the layer it landed on", `:9`, `reconcileSelection` at `:134`)
means picking a city building afterwards puts the CITY layer back in charge. So
§10.11's `Selected (2)` — and any Selected-scoped Aggregate run — is unreachable
through the UI for every ordering, not only for this driver. Either the
selection must survive activation when the other layer is a tool's source, or
Aggregate's eligibility must not depend on the active layer.

---

## Observations (not defects, but worth a look)

1. **A Style-by-result draft on a single-valued column styles nothing.** On
   `two-buildings` the drafted rule is `solid_volume_m3 > 2178`, where 2178 is
   the median of the one non-NULL value, and `>` is strict — so after Save the
   legend reads `solid_volume_m3  0` / `Unmatched  4` and the whole layer turns
   grey. The recolour is real (which is what §6.2 asks for), but the result a
   user sees on a small layer is "everything unmatched".
2. **Details prints raw floats where the grid formats them**:
   `solid_envelope_m2` reads `1013.4000000000001` in Details and `1013.40` in
   the table.
3. **Switching the tool's target layer keeps `scope = "selected"`.** Retargeting
   Measure solids from `two-buildings` to `invalid-solid` left the Selected radio
   checked AND disabled, with Run disabled under `Nothing selected on this
layer`; the user has to click All. A retarget could fall back to `all` when the
   new layer has nothing selected.

---

## What this run did NOT cover

- **Scenario 10's streaming variant** — unmet by design (Decisions item 1);
  the refusal itself is verified above.
- **§6's workload note** — no source above 100 MB was loaded.
- **Cancel** — unchanged from M2: at 1–2 fps the runs land in 7–16 s and the
  window for a meaningful cancel is not worth the timing games. Covered by
  `runQueue.test.ts`.
- **Engine death** — driven for real in M2 (regression spot check 3) and
  extended by Task 25's suites; not re-driven here.
- **Scenario 8 at LoD 2.2 over a whole scope** — blocked by F1, not by the
  driver.
