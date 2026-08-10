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
