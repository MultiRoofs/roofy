# Roofy UI redesign: implementation handoff

Implementation status (2026-09-08): the approved prototype has been implemented and reconciled in the working tree. The original proposal/approval instructions below are historical; do not restart prototyping. Continue from `docs/superpowers/plans/2026-09-07-ui-redesign-reconciliation.md` and the ignored progress ledger for verification, current capabilities and remaining external review. No commit or push is implied by local completion.

## Goal and authority

Redesign the viewer around a clear relationship between layers, the map, selected features, styling, and data. Prioritize layout and predictable behavior over cosmetic adjustments. Breaking changes, replacement of existing components, and removal of features are welcome when they improve the experience.

The design direction below is the starting brief. **The user must review and explicitly approve the interactive prototype before production implementation begins.** Agreement with this brief is not approval of an unseen layout. Follow the repository contributor guide and architecture guardrails throughout.

## Working instructions for the next AI

### 1. Inspect and prototype outside Git

- Read the repository's required design/architecture documents and inspect the current viewer with the Delft sample. Consult `design/wireframe.html` as historical context, not a layout that must be preserved.
- Create a unique temporary directory outside the repository using `mktemp -d /private/tmp/roofy-ui-prototype.XXXXXX`. Do not initialize Git there. Report its absolute path and keep it available for the user's review.
- Build a standalone, locally served interactive HTML/CSS/JavaScript prototype. Use mock data and a schematic map with clickable buildings/areas; real ingestion, Three.js, DuckDB, basemap services, and backend integration are unnecessary.
- Do not modify application source, dependencies, or the existing design files during this stage. Keep prototype files, screenshots, and design notes in the temporary directory.
- Make the proposal concrete: show realistic labels, panel sizing, selected/active states, collapsed states, and meaningful interactions. Avoid a collection of static boxes or buttons that all do nothing.
- Start with one coherent recommended layout. Use alternatives only for a specific unresolved design decision. Inspect the prototype in a browser at a roomy desktop size and a smaller laptop size, such as 1440 × 900 and 1280 × 720.

### 2. Review and agree

- Present the prototype URL, directory path, a short walkthrough, and screenshots of the main states. Identify simulated behavior, proposed feature removals, and decisions needing feedback.
- Ask the user to review the layout and behavior. **Stop before production implementation and wait for explicit agreement.** Continue prototype revisions when feedback arrives; do not interpret silence as approval.
- Keep a short decision log beside the prototype. Once approved, record the agreed layout, interaction rules, removals, and any deferred capabilities in repository documentation so implementation does not depend on a temporary directory surviving.

### 3. Implement the approved design

- Turn the approved proposal into small implementation slices: shared context/selection behavior, shell and layer management, styling and inspection, linked data/filtering, then scene controls and remaining capabilities. Adjust this order where dependencies require it.
- Follow the repository's test-first workflow for production behavior: focused failing test, smallest implementation, green tests, refactor. The disposable visual prototype is a design artifact, not a production implementation or a substitute for these tests.
- Preserve separation between ingestion, domain logic, rendering, analysis, persistence, and UI. A unified layer UI does not require forcing all encoding-specific engine implementations into one class.
- Explicitly handle saved workspace/share-state compatibility when state changes. Migrate where practical or explain unsupported versions with recovery; do not silently discard user data. No backward-compatible UI is required.
- Verify the approved workflows in the real browser, including multiple layers and supported streaming behavior. Run relevant automated checks and obtain the contributor-guide code review before committing; resolve Critical and Important findings.
- Report completed changes, validation, and remaining limitations. Do not deploy merely because implementation is complete.

## Design model

Every control should have a clear subject:

| Subject   | Meaning                                                   | Main home                           |
| --------- | --------------------------------------------------------- | ----------------------------------- |
| Workspace | Opened datasets, saving, sharing, application preferences | Header                              |
| Scene     | Camera, basemap/context, rendering, sun and shade         | Map controls and scene settings     |
| Layer     | Dataset configuration, styling, filtering, records        | Left panel and linked bottom drawer |
| Selection | Specific features or surfaces being examined              | Right panel                         |

Use **one active layer and one shared feature selection**. Label panel targets by layer name. Distinguish active layer, visible layers, selected features, and filtered results; they are different states.

The current app demonstrates why this matters: switching layers can change the table while retaining another layer's selected building in the inspector; selection opens duplicate attributes over the map; Rules can target a layer independently of the other panels.

## Proposed layout and behavior

### Workspace header and map tools

- Keep workspace identity/menu, Save, Share, and Preferences in the header. Put application light/dark mode under **Interface appearance** in Preferences.
- Place a labeled **Select: Feature / Surface** control on the map. Offer surface picking only for compatible data. Remove unavailable box-select and measure buttons from the primary UI.
- Group camera actions on the map: zoom, north, fit, and **Top-down / Angled / Free 3D**. A layer click must not move the camera; provide explicit Zoom to layer and Zoom to selection actions.
- Use text with icons for conceptual actions such as Style, Filter, and Sun & shade. Familiar actions such as zoom and visibility can use icons with accessible labels/tooltips.

### Left: unified layers and active-layer configuration

- Use one list for city models, vectors, rasters, and tilesets, with one **Add layer** entry point. Rows share visibility, type icon, name, concise state, and an overflow menu. Do not imply that list order controls rendering unless it actually does.
- Keep the layer list accessible while configuring a layer and while the data drawer is open. Place the active layer's configuration below it, clearly titled with the layer name.
- Use **Style** and **Details** sections. Move detailed LoD, source appearance, metadata, and streaming controls out of dense layer rows. Only expose capabilities supported by the selected layer.
- Organize import primarily around **File / URL / Catalog**, with format detection and a correction mechanism when needed. Allow a geospatial-only workspace to enter the viewer.

### Layer styling

- Move Rules out of the selection inspector into the active layer's **Style** section. Present a readable **Color by / Classification** workflow, with rule authoring as the advanced method.
- Show the affected unit, for example **Delft · Color roof surfaces by rules**. Retain useful presets such as **Flat roofs — slope below 10°**. Explain unmatched appearance and overlapping-rule precedence.
- Remove the independent Rules target selector. Layer configuration and the data drawer follow the same active layer. Preserve drafts per layer so changing context does not apply edits to a different dataset.
- Keep a map legend grouped by layer; its heading can open the corresponding Style controls. The legend must describe the colors actually rendered.

### Right: selection details only

- Remove the floating attributes overlay. Use a single right panel for feature details, opening on selection and collapsing when selection is empty.
- Show a clear identity trail: **Delft → Building …25028 → Roof surface 12**. Lead with useful summary/roof metrics; keep attributes and geometry details in named sections. Label multiple-selection counts and aggregate meanings.
- Selecting another layer clears the previous layer's feature selection. Picking a feature activates its owning layer and updates map highlight, inspector, and open table together.
- Map and table always share selection; remove **Sync selection**. Selecting a row does not automatically fly the camera. Surface selection identifies the surface in the inspector and highlights its corresponding feature row.
- Multi-selection stays within one layer. Hiding/removing that layer clears its selection; removing the active layer chooses a remaining layer deterministically or shows an empty workspace. Applying a filter clears selections excluded by its result.

### Bottom: linked layer data

- Provide **Open table** in layer controls instead of relying on a status-bar entrance. Title the drawer with the active layer and offer **Records / Summary**. Put layer-level statistics here; selection-specific metrics remain in the inspector.
- Preserve layer navigation when the drawer opens. Keep the map usable; on constrained screens offer an explicit expanded-table view rather than shrinking all panels into unusable strips. Opening the drawer must not bury the active-layer list.
- A layer filter affects map and records together by default. Remove the ordinary **Filter map** checkbox. Keep an active-filter indicator in the layer row and map when the drawer is closed, with an accessible Clear filter action.
- Distinguish filtering (result membership), selection (features being examined), and styling (appearance). **Show selected records** is a table view, not another map filter. Sorting and pagination do not change map membership.
- Display counts with units and scope: total, matching, selected. Export explicitly offers all, matching, or selected records, using that same meaning.
- For streaming layers, say **currently loaded features**. Until map filtering is implemented for them, explicitly label a filter **Table only** before application; never imply complete-dataset analysis. Layers without tabular capability show an explanatory state, never another layer's stale table.

### Feature identity and useful records

- For hierarchical building data, propose a building-oriented default view, with parts accessible by expansion/inspection and **Raw objects** available for technical work. For other datasets, use their meaningful feature unit.
- Map/table linkage must map a building to its rendered parts. Merely hiding BuildingPart rows is insufficient. Counts and aggregates must not double-count a building and its parts as independent buildings.
- Start with useful available fields and put structural columns such as bounding boxes and parent arrays in a column chooser. Preserve raw field names/access; do not guess the meaning or units of unknown attributes.
- Prototype this behavior with mock data. Production identity mapping and aggregation are a distinct implementation slice, not a cosmetic table adjustment.

### Scene settings and sun exploration

- Group basemap, Google 3D context, and rendering preferences under **Scene settings**, separate from dataset styling. Keep scene background appearance distinct from interface light/dark appearance.
- Give **Sun & shade** a nonmodal control area with date, time, explicit timezone, playback, and seasonal presets. Map navigation and feature inspection remain usable while it is open.
- Move weather effects into optional scene appearance controls; do not present them as analytical weather data.
- Remove Cyber from the primary workflow or move expressive looks into an optional presentation area. Make any preset overrides explicit, especially those affecting basemap or classification colors. Confirm the proposed simplifications during prototype review.

## Required prototype scenarios and production acceptance

Use mock Delft buildings plus a vector planning-area layer, and demonstrate:

1. **Initial viewer:** visible layer list, useful map area, no large empty selection inspector.
2. **Feature and surface selection:** one detail panel, explicit identity, matching table highlight, clear selection action.
3. **Layer switching:** layer controls, table, and selection state stay consistent across city and vector data.
4. **Classification:** apply Flat roofs, see a meaningful legend, inspect a roof without losing the styling context.
5. **Filtering:** see matching records and map features, close the drawer, still recognize and clear the active filter. Demonstrate the explicitly labeled streaming exception.
6. **Data exploration:** browse parts/raw objects, switch Records/Summary, inspect a selection outside the current page through Show selected records, and choose an explicit export scope.
7. **Sun exploration:** adjust time while keeping the map and selected roof usable.
8. **Space constraints:** open/resize/collapse panels on desktop and laptop; layer navigation remains reachable. Show expanded-table behavior.
9. **Capability/empty states:** vector styling, a layer without a table, loading/error feedback, and no matching records. Never substitute stale content from another layer.

Record any changes to these defaults in the approved design notes before implementation. The goal is a coherent workflow, not preserving the current number of controls or panels.
