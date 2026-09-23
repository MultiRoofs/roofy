# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: municipal planners at MultiRoofs pilot cities.** They evaluate rooftop
capacity and trade-offs for a district or a whole city. They are not 3D or GIS
specialists: they need results they can explain to colleagues and decision-makers,
and a view they can hand on as a link. Design decisions optimise for this user
first (confirmed 2026-09-05).

Secondary audiences, from the design doc, in no priority order:

- Researchers and students at TU Delft and partner institutions exploring
  rooftop scenarios; comfortable with CityJSON, CRS and attribute semantics.
- Public authorities taking part in MultiRoofs pilot activities.
- Technical partners who need a reusable viewer for demonstrations and analysis
  sessions.

## Product Purpose

Roofy is a browser-based 3D city model viewer and rooftop analysis workspace.
It exists so that a city can load its own 3D city model, inspect roof geometry,
colour roofs by planning rules, explore sun and shade for a date and time, run
summary statistics, and share a reproducible view, all in one place and without
a backend.

It is developed within the **MultiRoofs** project (INTERREG North-West Europe,
December 2024 to June 2029) at TU Delft. MultiRoofs aims to turn underused urban
rooftops into productive space for energy, biodiversity, water management,
housing and community life. Roofy is a general-purpose city model viewer first;
the rooftop lens is the product focus layered on top.

Success: a planner reaches an explainable answer about rooftop capacity from
their own city model in the browser, and can share that answer as a URL that
reconstructs the view.

## Positioning

**The rooftop-function lens.** Roofy frames every roof through the four rooftop
functions MultiRoofs cares about: nature, energy, social, water. Rule-based
colouring, the roof metrics pipeline (area, slope, orientation), solar and shading
exploration and the brand's four-colour legend all serve this reading of a city.
A neighbouring viewer can show the same geometry; it does not ask what each roof
could be for. (Confirmed as the one claim to lead with, 2026-09-05.)

Supporting facts a competitor could also claim, so they support rather than lead:

- Metre-accurate georeferencing on a real globe: every vertex projected from its
  source CRS through proj4 onto WGS84 ENU frames with EGM2008 geoid-corrected
  heights, so models wrap Google Photorealistic 3D Tiles.
- The whole workflow runs in the browser with no login and no server.
- Every CityJSON-family encoding is supported, plus the Open3D City STAC catalog.

## Operating Context

- **Desktop first, presentation-friendly.** The main scene is a planner at a
  workstation with a large monitor and a mouse; dense panels are acceptable
  there. The same session is often shown on a meeting-room screen or projector,
  so a path that hides panels and leaves the model and a large legend visible
  must stay available. Confirmed 2026-09-05.
- **Data arrives from many places:** local files, URLs, cloud buckets, or the
  built-in Open3D City STAC catalog browser. Streaming FlatCityBuf layers load
  progressively over the network as the camera moves, so loading and settling
  states are a normal part of the job, not an edge case.
- **The 3D viewport is the workspace.** Sidebar, toolbar, inspector, layers,
  table and status bar are arranged around a single live globe view.
- **No accounts.** Workspaces persist in the browser's localStorage; sharing is
  a URL whose hash encodes the view. Nothing is stored server-side.
- **Analytics in-browser.** DuckDB-wasm runs statistics over the loaded model.
- **Terminology.** `citymodel` is the domain term for the conceptual 3D city
  model; files are encodings of it (design doc §3.1). Rules colour roofs;
  layers group loaded sources; a workspace is the saved session.
- **Deployed** at https://roofy.open3d.city as a Cloudflare Worker; previews
  are built for every pull request.

## Capabilities and Constraints

Confirmed capabilities:

- Loads CityJSON 1.x and 2.x, CityJSONSeq, streaming FlatCityBuf, CityParquet,
  and zipped CityGML archives. CityGML support covers 2.0 and 3.0 buildings
  (roadmap M7.1); the later CityGML sub-milestones are not delivered.
- Georeferences through proj4 with worldwide EPSG resolution, ENU frames and
  the EGM2008 geoid.
- Object-level and surface-level selection with an attribute and geometry
  inspector.
- Per-layer, rule-based colouring from attributes or derived roof metrics
  (area, azimuth, inclination), with a legend. Built-in presets today: Flat
  roofs, South-facing, Steep roofs, Large roofs, Solar suitable. There is no
  preset or classification that maps a roof to one of the four rooftop
  functions yet; future surfaces must not imply one exists.
- Sun and shade simulation for any date and time, with a time-of-day animation.
- GIS overlay layers (styling, selection, attributes).
- DuckDB-wasm statistics over the model or a selection.
- Save and restore workspaces locally; share as a URL.
- Two themes, dark and light; the initial theme follows the OS preference and
  a toggle persists the choice.

Constraints future work must preserve:

- The geoid attribution overlay is a licence obligation. It is always visible
  and never gated or dropped.
- Exactly one 3D viewport per page.
- The Measure and Box Select tools are present in the toolbar but disabled, not
  implemented.
- English only; there is no internationalisation layer.
- Browser-first; a Tauri desktop shell is a future adapter, not a separate
  native design language.
- Engine specifics (lighting calibration, globe setters, effect wrapping,
  streaming commit rules) live in `docs/architecture-notes.md` and are hard
  rules for any UI that touches the scene.
- Experimental project: breaking changes are fine, no migration shims.

## Brand Commitments

Brand kit **v1.0 is binding** (confirmed 2026-09-05). The current `redesign`
branch replaces the app's layout and components around the kit; it does not
revisit the kit.

- Name **Roofy**; tagline **"Your city, roof by roof."**
- Mark: "Sun band", two roof planes over a slab on a 48 × 48 grid at 45° pitch.
  The four fills are the four rooftop functions in legend order: nature (lime),
  energy (amber), social (orange), water (blue). Small mark below 20 px,
  minimum 16 px, clear space of one slab height, never recoloured, rotated or
  given effects. Assets and rules in `public/brand/README.md`.
- Type: Outfit for display, IBM Plex Sans for UI, IBM Plex Mono for data.
- Tokens live in `src/app/brand.css`, mirrored in `public/brand/brand.css` and
  `public/brand/brand.tokens.json`; the three change together and `app.css`
  only derives from them.
- The kit is maintained outside the repository; the repo carries the shipped
  SVGs and tokens.
- Voice is not a confirmed commitment. As observed in the incumbent README and
  UI copy it is plain, short and descriptive, without marketing language.

## Evidence on Hand

Only what is in the repository may be used (confirmed 2026-09-05):

- Fixtures: `fixtures/two-buildings.city.json`, `fixtures/two-buildings.city.jsonl`,
  `fixtures/citygml-appearance.gml`, and `fixtures/delft.fcb`: 1115 real Delft
  buildings in EPSG:7415, vendored from the `@cityjson/flatcitybuf` repository's
  own conformance fixture. Its licence is not stated in the repo; confirm before
  showing it in public material. The same dataset is also served remotely as
  CityJSONSeq at https://storage.googleapis.com/cityjson/delft.city.jsonl.
- The README demo video:
  https://github.com/user-attachments/assets/85f3938b-f45b-43fb-9203-d9936b55898f
- The live deployment at https://roofy.open3d.city and the public Open3D City
  catalog at https://open3d.city.
- Brand assets under `public/brand/`.

Absent, and not to be fabricated: pilot-city names, user quotes or testimonials,
usage or performance numbers, partner logos, pricing or licensing claims beyond
the MIT licence.

## Product Principles

1. **Explain, don't just render.** A planner must be able to say why a roof is
   coloured the way it is; every rule, metric and legend entry is legible to a
   non-specialist.
2. **The model is the subject.** Interface recedes around the live globe; panels
   serve the view and can get out of its way for a shared screen.
3. **Real place, real geometry.** Never trade georeferencing accuracy or the
   terrain context for a prettier picture.
4. **Whole workflow, no backend.** Load, style, simulate, query and share stay
   inside the browser session; nothing requires an account.
5. **Roofs as opportunity.** The four rooftop functions are the product's
   reading of a city; features and copy speak in that frame without claiming
   classifications that do not exist yet.

## Accessibility & Inclusion

WCAG 2.1 AA is the floor for panels, controls, contrast, focus and keyboard
operation (confirmed 2026-09-05; public authorities in the EU fall under
EN 301 549). The 3D canvas itself is exempt as a live viewport, but everything
that reads from it (legend, inspector, status) must be reachable without it.
Respect `prefers-reduced-motion` for UI animation. The time-of-day animation
starts only from its play control and is off by default, so it is exempt.
