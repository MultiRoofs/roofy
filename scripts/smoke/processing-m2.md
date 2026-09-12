# Browser smoke: the processing toolbox, milestone 13.2

Spec §10 acceptance scenarios **4** (a streaming FlatCityBuf layer: Roof metrics
and Height from extent run over the resident set, the card says so, and moving
the camera far enough to rebuild the table marks the run stale) and **6** (the
network comes down: the lazy extensions fail with the download reason and a
Retry, while Roof metrics and Height from extent still run), plus three
regression spot checks carried over from milestone 13.1. Navara needs real WebGL
and DuckDB-wasm needs real WASM, so this is a **browser smoke** rather than a
jsdom test. This file is both the recipe and the record of its last run.

---

## Last run

|            |                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-09-12                                                                                                                                                                                                                                                                                                                                                    |
| Branch     | `develop` @ `af22992`                                                                                                                                                                                                                                                                                                                                         |
| Browser    | Chrome/151 headless (`--headless=new`), SwiftShader, 1–2 fps                                                                                                                                                                                                                                                                                                  |
| Driver     | `agent-browser connect 9333` against a hand-launched Chromium, plus one raw CDP session over `node`'s global `WebSocket` for the two steps `agent-browser` cannot reach                                                                                                                                                                                       |
| Dev server | `npm run dev -- --port 5210 --strictPort --host 127.0.0.1` (5173–5176, 5199 and 5390 were taken by other sessions)                                                                                                                                                                                                                                            |
| DuckDB     | `duckdb-eh.wasm` + the `cityjson` community extension; `spatial` loaded on demand during the scenario-6 Retry step                                                                                                                                                                                                                                            |
| Result     | **Scenario 4: all seven checks pass** (with the two recorded deviations). **Scenario 6: the warm-engine half and the cold-boot half both pass; the "Retry fails again while offline" half is UNMET** — the tooling cannot take the network away from the DuckDB worker. All three regression spot checks pass, and the engine-death path was driven for real. |

Screenshots went to the run's scratch directory (`…/scratchpad/smoke-m2/`), not
into the repo — re-running the recipe regenerates them.

Two console lines every run of this recipe produces, neither of them the
toolbox's business: the dev server prints `☠ [MISSING_ENV_FILE] missing file
(.env)` (only `.env.local` exists on this host, so `VITE_GOOGLE_MAPS_API_KEY` is
unset and the page logs `[googleTiles] … Tiles disabled`), and the page logs
`THREE.WARNING: Multiple instances of Three.js being imported`.

---

## Running it

```bash
# 1. dev server. ALWAYS through the npm script (a bare `vp dev` inlines the
#    dotenvx ciphertext as the env values). Pick a free port with `ss -ltn`.
npm run dev -- --port 5210 --strictPort --host 127.0.0.1

# 2. a Chromium of your own. Launch it with `setsid` so a stray `pkill` later
#    cannot take your own shell down with it.
setsid "$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" \
  --headless=new --remote-debugging-port=9333 --remote-allow-origins='*' \
  --no-sandbox --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
  --disable-dev-shm-usage --user-data-dir=<scratch>/profile \
  --window-size=1600,1000 about:blank &

agent-browser connect 9333
agent-browser open "http://127.0.0.1:5210"
```

Five things this run wanted and the obvious spelling does not give:

- **Never call `agent-browser set viewport`.** It resizes the emulated viewport
  through `Emulation.setDeviceMetricsOverride`, and Navara's canvas does NOT
  follow: the canvas stayed at 960×600 inside a 1600×1000 page, the globe
  rendered **pure black** for the whole session, and the FCB stream never left
  `too-far`. Launch Chromium at the size you want with `--window-size` and leave
  the emulation alone. This cost the first hour of this run.
- **Load both fixtures over HTTP, not through the file input.** Vite's static
  middleware answers `Range` requests (verified: `206 Partial Content` on
  `/fixtures/delft.fcb`), so `http://127.0.0.1:5210/fixtures/delft.fcb` drives
  the real streaming path and sidesteps M1's "the second upload of a session
  fails" trap. In the Add-layer DIALOG the URL field only works after clicking
  the **URL** tab — the input exists in the DOM under the File tab and silently
  belongs to nothing.
- **The Add-layer dialog has TWO `.fcb-url-btn` buttons** (Detect and Add
  layer), so `querySelector('.fcb-url-btn')` hits the disabled Detect one; match
  on text.
- **Fly with the address search** (magnifier → type → click the suggestion with
  `agent-browser find text … click`) and zoom with the viewport's own **Zoom in
  / Zoom out** buttons. `agent-browser mouse wheel` over the canvas moves
  nothing, and "Zoom to layer" moved the camera in neither session that tried it
  on a stream with no resident features (no new terrain requests, scale bar
  unchanged) — see the closing note.
- **Synthetic clicks on the canvas cannot pick a building** under SwiftShader
  (unchanged from M1). Select through a table row cell.

### Getting `delft.fcb` to actually stream

`fixtures/delft.fcb` covers **4.3607–4.3775 °E, 51.9961–52.0069 °N** (EPSG:7415
extent `[84501.55, 445805.03] … [85675.23, 446983.47]`, 1115 features) — the
SOUTH of Delft, not the city centre. Searching "Delft, South Holland" lands you
~1.5 km north of it and nothing loads. Search **"Delft Campus"** instead: that
one fly, straight from the fresh whole-globe camera, was enough — the status bar
went to `2.2K loaded objects · 16 resident cells · Settled` and the layer row to
`Streaming · 2,231 currently loaded`, with no zoom-in pressed afterwards.

The layer's DuckDB table is a separate step: it is only (re)built on a commit
**while the table panel is open** (`layerTableLifecycle.ts`). Open the table
first, then nudge the camera once; the drawer then reads `All 1,115 · Matching
1,115 · currently loaded` and the tool form's scope follows. Until that happens
the form honestly reads `All 0 buildings` / `Runs over the 0 currently loaded
buildings` with Run disabled — that is the table count, not a bug.

### Prerequisites for the two offline steps

- **Warm-engine offline (reachable):** the page is already loaded, DuckDB-wasm
  has booted from the CDN, `cityjson` is loaded and the layer's table is READY.
  Only then `agent-browser set offline on`.
- **Cold offline BOOT (reachable since fix wave 1, F2):** the engine must still
  be able to fetch its worker and wasm, so the network stays UP and only
  `navigator.onLine` is faked. `agent-browser` has no init-script command, so
  drive raw CDP and hold the session open across the reload (Chrome drops
  injected scripts when the client detaches):

  ```js
  // node ≥22: global WebSocket. Connect to the page's webSocketDebuggerUrl.
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});",
  });
  await send("Page.reload");
  // keep the socket open while the app boots, then let it go
  ```

  The override survives in the page after the CDP client leaves, so
  `agent-browser` can assert against it normally.

- **A genuinely offline reload is NOT reachable and must not be claimed.** The
  dev server answers `Cache-Control: no-cache`, so an emulated-offline reload
  never gets the page at all, and `doInit` fetches the worker and the wasm from
  jsDelivr (`duckdb.ts`) before installing `cityjson` from the community repo —
  an offline reload gives a FAILED engine, not a ready one with two unloaded
  extensions.

---

## Scenario 4 — the streaming layer (`fixtures/delft.fcb`)

Camera over Delft Campus, 1,115 buildings resident, table built.

| #   | check (spec §10 scenario 4)                          | observed                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Measure solids is disabled with the FCB reason       | **DEVIATION.** It reads `"Not available yet"`. `!implemented` outranks every eligibility reason (`eligibility.ts:44`), and every extension tool is still unimplemented in 13.2. Resolves in 13.3. Validate solids, Join, Aggregate and Distance read the same.                                                                                                                                                |
| 2   | Roof metrics to attributes is enabled                | PASS — `aria-disabled="false"`, no reason line. Height from extent likewise.                                                                                                                                                                                                                                                                                                                                  |
| 3   | the LoD select offers the stream's rungs with counts | PASS — `2.2 (1,115 buildings with roof surfaces)`, `1.3 (…)`, `1.2 (…)`, defaulted to 2.2.                                                                                                                                                                                                                                                                                                                    |
| 4   | the streaming note                                   | PASS — `"Runs over the 1,115 currently loaded buildings, not the whole dataset."`                                                                                                                                                                                                                                                                                                                             |
| 5   | six measures, threshold, six columns                 | PASS — all six ticked, `Flat threshold 5°`, `Columns: roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg, roof_azimuth_deg, roof_surfaces_n`.                                                                                                                                                                                                                                                        |
| 6   | Run, and the card says it ran over the resident set  | PASS — `✓ 1,115 buildings measured · 7.7 s`, then **`Over the resident set: the buildings loaded when the run started.`**, then `Wrote 6 columns to delft.fcb.` The Tools button carries `.tools-button__dot[data-tone="running"]` while the run is in flight and drops it when the run lands.                                                                                                                |
| 7   | the six columns in the table, badged                 | PASS — `ROOF_AREA_M2 … ROOF_SURFACES_N` appended after the three synthetic columns, each with the computed badge titled `Roof metrics to attributes · LoD 2.2 · All 1,115 buildings · 2026-09-12 05:51`. The app's own `ROOF AREA` / `MEAN SLOPE` / `PARTS` keep the generic "Computed by Roofy" badge. Real values, e.g. `NL.IMBAG.Pand.0503100000031902` → 5301.97 / 2813.32 / 0.53 / 13.71 / 157.09 / 189. |
| 8   | Details shows the values                             | **DEVIATION (unmet part of §7.1/§8).** Selecting that building through a table cell opens `Details · …100000031902` with Summary and Attributes and **no COMPUTED group at all** — `roof_area_m2` appears nowhere in the panel. The FCB attribute write-back is a future consideration (decision 11): a streaming run's values live in the table and nowhere else.                                            |
| 9   | Height from extent, same layer                       | PASS — `✓ 1,115 buildings measured · 5.4 s`, the same resident-set line, `Wrote 3 columns to delft.fcb.`                                                                                                                                                                                                                                                                                                      |
| 10  | move the camera far enough to rebuild the table      | PASS — four Zoom-out clicks took the resident set to 0 and rebuilt the table. Both cards read **`stale: layer reloaded`**, **Style by result is disabled with that string as its `title`**, and Undo is gone. RECENT RUNS shows both rows as `done` + `stale: layer reloaded` with `Log`, **`Re-run`** and `Edit & run` (the card's own button is labelled `Run again`; the run row's is `Re-run`).           |

---

## Scenario 6 — the network comes down

### Part A — warm engine, network taken away (PASS)

DuckDB booted, `cityjson` loaded, `delft.fcb`'s table ready, 1,115 buildings
resident. Then `agent-browser set offline on` (`navigator.onLine === false` in
the page, confirmed).

1. **Roof metrics runs.** `Run again` → Run → `✓ 1,115 buildings measured ·
7.3 s`, the resident-set line, `Wrote 6 columns to delft.fcb.` — with
   `navigator.onLine` still `false` at the moment the card appeared.
2. **Height from extent runs.** `✓ 1,115 buildings measured · 5.0 s`, same.
   Neither tool needs the network, and Roof metrics does not re-read the source.
3. **The chips do not change.** Both `3D` chips and all three `Spatial` chips
   stay `data-state="unloaded"` with the COST tooltip ("Loads the spatial
   extension on first run (about 24 MB, once per session)"). Correct: the
   boot-time offline check ran while the session was still online, and nothing
   in the UI re-checks. Their rows read `"Not available yet"` — **the documented
   deviation**: until 13.3 the download sentence lives on the chip's tooltip and
   on no row.

### Part B — cold boot with `navigator.onLine === false` (PASS)

Injected before boot with the CDP recipe above, network really up, then one
`two-buildings.city.json` layer added so the rows have a ready target.

1. **Both lazy extensions publish `failed`.** All five chips read
   `data-state="failed"`, with `title` exactly
   `"The spatial extension could not be downloaded; check the connection and retry"`
   and the `three_d` equivalent. This is `failLazyExtensionsIfOffline`
   (`duckdb.ts:346`), the F2 fix — verified in a real browser, not only in
   `tests/unit/ui/processing/extensionChip.test.tsx`.
2. **Retry is rendered, five of it**, one per extension tool, each
   `aria-label="Retry loading the <name> extension"` with the same sentence as
   its `title`.
3. **Roof metrics and Height from extent stay enabled** (`aria-disabled="false"`,
   no reason). The five extension rows read `"Not available yet"` — the same
   deviation as Part A step 3.

### Part C — "Retry while still offline fails again" — **UNMET**

What was tried: `agent-browser set offline on` (Playwright's `setOffline`, i.e.
`Network.emulateNetworkConditions`) with the faked `navigator.onLine`, then the
`spatial` Retry.

What happened: the chip went `loading` (captured mid-flight: `failed, failed,
loading, loading, loading`) and then **`loaded`** — tooltip `"The spatial
extension is loaded"`. The 24 MB install succeeded. **The emulation does not
reach the DuckDB worker's fetches**, and `ensureExtension` memoises one
INSTALL/LOAD per extension per engine, so the case cannot be re-attempted
against the same engine.

Do not read this as a failure of the app: it is a limit of the driver. What it
DOES verify, positively and in a real browser, is §5's Retry wiring end to end —
the link calls `ensureExtension`, the chip re-renders `failed → loading →
loaded`, and the loaded tooltip is the decided copy. The failure-again half
stays covered by `tests/unit/ui/processing/extensionChip.test.tsx` and
`tests/unit/insights/useDuckDBStatus.test.tsx`.

Scenario 6 becomes fully driveable when the tooling can cut the network beneath
a worker (a Playwright route that covers worker requests, or a host-level
firewall rule for the run) **and** 13.3 ships a tool that actually declares an
extension, so the download reason reaches a row.

---

## Regression spot checks

1. **Scenario 1, Height from extent on `fixtures/two-buildings.city.json` —
   PASS.** Catalogue → Height from extent → Run: `✓ 2 buildings measured ·
0.7 s`, `Wrote 3 columns to two-buildings.city.json.`; the table header gains
   `EXTENT_HEIGHT_M · EXTENT_ZMIN_M · EXTENT_ZMAX_M`; **Undo** removes all three
   and the card reads `Undone` and loses its Undo button.
2. **The Tools button's activity dot — PASS.** `.tools-button__dot` exists with
   `data-tone="running"` for the whole of the Delft Roof metrics run
   (`Reading source ✓ · Computing … · Writing results`) and is absent before it
   starts and after it lands.
3. **Engine death — PASS, driven for real.** The DuckDB worker was killed from
   inside, mid-run: `Target.setAutoAttach({autoAttach:true, flatten:true})` on
   the page session finds the one `blob:` worker among the ~108 Navara tile
   workers; `Runtime.evaluate` on that session with
   `setTimeout(()=>{throw new Error("smoke: killed")},0)` raises an uncaught
   exception at the worker's global, which is what fires `error` on the parent
   `Worker` and reaches `duckdb.ts`'s own listeners. (`self.close()` would NOT
   do — a clean termination raises no error event and the app simply hangs.)
   All three of §6.1's contained behaviours appeared:
   - every implemented row disabled with **`"Not available while DuckDB is
unavailable"`** (the five unimplemented ones keep `"Not available yet"`),
     and the open tool form's footer with the same sentence;
   - the run that was in flight landed as **`failed`** with **`"Analytics engine
stopped"`**, beside `Log` / `Retry` / `Edit & run`;
   - the earlier completed run's **Undo is disabled** with
     `title="Unavailable: the analytics engine stopped"`.

   This upgrades what M13.2's plan expected to be unit-test-only evidence
   (`tests/unit/features/processing/runQueue.test.ts`,
   `tests/unit/ui/processing/engineStopped.test.tsx`). The RECOVERY half is
   still deliberately not built (decision 12): the status bar's Retry reboots
   the engine without rebuilding the tables that were `ready` when the worker
   died, so the tools stay disabled until the page is reloaded.

---

## Performance note

The LoD select opens instantly on the 1,115-building stream (it reads tags, not
geometry), and the page stays responsive through a run: the phase line ticks
through `Reading source ✓ · Computing … · Writing results` while the panel is
polled from outside. `ROOF_BATCH_FEATURES` was not changed. **Cancel was not
exercised** — at 1–2 fps the whole run lands in 7 s and the window for a
meaningful cancel is not worth the timing games; it stays covered by
`runQueue.test.ts`'s cancellation cases.

---

## One unexplained session this run turned up (not a toolbox behaviour)

**One session's stream never planned at all, from the moment the layer was
added.** `delft.fcb` was added into an EMPTY workspace; the status bar read
`0 resident cells · Settled` immediately, at a whole-globe (1000 km) camera —
`idle`, where the planner should have said `too-far`, which is what it did say
at a comparable camera in another session. From then on nothing unstuck it: not
"Zoom to layer" (which moved the camera not at all), not the address search
(which did fly, to inside the file's extent), not the zoom buttons, not a real
mouse wheel. 0 resident cells throughout. An identical add-by-URL into an empty
workspace in the very next session streamed on its first address-search fly.

**n = 1, and the cause is not attributed.** "Zoom to layer" was clicked into an
already-silent stream, so it cannot be the trigger. Candidates that cannot be
told apart from outside: the first-stream auto-fit (`fitFirstStream` →
`setFitToken`) issuing a `flyTo` that evidently did not move the camera off the
globe and leaving `withSettleSuppressed` latched, which would gate every later
commit (CLAUDE.md's rule about returning the `flyTo` promise); or the driver
never subscribing at all. Not reproduced on demand. Recorded here — it is
viewport/layer-panel territory, not the toolbox's — so the next runner of this
recipe recognises it instead of losing an hour to it: if the first status after
adding a stream is `Settled` rather than `Zoom in to load`, reload and add
again.
