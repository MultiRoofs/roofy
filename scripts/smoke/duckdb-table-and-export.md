# Browser smoke: the layer table, the map filter and the four exports

Navara needs real WebGL and real WASM, and DuckDB-wasm needs a real network, so
the end-to-end path for the table panel is a **browser smoke** rather than a
jsdom test. This file is both the recipe and the record of its last run.

`cityparquet_write` itself was settled separately (Chrome 151, 2026-09-04: a
filtered CTAS source, `PRAGMA cityparquet_init` as its own statement, both
output files retrievable through `copyFileToBuffer` with `PAR1` magic). What
follows is the ordinary check that the finished UI over it does what the parts
do.

---

## Last run

|            |                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-09-05                                                                                                                                                |
| Browser    | Chrome/151.0.7922.34 (`HeadlessChrome/151.0.0.0`, `--headless=new`, SwiftShader, ~2 fps)                                                                  |
| Branch     | `integration-of-duckdb-wasm-and-relevant-extensio` @ `e3f5db1`                                                                                            |
| Dev server | `npm run dev -- --port 5199 --host 127.0.0.1` → it printed `http://127.0.0.1:5200/` (5199 was taken); use the port it prints, never the one you asked for |
| DuckDB     | `duckdb-eh.wasm` + `duckdb-browser-eh.worker.js` from `cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev64.0`                                           |
| Extension  | `community-extensions.duckdb.org/v1.5.5/wasm_eh/cityjson.duckdb_extension.wasm` (plus core `json` / `parquet` from `extensions.duckdb.org`)               |
| Result     | **every step passed; no code changes were needed**                                                                                                        |

Screenshots are named below as `NN-name.png`. They were written to the run's
scratch directory (`.../scratchpad/smoke/shots/`), not committed — re-running
the recipe regenerates them.

---

## Running it

The host used for the last run has no GPU and an `agent-browser` whose
connection state is shared across sessions (it has attached to the wrong Chrome
before), so the run drove Chrome directly over CDP. **The `agent-browser`
spelling below was NOT exercised in this run** — it is kept because it is the
shorter route on a host where `agent-browser` is trustworthy. The assertions are
what matter; how the clicks arrive is not.

```bash
# 1. dev server. ALWAYS through the npm script — `npm run dev` is
#    `dotenvx run -- vp dev`, and dotenvx runs perfectly well in a worktree with
#    no `.env`/`.env.keys` (the only casualty is VITE_GOOGLE_MAPS_API_KEY, i.e.
#    photoreal tiles). Never call `vp dev` directly: on a checkout that DOES
#    have `.env`, a bare run inlines the ciphertext as the value.
npm run dev -- --port 5199 --host 127.0.0.1
# Read the URL it prints and use THAT port: vite takes the next free one when
# the requested port is busy (the last run asked 5199 and was given 5200).
PORT=5200

# 2a. with agent-browser
agent-browser open "http://127.0.0.1:$PORT"
agent-browser snapshot -i

# 2b. or headless Chrome over CDP (what the last run did), driven by the
#     committed driver beside this file
~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
  --headless=new --remote-debugging-port=9401 --remote-allow-origins='*' \
  --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --user-data-dir=<scratch>/profile --log-net-log=<scratch>/netlog.json \
  --window-size=1600,1000 &

node scripts/smoke/driver.mjs 9401 9412 "http://127.0.0.1:$PORT" &

# the three one-liners the whole run is written in
D=http://127.0.0.1:9412
ev()   { curl -s --data-binary "$1" $D/eval; echo; }             # JS -> {value}|{err}
clk()  { curl -s --data-binary "{\"x\":$1,\"y\":$2}" $D/click; echo; }
shot() { curl -s --data-binary "{\"path\":\"$PWD/$1\"}" $D/shot; echo; }
# and, for the occlusion measurement in Step 3:
node scripts/smoke/px.mjs before.png after.png 748 338 24 24
```

`scripts/smoke/driver.mjs` is the driver the last run used: it opens one CDP
tab, keeps the console/exception/network log, exposes `/eval` `/click` `/key`
`/shot` `/dump` `/clearlog` `/quit` over a local HTTP port, and installs the
download capture described below. `scripts/smoke/px.mjs` decodes two PNGs and
reports the changed-pixel percentage and mean colour of one region — Step 3's
occlusion numbers come from it.

Three things the CDP route wants and the obvious spelling does not give:

- **`--enable-unsafe-swiftshader`.** Chrome 151 logs its automatic fallback to
  software WebGL as deprecated and asks for this flag. It was passed
  prophylactically and `getContext("webgl2")` came back non-null; whether the
  fallback still happens WITHOUT it was not tested here (an earlier session's
  log suggests it does, with the deprecation notice as an error line).
- **Downloads are captured in the page, not by the browser.** Wrap
  `URL.createObjectURL` (url → Blob) and `HTMLAnchorElement.prototype.click`
  (record `{name: this.download, blob}` and _suppress_ the real click), then
  read the bytes back through `blob.arrayBuffer()` → base64. Fighting
  `Browser.setDownloadBehavior` buys nothing, and the bytes have to be read
  back anyway. **Note what this therefore does NOT prove.** Because the driver
  REPLACES `anchor.click` for download anchors, the smoke exercises the blob
  the app built and nothing past it: Chrome's own download machinery, the
  `download` attribute's effect on the saved file name, and the object URL's
  lifetime (`downloadBlob` revokes on a `setTimeout(…, 0)`, and a premature
  revoke shows up as a zero-byte SAVED file, never as a bad blob) are all
  outside what a green run says anything about. They need a real download in a
  real browser.
- React inputs ignore a bare `el.value = x`. Use the prototype's native value
  setter plus `input`/`change` events.

---

## Step 1 — Boot and load a reader-backed layer — PASS

Click **try the Delft sample**
(`https://storage.googleapis.com/cityjson/delft.city.jsonl` — CityJSONSeq, so
the table is reader-backed through `read_cityjsonseq`).

Observed: status bar `DuckDB Ready`, and its `title` reads

> `Platform wasm_eh. Loaded extensions: cityjson a1455e1, core_functions v1.5.5`

Status bar: `Objects 2231 · Triangles 109.1K · CRS EPSG:7415`. `01-loaded.png`.

## Step 2 — Browse, sort and page — PASS

- Header: `delft.city.jsonl (2,231 rows)`.
- Columns: `id`, `feature_id`, `object_type`, … 59 in all (9 identity/structure
  columns and 50 attributes, which is exactly what the export dialog offers as
  tick-boxes), **no `geometry_*` column** — asserted by predicate, not by eye.
- Clicking the `id` header sorts: the header becomes `id▲` (a
  `span.sort-indicator`) and the first three ids change from
  `…0012869 / …0012869-0 / …0016459` to `…0000010 / …0000010-0 / …0000030`.
- Footer: `1–100 of 2,231`. Switching to 1000 rows/page gives
  `1–1,000 of 2,231` with 1000 `<tr>`; **Next** gives `1,001–2,000 of 2,231`.

`02-table.png`.

## Step 3 — Filter, and filter the map — PASS (occlusion sub-check PARTIAL)

**`object_type` = `Building`** → footer `1–100 of 1,115 filtered from 2,231`,
every visible `object_type` cell reads `Building`. Ticking **Filter map**
changes nothing on screen, and that is _correct_: the map sync is
feature-scoped (`buildFeatureIdsSql` → `COALESCE(feature_id, id) IN (…)`), so
selecting every `Building` drags every `BuildingPart` in with it and the whole
layer still draws. Triangles stayed at `109.1K`.

**`b3_h_dak_max > 10`** (with Filter map on) → `1–100 of 382 filtered from
2,231`, and **Triangles fell from 109.1K to 80.0K**. That is the rebuild: the
style evaluator cannot change a triangle count. `03-filtered-map.png`.

The two discriminators the step exists for, both against `b3_h_dak_max < 20`
(chosen so that a _specific_ picked building is excluded):

- **They stop answering a CLICK.** Before the filter, a click at viewport pixel
  `(760, 350)` selected a `BuildingPart` inheriting from
  `NL.IMBAG.Pand.0503100000025028` (`b3_h_dak_max = 22.51`, so `< 20` excludes
  it) — `Selected 1`, attributes in the overlay and the inspector. With the
  filter applied and Filter map on, **the same pixel selects nothing**:
  `Selected 0`, no attribute panel, inspector empty. Picking is our own raycast
  against the real geometry, so an object still in the mesh would still answer
  however it were coloured. `05-excluded-tall.png`, `06-pick-fallthrough.png`.
- **They stop OCCLUDING.** In the 24×24 px block around that pixel, 65.5% of
  pixels changed between the unfiltered and filtered frames, and the block's
  mean colour moved off the building tint to the imagery beneath
  (`rgb(215,161,161)` → `rgb(192,171,169)`). What was behind the excluded
  building — here the aerial basemap and the terrain — is visible through it.
  _Limitation:_ a building staged directly behind another building was not
  arranged; at ~2 fps under SwiftShader the camera work to guarantee that
  geometry costs more than it proves, given the raycast fall-through above.

**A condition nothing matches** (`b3_h_dak_max < -9999`) → the grid says, in
full,

> `0 of 2,231 rows match; the map shows nothing while Filter map is on`

footer `0 rows filtered from 2,231`, Triangles `0`. `07-empty-filter.png`.

**Clear** → Triangles back to `109.1K`, and the same pixel `(760, 350)` selects
`NL.IMBAG.Pand.0503100000025028` again. `08-cleared-again.png`.

## Step 4 — Export each of the four formats — PASS

The LoD picker, read before the CityParquet runs:

```js
Array.from(
  document.querySelector("select[aria-label='Level of detail']").options,
).map((o) => [o.textContent, o.value]);
// [["0.0","0_0"], ["1.2","1_2"], ["1.3","1_3"], ["2.2","2_2"]]
```

Option **text** reads like an LoD, option **value** is the reader's own suffix,
and the default is `2_2` — the layer's own `LoD 2.2`, matched by label rather
than re-spelled.

The format radios:

```js
Array.from(document.querySelectorAll("input[name=export-format]")).map((i) => [
  i.getAttribute("aria-label"),
  i.disabled,
]);
```

```
CityParquet package (.zip)  enabled
Parquet                     enabled
CSV                         enabled (default)
JSON                        enabled
CityJSON / CityJSONSeq / FlatCityBuf   disabled, each with the title
  "Not available in the browser build of the cityjson extension (writes an empty file)"
```

`09-export-dialog.png`. Every export completed with no error and no warning
line:

| Format              | File                    | Bytes     |
| ------------------- | ----------------------- | --------- |
| CSV                 | `delft.csv`             | 828,574   |
| JSON                | `delft.json`            | 3,356,636 |
| Parquet             | `delft.parquet`         | 190,351   |
| CityParquet @ `2_2` | `delft.cityparquet.zip` | 1,590,069 |
| CityParquet @ `0_0` | `delft.cityparquet.zip` | 330,396   |

Also exercised, beyond the checklist:

- **Scope = Current filter.** With `b3_h_dak_max > 15` applied (40 rows), the
  dialog opened with **Current filter** pre-selected; the CSV came back with 81
  data rows — the 40 matching `Building`s plus their `BuildingPart`s, which is
  the feature scope the exporter promises. The CityParquet package for the same
  scope wrote `building.parquet` at 777,877 bytes.
- **Attribute tick-boxes.** Unticking `b3_bag_bag_overlap` and `b3_bouwlagen`
  produced a CSV of 51 columns with neither name in the header.
- **Object types.** Unticking the only root type (`Building`) disables the
  Export button; re-ticking re-enables it.
- **Modal chrome.** Focus lands inside the dialog on open, `body` gets
  `overflow: hidden`, Escape closes it and focus returns to the **Export**
  button that opened it.
- **A streaming layer** (`fixtures/delft.fcb`, served over `/@fs`). Its table
  builds (`delft.fcb (2,231 rows)`); **Filter map** is disabled with the title
  _"Map filtering is not available for streaming layers yet"_; the export dialog
  offers Parquet/CSV/JSON only, shows no LoD picker, hides the three disabled
  city formats and says _"This layer has no CityJSON source in DuckDB; geometry
  formats need one"_; a CSV export from it succeeds (808,380 bytes, 2,231 rows).
  `10-export-streaming.png`.

## Step 5 — Re-open every downloaded file — PASS

```
delft.parquet   first 4 bytes PAR1, last 4 bytes PAR1
delft.json      json.load -> list of 2231 objects, first keys
                ["id","feature_id","object_type","b3_bag_bag_overlap",...]
delft.csv       2232 lines = header + 2231 rows; header is
                id,feature_id,object_type,<the ticked attributes>
delft.cityparquet.zip (2_2)  ['building.parquet', 'metadata.json']
                building.parquet 2,160,544 B, starts PAR1
                metadata.json    6,686 B, a STAC Feature, assets ['building.parquet'],
                                 properties["city3d:lods"] == ["2.2"]
delft.cityparquet.zip (0_0)  ['building.parquet', 'metadata.json']
                building.parquet 439,299 B, starts PAR1
                properties["city3d:lods"] == ["0.0"], and the parquet schema
                carries geometry_lod0_0
```

The zip entry names are **real file names** — `building.parquet`, not
`written` — so `writtenFileName`'s "first string-valued column" rule picked the
right column of `file | action | rows | bytes`. The `0.0` / `0_0` rung, where a
re-spelled label would have named a column that does not exist, produced
`geometry_lod0_0` and a `city3d:lods` of `["0.0"]`.

## Step 6 — Nothing left in the VFS — PASS

Run through the app's own module instance (proved to be the app's, not a second
lazily-booted DuckDB, by first querying `duckdb_tables()` and seeing the panel's
own `layer_1` with `count(*) = 2231`):

```js
const m = await import("/src/analytics/duckdb.ts");
await m.runQuery("SELECT file FROM glob('exp_*')"); // ok: true, rows: []
await m.runQuery("SELECT schema_name FROM duckdb_schemas()");
```

After **nine** exports (`export_1`…`export_8` plus the `exp_4`/`exp_5`/`exp_7`
package directories): `glob('exp_*')` returns **zero rows**; the schema list is
only `information_schema`, `main`, `pg_catalog` — no `exp_*` schema survived;
and `duckdb_tables()` shows only the two live layer tables, so
`cityparquet_validation` was dropped too.

## Step 7 — Console — PASS

Over the whole session: **0 uncaught exceptions**, **0** `Could not remove the
exported file` warnings. Every `console.error` was a basemap/terrain fetch
failing with `net::ERR_NETWORK_CHANGED` on this host's egress
(`server.arcgisonline.com`, `terrain.reearth.land`), i.e. not the app. Two
benign warnings, both known and expected here:

- `THREE.WARNING: Multiple instances of Three.js being imported.` — Navara
  inlines its own copy (Known Issue (a)).
- `[googleTiles] VITE_GOOGLE_MAPS_API_KEY not set. Tiles disabled.` — no `.env`
  in this worktree.

One engine-side observation worth knowing when reading a console: DuckDB-wasm
logs `Buffering missing file: export_1.csv` (etc.) at _warning_ level for each
`COPY … TO` target as it creates it. It is the writer opening a new VFS name,
not a failure — one line per output file, and the names confirm the export
counter never reuses one.

---

## What this run could not verify

- **Building-behind-building occlusion.** See Step 3. The raycast fall-through
  and the triangle-count drop carry the claim; a staged occluder does not.
- **Frame-rate-dependent behaviour.** SwiftShader renders at ~2 fps here, so
  event _shapes_ are reliable and frame counts are not.
- **`relinkNeeded`** (a restored session whose table has a reader but no
  source): not reachable without a save/restore cycle, and untested in a
  browser.
