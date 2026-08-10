# GIS Layer Support & Per-Layer Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Geospatial-first Add Layer entry, per-layer style editing that names its target (city rules) and exists at all (geo layers), plus click-selection and attribute display for GeoJSON features.

**Architecture:** All changes are app-side (no submodule edits). Geo styling becomes a `style` object on each `GeoLayer` record flowing through the existing descriptor/sync discipline (full-description rebuild on identity change). Geo picking rides the engine's native GPU `pick` event — city meshes are absent from that pass (own-raycast), so the two paths are complementary; a pure gesture-resolution function in `pickEventHandlers` coordinates them. Selection state gains a parallel `geoSelection` field (mutually exclusive with city `selections`), never widening the `Selection` union.

**Tech Stack:** React 19 + TS + Vite, Zustand, Vitest + @testing-library/react, `@navaramap/three@0.0.5` (engine seams stay structural — engine-free modules must not import `@navaramap/*`).

**Spec:** `docs/superpowers/specs/2026-08-10-gis-layers-and-per-layer-styles-design.md`. Phase E of the spec (attribute-driven rules for GeoJSON layers) is deliberately NOT in this plan — it gets its own follow-up plan once this one lands.

## Global Constraints

- Run app tests: `npx vitest run tests/unit/<path>` (from repo root, npm-managed). Full suite: `npx vitest run`.
- Type gate: `npx tsc -b --noEmit` (per CLAUDE.md). If it reports TS6310 about a referenced project, the composite build state is stale — run `npx tsc -b` once (artifacts are gitignored) and re-run the gate.
- Import tests from `"vitest"`, never `"vite-plus/test"`. The existing suites use `fireEvent` from @testing-library — follow that convention, do not introduce `userEvent`.
- Engine-free modules (`src/scene/geoLayerDescriptions.ts`, `src/scene/geoLayerSync.ts`, `src/scene/pickEventHandlers.ts`, everything in `src/features/`) must not import `@navaramap/*`. Engine values reach them through structural seams.
- Every store/sync edit REPLACES objects/arrays, never mutates — both sync paths compare by identity.
- Commits: small, one task each, prefix `feat:`/`fix:`/`docs:`/`refactor:`/`test:`, include `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. The pre-commit hook runs `vp check --fix` (lint+format) — if it rewrites files, `git add` them and commit again.
- No app-side `npm install` is needed for any task. Do not touch `packages/cityjson-navara-plugins`.
- The engine contract reference is `node_modules/@navaramap/three/dist/index.d.ts` — cited line ranges below are for reading, verify before relying on a signature.

---

### Task 1: Add Layer dialog — `initialTab` prop, geospatial default, per-section add buttons

**Files:**

- Modify: `src/ui/layers/AddLayerDialog.tsx` (prop + default at line ~65; export `SourceTab`)
- Modify: `src/ui/layers/LayerPanel.tsx` (dialog open state at line ~66, main button ~270–277 — note its `aria-expanded={addDialogOpen}` must track the new state, mount at ~279–287, section headers: `3D City Models ({n})` at ~83 and `Geospatial Layers ({n})` at ~252)
- Test: `tests/unit/ui/layers/AddLayerDialogGeospatial.test.tsx` (the pinned default at ~line 63), `tests/unit/ui/layers/LayerPanelSections.test.tsx`, **and `tests/unit/ui/layers/AddLayerDialog.test.tsx`** — six of its tests open the dialog via the main button and then drive the CITY tab body (`getByLabelText("Or load from URL:")` at ~132/252, `getByTestId("source-picker-drop-zone")` at ~162/181/194, plus a "city is the default" comment at ~218); once the main button opens on geo they all break.

**Interfaces:**

- Produces: `AddLayerDialogProps` gains `readonly initialTab?: SourceTab` (default `"geo"`); `export type SourceTab = "city" | "geo" | "stac"` becomes exported. `LayerPanel` opens the dialog with `initialTab: "city"` from the city section header button, `"geo"` from the Geospatial section header button and from the main "+ Add Layer" button (omitted → default).

- [ ] **Step 1: Write the failing tests.** IMPORTANT: neither AddLayerDialog test file renders the dialog directly — both render `<LayerPanel>` through a `renderPanel`-style harness and click the main button (`openDialog()` helper). Work with that. In `AddLayerDialogGeospatial.test.tsx`: REPLACE the ~line-63 test (`"opens on the city-model tab, whose loader is untouched"`) with one asserting the geo tab is selected after `openDialog()` (`getByRole("tab", { name: /geospatial/i })` has `aria-selected="true"` and `geo-drop-zone` is in the document). ADD a direct-render test for the prop (new minimal harness, stub props `onClose`/`onAddFile`/`onAddFiles`/`onAddUrl: async () => ({ok: true as const})`/`loading: false`):

```tsx
it("opens on the tab named by initialTab", () => {
  render(
    <AddLayerDialog
      initialTab="city"
      onClose={() => {}}
      onAddFile={() => {}}
      onAddFiles={() => {}}
      onAddUrl={async () => ({ ok: true as const })}
      loading={false}
    />,
  );
  expect(screen.getByRole("tab", { name: /city model/i })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
```

In `LayerPanelSections.test.tsx` (existing store-seeding + `fireEvent`):

```tsx
it("each section header opens the add dialog on its own tab", () => {
  renderPanel(); // the file's existing harness
  fireEvent.click(
    screen.getByRole("button", { name: /add city model layer/i }),
  );
  expect(screen.getByRole("tab", { name: /city model/i })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(
    screen.getByRole("button", { name: /add geospatial layer/i }),
  );
  expect(screen.getByRole("tab", { name: /geospatial/i })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/unit/ui/layers/` — expect the new tests FAIL (dialog opens on city; section buttons don't exist). The six city-tab-driving tests in `AddLayerDialog.test.tsx` still pass at this point (nothing changed yet).
- [ ] **Step 3: Implement.** In `AddLayerDialog.tsx`: export the `SourceTab` type; add `readonly initialTab?: SourceTab` to props; `const [tab, setTab] = useState<SourceTab>(initialTab ?? "geo")`. Rewrite the `SourceTab` doc comment: the geospatial tab is now the default per the 2026-08-10 spec (user request), and each LayerPanel section opens the dialog on its own tab. In `LayerPanel.tsx`: replace `const [addDialogOpen, setAddDialogOpen] = useState(false)` with `const [addDialogTab, setAddDialogTab] = useState<SourceTab | null>(null)` (`null` = closed; `aria-expanded={addDialogTab !== null}`); main button sets `"geo"`; add a small icon button (`aria-label="Add city model layer"`, text `+`) in the `3D City Models` section header and one (`aria-label="Add geospatial layer"`) in the Geospatial Layers header; mount `<AddLayerDialog initialTab={addDialogTab} …/>` when non-null; `onClose` sets `null`. Match the existing section-header markup/classNames.
- [ ] **Step 3b: Repair the six broken tests in `AddLayerDialog.test.tsx`.** After `openDialog()`, click the City model tab (`fireEvent.click(screen.getByRole("tab", { name: /city model/i }))`) before driving the URL field / source-picker drop zone; fix the ~218 comment. Do NOT weaken what they assert about the city loaders.
- [ ] **Step 4: Run to verify pass:** `npx vitest run tests/unit/ui/layers/`, then the type gate.
- [ ] **Step 5: Commit.** `feat: open the Add Layer dialog on the geospatial tab, per-section add buttons`

---

### Task 2: Rules tab names and lets you pick its target layer

**Files:**

- Modify: `src/ui/inspector/InspectorPanel.tsx` (~130–141 `displayLayer` resolution, ~296–304 Rules tab render)
- Modify: `src/ui/inspector/RuleBuilderTab.tsx` (props at ~25–28, header at ~112–121)
- Test: `tests/unit/ui/inspector/RuleBuilderTab.test.tsx`

**Interfaces:**

- Produces: `RuleBuilderTab` props become `{ model: CityModel; layerId: string; layerOptions: ReadonlyArray<{ id: string; name: string }>; onSelectLayer: (id: string) => void }`. The header renders a `<select aria-label="Rules target layer">` whose value is `layerId`.
- InspectorPanel holds `const [ruleTargetOverride, setRuleTargetOverride] = useState<string | null>(null)`; an effect resets the override to `null` whenever `displayLayer?.id` changes; the effective rules target is `layers.find(l => l.id === ruleTargetOverride) ?? displayLayer`.

- [ ] **Step 1: Write the failing tests** in `RuleBuilderTab.test.tsx`. The file's ACTUAL shape: a `baseLayer(overrides)` factory producing one layer (id `"L"`), `useLayerStore.setState` seeding, and inline `render(<RuleBuilderTab model={...} layerId="L" ... />)`. Because the tab is controlled by its parent, the second test needs a tiny harness component in the test file that owns the override state exactly as InspectorPanel will:

```tsx
function TargetHarness({
  layers,
}: {
  layers: ReadonlyArray<{ id: string; name: string; model: CityModel }>;
}) {
  const [override, setOverride] = useState<string | null>(null);
  const target = layers.find((l) => l.id === override) ?? layers[0]!;
  return (
    <RuleBuilderTab
      model={target.model}
      layerId={target.id}
      layerOptions={layers.map((l) => ({ id: l.id, name: l.name }))}
      onSelectLayer={setOverride}
    />
  );
}

it("names its target layer and lists the alternatives", () => {
  seedTwoLayers(); // seed useLayerStore with layers "L" (Delft) and "R" (Rotterdam) via baseLayer
  render(<TargetHarness layers={twoLayerOptions} />);
  const select = screen.getByRole("combobox", { name: /rules target layer/i });
  expect(select).toHaveValue("L");
  expect(
    within(select).getByRole("option", { name: "Rotterdam" }),
  ).toBeInTheDocument();
});

it("edits land on the layer the dropdown names", () => {
  seedTwoLayers();
  render(<TargetHarness layers={twoLayerOptions} />);
  fireEvent.change(
    screen.getByRole("combobox", { name: /rules target layer/i }),
    { target: { value: "R" } },
  );
  fireEvent.click(screen.getAllByRole("button", { name: /flat roofs/i })[0]!); // first preset
  const state = useLayerStore.getState();
  expect(state.layers.find((l) => l.id === "R")!.rules).toHaveLength(1);
  expect(state.layers.find((l) => l.id === "L")!.rules).toHaveLength(0);
});
```

(Adapt the preset-button query to the actual preset grid markup in `RuleBuilderTab.tsx` ~173–187.)

- [ ] **Step 2: Run to verify failure** (no combobox rendered).
- [ ] **Step 3: Implement.** `RuleBuilderTab`: render the select in its header block (~112–121) above the existing controls, options from `layerOptions`, `onChange={(e) => onSelectLayer(e.target.value)}`. `InspectorPanel`: add the override state + reset effect keyed on `displayLayer?.id`; compute `ruleTargetLayer`; pass `model={ruleTargetLayer.model} layerId={ruleTargetLayer.id} layerOptions={layers.map(l => ({id: l.id, name: l.name}))} onSelectLayer={setRuleTargetOverride}`.
- [ ] **Step 4: Run to verify pass**, plus `tests/unit/ui/inspector/` and `npx tsc -b`.
- [ ] **Step 5: Commit.** `feat: rules tab names its target layer and offers a picker`

---

### Task 3: Legend groups rules by layer

**Files:**

- Modify: `src/ui/viewport/LegendOverlay.tsx` (~16–22 computes `layerName`, ~47–52 drops it)
- Test: `tests/unit/ui/viewport/LegendOverlay.test.tsx` (create if absent; seed `useLayerStore` directly like `LayerPanel.test.tsx` does)

- [ ] **Step 1: Write the failing test:** seed two visible layers, each `rulesEnabled` with one enabled rule (`{id, name, color: "#ff0000", conditions: [], logic: "AND", enabled: true}`), render `<LegendOverlay />`, assert both layer names render as group headings and each rule name appears under its own layer's heading (e.g. `within(screen.getByRole("group", { name: "Delft" })).getByText("Flat roofs")`).
- [ ] **Step 2: Run to verify failure** (layer names absent from the DOM).
- [ ] **Step 3: Implement:** group the existing flat-map by layer (`Map<layerId, {layerName, entries}>`), render one `<div role="group" aria-label={layerName}>` per layer with a small heading; keep the existing entry markup inside. Single-layer case still shows the heading (consistency beats special-casing).
- [ ] **Step 4: Run to verify pass** + the type gate.
- [ ] **Step 5: Commit.** `feat: legend groups rule entries by layer`

---

### Task 4: `GeoLayerStyle` — style module + store field

**Files:**

- Create: `src/features/geoLayers/geoLayerStyle.ts`
- Modify: `src/features/geoLayers/geoLayerStore.ts` (base at ~57–65, input at ~90–97, patch at ~102–106, `addGeoLayer` ~180–198, `updateGeoLayer` ~210–221)
- Test: `tests/unit/features/geoLayers/geoLayerStyle.test.ts` (create), `tests/unit/features/geoLayers/geoLayerStore.test.ts`

**Interfaces (produced — later tasks depend on these exact names):**

```ts
// src/features/geoLayers/geoLayerStyle.ts
export interface GeoLayerStyle {
  readonly color: string; // "#rrggbb" CSS hex
  readonly pointSizePx: number; // geojson points, px
  readonly lineWidthPx: number; // geojson lines, px
  readonly fillOpacity: number; // 0..1, geojson polygons (multiplies layer opacity)
}
export const DEFAULT_GEO_LAYER_STYLE: GeoLayerStyle; // { color: "#ff5a3c", pointSizePx: 24, lineWidthPx: 2, fillOpacity: 1 }
/** Total: any junk in → a valid style out (bad fields fall back per-field to the default). */
export function normalizeGeoLayerStyle(value: unknown): GeoLayerStyle;
/** "#rgb"/"#rrggbb" → 0xRRGGBB, else null. */
export function hexColorToNumber(hex: string): number | null;
```

`GeoLayerBase` gains `readonly style: GeoLayerStyle`; `GeoLayerInput`'s `Omit` list adds `"style"` with `readonly style?: GeoLayerStyle` optional; `GeoLayerPatch` gains `readonly style?: GeoLayerStyle` (whole-object replacement, normalized on write). Move the default-value rationale comments (accent color choice, px-not-meters points) from `geoLayerDescriptions.ts` here — Task 5 deletes the old constants.

- [ ] **Step 1: Write the failing tests.** `geoLayerStyle.test.ts`: defaults match the historical constants (`#ff5a3c`/24/2/1); `hexColorToNumber("#ff5a3c") === 0xff5a3c`, `"#f53"` → `0xff5533`, `"red"`/`""` → null; `normalizeGeoLayerStyle(undefined)` → defaults; `normalizeGeoLayerStyle({color: "nope", pointSizePx: -3, lineWidthPx: Infinity, fillOpacity: 2})` → per-field fallbacks (color default, pointSizePx default, lineWidthPx default, fillOpacity clamped to 1). In `geoLayerStore.test.ts`: `addGeoLayer` without style → `DEFAULT_GEO_LAYER_STYLE`; with a VALID style → kept verbatim; with junk style values → normalized on add (these values reach the engine, and persistence is not the only caller); `updateGeoLayer(id, {style})` replaces the object (new identity, also normalized) and leaves other layers' style identity untouched; a patch without `style` keeps the style object identity.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** per the interface block. Clamp `fillOpacity` to [0,1]; sizes must be finite and > 0 else default. Both `addGeoLayer` and `updateGeoLayer` run incoming style through `normalizeGeoLayerStyle` (a valid style normalizes to itself value-wise).
- [ ] **Step 4: Run to verify pass** + type gate. The gate WILL flag `tests/unit/persistence/geoLayerSnapshot.test.ts` — it builds five `const layer: GeoLayer = {…}` annotated literals (~lines 42/61/76/96/117) that now lack `style`. Add `style: DEFAULT_GEO_LAYER_STYLE` to them in this task (the sync/descriptor fixtures use `as GeoLayer` casts and survive; leave those to their own tasks). Re-run `tests/unit/persistence/geoLayerSnapshot.test.ts` after.
- [ ] **Step 5: Commit.** `feat: per-layer style record for geospatial layers`

---

### Task 5: Descriptors read the record's style

**Files:**

- Modify: `src/scene/geoLayerDescriptions.ts` (delete `GEO_ACCENT_COLOR`/`GEOJSON_POINT_SIZE_PX`/`GEOJSON_LINE_WIDTH_PX` consts, ~29–43; use `layer.style` in `geoLayerDescription`, ~110–171)
- Test: `tests/unit/scene/geoLayerDescriptions.test.ts` (~118–200 pins the old constants)

**Interfaces:**

- Consumes: `GeoLayerStyle`, `DEFAULT_GEO_LAYER_STYLE`, `hexColorToNumber` from Task 4.
- Produces: geojson descriptions now derive `point.color`/`polyline.color`/`polygon.color` from `hexColorToNumber(layer.style.color) ?? hexColorToNumber(DEFAULT_GEO_LAYER_STYLE.color)!`; `point.size = layer.style.pointSizePx`; `polyline.width = layer.style.lineWidthPx`; `polygon.opacity = layer.opacity * layer.style.fillOpacity` with `transparent: layer.opacity * layer.style.fillOpacity < 1`. Point/polyline opacity stays `layer.opacity`. Raster/3d-tiles arms unchanged. `TILES3D_MAX_SSE` stays.

- [ ] **Step 1: Update/extend the tests first:** default-styled layer produces the same numbers as before (0xff5a3c, 24, 2 — now via `DEFAULT_GEO_LAYER_STYLE`); a custom style (`{color: "#00ff00", pointSizePx: 10, lineWidthPx: 5, fillOpacity: 0.5}`, layer opacity 1) lands in `point.color === 0x00ff00`, `point.size === 10`, `polyline.width === 5`, `polygon.opacity === 0.5`, `polygon.transparent === true`; an unparsable stored color falls back to the default accent. Update the test fixtures' layer literals to carry `style` (the store type now requires it).
- [ ] **Step 2: Run to verify failure** (custom style ignored).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** + type gate — fix any remaining fixture literal missing `style` (search `tests/` for `kind: "geojson"` etc.). `normalizeGeoLayers` in `src/persistence/types.ts` returns `GeoLayerInput[]`, where `style` is optional — it compiles unchanged; Task 8 adds the real normalization.
- [ ] **Step 5: Commit.** `feat: geospatial descriptors read the layer's own style`

---

### Task 6: geoLayerSync re-describes on style change

**Files:**

- Modify: `src/scene/geoLayerSync.ts` (`LiveGeoLayer` ~59–68, `addPair` return ~101–108, update condition ~174)
- Test: `tests/unit/scene/geoLayerSync.test.ts`

**Interfaces:**

- Produces: `LiveGeoLayer` gains `style: GeoLayerStyle` (identity-compared, like `config`). Update condition becomes `entry.visible !== layer.visible || entry.opacity !== layer.opacity || entry.style !== layer.style`.

- [ ] **Step 1: Write the failing test** (mirror the existing visible/opacity suite at ~170): add a layer via `syncGeoLayers`, then replace its `style` object (new identity, changed color) in a fresh layers array; expect exactly one `layer.update(...)` carrying the new color; then re-sync with the same array and expect no further engine calls (memo holds).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** + the type gate.
- [ ] **Step 5: Commit.** `feat: style edits reach the live geospatial layer`

---

### Task 7: GeoLayerRow style editor

**Files:**

- Modify: `src/ui/layers/GeoLayerRow.tsx` (opacity slider gate ~128–147; add style controls for `kind === "geojson"`)
- Test: `tests/unit/ui/layers/LayerPanelSections.test.tsx` (geo row affordances live here)

**Interfaces:**

- Consumes: `updateGeoLayer(id, { style })` from Task 4 (whole-object replacement: spread the current style, override the edited field).

- [ ] **Step 1: Write the failing tests:** a geojson row shows a color input (`aria-label="Layer color"`, `type="color"`), a point-size and a line-width number input (`aria-label="Point size"`, `"Line width"`), a fill-opacity slider (`aria-label="Fill opacity"`) AND the general opacity slider (previously raster-only); changing the color input calls through to the store — assert `useGeoLayerStore.getState().layers[0].style.color === "#00ff00"` and the style object identity changed; a raster row shows only the opacity slider (no color input).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Put the vector controls in a collapsible block (a `<details>` with `<summary>Style</summary>` keeps the row compact — matches the row's plain-HTML character). Opacity slider gate becomes `kind === "raster-xyz" || kind === "geojson"`; update its explanatory comment (~128–132) — vector fading is now answered by style. Number inputs commit on change with `Number(...)` + the store's normalization as the safety net.
- [ ] **Step 4: Run to verify pass** + the type gate.
- [ ] **Step 5: Commit.** `feat: style controls on geospatial vector layer rows`

---

### Task 8: Persist geo layer style

**Files:**

- Modify: `src/persistence/types.ts` (`GeoLayerSnapshot` ~143–153, `geoLayerSnapshot()` ~156–167, `normalizeGeoLayers()` ~196–250)
- Test: `tests/unit/persistence/geoLayerSnapshot.test.ts`

**Interfaces:**

- Consumes: `GeoLayerStyle`, `normalizeGeoLayerStyle` from Task 4.
- Produces: `GeoLayerSnapshot` gains `readonly style?: GeoLayerStyle`; `geoLayerSnapshot()` writes it; `normalizeGeoLayers()` runs every restored layer's style through `normalizeGeoLayerStyle` (absent → defaults). Snapshot version stays `"3"`.

- [ ] **Step 1: Write the failing tests:** round-trip keeps a custom style; a v3 snapshot WITHOUT style (old save) restores with `DEFAULT_GEO_LAYER_STYLE`; a snapshot with junk style (`{color: 5}`) restores with per-field defaults, layer intact.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (remove any Task-5 stopgap default in `normalizeGeoLayers`).
- [ ] **Step 4: Run to verify pass**, then the whole `tests/unit/persistence/` + the type gate.
- [ ] **Step 5: Commit.** `feat: geospatial layer style survives save and restore`

---

### Task 9: Selection store learns geo feature selection

**Files:**

- Modify: `src/domain/selection/types.ts`, `src/features/selection/selectionStore.ts`
- Test: `tests/unit/features/selection/selectionStore.test.ts`

**Interfaces (produced):**

```ts
// domain/selection/types.ts
export interface GeoFeatureSelection {
  readonly geoLayerId: string; // geoLayerStore id
  readonly batchId: number; // engine per-feature batch id
  readonly properties: Readonly<Record<string, unknown>>;
}
```

`SelectionState` gains `readonly geoSelection: GeoFeatureSelection | null` (initial `null`). `SelectionActions` gains `selectGeoFeature: (selection: GeoFeatureSelection | null) => void`. Invariants: `selectGeoFeature(x)` sets `geoSelection` and clears `selections`; `select`/`toggleSelect`/`selectMany` clear `geoSelection`; `clear` and `setMode` clear both. The `Selection` union is untouched.

- [ ] **Step 1: Write the failing tests:** select a geo feature → `geoSelection` set, `selections` empty; then `select(citySel)` → `geoSelection === null`; `selectGeoFeature(null)` clears only geo; `toggleSelect`/`selectMany` clear geo; `clear()` clears both; `select(null)` also clears geo (a miss clears everything).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** exactly per the invariants (note: `select(null)` must clear geo too — `select: (selection) => set({ selections: selection ? [selection] : [], geoSelection: null })`).
- [ ] **Step 4: Run to verify pass** + the type gate.
- [ ] **Step 5: Commit.** `feat: selection store carries a geo feature selection`

---

### Task 10: Pure gesture resolution for engine picks

**Files:**

- Modify: `src/scene/pickEventHandlers.ts`
- Test: `tests/unit/scene/pickEventHandlers.test.ts`

**Interfaces (produced):**

```ts
/** What the viewport stashes from the engine's `pick` event (fires on clean mouseup). */
export interface EnginePickStash {
  readonly engineLayerId: unknown; // FeatureInfo.layerId — the ENGINE's layer id
  readonly batchId: number;
  readonly properties: Readonly<Record<string, unknown>> | undefined;
}

/** Resolve a stash to a geo selection, or null when it names no known geo layer
 *  (basemap tiles, Google tiles) or there is no stash. */
export function geoSelectionFromStash(
  stash: EnginePickStash | null,
  resolveGeoLayerId: (engineLayerId: unknown) => string | null,
): GeoFeatureSelection | null;
```

Semantics: `null` stash → `null`; `resolveGeoLayerId` answers `null` → `null`; otherwise `{ geoLayerId, batchId, properties: stash.properties ?? {} }`.

- [ ] **Step 1: Write the failing tests** (append a `describe("geoSelectionFromStash")` to the existing file): the three semantics above, plus: `engineLayerId: undefined` still consults the resolver — assert with a `vi.fn()` resolver that it WAS CALLED (returning null), not merely that the result is null.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (pure, ~10 lines).
- [ ] **Step 4: Run to verify pass** + the type gate.
- [ ] **Step 5: Commit.** `feat: resolve an engine pick stash to a geo feature selection`

---

### Task 11: geoLayerSync — engine-id lookup, evaluator capture, highlight

**Files:**

- Modify: `src/scene/geoLayerSync.ts`
- Test: `tests/unit/scene/geoLayerSync.test.ts`

**Interfaces (produced):**

```ts
export interface GeoFeatureEvaluator {
  /** Engine contract (d.ts ~3568–3625): cb runs per feature; returned fields
   *  OVERRIDE the layer defaults. CRITICAL: an omitted field does NOT reset a
   *  previously evaluated override (the d.ts documents "omit the key to leave
   *  it unchanged") — so CLEARING a highlight must return the layer's own
   *  default color explicitly, never `{}`. */
  evaluate(
    cb: (info: { readonly batchId: number }) => Record<string, unknown>,
  ): void;
}

export interface GeoLayerHandle {
  update(description: Record<string, unknown>): void;
  delete(): void;
  /** The engine layer id (`Layer.id`) — optional so existing fakes stay valid. */
  readonly id?: unknown;
  /** Engine `Layer.on`. A vector layer creates one feature set PER MATERIAL
   *  (point/polyline/polygon…), each with its own evaluator and featureSetId —
   *  mixed-geometry GeoJSON fires this several times. Features are also
   *  (re)created on `update()`, so the subscription lives on the handle,
   *  installed once in addPair. */
  on?(
    type: "featureCreated" | "featureUpdated",
    cb: (params: {
      readonly featureSetId?: unknown;
      readonly evaluator: GeoFeatureEvaluator;
    }) => void,
  ): void;
  forceUpdate?(): void;
}

export interface LiveGeoLayer {
  // …existing fields…
  style: GeoLayerStyle; // from Task 6
  /** One evaluator per feature set, keyed by featureSetId (the evaluator
   *  itself when the engine sends none). */
  evaluators: Map<unknown, GeoFeatureEvaluator>;
  highlightedBatchId: number | null; // desired highlight state
}

export function geoLayerIdForEngineLayerId(
  live: Map<string, LiveGeoLayer>,
  engineLayerId: unknown,
): string | null; // === compare against entry.layer.id; undefined never matches

export function syncGeoHighlight(
  selection: { readonly geoLayerId: string; readonly batchId: number } | null,
  live: Map<string, LiveGeoLayer>,
  /** Engine Color factory — EvaluatedValue.color must be a Color INSTANCE and
   *  this module stays engine-free, so the viewport supplies the constructor
   *  (`(hex) => new Color().setHex(hex)`). Called for the highlight accent and
   *  for each layer's own default color when clearing. */
  makeColor: (hex: number) => unknown,
): void;

/** The highlight accent hex — reuse the city selection accent from
 *  `packages/cityjson-navara-plugins/packages/navara-cityjson/src/surfaceColorLayers.ts`. */
export const GEO_HIGHLIGHT_COLOR_HEX: number;
```

`addPair` installs the subscription when `handle.on` exists (both event types): the callback stores `params.evaluator` under `params.featureSetId ?? evaluator` in `entry.evaluators` AND, if `entry.highlightedBatchId !== null`, immediately applies the highlight through that fresh evaluator (an engine `Layer.update()` recreates features, so the desired state must survive re-evaluation; a fresh feature set carries no stale overrides, so no clearing is needed there).

`applyHighlight(entry)` (private): `const hl = makeColor(GEO_HIGHLIGHT_COLOR_HEX)`, `const base = makeColor(hexColorToNumber(entry.style.color) ?? default accent)`; for every evaluator in `entry.evaluators`: `evaluate(info => ({ color: info.batchId === entry.highlightedBatchId ? hl : base }))` — the else-branch returns the layer's OWN color explicitly because omitted keys never reset (see the interface note); then `entry.layer.forceUpdate?.()` once. When `entry.highlightedBatchId === null` AND the entry was never highlighted, skip entirely (never touch a layer that never had an override — evaluated colors would otherwise shadow future style edits). Track that with a `hadHighlight: boolean` on the entry if needed.

`syncGeoHighlight`: for each entry, desired = `selection && selection.geoLayerId === id ? selection.batchId : null`; if `desired === entry.highlightedBatchId` skip; else set it and run `applyHighlight`. Engine-call failures are caught and reported like every other engine call in this module. `makeColor` results may be cached per call of `syncGeoHighlight`, not module-globally (the factory belongs to a view lifetime).

- [ ] **Step 1: Write the failing tests** (extend the fake view: fake handles gain `id`, `on` recording callbacks, `forceUpdate` counting calls; fake evaluators record the last cb and can run it; `makeColor` fake: `(hex) => ({ hex })`):
  - `geoLayerIdForEngineLayerId` finds the record whose handle carries the engine id; unknown id → null; a fake without `id` → never matches.
  - `syncGeoHighlight` selects: EVERY registered evaluator (register two, with distinct featureSetIds, simulating point+polygon sets) gets an evaluate call; running a cb with the matching batchId returns `{color: {hex: GEO_HIGHLIGHT_COLOR_HEX}}`, any other batchId returns `{color: {hex: 0xff5a3c}}` (the layer's own default — NOT an empty object); `forceUpdate` called once per layer.
  - Re-applying the same selection is a no-op (no second evaluate/forceUpdate).
  - Clearing (selection null after a highlight) evaluates every feature to the layer's own color and forces update; a layer that was NEVER highlighted gets no evaluate call at all.
  - A `featureCreated` fired after a highlight applies it through the NEW evaluator immediately (simulate: highlight, fire the recorded `on` callback with a fresh fake evaluator + new featureSetId, assert the fresh one got an evaluate call whose cb still highlights the batchId) — and the map now holds both evaluators.
  - Handles without `on` (old fakes) still add fine — no crash, `evaluators` stays empty, highlight is a silent no-op.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** + the type gate.
- [ ] **Step 5: Commit.** `feat: geo layer highlight plumbing and engine-id lookup`

---

### Task 12: Viewport wiring — engine pick event, click coordination, highlight sync

**Files:**

- Modify: `src/scene/NavaraViewport.tsx` (pick seam ~2769–2966: `rayAt`/`pickAt`/`onClick`/`onMouseMove`; the "we do NOT subscribe view.on('pick')" comment at ~2943–2948 is superseded; selection-store subscription that drives `syncHighlight`; geo sync effect ~1621–1625)
- Test: `tests/unit/scene/navaraViewport.test.tsx` (geo describe at ~2244+) or the pick-focused sibling file — follow where the existing mocked-engine pick tests live

**Interfaces:**

- Consumes: `geoSelectionFromStash` + `EnginePickStash` (Task 10), `geoLayerIdForEngineLayerId` + `syncGeoHighlight` + `GEO_HIGHLIGHT_COLOR_HEX` (Task 11), `selectGeoFeature` (Task 9).
- Behavior contract:
  1. Subscribe `view.on("pick", handler)` where the handler writes an `EnginePickStash | null` into a REF (`useRef`, not an effect-local `let` — the hosting effect at ~2768 has deps `[engineReady, layers, onCursorPosition]` and re-runs on every city-layer edit; an effect-local stash would be lost mid-gesture). The cleanup MUST `view.off("pick", handler)` — without it, handlers accumulate one per layer edit. Replace the ~2943–2948 "we do not subscribe pick" comment with one explaining the complementary split (own-raycast for city meshes, engine pick for engine-native layers).
  2. In the click handler, after the own-raycast resolution and inside the same tool-mode/click-gate acceptance: if the city selection is non-null, behave exactly as today (store invariant clears geo). If it is null, `const geo = geoSelectionFromStash(stashRef.current, id => geoLayerIdForEngineLayerId(geoLiveRef.current, id))`; if `geo` non-null and the gesture is a plain click (no shift-toggle for geo), call `selectionStore.getState().selectGeoFeature(geo)` instead of `select(null)`; else fall through to the existing intent dispatch. Consume the stash (`stashRef.current = null`) after every handled click, and clear it on `mousedown` (new gesture).
  3. Highlight: extend the existing selection-store subscription (the one calling `syncHighlight`) to also call `syncGeoHighlight(sel.geoSelection, geoLiveRef.current, makeEngineColor)`, and call it from the geo sync effect too (a layer re-added after the selection existed must come back highlighted). `makeEngineColor = (hex: number) => new Color().setHex(hex)` defined INSIDE the engine-bound scope — the engine's `Color` (d.ts ~1625) declares NO constructor parameters (`new Color(hex)` is a type error; the documented forms are `.setHex()`/`.setStyle()` — the same class mesh descs require per CLAUDE.md Known Issue (i)). Never construct a `Color` at module scope: the six viewport test suites mock `@navaramap/three` and a module-level `new Color()` evaluates `undefined` as a constructor at import time.
  4. Known, accepted asymmetry (document in the comment): the engine's pick pass skips on ANY mousemove between mousedown and mouseup (zero tolerance), while `createClickGate` allows 3 px — a 1-px jitter click can select a city object but will clear rather than select a geo feature. Engine-side; not fixable app-side on 0.0.5.
- Produces (for Task 13): on click of a geo feature, `useSelectionStore.getState().geoSelection` is populated.

- [ ] **Step 1: Extend the shared engine mock FIRST.** `tests/unit/scene/navaraViewport.test.tsx` (~29–33) returns `{ id: "layer-1", delete }` from EVERY `addLayer` — terrain, basemap and geo would share one id, which would make `geoLayerIdForEngineLayerId` resolve a basemap pick to the geo layer and invert the "unknown layer" test. Change the mock to mint unique ids (`layer-1`, `layer-2`, …) and add `update`, `forceUpdate`, and an `on` that records callbacks per instance. Add `Color: class { setHex() { return this; } setStyle() { return this; } }` to the `vi.mock("@navaramap/three")` factory of ALL SIX viewport suites (`navaraViewport{,Camera,Container,Solar,Streaming,Theme}.test.tsx`). Run the full `tests/unit/scene/` suite and repair any assertion that depended on the shared `"layer-1"` id BEFORE writing new tests — this refactor must land green.
- [ ] **Step 2: Write the failing tests** in the geospatial describe block:
  - The mount subscribes a `"pick"` handler (mock `view.on` records it) and unmount/effect-teardown unsubscribes it (`view.off` called with the same function).
  - Simulate: engine pick fires with `{batchId: 7, properties: {name: "Park"}, layerId: <the geo layer's minted engine id>}`, then the click handler fires with an own-raycast miss → `useSelectionStore.getState().geoSelection` equals `{geoLayerId, batchId: 7, properties: {name: "Park"}}`.
  - Same pick but the engine layerId is the basemap/terrain layer's id → click clears selection as before, `geoSelection` stays null.
  - A city hit on the same gesture wins: seed a city selection path (follow the existing pick tests' fixture) → `geoSelection` null.
  - After selecting, the selection-store subscription drove the highlight: the geo layer handle's recorded `on` callback was fed a fake evaluator and the handle received `forceUpdate`.
- [ ] **Step 3: Run to verify failure, then implement** per the behavior contract. Keep every decision that can be pure in `pickEventHandlers` — the viewport only wires events to the pure functions and the stores.
- [ ] **Step 4: Run to verify pass**, then ALL viewport tests (`npx vitest run tests/unit/scene/`) + the type gate.
- [ ] **Step 5: Commit.** `feat: click-select geospatial features via the engine pick pass`

---

### Task 13: Attributes for the selected geo feature

**Files:**

- Modify: `src/ui/viewport/AttributePanel.tsx` (props ~14–24, early return ~33), `src/app/App.tsx` (selection resolution ~1199–1214, render ~1279–1282)
- Test: `tests/unit/ui/viewport/AttributePanel.test.tsx`

**Interfaces:**

- Consumes: `geoSelection` from the selection store (Task 9); geo layer names from `useGeoLayerStore`.
- Produces: `AttributePanelProps` gains `readonly geoFeature?: { readonly layerName: string; readonly properties: Readonly<Record<string, unknown>> } | null`. When `objects` is empty and `geoFeature` is present, the panel renders the layer name as its title and the flat properties through the existing `AttributeTable` (no inheritance caption); empty properties render the existing "No attributes" copy. City selection present → city path unchanged (city wins; the store invariant makes co-presence impossible anyway).

- [ ] **Step 1: Write the failing tests:** renders `{name: "Park", area: 12}` rows with the layer name heading; empty properties → "No attributes"; `geoFeature` absent + no objects → renders nothing (existing behavior preserved).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** In `App.tsx`: `const geoSelection = useSelectionStore(s => s.geoSelection);` build `geoFeature` by joining with `useGeoLayerStore` layers for the name (a selection whose layer vanished → pass null); pass to `<AttributePanel …/>`. Also invalidate the geo selection when its subject can no longer be trusted — one effect watching the geo layers array: clear (`selectGeoFeature(null)`) when the selected layer is REMOVED, and also when its `config` identity has changed since selection (a relink/rebuild recreates the engine pair and batch ids are minted globally, so the retained `batchId` now names a different feature). Capture the config identity in a ref when `geoSelection` changes; compare in the effect.
- [ ] **Step 4: Run to verify pass**, then full `npx vitest run` + the type gate.
- [ ] **Step 5: Commit.** `feat: attribute panel shows the picked geo feature's properties`

---

### Task 14: Full verification, browser smoke, docs

**Files:**

- Modify: `CLAUDE.md` (Project Structure: add `features/geoLayers/`; note geo picking/styling in the architecture bullets), `docs/roadmap.md` (record the milestone)

- [ ] **Step 1: Full gates.** `npx vitest run` (0 failures) and the type gate (clean).
- [ ] **Step 2: Browser smoke** (host may lack the managed browser — per project memory use CDP on port 9333 if `agent-browser open` fails; if no browser is reachable, SKIP and say so in the report rather than faking it). NOTE the viewer shell (LayerPanel, viewport, panels) only mounts once a CITY layer exists (`App.tsx` gates on `layerStore.layers.length > 0`), so: `npm run dev`, load `fixtures/two-buildings.city.json` from the landing page FIRST, then verify (1) "+ Add Layer" opens on the Geospatial tab, (2) add `https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json` as GeoJSON, footprints drape, (3) click a state → attribute panel shows its properties and the feature recolors, (4) change the layer color in the row's Style block → re-render in the new color, (5) click a city building → city selection wins, geo highlight clears, (6) reload + restore → style survives. Note in the report that a geo-only session is still impossible (the landing page has no geospatial door) — a candidate follow-up, out of this plan's scope.
- [ ] **Step 3: Docs.** Update CLAUDE.md and roadmap per the file list; keep edits to what changed.
- [ ] **Step 4: Commit.** `docs: record GIS layer styling, selection and attributes`

---

## Self-review notes

- Spec A → Task 1; B → Tasks 2–3; C → Tasks 4–8; D → Tasks 9–13; E → deferred follow-up plan (spec marks it cuttable); smoke/docs → Task 14.
- Type-consistency: `GeoLayerStyle`/`DEFAULT_GEO_LAYER_STYLE`/`normalizeGeoLayerStyle`/`hexColorToNumber` (Task 4) are consumed by 5–8 and 11; `GeoFeatureSelection` (Task 9) by 10, 12, 13; `EnginePickStash`/`geoSelectionFromStash` (Task 10) by 12; `GeoFeatureEvaluator`/`geoLayerIdForEngineLayerId`/`syncGeoHighlight`/`GEO_HIGHLIGHT_COLOR_HEX` (Task 11) by 12.
- Reviewed 2026-08-10 by `claude -p` (Opus): 15 findings, all addressed in this revision — the load-bearing ones: evaluator clears must return explicit default colors (omitted keys never reset), one evaluator PER FEATURE SET (Map, not a single slot), `AddLayerDialog.test.tsx`'s six city-tab tests break on the default flip and are repaired in Task 1, `GeoLayer.style` being required breaks five annotated literals in `geoLayerSnapshot.test.ts` at Task 4's own gate, the shared engine mock mints one id for every layer and must be fixed before Task 12's tests mean anything, engine `Color` has a no-arg constructor and must never be built at module scope, the pick subscription needs `view.off` + a ref-stash, styles normalize on add too, geo selection invalidates on config rebuild, and the browser smoke must load a city model first (the shell gates on it).
- Known risk, called out to executors: the engine's `FeatureEvaluator.evaluate` semantics (persistence across `forceUpdate`, cb re-registration) are inferred from d.ts docs and cannot be fully proven under Node — Task 11's subscription re-applies state defensively, and Task 14's browser smoke is the ground truth. If the smoke shows the highlight not surviving a style edit, the fix belongs in the `featureCreated`/`featureUpdated` callback, not in new sync passes.
- Also known and accepted: the engine pick pass has ZERO drag tolerance vs the click gate's 3 px (Task 12 behavior contract #4), and a geo-only session remains impossible (landing page has no geospatial door — follow-up candidate, Task 14 notes it).
