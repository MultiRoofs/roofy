# Scene themes — Photoreal / Cartoon / Cyber / Wireframe

**Date:** 2026-08-05
**Status:** approved for implementation (commander/executor; nothing committed until the user
reviews). Preset constants marked _tune_ get their final values from the commander's browser
pass, not from these numbers.

## What

A scene-wide theme picker with four looks:

- **Photoreal** (default) — exactly today's rendering; the theme system is a no-op.
- **Cartoon** — flat colours with dark ink edges: pastel basemap, flat sky, city meshes keep
  their vertex colours but gain near-black edge lines.
- **Cyber** — dark neon: night-dark environment, stars up, city meshes as dark fills with
  glowing HDR neon edges (Tron), cyan Fresnel halo on the globe.
- **Wireframe** — architectural hidden-line: near-black fills that still occlude, bright edge
  lines, wireframe globe, everything else off.

Themes are **presentation overlays**. They never write the user's stores (basemap choice,
Google-tiles toggle, exposure, solar time) — switching back to Photoreal restores everything,
because nothing was mutated in the first place.

## Engine facts this design rests on (audited, installed 0.0.5)

- `selectiveBloom`/`selectiveOutline` read the MRT g-buffer; our city meshes render in
  `scenes.opaque` and never write it, so **no engine post-effect can target the city meshes**.
  Also the outline is a per-slot silhouette (≤11 slots, unions blobs) and no toon/edge shader
  exists. City-mesh looks therefore come from OUR materials, which we fully own.
- `material.color` on `MeshBasicMaterial` multiplies vertex colours **unclamped** in three
  r183 (`diffuseColor *= vColor`; `uniforms.diffuse` is a raw copy). `color.setRGB(r,g,b)`
  with components > 1 is a genuine HDR value under the exposure-10 AgX pipeline. Never
  `setHex`/`set("#…")` for tints — those sRGB-convert and clamp.
- `material.wireframe` is a draw-state flag (no recompile) but draws every triangle edge of
  our non-indexed soup — roof diagonals included. Real lines need a real edge geometry.
- Effects: create once, toggle `handle.visible` (the composer's enable flag); never
  add/delete per switch (CLAUDE.md bug (f): `onDestroy` removes without disposing).
  `toneMapping.mode` and LUT/skyBox/stars fields are live-updatable via `handle.update`.
- Live env levers: `view.globe.{wireframe,color,opacity}` (live setters, unused until now),
  `view.toneMappingExposure`, `aerialPerspective.update({aerialPerspective:{albedoScale,…}})`,
  `sky`/`stars` mesh updates, `skyBox` mesh (`dayColor/nightColor/sunColor`, flat-colour sky,
  not added by the photoreal default), `glowGlobe` mesh (Fresnel halo), raster basemap
  tintable via `layer.update({type:"raster",source,raster:{color,opacity}})`.
- **Solar hygiene:** `atmosphere.date` is solar TIME; writing it round-trips through
  `sunChanged` into `solarStore.sunPosition` and corrupts the analysis. A theme darkens via
  exposure/albedoScale/probe-intensity/sky-visibility only. `atmosphere.date` is untouchable.
- `Options.backgroundColor` is constructor-only (default black). Black suits Cyber/Wireframe;
  no runtime clear-colour change in v1.

## The one new rendering capability: city edge segments (navara-core)

`buildCityEdgeSegments(positions: Float32Array, angleThresholdDeg: number): Float32Array` —
from the projected, non-indexed triangle soup, emit line-segment endpoints for every edge that
is (a) a boundary edge (used by exactly one triangle) or (b) a crease edge where adjacent face
normals disagree by more than the threshold (default **25°**). Face normals are computed from
the triangle positions themselves (post-ENU, so edges live in render space). Edge identity is
a sorted pair of quantized endpoints (1e-4 m grid). Engine-free, O(triangles), unit-tested on
synthetic cubes (12 silhouette edges, no diagonals) and the two-buildings fixture.

This single builder powers Cartoon's ink AND Wireframe's architectural lines — and makes
"wireframe" mean building edges, not triangulation.

## Submodule API — one theme style on both mesh classes

`ThemeStyle` (engine-free type in navara-cityjson, re-exported by navara-flatcitybuf):

```ts
interface ThemeStyle {
  readonly fill: "vertex" | "tint"; // vertex = today's colours
  readonly tintRGB?: readonly [number, number, number]; // linear, unclamped, only for "tint"
  readonly edges: {
    readonly color: number;
    readonly hdr?: readonly [number, number, number];
  } | null;
}
const DEFAULT_THEME_STYLE: ThemeStyle = { fill: "vertex", edges: null };
```

- Both mesh classes (`CityModelMesh`, `CityMeshArraysMesh`) get `setThemeStyle(style)`:
  - fill "tint" → `material.color.setRGB(...tintRGB)`; "vertex" → `setRGB(1,1,1)`.
  - edges non-null → lazily build the edge `LineSegments` (a **child of the existing Mesh**,
    so it inherits `matrixWorld` and `addToScene`; picking is unaffected because the raycast
    is `intersectObject(mesh, false)`), with `LineBasicMaterial` — colour from `hdr` via
    `setRGB` when present, else `color`. Cache the edge geometry; invalidate in
    `rebuildGeometry()` (LoD/hiddenTypes/heightOffset) and rebuild lazily on next themed
    paint. edges null → remove + dispose the child.
  - Shared implementation module (e.g. `themeStyle.ts` in navara-cityjson) used by both
    classes — the material construction comment in `cityMesh.ts` already cross-references its
    twin; this factors the duplication instead of tripling it.
- `CityModelHandle.setThemeStyle(style)` (registry closure → mesh), and
  `FcbStreamLayerHandle.setThemeStyle(style)` which stores the style, applies it to every
  resident cell mesh, and applies it to each newly installed cell (same place `paintCell`
  hooks new cells). No worker/protocol change — edges are built main-thread from the arrays
  the cell mesh already holds.
- `AddCityModelOptions`/`OpenStreamOptions` do NOT grow a theme field: the app pushes the
  style right after add/open, and a one-frame default is invisible during load.

## App composition

- `src/features/sceneTheme/sceneThemeStore.ts`: `SceneTheme = "photoreal" | "cartoon" |
"cyber" | "wireframe"`, default `"photoreal"`; persisted as optional snapshot-v3 field
  (`normalize` defaults, same convention as `viewMode`).
- `src/scene/sceneThemePolicy.ts` (engine-free table, unit-tested), per theme:
  - `meshStyle: ThemeStyle` — photoreal: default; cartoon: vertex fill + edges 0x1a1a1a;
    cyber: tint fill `[0.06, 0.07, 0.12]` _tune_ + edges hdr `[0.4, 2.2, 2.6]` _tune_ (cyan);
    wireframe: tint fill `[0.02, 0.02, 0.03]` _tune_ (occluding hidden-line fills) + edges
    hdr `[0.9, 2.0, 1.2]` _tune_.
  - `basemapOverride: BasemapId | "none" | null` (null = user's choice) — cartoon:
    CartoDB Positron; cyber/wireframe: "none".
  - `googleTilesOff: boolean` — true for cartoon/cyber/wireframe.
  - `environment`: photoreal = all null (no pushes). Others set: `skyVisible`,
    `starsBoost: {pointSize, intensity} | null`, `skyBoxColors | null` (cartoon's flat sky),
    `glowGlobe: {glowColor, opacity} | null` (cyber), `globeWireframe`, `globeColor | null`,
    `toneMappingMode` ("AGX" | "LINEAR"), `exposure | null`, `apAlbedoScale | null`,
    `skyLightProbeIntensity | null`, `lensFlareOff`. All _tune_. (`cloudsOff` was
    removed 2026-08-06: themes no longer suppress the user's clouds.)
- `NavaraViewport` applies the policy in one effect + the existing seams:
  - basemap/tiles: **derived selectors** (`themeOverride ?? userChoice`), exactly the
    wave-1 pattern — stores untouched, panels keep showing the user's choice (with an
    "overridden by theme" hint text in the two panels), attribution follows automatically.
  - exposure: effective = `policy.exposure ?? renderDebugStore.exposure` at the one
    `toneMappingExposure` write site.
  - effects/meshes: `skyBox` and `glowGlobe` are created once on first non-photoreal use and
    then toggled/updated; sky/stars/clouds/lensFlare/AP via the existing handles
    (`visible` + `update`), restoring the photoreal state (incl. the user's clouds/lens-flare
    settings from atmosphereStore) when leaving a theme.
  - mesh styles: pushed through `handleSync` (`LiveLayer.themeStyle` memo + push, and
    `StreamSyncMemo` likewise) so newly added layers and late-opened streams get the active
    theme — identity comparison on the policy's style object (one frozen object per theme).
- **UI**: `src/ui/toolbar/SceneThemeMenu.tsx` — a header popover (SolarMenu pattern): four
  entries with a one-line description each, radio semantics, active theme shown on the
  toolbar button. Sits next to the view-mode segments.
- DuckDB, rules, picking, solar analysis: untouched by design. Rules still bake vertex
  colours; cyber/wireframe tint just multiplies them darker (rule differences remain faintly
  visible in fills and fully visible on hover/selection highlights, which paint vertex
  colours and are multiplied the same way — acceptable, verified in the browser pass).

## Commander's browser-tuning pass

After both waves land, I load the Delft sample and tune every _tune_ constant by screenshot
(edge threshold included), then update `sceneThemePolicy.ts` + its tests with the final
numbers. The audit flagged that exposure/AP interactions are only predictable empirically;
the spec deliberately ships levers, not final values.

## Testing

- navara-core: `buildCityEdgeSegments` — cube → 12 unique silhouette edges, no diagonals;
  coplanar quad-split → shared diagonal dropped; boundary edge kept; threshold behaviour;
  quantization tolerance.
- navara-cityjson: `setThemeStyle` — tint applied unclamped (material.color.r > 1 allowed),
  reverting to default restores white; edge child added/removed/disposed; edge cache
  invalidated by `rebuildGeometry` (LoD change while themed rebuilds edges); picking
  unaffected (raycast non-recursive).
- navara-flatcitybuf: style applied to resident cells and to a cell installed AFTER
  `setThemeStyle`.
- App: policy table (photoreal = all-null no-op); store + persistence round-trip;
  derived basemap/tiles selectors (user choice preserved, restored on photoreal);
  handleSync push-on-change for both paths; SceneThemeMenu component.
- Browser (commander): all four themes on the Delft sample + a streaming layer, screenshots;
  solar readout unchanged across theme switches; back-to-photoreal is pixel-plausible vs a
  fresh load.

## Out of scope (recorded, not attempted)

Selective bloom on city meshes (needs a `getPassKey():"mrt"` move + an emissive-capable
material — and the audit found the engine's `basic`-material MRT injection references an
undeclared `emissive`, likely a compile error upstream); Google-tiles neon via
`model.effectIds` (works natively, but tiles are off in cyber anyway); `fogLight` volumetric
neon; per-theme LUT grading (`colorGradingLUT` wants a shipped LUT asset); runtime clear
colour; SSAO ink (reads globe normals at city pixels — wrong on our meshes).

## Follow-up (2026-08-06): a real cel-shaded Cartoon via a custom effect

The user pointed at `eukarya-biz/toon-navara` as a reference. It is the missing
technique this design said did not exist: a CUSTOM Navara effect
(`view.registerEffect("toon", ToonEffectDesc)`) implementing cel-shading bands,
rim light and DEPTH-based ink outlines as a post effect — depth is shared by
our `scenes.opaque` city meshes, so its outlines would apply to them even
though the selective effects cannot. It also ships a `CloudMeshDesc` for
cartoon cumulus.

Constraints for whoever ports it: the repo has NO LICENSE FILE — reimplement
the techniques, never copy the code; it runs an ambient-only lighting
calibration (its own comment: "the ambient-only scene leaves albedo in the
frame"), so the effect must be validated under our cartoon theme's
LINEAR/low-exposure environment; and its cel bands read g-buffer
normals/metalness, which our city meshes do not write (§ engine facts) — the
depth-outline half is the safely portable part.
