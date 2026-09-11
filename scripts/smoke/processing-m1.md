# Browser smoke: the processing toolbox, milestone 13.1

Spec §10 acceptance scenario 1 — load `fixtures/two-buildings.city.json`, open
Tools, run **Height from extent**, read the three columns in the table and in
Details, style by the result, undo. Navara needs real WebGL and DuckDB-wasm
needs real WASM, so this is a **browser smoke** rather than a jsdom test. This
file is both the recipe and the record of its last run.

---

## Last run

|            |                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-09-11                                                                                                            |
| Branch     | `develop` @ `8ef02cd`                                                                                                 |
| Browser    | Chrome/151.0.7922.34 (`HeadlessChrome/151.0.0.0`), SwiftShader, 1–2 fps                                               |
| Driver     | `agent-browser connect 9333` against a Chromium launched by hand                                                      |
| Dev server | `npm run dev -- --port 5199 --host 127.0.0.1` → it printed `http://127.0.0.1:5200/`; use the port it prints           |
| DuckDB     | `duckdb-eh.wasm` + the `cityjson` community extension, as the status bar reports                                      |
| Result     | **every assertion of scenario 1 passed**; five deviations recorded below, none of them a regression of this milestone |

Screenshots went to the run's scratch directory
(`…/scratchpad/smoke/`), not into the repo — re-running the recipe
regenerates them.

---

## Running it

```bash
# 1. dev server. ALWAYS through the npm script (a bare `vp dev` inlines the
#    dotenvx ciphertext as the env values). It prints the port it actually got.
npm run dev -- --port 5199 --host 127.0.0.1
PORT=5200

# 2. a Chromium of your own — the Playwright MCP has no browser on this host.
#    SwiftShader is what gives a headless run a WebGL context at all.
"$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" \
  --headless=new --remote-debugging-port=9333 --remote-allow-origins='*' \
  --no-sandbox --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
  --disable-dev-shm-usage --user-data-dir=<scratch>/profile \
  --window-size=1600,1000 about:blank &

agent-browser connect 9333
agent-browser open "http://127.0.0.1:$PORT"
```

Three things this run wanted and the obvious spelling does not give:

- **The launch screen owns the first 3.5 s.** `revealAppAfterLaunch` removes
  `#launch-screen` 3.5 s after React commits, and React commits only after the
  whole dev module graph loads — allow ~30 s before asserting anything.
- **Load the fixture through the file input, not a synthetic drop.**
  `agent-browser upload "input[type=file]" fixtures/two-buildings.city.json`
  drives the same path as Browse files. (The second file input on the page is
  the `webkitdirectory` one for CityParquet folders.)
- **Synthetic clicks on the canvas cannot pick a building** under SwiftShader.
  Select through a table row cell instead: it writes the same selection store,
  and the scope line goes to `Selected 1`.

### One environment gap this run had to fix first

`node_modules` was missing `@fontsource/source-sans-3`, which `src/main.tsx`
imports and which `package.json` and `package-lock.json` both already declare.
Vite answered `/src/main.tsx` with a 500 (`Failed to resolve import
"@fontsource/source-sans-3/400.css"`) and the app never mounted. Fixed with
`npm install --no-save --no-package-lock @fontsource/source-sans-3@5.3.0`; the
lockfile was verified unchanged afterwards. A cold `npm install` would do the
same. (It also pruned `@fontsource/ibm-plex-{mono,sans}` from `node_modules`;
nothing in the repo imports either.)

---

## Step 1 — Tools sits after the Mode select — PASS

Asserted structurally, not by eye: inside `div.map-tool-header__editing` the
children are, in order,

```
label.map-mode-control   ("Mode", the Pick feature / Pick surface / Draw model select)
button.tools-button      ("Tools")
div.address-search
```

## Step 2 — The catalogue — PASS, with a deviation

Seven rows in three groups with the mono group labels `ROOF`,
`3D MEASUREMENTS`, `CROSS-LAYER`, plus `RECENT RUNS` ("Runs you start appear
here"). Exactly one row is enabled:

| Row                          | `aria-disabled` | reason shown        |
| ---------------------------- | --------------- | ------------------- |
| Roof metrics to attributes   | true            | "Not available yet" |
| Measure solids               | true            | "Not available yet" |
| Validate solids              | true            | "Not available yet" |
| **Height from extent**       | **false**       | —                   |
| Join attributes by location  | true            | "Not available yet" |
| Aggregate buildings per area | true            | "Not available yet" |
| Distance to nearest          | true            | "Not available yet" |

**Deviation from the scenario's wording.** Scenario 1 expects every row enabled
except the cross-layer ones, which should read "Add a vector layer to join
with". In M13.1 only `height-from-extent` is registered, and
`toolEligibility` (`src/features/processing/eligibility.ts:44`) puts
`!tool.implemented` → "Not available yet" ahead of every other reason,
including the vector-layer one at line 71. So the scenario's catalogue is the
state of the FINISHED milestone 13, not of 13.1. The vector-layer string itself
is covered by `tests/unit/features/processing/eligibility.test.ts:77`.

Rows are disabled through `aria-disabled`, not the `disabled` attribute, so the
reason stays reachable to a screen reader and the row keeps its tooltip.

## Step 3 — Height from extent → Run — PASS

The form opens with the back chevron and the tool's own sentence, then
`TARGET` (Layer `two-buildings.city.json`, Scope `All 2 buildings` /
`Matching` / `Selected 0`) and `OUTPUT` (Prefix `extent_`, "Columns:
extent_height_m, extent_zmin_m, extent_zmax_m").

Before Run there is **no** "columns exist" warning (asserted, not assumed);
after Run the same form adds "⚠ 3 of these columns exist; they will be
replaced." — it is post-run state, not a pre-run warning.

The result card reads, in two lines:

> ✓ **2 buildings measured · 7.0 s**
> Wrote 3 columns to two-buildings.city.json.

with `Open table`, `Style by result`, `Undo`, `Log` and `Run again`. The toast
repeats the first line verbatim (`2 buildings measured · 10.6 s` on the run
where it was still on screen). Elapsed was 7.0–11.0 s across four runs — that
is SwiftShader, not the tool.

## Step 4 — The table — PASS

Headers, in order: `ID`, `FUNCTION`, `MEASUREDHEIGHT`, `ROOFTYPE`, `STATUS`,
`YEAROFCONSTRUCTION`, `ROOF AREA`, `MEAN SLOPE`, `PARTS`, **`EXTENT_HEIGHT_M`,
`EXTENT_ZMIN_M`, `EXTENT_ZMAX_M`** — the three computed columns are appended
and visible by default.

Each of the three carries `span.computed-attribute-badge` whose `title` is the
provenance sentence:

```
Height from extent · All 2 buildings · 2026-09-11 17:06
```

The app's own derived columns (Roof area, Mean slope, Parts) carry the same
badge with the generic "Computed by Roofy — this value is calculated by the
app.", so the two kinds are told apart by the tooltip, not by the icon.

Values:

| id                 | measuredHeight | extent_height_m | extent_zmin_m | extent_zmax_m |
| ------------------ | -------------- | --------------- | ------------- | ------------- |
| NL.IMBAG.Pand.0001 | 8.40           | 8.40            | 0             | 8.40          |
| NL.IMBAG.Pand.0002 | 12.10          | 12.10           | 0             | 12.10         |

## Step 5 — Details shows COMPUTED — PASS

Clicking a table row cell selects the building (`Selected 1`) and adds the
right panel's second tab, `Details · …AG.Pand.0001`, **without** switching away
from Tools — spec §4.2's "picking a feature while Tools is showing does NOT
switch the tab". Opening that tab:

```
Attributes                     COMPUTED
  measuredHeight   8.4           extent_height_m  8.4
  roofType         gabled        extent_zmin_m    0
  yearOfConstruction 1923        extent_zmax_m    8.4
  status           in use
  function         residential
```

The file's own attributes stay under Attributes; only the registry's columns
move into COMPUTED.

## Step 6 — Style by result — PASS, with two deviations

Clicking **Style by result** opens the target layer's STYLE section with
`Color by = Rules` (the select's value is `rules`) and a draft rule row:
attribute `extent_height_m`, operator `>`, value `8.4`, an empty Rule name, the
editor's default new-rule colour, `+ Condition`, `Add` / `Cancel`.

- **The map repaints BEFORE Save.** The legend goes from
  `Roof 4 | Wall 12 | Ground 3 | Other 0` to `Unmatched 4` and 17.5 % of the
  pixels over the two buildings change the moment Style by result is clicked.
  This is the ledger's accepted ruling (`colorBy: "rules"` is set eagerly, spec
  §6.2's letter); what stays true is that the DRAFT rule's own colour is not
  painted until the rule is added.
- **The draft cannot be added without a name.** Clicking `Add` with the Rule
  name empty does nothing at all — the draft stays open and the rule list is
  unchanged. That is the rule editor's existing validation, and it means
  §6.2's "recolours after Save" costs the user one more step: type a name.

With the name `Tall` typed and `Add` clicked: the rule appears in the list as
`Tall — extent_height_m > 8.4`, the legend becomes `Tall 1 | Unmatched 3` (the
12.1 m building matches, the 8.4 m one does not), and 22.5 % of the pixels over
the buildings change again. The map recoloured after Save.

**Why the threshold reads 8.4 and not 10.25.** `RunFooter` asks DuckDB for
`median(extent_height_m)` over the layer's TABLE, which holds three rows — the
two Buildings and the one BuildingPart — so the column's median is 8.4, not the
median of the two buildings. Consistent with the spec's "median"; worth knowing
before reading it as an off-by-one.

## Step 7 — Undo — PASS

`Undo` on the result card (it is also on the `RECENT RUNS` row) removes all
three `EXTENT_*` columns from the table, removes the COMPUTED group and the
three attributes from Details, and takes the `Undo` button off the run row —
which keeps `Log` and `Edit & run`. The `Tall` rule survives and its legend
count falls to `Tall 0 | Unmatched 4`, which is the honest reading: the column
it tests no longer exists.

## Step 8 — Escape order — PASS

Set up with all three live: the Sun & shade sheet open
(`div.scene-buttons__sheet`), the Height from extent form open, and one
building selected.

| press | sheet      | tool form              | selection                        |
| ----- | ---------- | ---------------------- | -------------------------------- |
| —     | open       | open                   | Selected 1                       |
| Esc 1 | **closed** | open                   | Selected 1                       |
| Esc 2 | closed     | **catalogue (7 rows)** | Selected 1                       |
| Esc 3 | closed     | catalogue              | **Selected 0**, Details tab gone |

Exactly the order in `useEscapeClearsSelection`: modal, sheet, tool form, text
field, then the selection.

## Step 9 — The collapsed pill — PASS, with a deviation

Collapsed with the toolbox open and a building selected, the map's right edge
shows two pills: **`Tools`** and `Details · …AG.Pand.0001`, in that order.

**Deviation.** The header's collapse chevron is
`disabled={!hasSelection}` (`src/ui/header/WorkspaceHeader.tsx:193`), so with
the toolbox open and NOTHING selected the right panel cannot be collapsed at
all and the `Tools` pill is unreachable. Spec §4.2 describes the Tools pill
"beside the existing Details pill", which this satisfies, but a toolbox-only
session has no way to collapse the panel. Left as found; it is one predicate in
the header, not a toolbox change.

---

## What this run could not verify

- **The Delft sample as a secondary check.** Not exercised. The headless
  Chromium crashed once mid-run (`No usable sandbox` on the automatic
  relaunch; the original process was gone) and the budget went to finishing
  scenario 1 on the two-buildings fixture rather than starting a 2,231-object
  layer at 1–2 fps.
- **Anything about frame rate or timing.** SwiftShader renders at 1–2 fps here,
  so a 7 s run says nothing about the tool's cost.
- **A stable session.** The page full-reloaded four times unprompted over the
  session — no page error, no `[vite] optimized dependencies changed` line, no
  renderer-crash entry in the Chromium log. Computed columns are session state,
  so each reset silently emptied them while the layer itself was restored from
  the autosaved workspace; a reader who queries `duckdb_tables()` after one of
  these resets sees a rebuilt `layer_N` with no `extent_*` columns and can
  easily mistake it for a write-back bug. Every assertion above was re-taken
  after a reset and came back identical.
