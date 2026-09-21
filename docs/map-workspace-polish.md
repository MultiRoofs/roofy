# Map workspace polish

Implemented 2026-09-09 following the requested typography, spacing and overflow pass.

## Interface conventions

- The interface uses Source Sans 3 consistently for controls, headings, data, the Roofy lockup and landing page. Numeric values in the workspace use tabular figures.
- Workspace controls use 4px corners, floating groups 6px, and larger containers 8px. These overrides are scoped in `src/app/workspace.css`, including the derived radius aliases.
- Use 12px for normal panel controls, 11px for secondary information, and 13px semibold for panel titles. Section headings use sentence case and weight rather than tracked monospace capitals.
- Separate panel sections by 16–24px; place labels 6px from fields and tightly related actions 4–6px apart. The details panel has an opaque surface and a bounded two-column attribute layout; long values remain available rather than being rounded or removed.
- Sun and scene sheets share `mapSheet.css`: a fixed header and close action above one scrolling body. Date and Time are paired fields. Native controls inherit the effective light/dark appearance.
- At map widths below 560px, scene triggers become labelled icon buttons and the selection camera action retains its accessible name while its text is hidden. The legend and compact camera cluster have separate space.
- The existing desktop viewer minimum width of 1024px remains. This pass does not introduce a phone layout.

## Regression checks

Start `npm run dev`, open the app, click **try the Delft sample**, and pick a building. Open **Sun & shade** or **Scene settings**. With agent-browser connected to that page, run:

```sh
agent-browser --session YOUR_SESSION eval --stdin < scripts/smoke/map-polish.js
```

The assertions cover consistent control fonts, sheet and details width containment, a single sheet scroll container, time field size, native control appearance, and camera/legend/selection-control overlap. Exercise both sheets, both themes, and the records drawer open and closed. Scroll to the bottom of settings: its header must remain available. Escape should close the sheet and focus its trigger while retaining the building selection.

Verified locally in Chromium with the real Delft sample at 1440×900, 1280×720, 1280×577 and 1024×768. Checks included light/dark appearance, building selection, internal settings scrolling, drawer interaction and Escape focus restoration. The initial browser assertions failed on camera/legend overlap and native control theme; both passed after the fixes. Unit regression tests first failed on missing date/time grouping and the duplicate Basemap label, then passed. Final affected test run: 169 passed across 24 files. Targeted lint passed; production build passed with the existing large-bundle warning.

Place search has a dedicated row below Feature/Surface selection. Both use 32px controls. The explicit close button collapses search, preserves the query and restores focus to the search trigger. Result lists scroll within the available map width.

Expanded search and scene sheets are mutually exclusive: opening either closes the other, preventing collisions on narrow maps.

## Workspace management and reusable styles

`/workspaces` lists browser-local saves with create, open, rename, duplicate and delete actions. The workspace menu and landing page link to it. The viewer remains mounted and inert while the page is open so returning preserves the camera and loaded layers. An opened save is updated in place; saving after its record was deleted creates a new record. Persistence adapters can implement `ProjectStateStore.update`; legacy adapters retain save-as-new behavior.

Scene settings accepts a custom XYZ basemap title, HTTP(S) `{z}/{x}/{y}` URL template and optional attribution. Basemap selection, custom definition and heatmap settings are additive snapshot/share fields. Missing fields restore default settings. Existing scene-theme overrides still apply. Custom tiles use the normal browser raster pipeline and must be accessible by the browser.

City-layer Style includes “Copy from…”: copying replaces the destination color mode, colors and ordered rules, with fresh rule IDs and independent conditions. Geometry, visibility and filters stay layer-specific. Rules referencing attributes absent in the destination follow the existing rule evaluator's missing-attribute behavior.
