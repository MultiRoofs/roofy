# UI layout redesign — GIS-conventional information architecture

**Date:** 2026-08-10 · **Branch:** `feat/ui-redesign`

## Problem

Three concerns, raised by the user:

1. **The header mixes controls with scene information.** GIS tools (QGIS,
   ArcGIS, Cesium viewers) put tools in the header and _facts about the scene_
   in the bottom status bar. Ours renders the active layer's file name, CRS,
   object count, LoD, layer count, a sun datetime pill _and_ a separate sun
   button, plus a rules pill, all in the toolbar. "Advanced Settings" also
   bundles unrelated configuration (lighting, post-processing, backdrop,
   diagnostics) — and its Backdrop section duplicates the sidebar's Basemap
   and Google 3D Tiles panels outright.
2. **The layer panel's row actions are unpolished.** "del" is a text button
   among icon buttons; the fly-to glyph is ambiguous.
3. **The landing page buries its hierarchy.** "Load Delft sample" and "Browse
   catalog" render as the same kind of button, but they are not the same kind
   of choice: the real fork is _use your own data_ vs _browse the published
   catalog_. The sample is a demo/debug convenience.

## Design

### A. Toolbar sheds information; the status bar is the facts row

**Dedupe, don't relocate.** Each toolbar pill either duplicates an existing
surface (delete it) or has no other home (move it):

| Toolbar item          | Fate   | Why                                                                |
| --------------------- | ------ | ------------------------------------------------------------------ |
| File name             | delete | Sidebar highlights the active layer already                        |
| `Objects N` pill      | delete | StatusBar already shows `Objects N`                                |
| `Layers N` pill       | delete | Sidebar section title shows the count                              |
| `LoD x` pill          | delete | Each sidebar row carries the LoD dropdown                          |
| `Rules N active` pill | delete | LegendOverlay + Inspector Rules tab show rules                     |
| `CRS EPSG:nnnn` pill  | move   | No other home → StatusBar right side (QGIS puts EPSG bottom-right) |
| Sun datetime pill     | merge  | Becomes the label _of_ the sun menu button                         |

The sun control becomes **one** trigger: the existing popover unchanged, but
its toolbar button carries the compact datetime text and the day/night state
styling that lived on `.sun-pill`. One subject, one control.

The toolbar that remains, left to right: brand, sidebar toggle, pick modes +
(disabled) box-select/measure, fit, view mode, scene theme, sun menu, spacer,
rendering settings gear, theme toggle, save, share, inspector toggle, close.

### B. "Advanced Settings" becomes "Rendering"

Drop the **Backdrop** section entirely — basemap and Google 3D Tiles already
have a first-class home at the top of the left sidebar. What remains is
genuinely one subject: how the scene is rendered. Rename panel title and gear
tooltip to "Rendering". Sections: Lighting, Post Processing, Diagnostics.
The reset-footer keeps its exact semantics (it never touched the backdrop
anyway — its title said so).

### C. Layer panel row actions become a consistent icon set

- Remove: trash-can icon (was the text "del"), `title="Remove layer"`.
- Fly-to: crosshair/locate icon (circle + center dot + tick marks), replacing
  the ambiguous compass glyph, `title="Zoom to layer"`.
- Both stay 12px stroke icons in the existing `.rule-action-btn` chrome; hover
  states per existing pattern. No behavior change.

### D. Landing page: one fork, two doors, sample demoted

Hero keeps the eyebrow + headline but drops the extension list from the
summary (the drop zone already names the formats). Below it, **two equal
entry cards**:

- **Open your data** — the existing `SourcePicker` (drop zone, browse,
  folder, URL field).
- **Browse the catalog** — opens the STAC browser; card explains it in one
  sentence ("Pick a city model from the Open3D City catalog").

"Load Delft sample" becomes a small text link under the cards ("or try the
Delft sample"), styled like a footnote, not a peer action. Saved workspaces
list unchanged below.

### E. Attribute panel becomes a table (second wave, same session)

The floating `AttributePanel` renders attribute key/values as a stacked div
list — it reads as a popup, not a data surface. It becomes a semantic
`<table>` with the shadcn Table _look_ built on the app's existing tokens
(decided with the user: no Tailwind/shadcn install — the app is one
hand-rolled CSS system and stays that way): muted `<thead>` (Attribute /
Value), hairline row dividers, row hover, compact padding, monospace values,
sticky header when the body scrolls. New `.attr-table*` classes — the
existing `.attr-row`/`.attr-key`/`.attr-value` classes are SHARED with
SolarMenu, RenderingPanel and the inspector and must not be restyled.
Every behavior stays: collapse, agg-mode select (the Value header names the
mode, e.g. "Value (avg)"), inherited-from note, value tooltips, `.attr-mixed`,
empty state.

### F. View-align cluster removed (second wave, same session)

The T/F/R/Bo/Bk/L overlay goes — component, render site, test, CSS (incl.
the light-theme override). `CitySceneHandle.alignView` stays: it is
documented public API, and the UI's removal is not an API break. The
`ViewDirection` type moves with the handle if it lived in the deleted file.
`CameraControls` (zoom/compass) is untouched.

### G. Visible tooltips on icon-only buttons (third wave)

Native `title` tooltips are slow and were the only accessible name an icon
button had. A shared CSS `[data-tooltip]` pattern (token colors, 300 ms
appear / instant hide, `pos`/`align` variants) serves the toolbar, the sun
trigger and the layer-row actions; every migrated button carries an
`aria-label` because `content: attr(data-tooltip)` would otherwise become
the accessible name. No JS, no dependency.

### H. Rendering panel regroups by subject (third wave)

Sections become **Rendering** (exposure, sun shadows, post-processing
master, aerial perspective), **Weather** (clouds, coverage, precipitation,
lens flare — the user's grouping), **Diagnostics** (unchanged). The master
toggle's visible label becomes "Post Processing"; wiring and the
cross-section disabled logic are untouched.

### I. Cyber theme goes synthwave (third wave)

Reference: neon wireframe city. Edges already existed (LineSegments via
`ThemeStyleController`); the halo is new: a `cityBloom` EffectDesc wraps
the app's `postprocessing` BloomEffect in the ENGINE's `Effect` class
(Navara inlines its own postprocessing copy; a foreign pass silently
no-ops through `insertPass`'s instanceof checks — CLAUDE.md Known Issue
(l)), inserted before toneMapping, add-once-then-toggle. Policy stays
engine-free: `bloom` is plain data on `ThemeEnvironment`, null everywhere
but cyber. Fill drops to a near-silhouette, edge HDR rises; bloom numbers
were browser-bisected (threshold 1.0 bloomed nothing, 0.1 washed the
ground, 0.3/intensity 3 shipped). Wireframe theme deliberately gets no
bloom (a hidden-line drawing needs crisp lines).

### J. Catalog ZIP CityGML becomes addable (third wave)

`.zip` assets flip to loadable; magic-byte sniff in the loaders routes the
bytes through `cityGmlArchive.ts` (fflate two-pass read, 32-entry cap,
`.xml` fallback only when no `.gml`, merge only on same-CRS + no id
collision). One zip = one layer. AdV `ETRS89_UTM32/33` URNs map to
EPSG:25832/25833, which is what makes the CORS-clean German items load
end-to-end (browser-verified on Brandenburg). Most other catalog zips
still fail for pre-existing host reasons (no CORS, degree CRS, stale
URLs) — the failure sentence names the reason.

## Non-goals / guard rails

- **No re-theme.** This is an IA/usability restructure; keep the existing
  visual language, tokens and both themes exactly as they are.
- Measure/box-select stay present and disabled (Navara migration).
- AttributionOverlay is untouchable (license obligation).
- No engine, store, or persistence changes; props/tests updated as needed.

## Execution

Sequential executor tasks A → B → C → D (all touch `app.css`; parallel edits
would clobber). Each task: implement, update mirrored unit tests,
`npx tsc -b --noEmit` + `npx vitest run` green, browser-verify both themes.
`feature-dev:code-reviewer` at high effort before commit; small `feat:`
commits per task.
