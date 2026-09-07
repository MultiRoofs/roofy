# UI Redesign (Milestone 12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the viewer shell around one active layer and one shared selection: a unified layer list with the active layer's Style / Filter / Details under it, a details panel that exists only while something is selected, a data drawer under the map that follows the active layer, and scene controls on the map.

**Architecture:** The stores keep their split (layer, geo-layer, selection, query, stream) and gain one small workspace store that owns the single `activeLayerId` for both layer kinds, plus a coordination module that enforces the cross-store rules (activate clears a foreign selection, a pick activates its owner, hide/remove clear the selection; a filter that excludes a selected feature clears it in 12.4's `mapFilterSync`, the one owner of that rule). The React shell is rebuilt region by region (header, left panel, map overlays, details panel, drawer) as new modules under `src/ui/*`, and the old modules are deleted in the slice that replaces them. Engine bindings (`NavaraViewport`, `handleSync`, plugins) change only where the design needs a new capability (no fit-all on add, camera-cluster methods on the handle, per-object bounds).

**Tech Stack:** React 19, Zustand 5, Vitest 4 + Testing Library (jsdom), DuckDB-wasm (`src/insights`), Navara 0.1.1 through the `@cityjson/navara-*` plugins, vite-plus (`vp check`, `vp test run`).

**Spec:** `docs/superpowers/specs/2026-09-06-ui-redesign-design.md` (the approved design). Brief: `docs/ui-redesign-handoff.md`. Visual system: `DESIGN.md`, `src/app/brand.css`. Architecture map used to write this plan: `docs/superpowers/specs/2026-09-06-ui-redesign-architecture-map.md`.

## Global Constraints

- TDD, red-green-refactor; regression tests before fixes (`docs/testing-strategy.md`). Test files import from `"vitest"`.
- Commit directly on `develop`, small commits prefixed `feat:` / `fix:` / `refactor:` / `test:` / `docs:`, with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and the `Claude-Session:` trailer. Never bypass the hooks. Push from a clean same-filesystem worktree if the working tree carries another session's files (`host-tooling-quirks` memory, item 8).
- Submodule-first when a plugin changes: commit and push `packages/cityjson-navara-plugins` before the parent pointer bump.
- Hard rules from `CLAUDE.md` stay in force: every programmatic camera move goes through `withSettleSuppressed`; `AttributionOverlay` is never gated; no `view.globe.color` writes; `@navaramap/*` imports only in the named engine-binding modules; `src/insights/duckdb.ts` is the only importer of `@duckdb/duckdb-wasm`; one writer of the DuckDB status.
- Brand: tokens only from `src/app/brand.css`; readable text on `--fg` / `--fg-muted`, never `--fg-dim`; one filled lime button per view; lime is the only interactive colour; glass only over the map.
- No `activeLayerId ?? layers[0]` fallbacks anywhere: the active layer is the workspace store's id or nothing.
- Streaming layers keep `useStreamStore` separate from `useLayerStore` (render-cost split), and their counts always read "currently loaded".
- Persistence: schema v4; v3 migrates; v1/v2 keep the explicit unsupported-version error. No silent data loss. v4 is this milestone's only version bump: 12.3 (`colorBy`, `singleColor`, `unmatchedColor` on `LayerSnapshot`) and 12.5 (`timeZone`) add OPTIONAL fields under v4, the codebase's precedent (`geoLayers?` joined v3 without a bump).
- Desktop-first: verify at 1440×900 and 1280×720 in the real browser (`scripts/smoke/driver.mjs` or `agent-browser` with a hand-launched Chromium, see `host-tooling-quirks`).

## Slices

| Slice | Title                                                           | Depends on | Detailed tasks            |
| ----- | --------------------------------------------------------------- | ---------- | ------------------------- |
| 12.1  | Shared context: one active layer, one selection, v4 persistence | —          | in this document (done)   |
| 12.2  | Shell and layer management                                      | 12.1       | in this document (T13–24) |
| 12.3  | Styling and inspection                                          | 12.2       | written when 12.2 lands   |
| 12.4  | Linked data and filtering                                       | 12.2, 12.3 | written when 12.3 lands   |
| 12.5  | Scene controls and remaining capabilities                       | 12.2       | written when 12.4 lands   |
| 12.6  | Verification, review, docs                                      | all        | written when 12.5 lands   |

Each later slice gets its own task-level section appended to this document (same format as 12.1) immediately before it starts, written against the code as it then exists. The slice outlines below fix the scope, the module boundaries and the interfaces so that 12.1 does not paint later slices into a corner.

---

## Slice 12.1 — Shared context (detailed)

Outcome: the app behaves by the design's interaction rules 1, 2, 4 and the single-layer + Escape parts of rule 5 (the right panel that hides when empty is 12.2) with the OLD panels still on screen. Nothing visual changes except the removals. Every existing test still passes or is rewritten for the new rule.

### Execution order for 12.1

Tasks run **1 → 3 → 4 → 2 → 5 → 6 → 7 → 8**, not in numeric order. Task 4 rewires every reader to the workspace store while the old store fields still exist (unread), so Task 2's deletion is green by construction. Every commit leaves `npx vp check`, `npx tsc -b --noEmit` and `npx vp test run` green; a subagent inheriting a red suite cannot tell its own breakage from the plan's. One writer at a time in this worktree: tasks are dispatched sequentially, never in parallel.

### File map for 12.1

- Create `src/features/workspace/workspaceStore.ts` — `activeLayerId` for both layer kinds.
- Create `src/features/workspace/activeLayer.ts` — `resolveActiveLayer`, `useActiveLayer`, `unifiedLayerOrder`.
- Create `src/features/workspace/layerCoordination.ts` — `activateLayer`, `nextActiveAfterRemoval`, `selectionLayerId`, `installWorkspaceInvariants`.
- Modify `src/features/layers/layerStore.ts` — remove `activeLayerId` and `setActiveLayer`.
- Modify `src/features/geoLayers/geoLayerStore.ts` — remove `activeGeoLayerId` and `setActiveGeoLayer`.
- Modify `src/features/selection/selectionStore.ts` — `setMode` converts instead of wiping.
- Modify `src/app/App.tsx`, `src/ui/inspector/InspectorPanel.tsx`, `src/ui/inspector/RuleBuilderTab.tsx`, `src/ui/layers/LayerPanel.tsx`, `src/ui/layers/GeoLayerRow.tsx`, `src/ui/table/TablePanel.tsx`, `src/ui/StatusBar.tsx`, `src/scene/NavaraViewport.tsx`.
- Delete `src/ui/viewport/AttributePanel.tsx`, `tests/unit/ui/viewport/AttributePanel.test.tsx`, the `ATTRIBUTE PANEL` and `AGGREGATION MODE SELECT` sections of `src/app/app.css` (lines ~2965–3175).
- Modify `src/persistence/types.ts`, `src/persistence/captureSnapshot.ts`, `src/persistence/restoreSnapshot.ts`; create `src/persistence/migrateSnapshot.ts`.
- Tests: `tests/unit/features/workspace/{workspaceStore,activeLayer,layerCoordination}.test.ts`, updates under `tests/unit/features/{layers,geoLayers,selection}`, `tests/unit/ui/{inspector,layers,table,StatusBar}`, `tests/unit/scene/navaraViewport*.test.tsx`, `tests/unit/persistence/*`, `tests/unit/app/*`.

### Task 1: Workspace store and active-layer resolution

**Files:**

- Create: `src/features/workspace/workspaceStore.ts`
- Create: `src/features/workspace/activeLayer.ts`
- Test: `tests/unit/features/workspace/workspaceStore.test.ts`, `tests/unit/features/workspace/activeLayer.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // workspaceStore.ts
  export interface WorkspaceState {
    readonly activeLayerId: string | null;
  }
  export interface WorkspaceActions {
    setActiveLayerId: (id: string | null) => void;
  }
  export const useWorkspaceStore: UseBoundStore<
    StoreApi<WorkspaceState & WorkspaceActions>
  >;

  // activeLayer.ts
  export type ActiveLayer =
    | { readonly kind: "city"; readonly layer: Layer }
    | { readonly kind: "geo"; readonly layer: GeoLayer };
  export function resolveActiveLayer(
    activeLayerId: string | null,
    layers: ReadonlyArray<Layer>,
    geoLayers: ReadonlyArray<GeoLayer>,
  ): ActiveLayer | null;
  /** City layers in add order, then geo layers in add order. */
  export function unifiedLayerOrder(
    layers: ReadonlyArray<Layer>,
    geoLayers: ReadonlyArray<GeoLayer>,
  ): ReadonlyArray<string>;
  export function useActiveLayer(): ActiveLayer | null;
  export function useActiveCityLayer(): Layer | null; // null when the active layer is geo
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/features/workspace/workspaceStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

describe("workspaceStore", () => {
  beforeEach(() => useWorkspaceStore.setState({ activeLayerId: null }));
  it("starts with no active layer", () => {
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });
  it("sets and clears the active layer id", () => {
    useWorkspaceStore.getState().setActiveLayerId("a");
    expect(useWorkspaceStore.getState().activeLayerId).toBe("a");
    useWorkspaceStore.getState().setActiveLayerId(null);
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });
});
```

```ts
// tests/unit/features/workspace/activeLayer.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveActiveLayer,
  unifiedLayerOrder,
} from "../../../../src/features/workspace/activeLayer";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";

const city = (id: string) => ({ id, name: id }) as unknown as Layer;
const geo = (id: string) =>
  ({ id, name: id, kind: "geojson" }) as unknown as GeoLayer;

describe("resolveActiveLayer", () => {
  it("returns null for a null id and for an unknown id (no first-layer fallback)", () => {
    expect(resolveActiveLayer(null, [city("a")], [])).toBeNull();
    expect(resolveActiveLayer("zzz", [city("a")], [geo("g")])).toBeNull();
  });
  it("resolves a city layer and a geo layer by id", () => {
    expect(resolveActiveLayer("a", [city("a")], [geo("g")])).toEqual({
      kind: "city",
      layer: city("a"),
    });
    expect(resolveActiveLayer("g", [city("a")], [geo("g")])).toEqual({
      kind: "geo",
      layer: geo("g"),
    });
  });
});

describe("unifiedLayerOrder", () => {
  it("lists city layers first, then geo layers, each in add order", () => {
    expect(
      unifiedLayerOrder([city("b"), city("a")], [geo("g2"), geo("g1")]),
    ).toEqual(["b", "a", "g2", "g1"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/features/workspace`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// src/features/workspace/workspaceStore.ts
/**
 * The one "active layer" for the whole workspace: city model, streaming,
 * vector, raster or tiles. Every panel that concerns a layer (style, filter,
 * details, the data drawer, the legend heading) follows this id. Nothing
 * else holds an active id — layerStore and geoLayerStore no longer do.
 *
 * Not persisted here; the snapshot records it as an index (persistence v4).
 */
import { create } from "zustand";

export interface WorkspaceState {
  readonly activeLayerId: string | null;
}

export interface WorkspaceActions {
  setActiveLayerId: (id: string | null) => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  activeLayerId: null,
  setActiveLayerId: (id) => set({ activeLayerId: id }),
}));
```

```ts
// src/features/workspace/activeLayer.ts
import { useShallow } from "zustand/react/shallow";
import { useLayerStore, type Layer } from "../layers/layerStore";
import { useGeoLayerStore, type GeoLayer } from "../geoLayers/geoLayerStore";
import { useWorkspaceStore } from "./workspaceStore";

export type ActiveLayer =
  | { readonly kind: "city"; readonly layer: Layer }
  | { readonly kind: "geo"; readonly layer: GeoLayer };

export function resolveActiveLayer(
  activeLayerId: string | null,
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): ActiveLayer | null {
  if (activeLayerId === null) return null;
  const city = layers.find((l) => l.id === activeLayerId);
  if (city) return { kind: "city", layer: city };
  const geo = geoLayers.find((l) => l.id === activeLayerId);
  if (geo) return { kind: "geo", layer: geo };
  return null;
}

export function unifiedLayerOrder(
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): ReadonlyArray<string> {
  return [...layers.map((l) => l.id), ...geoLayers.map((l) => l.id)];
}

export function useActiveLayer(): ActiveLayer | null {
  const activeLayerId = useWorkspaceStore((s) => s.activeLayerId);
  const layer = useLayerStore(
    useShallow((s) => s.layers.find((l) => l.id === activeLayerId) ?? null),
  );
  const geoLayer = useGeoLayerStore(
    useShallow((s) => s.layers.find((l) => l.id === activeLayerId) ?? null),
  );
  if (layer) return { kind: "city", layer };
  if (geoLayer) return { kind: "geo", layer: geoLayer };
  return null;
}

export function useActiveCityLayer(): Layer | null {
  const active = useActiveLayer();
  return active?.kind === "city" ? active.layer : null;
}
```

Do not use `useShallow`: `find` returns a stable object reference, so select the id and the array separately and `find` in the hook body (drop the import).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/features/workspace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace tests/unit/features/workspace
git commit -m "feat(workspace): one active-layer id for every layer kind"
```

### Task 2: Remove the two store-level active ids

**Files:**

- Modify: `src/features/layers/layerStore.ts:107-108, 151, 300, 305-312, 320-322`
- Modify: `src/features/geoLayers/geoLayerStore.ts:153-167` and the actions' implementations
- Test: `tests/unit/features/layers/layerStore.test.ts`, `tests/unit/features/geoLayers/geoLayerStore.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `LayerStoreState` is `{ layers }` only; `GeoLayerState` is `{ layers }` only. `setActiveLayer` / `setActiveGeoLayer` no longer exist. `addLayer` and `removeLayer` no longer touch any active id.

- [ ] **Step 1: Update the store tests first**

Delete every assertion on `activeLayerId` / `activeGeoLayerId` in the two store test files and add:

```ts
it("does not carry an active id (the workspace store owns it)", () => {
  expect("activeLayerId" in useLayerStore.getState()).toBe(false);
});
```

and the geo equivalent for `activeGeoLayerId`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/features/layers/layerStore.test.ts tests/unit/features/geoLayers/geoLayerStore.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Remove the fields and actions**

In `layerStore.ts`: delete `activeLayerId` from `LayerStoreState`, delete `setActiveLayer` from the actions interface and the implementation, make `addLayer` return without the `activeLayerId:` line, make `removeLayer` `set((state) => ({ layers: state.layers.filter((l) => l.id !== id) }))`, and `removeAllLayers: () => set({ layers: [] })`.
In `geoLayerStore.ts`: delete `activeGeoLayerId` and `setActiveGeoLayer`; `removeGeoLayer` / `removeAllGeoLayers` only touch `layers`.

- [ ] **Step 4: Run the whole suite**

Run: `npx tsc -b --noEmit && npx vitest run`
Expected: green. Task 4 already moved every reader and every test to the workspace store; if anything still references the deleted fields, that is a Task 4 omission — fix the reader, do not reintroduce the field.

- [ ] **Step 5: Commit** — `refactor(layers): drop the per-store active ids`

### Task 3: Coordination rules and invariants

**Files:**

- Create: `src/features/workspace/layerCoordination.ts`
- Modify: `src/features/selection/selectionStore.ts:108` (`setMode`)
- Test: `tests/unit/features/workspace/layerCoordination.test.ts`, `tests/unit/features/selection/selectionStore.test.ts`

**Interfaces:**

- Produces:

  ```ts
  /** The layer that owns the current selection: a city selection's layerId or a geo selection's geoLayerId. */
  export function selectionLayerId(
    state: Pick<SelectionState, "selections" | "geoSelection">,
  ): string | null;
  /** Rule 1: sets the active layer; clears the selection first when it belongs to another layer. Never moves the camera.
   *  The rule is enforced INSIDE `useWorkspaceStore.setActiveLayerId` (the store imports the selection store and clears a
   *  foreign selection before writing), so no caller can bypass it; `activateLayer` is the documented entry point and
   *  delegates to it. Task 3 amends `workspaceStore.ts` accordingly (moving `selectionLayerId` there; `layerCoordination` re-exports it)
   *  and adds the test to `workspaceStore.test.ts`. */
  export function activateLayer(id: string | null): void;
  /** Rule 4: next in unified order after the removed one, else the previous, else null. `removedIndex === -1` (unknown) → the first remaining id. */
  export function nextActiveAfterRemoval(
    order: ReadonlyArray<string>,
    removedId: string,
    removedIndex: number,
  ): string | null;
  /** Subscribes to the layer, geo-layer and selection stores and enforces: first layer becomes active; a removed active layer hands over per nextActiveAfterRemoval; a selection whose owner is removed or hidden is cleared; a selection activates its owner. Returns a disposer that disposes ONLY its own subscriptions and clears the module pointer only when it still points at itself; a second install disposes the first. */
  export function installWorkspaceInvariants(): () => void;
  ```

  `selectionStore.setMode(mode)` now: `"object"` narrows every surface selection to its object (deduplicated); `"surface"` keeps object selections untouched; hover cleared; `geoSelection` untouched.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/features/workspace/layerCoordination.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import {
  activateLayer,
  installWorkspaceInvariants,
  nextActiveAfterRemoval,
  selectionLayerId,
} from "../../../../src/features/workspace/layerCoordination";

// Define two local factories at the top of the file (copy, do not import across test files):
//   layerInput(name): the `addLayer` input — reuse the shape of the `layer()` factory in
//     tests/unit/features/layers/layerStore.test.ts (a minimal CityModel with one object, `visible: true`,
//     `rules: []`, `rulesEnabled: false`, a `modelRef` of `{ type: "url", url: "https://x/" + name }`).
//   geoInput(name): the `addGeoLayer` input — a GeoJSON layer matching `GeoLayerInput` in
//     src/features/geoLayers/geoLayerStore.ts (check the exact config fields there).

describe("nextActiveAfterRemoval", () => {
  it("prefers the next id, then the previous, then null", () => {
    expect(nextActiveAfterRemoval(["a", "b", "c"], "b", 1)).toBe("c");
    expect(nextActiveAfterRemoval(["a", "b", "c"], "c", 2)).toBe("b");
    expect(nextActiveAfterRemoval(["a"], "a", 0)).toBeNull();
  });
});

describe("selectionLayerId", () => {
  it("reads the city owner or the geo owner", () => {
    expect(
      selectionLayerId({
        selections: [{ kind: "object", layerId: "L", objectId: "o" }],
        geoSelection: null,
      }),
    ).toBe("L");
    expect(
      selectionLayerId({
        selections: [],
        geoSelection: { geoLayerId: "G", batchId: 0, properties: {} },
      }),
    ).toBe("G");
    expect(selectionLayerId({ selections: [], geoSelection: null })).toBeNull();
  });
});

describe("activateLayer + invariants", () => {
  let dispose: () => void;
  beforeEach(() => {
    useLayerStore.setState({ layers: [] });
    useGeoLayerStore.setState({ layers: [] });
    useSelectionStore.setState({
      selections: [],
      hovered: null,
      geoSelection: null,
      mode: "object",
    });
    useWorkspaceStore.setState({ activeLayerId: null });
    dispose = installWorkspaceInvariants();
  });
  afterEach(() => dispose());

  it("the first added layer becomes active; later adds do not steal it", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
    useLayerStore.getState().addLayer(layerInput("B"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
  });

  it("activating another layer clears a selection that belongs to the previous one", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: a, objectId: "o1" });
    activateLayer(b);
    expect(useSelectionStore.getState().selections).toEqual([]);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(b);
  });

  it("a pick activates its owning layer", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    activateLayer(a);
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: b, objectId: "o1" });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(b);
    expect(useSelectionStore.getState().selections).toHaveLength(1);
  });

  it("removing the active layer hands over to the next in list order, and clears its selection", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: a, objectId: "o1" });
    useLayerStore.getState().removeLayer(a);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(b);
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("removing the last layer leaves no active layer", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    useLayerStore.getState().removeLayer(a);
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });

  it("hiding the selection's layer clears the selection", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    useSelectionStore
      .getState()
      .select({ kind: "surface", layerId: a, objectId: "o1", surfaceIndex: 2 });
    useLayerStore.getState().updateLayer(a, { visible: false });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("activating the layer that owns the selection keeps the selection", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: a, objectId: "o1" });
    activateLayer(a);
    expect(useSelectionStore.getState().selections).toHaveLength(1);
  });

  it("hiding a geo layer clears its feature selection", () => {
    const g = useGeoLayerStore.getState().addGeoLayer(geoInput("G"));
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId: g, batchId: 0, properties: {} });
    useGeoLayerStore.getState().updateGeoLayer(g, { visible: false });
    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("closing every city layer while geo layers survive hands the active layer to a geo layer", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const g = useGeoLayerStore.getState().addGeoLayer(geoInput("G"));
    activateLayer(a);
    useLayerStore.getState().removeAllLayers();
    expect(useWorkspaceStore.getState().activeLayerId).toBe(g);
  });

  it("no active layer while layers exist is not a durable state: the reconciler picks the first", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    activateLayer(null);
    useLayerStore.getState().updateLayer(a, { name: "renamed" });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
  });

  it("clear() also ends a geo selection (what keeps activate and pick from fighting)", () => {
    const g = useGeoLayerStore.getState().addGeoLayer(geoInput("G"));
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId: g, batchId: 0, properties: {} });
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("a geo layer takes part in the same rules", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const g = useGeoLayerStore.getState().addGeoLayer(geoInput("G"));
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId: g, batchId: 0, properties: {} });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(g);
    activateLayer(a);
    expect(useSelectionStore.getState().geoSelection).toBeNull();
    useGeoLayerStore.getState().removeGeoLayer(g);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
  });
});
```

In `selectionStore.test.ts`, DELETE the existing case asserting that `setMode` clears the selection, then add:

```ts
it("switching to object mode narrows surface selections to their objects", () => {
  const s = useSelectionStore.getState();
  s.selectMany([
    { kind: "surface", layerId: "L", objectId: "o1", surfaceIndex: 0 },
    { kind: "surface", layerId: "L", objectId: "o1", surfaceIndex: 3 },
  ]);
  s.setMode("object");
  expect(useSelectionStore.getState().selections).toEqual([
    { kind: "object", layerId: "L", objectId: "o1" },
  ]);
});
it("switching to surface mode keeps object selections", () => {
  const s = useSelectionStore.getState();
  s.select({ kind: "object", layerId: "L", objectId: "o1" });
  s.setMode("surface");
  expect(useSelectionStore.getState().selections).toEqual([
    { kind: "object", layerId: "L", objectId: "o1" },
  ]);
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/unit/features/workspace tests/unit/features/selection`

- [ ] **Step 3: Implement**

```ts
// src/features/workspace/layerCoordination.ts
import { useLayerStore } from "../layers/layerStore";
import { useGeoLayerStore } from "../geoLayers/geoLayerStore";
import {
  useSelectionStore,
  type SelectionState,
} from "../selection/selectionStore";
import { useWorkspaceStore } from "./workspaceStore";
import { unifiedLayerOrder } from "./activeLayer";

export function selectionLayerId(
  state: Pick<SelectionState, "selections" | "geoSelection">,
): string | null {
  if (state.selections.length > 0) return state.selections[0]!.layerId;
  return state.geoSelection?.geoLayerId ?? null;
}

/** Rule 1 lives in the store's own `setActiveLayerId`; this is the documented entry point. */
export function activateLayer(id: string | null): void {
  useWorkspaceStore.getState().setActiveLayerId(id);
}
// In workspaceStore.ts the action becomes (selectionLayerId is defined there and re-exported here):
//   setActiveLayerId: (id) => {
//     const owner = selectionLayerId(useSelectionStore.getState());
//     if (owner !== null && owner !== id) useSelectionStore.getState().clear();
//     set({ activeLayerId: id });
//   },

export function nextActiveAfterRemoval(
  order: ReadonlyArray<string>,
  removedId: string,
  removedIndex: number,
): string | null {
  const remaining = order.filter((id) => id !== removedId);
  if (remaining.length === 0) return null;
  if (removedIndex < 0) return remaining[0]!;
  const next = remaining[removedIndex];
  return (
    next ??
    remaining[removedIndex - 1] ??
    remaining[remaining.length - 1] ??
    null
  );
}

let disposeInstalled: (() => void) | null = null;

export function installWorkspaceInvariants(): () => void {
  disposeInstalled?.();
  let previousOrder = unifiedLayerOrder(
    useLayerStore.getState().layers,
    useGeoLayerStore.getState().layers,
  );

  const reconcileLayers = () => {
    const layers = useLayerStore.getState().layers;
    const geoLayers = useGeoLayerStore.getState().layers;
    const order = unifiedLayerOrder(layers, geoLayers);
    const { activeLayerId } = useWorkspaceStore.getState();
    const selection = useSelectionStore.getState();
    const owner = selectionLayerId(selection);

    // A selection whose owner is gone or hidden is cleared.
    if (owner !== null) {
      const ownerCity = layers.find((l) => l.id === owner);
      const ownerGeo = geoLayers.find((l) => l.id === owner);
      const present = ownerCity ?? ownerGeo;
      const visible = present ? present.visible : false;
      if (!present || !visible) selection.clear();
    }

    if (activeLayerId === null) {
      if (order.length > 0)
        useWorkspaceStore.getState().setActiveLayerId(order[0]!);
    } else if (!order.includes(activeLayerId)) {
      const removedIndex = previousOrder.indexOf(activeLayerId);
      useWorkspaceStore
        .getState()
        .setActiveLayerId(
          nextActiveAfterRemoval(previousOrder, activeLayerId, removedIndex),
        );
    }
    previousOrder = order;
  };

  const reconcileSelection = () => {
    const owner = selectionLayerId(useSelectionStore.getState());
    if (
      owner !== null &&
      owner !== useWorkspaceStore.getState().activeLayerId
    ) {
      useWorkspaceStore.getState().setActiveLayerId(owner);
    }
  };

  const unsubs = [
    useLayerStore.subscribe(reconcileLayers),
    useGeoLayerStore.subscribe(reconcileLayers),
    useSelectionStore.subscribe(reconcileSelection),
  ];
  reconcileLayers();
  reconcileSelection();
  const dispose = () => {
    unsubs.forEach((u) => u());
    if (disposeInstalled === dispose) disposeInstalled = null;
  };
  disposeInstalled = dispose;
  return dispose;
}
```

`selectionStore.setMode`:

```ts
setMode: (mode) =>
  set((state) => {
    if (mode === "surface") return { mode, hovered: null };
    const seen = new Set<string>();
    const narrowed: Selection[] = [];
    for (const s of state.selections) {
      const key = `${s.layerId} ${s.objectId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      narrowed.push({ kind: "object", layerId: s.layerId, objectId: s.objectId });
    }
    return { mode, selections: narrowed, hovered: null };
  }),
```

Note `nextActiveAfterRemoval` receives the order BEFORE removal and the removed index within it; write the test data accordingly (the example above passes the pre-removal order).

- [ ] **Step 4: Run to verify they pass**, then `npx vitest run` for the suite.

- [ ] **Step 5: Commit** — `feat(workspace): coordination rules — activate clears foreign selection, picks activate, removal hands over`

Ruling recorded 2026-09-06 (plan review C1): `handleClose` removes geo layers as well as city layers from Task 4 on — "Close" means "new workspace"; the old "geo layers survive close" behaviour existed only because the landing page could not show a geo-only workspace, which 12.2 fixes. Cost if wrong: a user loses geo layers on Close in 12.1; 12.2 replaces Close with New workspace.

### Task 4: Wire the shell to the workspace store and remove the duplicate paths

**Files:**

- Modify: `src/app/App.tsx` (:247, :276-279, :500-510, :694, :1309; install the invariants in the mount effect next to the DuckDB boot; `:649-650` is the SAVE LABEL fallback `allLayers.find(...) ?? allLayers[0]` — replace it with `resolveActiveLayer(activeLayerId, layers, geoLayers)?.layer.name ?? "Untitled"`, no fallback to the first layer)
- Modify: `src/ui/layers/LayerPanel.tsx:75, :122, :128-133` → `useWorkspaceStore` + `activateLayer(layer.id)`
- Modify: `src/ui/layers/GeoLayerRow.tsx:43-46` → same
- Modify: `src/ui/inspector/InspectorPanel.tsx:129-162, :287, :334-338` → `displayLayer` is the active city layer or the selection's layer (no `?? layers[0]`); the geo branch renders when the active layer is geo; delete `ruleTargetOverride`; `RuleBuilderTab` gets only `{ model, layerId }`
- Modify: `src/ui/inspector/RuleBuilderTab.tsx:31-36, :125-137` → delete `layerOptions`, `onSelectLayer` and the `<select>`; the tab title reads "Rules · <layer name>"
- Modify: `src/ui/table/TablePanel.tsx:53-55, :63-64, :96-131, :179-186` → layer from `useActiveCityLayer()`; delete `syncSelection`, `tableSelection` and the checkbox; row click always writes the global selection
- Modify: `src/ui/StatusBar.tsx:50-51, :63-75` → delete the table toggle and its props; active layer from `useActiveCityLayer()`
- Modify: `src/ui/layers/LayerPanel.tsx` → add an `Open table` / `Close table` ghost button on the ACTIVE city row's actions (props `tableOpen`, `onToggleTable` threaded from `App` through `LeftSidebar`), so the table stays reachable until 12.2 builds the action row THROWAWAY by design: 12.2 deletes `LeftSidebar` and `LayerPanel`; do not defend the threading in review.
- Modify: `src/app/App.tsx` `handleClose` :1163-1181 → also `removeAllGeoLayers()`; then `activateLayer(null)` (ruling C1 above)
- Create: `src/features/selection/useEscapeClearsSelection.ts` — a hook installed once in `App`'s viewer branch: a capture-phase `keydown` listener on `window`; `Escape` calls `useSelectionStore.getState().clear()` unless a modal is open (`document.querySelector(".modal-backdrop")`) or the event target is an input, textarea or select. Test: `tests/unit/features/selection/useEscapeClearsSelection.test.tsx`.
- Modify: `src/features/workspace/activeLayer.ts` → tighten the selectors to `useLayerStore((s) => s.layers.find((l) => l.id === activeLayerId) ?? null)` (same for geo) and `useMemo` the `{ kind, layer }` wrapper on `[layer, geoLayer]` so the hook's return is a stable dependency; add a test for `useActiveCityLayer` returning null when the active layer is geo.
- Status bar streaming readout stays scoped to the active CITY layer (today's behaviour); when the active layer is geo the streaming row is absent. 12.5 trims the status bar.
- TEST SWEEP (the largest part of this task): `grep -rln "activeLayerId\|activeGeoLayerId\|setActiveLayer\|setActiveGeoLayer" tests` lists about 33 files. Every `useLayerStore.setState({ layers, activeLayerId })` becomes `useLayerStore.setState({ layers }); useWorkspaceStore.setState({ activeLayerId })`; every `activeGeoLayerId` setup becomes a workspace-store write; `setActiveLayer` / `setActiveGeoLayer` calls become `activateLayer`. Do the sweep with a script, then read every changed test for meaning. Files include all `tests/unit/scene/navaraViewport*.test.tsx`, `tests/unit/features/layers/*.test.ts`, `tests/unit/features/query/mapFilterSync.test.ts`, `tests/unit/ui/viewport/{LegendOverlay,StreamQueryBoxOverlay}.test.tsx`, `tests/unit/ui/sidebar/*.test.tsx`, `tests/unit/ui/layers/*.test.tsx`, `tests/unit/ui/viewerToolbar.test.tsx`, `tests/unit/ui/StatusBar.test.tsx` and `StatusBarDuckdb.test.tsx` (both exist), `tests/unit/app/*.test.tsx`.
- Tests: `tests/unit/ui/layers/LayerPanelSections.test.tsx`, `tests/unit/ui/inspector/InspectorPanel.test.tsx`, `tests/unit/ui/inspector/RuleBuilderTab.test.tsx`, `tests/unit/ui/inspector/GeoLayerInspector.test.tsx`, `tests/unit/ui/table/TablePanel.test.tsx`, `tests/unit/ui/StatusBar.test.tsx`, `tests/unit/app/appEngineBoot.test.tsx`

**Interfaces:**

- Consumes: `useWorkspaceStore`, `useActiveLayer`, `useActiveCityLayer`, `activateLayer`, `installWorkspaceInvariants`.
- Produces: `RuleBuilderTabProps = { model: CityModel; layerId: string }`; `TablePanelProps` unchanged; `StatusBarProps` loses `tableOpen` / `onToggleTable`; `LayerPanelProps` gains `tableOpen: boolean; onToggleTable: () => void`.

- [ ] **Step 1: Rewrite the tests that encode the old behaviour** — for each file above: replace `useLayerStore.setState({ layers, activeLayerId })` with `useLayerStore.setState({ layers }); useWorkspaceStore.setState({ activeLayerId })`; replace `activeGeoLayerId` setups with `useWorkspaceStore`; delete the "Sync selection" cases in `TablePanel.test.tsx` and add "a row click selects in the global store even after the panel re-mounts"; delete the target-select cases in `RuleBuilderTab.test.tsx`; in `StatusBar` assert there is no button named "Table"; in `LayerPanelSections.test.tsx` assert a row click calls into the workspace store and that "Open table" appears on the active row only.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Apply the source edits listed under Files.** Every read of the active layer goes through `useActiveLayer` / `useActiveCityLayer`. `App` installs the invariants: `useEffect(() => installWorkspaceInvariants(), [])`.
- [ ] **Step 4: `npx tsc -b --noEmit && npx vitest run`** — green.
- [ ] **Step 5: Commit** — `refactor(shell): every panel follows the workspace's active layer; sync-selection and rule-target override removed`

### Task 5: Remove the floating attributes overlay

**Files:**

- Delete: `src/ui/viewport/AttributePanel.tsx`, `tests/unit/ui/viewport/AttributePanel.test.tsx`
- Modify: `src/app/App.tsx:1270-1300, :1366-1370` (the `selectedObjects` / `geoFeature` resolution and the mount), `src/app/app.css` — delete ONLY the AttributePanel rules: the `ATTRIBUTE PANEL` section (:2965-3135), `.agg-mode-compact` (:3166) and `[data-theme="light"] .attribute-panel` (:3171). KEEP `.agg-mode-select` (:3140-3164): `InspectorPanel.tsx:486` still renders it
- Test: `tests/unit/app/appEngineBoot.test.tsx` — add "a selection renders exactly one attribute table": assert `document.querySelector(".attribute-panel")` is null and `screen.getAllByRole("table")` (or the inspector's attribute-list role) has length 1

- [ ] Steps: failing app test → delete the module, its mount and CSS → `npx vp check` (dead-class check: `grep -rn "attribute-panel\|agg-mode-compact" src` returns nothing) → suite green → commit `refactor(inspector): the details panel is the one attribute view; floating overlay removed`.

### Task 6: No fit-all flight on every added layer

**Files:**

- Modify: `src/scene/NavaraViewport.tsx:2380` — key the fit on the WORKSPACE going from no layers to some, not on `liveRef` (which counts static handles only): keep a `previousLayerCountRef` holding `layers.length + geoLayers.length + streamingCount` from the last sync (`layers` are already a dependency of the effect; read the geo count from `useGeoLayerStore` and the streaming count from `streamsRef`), and bump the fit token only when the previous total was `0` and the new total is `> 0`. Streaming layers count as layers here: a workspace whose first layer is streaming must not be yanked when the first static layer lands.
- Test: `tests/unit/scene/navaraViewport.test.tsx` — the existing auto-fit case becomes: "fits when the first layer of an empty workspace lands", "does not fit when a second static layer lands", "does not fit when a static layer joins a workspace that already has a streaming layer", "does not fit when a city layer joins a geo-only workspace"; the suppression case stays.

- [ ] Steps: failing test → one-line change and comment update → green → commit `fix(viewport): only the first layer of an empty workspace fits the camera`.

### Task 7: Persistence v4 with a v3 migration

**Files:**

- Modify: `src/persistence/types.ts:383, :385-404` — `SNAPSHOT_VERSION = "4"`; add
  ```ts
  /** v4: which layer was active. `index` is the position within `snapshot.layers` when `kind` is "city" and within `snapshot.geoLayers` when `kind` is "geo". Absent = the first layer in unified order. */
  readonly activeLayer?: { readonly kind: "city" | "geo"; readonly index: number };
  ```
- Create: `src/persistence/migrateSnapshot.ts`
  ```ts
  export type MigrationOutcome =
    | {
        readonly ok: true;
        readonly snapshot: ProjectSnapshot;
        readonly migratedFrom: string | null;
      }
    | { readonly ok: false; readonly error: UnsupportedSnapshotVersionError };
  /** v4 passes through; v3 becomes v4 with `activeLayer` omitted (the first layer); anything else is unsupported. */
  export function migrateSnapshot(raw: ProjectSnapshot): MigrationOutcome;
  ```
- Modify: `src/persistence/restoreSnapshot.ts:22-24` → call `migrateSnapshot`; throw the error outcome; return `viewState` and, additionally, `activeLayer` (change the return type to `{ viewState: ViewState; activeLayer: ProjectSnapshot["activeLayer"] }` and update its ONE caller, `App.tsx:711`; the share path goes through `readShareHash`, not `restoreSnapshot`)
- Modify: `src/persistence/captureSnapshot.ts:20-37, :39` — `CaptureInput` gains `activeLayer?: { kind; index }`; written when defined
- Modify: `src/app/App.tsx` `handleSave` :627-668 (compute `activeLayer` as `{ kind: "city", index: layers.findIndex(l => l.id === activeLayerId) }` or `{ kind: "geo", index: geoLayers.findIndex(...) }`, omitted when the id resolves to neither), `handleRestore` :696-925 (build `addedCityIds: (string | null)[]` ALIGNED with `snapshot.layers` — `null` for an unavailable placeholder or a failed load — and `addedGeoIds` aligned with `snapshot.geoLayers`; after the loops, resolve `activeLayer` by indexing the aligned array of its kind, and call `activateLayer(id)`; when the slot is `null` or the field is absent, activate the first non-null added id in unified order. Never compact the arrays: a skipped layer must not shift later indexes), `readShareHash` path unchanged (share stays v3; add a comment saying why)
- Tests: `tests/unit/persistence/snapshotV4.test.ts` (new: round trip with `activeLayer`; v3 document migrates with `migratedFrom: "3"`; v2 is rejected with `UnsupportedSnapshotVersionError`), update `tests/unit/persistence/{snapshotV3,captureRestore}.test.ts` for the version string, `tests/unit/app/appRestoreShare.test.tsx` — "restore activates the saved layer" and "a v3 snapshot restores with the first layer active".

- [ ] Steps: failing tests → implement → `npx vitest run tests/unit/persistence tests/unit/app` → suite → commit `feat(persistence): snapshot v4 records the active layer; v3 migrates, v1/v2 stay unsupported`.

### Task 8: Slice gate

- [ ] `npx vp check && npx tsc -b --noEmit && npx vp test run` green; `cd packages/cityjson-navara-plugins && pnpm typecheck && pnpm vitest run` unchanged.
- [ ] Browser smoke on Delft: pick a building → one attribute view; open the table from the layer row → row click selects in the viewport; add a second city layer (`fixtures/two-buildings.city.json`) → the camera does not move; save, reload, restore → the saved layer is active.
- [ ] `docs/roadmap.md` 12.1 marked complete with the commit range; push.

---

## Slice 12.2 — Shell and layer management (outline)

Scope: the new grid and regions with the OLD contents where the new ones do not exist yet.

- New modules: `src/ui/shell/ViewerShell.tsx` (grid: `header / left | map-column | right / status`; map column = viewport + drawer; right column width `0` when there is no selection; props for collapse and widths), `src/ui/shell/shellStore.ts` (`leftCollapsed`, `rightCollapsed`, `leftWidth`, `rightWidth`, `drawer: { open, height, expanded }` — replaces `App`'s `inspectorOpen`, `leftSidebarCollapsed`, `leftSidebarWidth`, `tableOpen`, `tableHeight`), `src/ui/header/WorkspaceHeader.tsx` (lockup, workspace menu, Save, Share, Preferences, collapse buttons; replaces `ViewerToolbar`), `src/ui/header/PreferencesMenu.tsx` (Interface appearance: System / Light / Dark — `useTheme` gains `"system"`), `src/ui/layers/LayerList.tsx` + `LayerRow.tsx` (one row component for `ActiveLayer`-shaped items: eye, type icon, name, state line, chips, overflow menu with Zoom to layer / Open table / Rename / Remove), `src/ui/layers/LeftRail.tsx` (collapsed state), `src/ui/layers/ActiveLayerPanel.tsx` with `StyleSection.tsx`, `FilterSection.tsx`, `DetailsSection.tsx` (Details absorbs `LodSelector`, `AppearanceSelector`, `LayerTypeToggles`, `StreamingLodControl`, the resident-cache tooltip, metadata), `src/features/layers/layerPresentation.ts` (`layerStateLine(layer, stream?, table?)`, `layerTypeOf(active): "city" | "streaming" | "vector" | "raster" | "tiles"`).
- `AddLayerDialog` reworked: tabs File / URL / Catalog; detection line from `detectEncoding` / `classifyCityParquetUrl` / `classifyGeoUrl` with a `Change…` select that overrides the route; a GeoJSON-only add enters the viewer (the landing branch condition becomes `hasLayers || hasGeoLayers || engineBooting`).
- Deleted at the end of the slice: (`ViewerToolbar` survives until 12.5 — its pick mode, view mode and scene menus are mounted temporarily inside the header's right group), `LeftSidebar`, `LayerPanel`, `GeoLayerRow`, `BasemapPanel` / `GoogleTilesPanel` move to 12.5's Scene settings sheet (temporarily under Details of the active layer? No: temporarily in a `Scene` popover from the header), CSS sections `TOOLBAR`, `LEFT SIDEBAR`, `LAYER PANEL`, `VIEWER SHELL`.
- Persistence: none.
- Tests: shellStore, ViewerShell layout classes at both collapse states, LayerRow for the five layer types, layerPresentation strings, AddLayerDialog detection and override, App landing-vs-viewer branch for a geo-only workspace.

## Slice 12.3 — Styling and inspection (outline)

- `StyleSection` for city layers: `Color by` = `Surface type` | `Rules` | `Single colour` (`src/features/rules/colorBy.ts`: `ColorBy` on `Layer` as `colorBy: "surface" | "rules" | "single"` plus `singleColor: string`, compiled to the evaluator `handleSync` already pushes — single colour is a catch-all rule); presets row; `RulesEditor` (from `RuleBuilderTab`, without the target select); per-layer drafts in `src/features/rules/ruleDraftStore.ts`; unmatched colour editable (`Layer.unmatchedColor`, threaded into `compileRuleEvaluator`'s fallback — verify the core API, add a parameter if needed, submodule-first).
- `StyleSection` for geo layers: fill / stroke / opacity (from `GeoLayerInspector`) and `Color by attribute` (`GeoLayerStyle.colorByAttribute?: { attribute: string; categories: Record<string, string> }` — verify `geoLayerSync` can paint per feature; if not, defer and say so in the section).
- `LegendOverlay` rebuilt: groups per visible layer (surface types / rules + unmatched / geo fill or categories), heading activates the layer and opens Style (shellStore `openSection: "style"`), presentation size when both panels are collapsed; no counts in 12.3 — 12.4's `useLayerCounts` adds them to the legend rows.
- `src/ui/details/DetailsPanel.tsx` (+ `IdentityTrail`, `SummarySection`, `RuleMatchSection`, `AttributesSection`, `PartsSection`, `GeometrySection`, `MultiSelectionSummary`, `GeoFeatureDetails`): replaces `InspectorPanel`, `GeoLayerInspector`, `AnalysisTab` (its content becomes an `ANALYSIS` section), `StatsTab` (moves to 12.4's Summary view). Roof metrics through `computeObjectStats`.
- Tests per component; the rule-match section against a compiled evaluator.

## Slice 12.3 — Styling and inspection (detailed, 2026-09-07)

Written against the code as it exists after 12.2 (origin/develop a0a4616). Line references are deliberately absent: find code by content. Same process as 12.2: one implementer per task, a reviewer per task, rulings in the ledger. Tasks are numbered T25+ because `task-brief` keys on `### Task N`.

**Slice rulings (binding, spec beats outline):**

- R1. **No submodule change in 12.3.** `evaluateRule` returns true for a rule with zero conditions, so `Single colour` is ONE catch-all rule and the editable unmatched colour is a TRAILING catch-all rule. A pure, memoised `effectiveRules(layer)` in `src/features/rules/colorBy.ts` is the ONE array handed to `compileRuleEvaluator` by BOTH consumers: `handleSync`'s static path (`compileRuleEvaluator(layer.rules, layer.rulesEnabled)`) and the streaming handle feed (`setRules(rules, enabled)` in `handleSync`, memoised on `memo.rules`). Memoise per `(rules, colorBy, singleColor, unmatchedColor)` identity so the repaint does not fire on every render.
- R2. `rulesEnabled` stays in the v4 snapshot; `colorBy`, `singleColor`, `unmatchedColor` are OPTIONAL snapshot fields with derived defaults (absent → `colorBy = rulesEnabled && rules.length > 0 ? "rules" : "surface"`), no version bump. Share links stay v3 and carry the EFFECTIVE rules array, so a shared single colour or unmatched colour renders on the other side as `Rules` (edit state is lossy across a share — accepted).
- R3. The right panel's sections are the spec's: identity trail, SUMMARY, RULE MATCH, ATTRIBUTES, PARTS, GEOMETRY (and the multi-selection summary). The Analysis tab's content folds into SUMMARY; there is no ANALYSIS section. "Avg solar score" stays as a SUMMARY row for buildings when the metric exists (it is the one derived number the presets use).
- R4. RULE MATCH: a roof-surface subject shows the one matching rule (or "Unmatched — no rule applies"); a building subject shows per-rule roof-surface counts ("Flat roofs · 3 surfaces · Unmatched · 1"), computed with `compileRuleEvaluator(effectiveRules(layer))` from core (engine-free).
- R5. Rule precedence: Move up / Move down buttons in 12.3 (keyboard-reachable); the spec's drag handle is deferred to 12.6 polish.
- R6. Unmatched grey, the single-colour default and the categorical palette come from `src/scene/cityColors.ts`, the app's one colour answer; the hard rule applies (none may equal highlight, hover, a base surface colour or the default geo colour) and the existing test that pins it is extended.
- R7. `StatsTab` has no host between 12.3 and 12.4: the file stays, unmounted, with a comment pointing at 12.4's Summary view. GEOMETRY's "Raw object" button renders disabled with `data-temporary="12.4"` (the drawer's Raw objects view lands in 12.4).
- R8. Geo `Color by attribute` is planned as feasible but gated on a real-browser probe (T29 step 1): the engine's evaluator callback carries `properties` (three d.ts: `properties: Record<string, unknown> | undefined`), while the app's `GeoFeatureEvaluator` narrows `info` to `{ batchId }`. If `info.properties` is populated for polygon AND polyline feature sets, colour per feature through the SAME evaluator path `applyHighlight` uses (highlight wins over the category colour). Fallback 1: the layer's GeoJSON data (inline, or the cached fetch the bounds path already does) mapped batchId → feature index. Fallback 2: defer with the spec's muted line. Stroke colour: only if the engine's vector description exposes a polygon outline colour; otherwise the single `color` stays for both fills and lines and "stroke colour" is deferred (say so in the section).
- R10 (plan review 2026-09-07, folded). Consumers use `effectiveRules` AND `effectiveRulesEnabled` TOGETHER; after 12.3 `rulesEnabled` is derived (`colorBy === "rules"`) on capture and read on restore only when `colorBy` is absent; the editor's On/Off toggle is gone (the `Color by` select replaces it). RULE MATCH identity comes from a pure `firstMatchingRule(attributes, metrics, rules): Rule | null` in `colorBy.ts` (core's `evaluateRule`, same precedence; a synthetic rule → null), never from a colour. Shares and snapshots NEVER serialise synthetic rules: the v3 share payload gains optional `colorBy`, `singleColor`, `unmatchedColor` (older builds ignore them); snapshot restore validates `colorBy` against the enum and the two colours as `#rrggbb` (else defaults), tests cover an old v4 fixture, partial fields and a new snapshot. Geo `Color by attribute` has NO batchId→index fallback: either the probe shows `info.properties` populated with distinct values across features for polygon, polyline and point feature sets, or the feature is deferred with the spec's muted line; one evaluator-application function serves highlight AND category colour (highlight wins, deselection restores the category colour, feature-set recreation re-applies). Categories are typed: `ReadonlyArray<{ readonly value: string | null; readonly color: string }>` over `String(value)` (null for missing), the first 8 distinct values in first-seen order, everything else in a reserved OTHER bucket coloured `CATEGORY_OTHER_HEX` (a literal "Other" value is a value). Constants are `UNMATCHED_COLOR_HEX`, `SINGLE_COLOR_HEX`, `CATEGORY_PALETTE_HEX`, `CATEGORY_OTHER_HEX` everywhere. Building RULE MATCH shows each matched rule's swatch, name, condition and surface count plus the unmatched count. SUMMARY's "Belongs to" row is a building link (selects the owner). The legend's presentation size triggers on `leftCollapsed && (rightCollapsed || !hasSelection)` — a right panel that does not exist counts as collapsed (spec amended). Deferred with a record in the design spec's Deferred section: rule drag handle (12.6 polish; Move up/down now), legend counts (12.4, `useLayerCounts`), "Raw object" → drawer (12.4, the Raw objects view), raster colormap (already deferred). Feasibility probes run BEFORE any styling UI (T26 step 0): (a) FCB — a zero-condition rule recolours resident AND newly streamed roofs on `fixtures/delft.fcb`; (b) geo `info.properties`. Reviewer tier: opus for T30 as well.
- R9. The geo re-link gap left by 12.2 (the list's geo "Needs re-link" placeholder has no action since `GeoLayerRow` was deleted) is closed FIRST (T25), before any styling work.

### Task 25: Loose ends from 12.2

**Files:** modify `src/ui/layers/LayerList.tsx` / `LayerRow.tsx` (geo unavailable placeholder gets `Re-link` (file picker → `useGeoLayerStore.relinkGeoJsonLayer(id, data)` via `parseGeoJsonText(await file.text())`) and `Remove`), `src/ui/shell/LeftRail.tsx` + `App.tsx` (a state dot on the rail button when `failed.length > 0`, tooltip "N failed adds"), `src/ui/shell/shellStore.ts` (`installShellListeners()` installed once by `App`: on `window` resize, re-clamp `drawerHeight` through `clampDrawerHeight`, and re-clamp `leftWidth`/`rightWidth` against `SHELL_LIMITS`), tests `tests/unit/ui/layers/LayerList.test.tsx`, `tests/unit/ui/shell/LeftRail.test.tsx`, `tests/unit/ui/shell/shellStore.test.ts`, `tests/unit/app/appGeoOnly.test.tsx` (the missing case: a city row joins while the first-geo fit is in flight → no fit; pins the single-row recheck).
Tests: geo placeholder Re-link calls `relinkGeoJsonLayer` with the parsed data and the row becomes a live vector row; the rail shows the dot only while `failed` is non-empty; a resize below the drawer height re-clamps it; the in-flight case.

- [ ] Steps: failing tests → implement → commit `fix(shell): re-link for geo placeholders, a rail dot for failed adds, re-clamp on resize; pin the in-flight geo fit`.

### Task 26: `colorBy` — the effective rules and their persistence

**Step 0 — feasibility probes (real browser, CDP harness in `/tmp/roofy-ui-prototype.rExpRq/smoke-12.2/`, dev server on 5199, fixture server on 5390):** (a) open `http://127.0.0.1:5199/fixtures/delft.fcb` as a streaming layer, add ONE rule with zero conditions and a distinctive colour through the store, confirm resident roofs recolour and roofs streamed AFTER the change also carry it (pan); (b) load `http://127.0.0.1:5390/parcels.geojson`, widen `GeoFeatureEvaluator`'s info to `{ batchId; properties? }`, log `info.properties` for every feature and feature set, confirm distinct values per feature for polygon and polyline sets (add a point feature to the fixture for the third set). Record both outcomes in the report and the ledger; if (a) fails, stop and report NEEDS_CONTEXT (R1 is revised); if (b) fails, T29 defers per R10.

**Files:** create `src/features/rules/colorBy.ts`; modify `src/features/layers/layerStore.ts` (`Layer.colorBy: "surface" | "rules" | "single"`, `singleColor: string`, `unmatchedColor: string`; defaults `"surface"`, `SINGLE_COLOR_HEX`, `UNMATCHED_COLOR_HEX` from `cityColors`; `updateLayer` accepts them), `src/scene/cityColors.ts` (export `UNMATCHED_COLOR_HEX`, `SINGLE_COLOR_HEX`, `CATEGORY_PALETTE_HEX: readonly string[]` (8 entries), `CATEGORY_OTHER_HEX`, derived from the brand tokens), `src/scene/handleSync.ts` (both consumers take `effectiveRules(layer)`; memo keys include the three new fields), `src/features/streaming/openStreamingLayer.ts` (the initial `rules` handed to the stream is `effectiveRules`), `src/persistence/{types,captureSnapshot,restoreSnapshot,urlShare}.ts` (optional fields validated per R10; the share carries user rules plus the three optional fields), tests `tests/unit/features/rules/colorBy.test.ts`, `tests/unit/scene/handleSync.test.ts`, the cityColors rule test, persistence tests.

```ts
export type ColorBy = "surface" | "rules" | "single";
export interface ColorByInput {
  readonly rules: ReadonlyArray<Rule>;
  readonly rulesEnabled: boolean;
  readonly colorBy: ColorBy;
  readonly singleColor: string;
  readonly unmatchedColor: string;
}
export function effectiveRules(input: ColorByInput): ReadonlyArray<Rule>; // "surface" → [] ; "single" → [catchAll(singleColor)] ; "rules" → [...enabled user rules, catchAll(unmatchedColor)] — memoised on the five inputs' identity (WeakMap on `rules` + a small key)
export function effectiveRulesEnabled(input: ColorByInput): boolean; // colorBy !== "surface" — ALWAYS passed together with effectiveRules (R10)
export function firstMatchingRule(
  attributes: Readonly<Record<string, unknown>>,
  metrics: RoofMetrics,
  rules: ReadonlyArray<Rule>,
): Rule | null; // core evaluateRule, first enabled match; synthetic → null
export const CATCH_ALL_RULE_ID_PREFIX = "__roofy_"; // the synthetic rules never reach the editor or the legend's user rows
export function isSyntheticRule(rule: Rule): boolean;
```

Tests: each mode's array; memoisation (same identity for the same inputs); `handleSync` repaints when only `unmatchedColor` changes, on BOTH the static and the streaming memo paths, and Rules → Surface → Rules round-trips; `firstMatchingRule` identity for two rules of the same colour; snapshot round-trip with and without the new fields; an old v4 fixture restores `colorBy` by the derived default; partial fields validate to defaults; a share link carries user rules + the three optional fields (never a synthetic rule) and restores the same mode.

- [ ] Steps: failing tests → implement → commit `feat(rules): Color by — surface type, rules with an unmatched colour, or a single colour — as one effective rule list`.

### Task 27: Per-layer rule drafts

**Files:** create `src/features/rules/ruleDraftStore.ts` (Zustand; `drafts: Record<layerId, RuleDraft | null>` where `RuleDraft = { editingId: string | null; form: RuleFormValues; open: boolean }`; `setDraft(layerId, draft)`, `clearDraft(layerId)`; drafts are session-only, never persisted); modify `src/ui/layers/RulesEditor.tsx` (its `showForm`/`editingId`/form state moves into the store keyed by `layerId`; `RuleForm` is controlled by the draft); test `tests/unit/features/rules/ruleDraftStore.test.ts`, update `tests/unit/ui/layers/RulesEditor.test.tsx` (switch layer A → B → A restores the unsaved editor with its values; Save/Cancel clears the draft; removing the layer clears it via `installWorkspaceInvariants`' removal hook or a store subscription in the draft store — pick one, test it).

- [ ] Steps: failing tests → implement → commit `feat(rules): unsaved rule editors survive switching layers`.

### Task 28: StyleSection for city layers — Color by, presets, rules, unmatched, single colour

**Files:** modify `src/ui/layers/StyleSection.tsx`, `src/ui/layers/RulesEditor.tsx` (becomes the `Rules` branch's body: preset chips row (swatch + label + tooltip description), the rule list rows (swatch, name, condition in mono via the existing condition text, enabled toggle, Move up / Move down, Edit, Delete), the unmatched line "First matching rule wins. Unmatched roofs: [swatch input] Unassigned grey" (the label reads the colour's name when it is the default, else the hex) writing `updateLayer(id, { unmatchedColor })`; the old On/Off toggle is removed (R10), "+ Add rule" → the inline `RuleForm` (Name, Attribute select listing roof metrics (the RoofMetrics keys the rule engine resolves: `areaSqM` / `inclinationDeg` / `azimuthDeg`, plus `elevationM` where the model carries it — NOT `roof.area`-style names, which `evaluateRule` would never match) first, then the spec's named attributes `measuredHeight`, `yearOfConstruction`, `roofType`, `function` when the model carries them, then the model's remaining attribute keys, Operator, Value, Colour, Save / Cancel); the five presets Flat roofs, South-facing, Steep roofs, Large roofs, Solar suitable are all rendered; Import / Export under a small "More" disclosure), create `src/ui/layers/SurfaceTypePalette.tsx` (read-only rows Roof / Wall / Ground with the `SURFACE_COLOR_HEX` swatches), `src/app/app.css`; tests `tests/unit/ui/layers/StyleSection.test.tsx`, `RulesEditor.test.tsx`.
Anatomy: `Color by` select (`Surface type` | `Rules` | `Single colour`) → `updateLayer(id, { colorBy })`; affected-unit line "<name> · Color roof surfaces by rules" / "… by surface type" / "… with one colour"; streaming layers identical (the resident model supplies the attribute keys as today). Changing a preset chip appends the preset rule and switches `colorBy` to `"rules"` if it was `"surface"`.
Tests: the select writes `colorBy`; all five presets render and append (switching `colorBy`); Move up/down reorders; the unmatched swatch writes `unmatchedColor` and the label reads "Unassigned grey" at the default; single colour input writes `singleColor`; a fixture whose store rules include a synthetic id proves synthetic rules never render as rows.

- [ ] Steps: failing tests → implement → commit `feat(style): Color by — surface type, rules with presets and an unmatched colour, or a single colour`.

### Task 29: StyleSection for geo layers — fill, opacity, Color by attribute (probe first)

**Step 1:** read T26's probe (b) outcome in the ledger. Populated → implement per R10 (no batchId fallback); not populated → defer: the vector Style shows the spec's muted line and the ledger + design spec record the engine limitation. Also probe whether polygon features draw an outline through the polyline material (then `strokeColor` is honest); if not, stroke colour is deferred and recorded.

**Files:** modify `src/features/geoLayers/geoLayerStyle.ts` (`GeoLayerStyle.colorByAttribute?: { readonly attribute: string; readonly categories: ReadonlyArray<{ readonly value: string | null; readonly color: string }> }`, `normalizeGeoLayerStyle` tolerates its absence), `src/features/geoLayers/geoLayerStore.ts` (`editStyle` accepts it), create `src/features/geoLayers/categorize.ts` (`categoriesFor(features, attribute): ReadonlyArray<{ value: string | null; color: string }>` per R10 — `String(value)`, null for missing, first 8 distinct values in first-seen order on `CATEGORY_PALETTE_HEX`, an OTHER bucket on `CATEGORY_OTHER_HEX`; `attributeKeys(features): string[]`), `src/scene/geoLayerSync.ts` (ONE `applyFeatureColors(entry, …)` used by highlight and category colour: per feature `highlight if picked else category colour if set else base`; a `colorByAttribute` change, a pick, a deselection and a feature-set recreation all go through it), `src/ui/layers/StyleSection.tsx` (vector: Fill colour, Fill opacity, Line width, Point size (existing controls), then `Color by attribute` select (`None` + the attribute keys from the inline data or the cached fetch) and, when set, the category rows with swatches (editable colour inputs writing `categories`); a muted "Rules are available for city models."; raster: opacity only; tiles: "No style options"), `src/app/app.css`; tests `tests/unit/features/geoLayers/categorize.test.ts` (overflow to OTHER, literal "Other", missing values, normalisation), `tests/unit/scene/geoLayerSync.test.ts` (category colour per feature, highlight precedence, deselection restores the category, recreation re-applies, editing a category re-evaluates), `tests/unit/ui/layers/StyleSection.test.tsx`.
Persistence: `GeoLayerSnapshot.style` already carries the style object — confirm `colorByAttribute` round-trips (test) without a version bump.

- [ ] Steps: probe → failing tests → implement (or defer per R8 with the muted line and a ledger entry) → commit `feat(style): vector layers colour by attribute with a categorical palette`.

### Task 30: LegendOverlay rebuilt

**Files:** rewrite `src/ui/viewport/LegendOverlay.tsx` (+ `src/ui/viewport/legendModel.ts`, pure: `legendGroups(layers, geoLayers): LegendGroup[]` where a group is `{ layerId; name; kind; rows: { label; color; kind: "surface" | "rule" | "unmatched" | "single" | "category" | "fill" }[] }` — city `surface` → Roof / Wall / Ground rows; `rules` → user rules in order + "Unmatched" (synthetic rules never listed — build from `layer.rules`, not `effectiveRules`); `single` → one row; vector → categories (+ OTHER when present) or one fill row; raster/tiles → no group; hidden layers → no group), `src/app/app.css`; tests `tests/unit/ui/viewport/legendModel.test.ts`, `tests/unit/ui/viewport/LegendOverlay.test.tsx`.
Behaviour: heading click → `useShellStore.getState().requestSection(layerId, "style")` (activates + opens Style + un-collapses the left panel); the existing Hide legend toggle stays; presentation size (`.legend-presentation`, 14 px rows) when `leftCollapsed && (rightCollapsed || !hasSelection)` (R10: an absent right panel counts as collapsed); no counts (12.4 adds them); the cyber-look warning chip stays as today.
Tests: groups per kind; hidden layers excluded; heading click requests the section; presentation class from the store.

- [ ] Steps: failing tests → implement → commit `feat(legend): grouped by layer, a heading opens the layer's Style, presentation size when both panels are collapsed`.

### Task 31: DetailsPanel — identity trail, Summary, Attributes (built beside the inspector, unmounted)

**Files:** create `src/ui/details/{DetailsPanel,IdentityTrail,SummarySection,AttributesSection,subject.ts}.tsx|ts`; reuse `src/ui/inspector/attrDisplay.tsx` (`AttrRow`, `formatValue`) and `useResidentSurfaces`/`SurfacesFetchGate` (move the gate into `src/ui/details/SurfacesGate.tsx` AND update `InspectorPanel`'s import in the same commit — every commit compiles); a `useResolvedSubject(subject)` hook produces `ResolvedBuilding` for building subjects and is the one metric source for SUMMARY and RULE MATCH; `src/app/app.css` (`DETAILS PANEL` section); tests `tests/unit/ui/details/{subject,IdentityTrail,SummarySection,AttributesSection}.test.tsx|ts`.

```ts
// subject.ts — pure
export type Subject =
  | {
      kind: "building";
      layerId: string;
      objectId: string;
      object: CityObject;
      parts: ReadonlyArray<CityObject>;
    }
  | {
      kind: "surface";
      layerId: string;
      objectId: string;
      surfaceIndex: number;
      surface: Surface;
      owner: CityObject;
    }
  | {
      kind: "multi";
      layerId: string;
      objectIds: ReadonlyArray<string>;
      objects: ReadonlyArray<CityObject>;
    }
  | {
      kind: "geo";
      geoLayerId: string;
      batchId: number;
      properties: Readonly<Record<string, unknown>>;
    };
export function subjectOf(
  selections: ReadonlyArray<Selection>,
  geoSelection: GeoFeatureSelection | null,
  resolveObject: (layerId, id) => CityObject | null,
): Subject | null;
export function identityTrail(
  subject: Subject,
  layerName: string,
): ReadonlyArray<{
  label: string;
  act: "activate-layer" | "narrow-to-building" | "current";
}>; // "Delft → Building …25028 → Roof surface 12" (ids shortened to their last 5 characters after an ellipsis)
export interface ResolvedBuilding {
  readonly object: CityObject;
  readonly parts: ReadonlyArray<CityObject>;
  readonly roofSurfaces: ReadonlyArray<{
    surface: Surface;
    owner: CityObject;
    metrics: RoofMetrics;
  }>;
  readonly loading: boolean;
} // roofs on the object AND its parts; streaming: through the surfaces gate, `loading` until resident
export function buildingSummary(
  b: ResolvedBuilding,
): ReadonlyArray<{ label: string; value: string; act?: () => void }>; // Roof area (sum m²), Mean roof slope, Main orientation (compass word + degrees via computeAverageAzimuth), Height (measuredHeight), Roof type, Parts (n), Avg solar score when present
export function surfaceSummary(surface, metrics, owner): rows; // Area, Slope, Azimuth, Type, Belongs to (a row with `act` selecting the owner building)
export function geoSummary(properties): rows; // Name, Zone, Area (ha) when present, else the first three properties
```

`DetailsPanel({ onClose })` reads the selection store, the layer stores and the workspace store, resolves the subject (static: `model.objects`; streaming: the resident model through the gate), renders `IdentityTrail` (layer crumb → `activateLayer`; building crumb → `select({kind:"object"…})`; copy-id icon button; × → `onClose`), the full id in mono, then SUMMARY and ATTRIBUTES (two-column table; a search field when > 8 rows filtering by key). Streaming subjects wait on the gate exactly as `InspectorPanel` does today (do not drop it: the SUMMARY of a streamed building would be blank).
Tests: `subjectOf` for the four kinds + null; trail labels and actions; building summary numbers against a hand-built parent with NO own geometry and roofs on two child parts; "Belongs to" selects the owner; attributes search.

- [ ] Steps: failing tests → implement → commit `feat(details): the selection's identity trail, summary and attributes` (InspectorPanel still mounted; nothing in App changes).

### Task 32: DetailsPanel — Rule match, Parts, Geometry, multi-selection, geo feature

**Files:** create `src/ui/details/{RuleMatchSection,PartsSection,GeometrySection,MultiSelectionSummary,GeoFeatureDetails}.tsx`, `src/ui/details/ruleMatch.ts` (pure: `ruleMatchFor(resolved: ResolvedBuilding | { surface; metrics }, layer): { kind: "surface"; rule: Rule | null } | { kind: "building"; matched: ReadonlyArray<{ rule: Rule; surfaces: number }>; unmatched: number } | null` using `firstMatchingRule` (R10) over `layer.rules`; null when `colorBy !== "rules"`; rendered with each rule's swatch, name and condition text); tests per component + `ruleMatch.test.ts`.
PARTS: rows "Part 1 · 12.4 m · 3 roof surfaces" expanding to the part's attributes; a roof-surface row click → `setMode("surface")` + `select({ kind: "surface", … })`. GEOMETRY: LoD, geometry type, surfaces by type (roof / wall / ground counts), vertices, bounding box in mono, "Raw object" disabled with `data-temporary="12.4"`. MULTI: heading "3 buildings selected", "Aggregates over the 3 selected buildings", Roof area (total), Height (mean · min–max), Roof types (counts), the id list with × → `toggleSelect`. GEO: layer name, `geoSummary`, the properties table; replaces `GeoFeatureDetailsTemp`'s content (the temp file is deleted in T33).
Tests: rule match by rule IDENTITY (two rules with the same colour) for a surface and a building; parts expand and select; multi aggregates; geo feature rows.

- [ ] Steps: failing tests → implement → commit `feat(details): rule match, parts, geometry and multi-selection aggregates`.

### Task 33: Swap — the right column renders DetailsPanel

**Files:** modify `src/app/App.tsx` (right slot: `hasSelection ? <DetailsPanel onClose={clearSelection}/> : null` for every selection kind; `DetailsPanel` OWNS the header — the identity trail is the only identity UI; `selectionTitle` survives solely as the collapsed pill's text; × clears city and geo selections alike, tested), delete `src/ui/inspector/GeoFeatureDetailsTemp.tsx` + test; update `tests/unit/app/appViewerShell.test.tsx` (the geo test asserts the new panel). `InspectorPanel` is now unmounted but still compiles.

- [ ] Steps: failing tests → implement → commit `feat(app): the details panel replaces the inspector for every selection`.

### Task 34: Delete the inspector and the analysis tab

**Files:** delete `src/ui/inspector/{InspectorPanel,AnalysisTab}.tsx` and their tests; keep `attrDisplay.tsx`, `StatsTab.tsx` (unmounted, comment → 12.4) and its test; CSS by surviving consumer (`INSPECTOR PANEL` rules that only the deleted files used; move `.attr-*` rules the details panel still uses under `DETAILS PANEL`); audit table in the report; gate grep `grep -rn "inspector-\|InspectorPanel\|AnalysisTab" src` lists only survivors.

- [ ] Steps: delete → fix references → suite → commit `refactor(inspector): removed — the details panel and the layer's Style own its content`.

### Task 35: Slice gate

- [ ] `npx vp check src tests`, `npx tsc -b --noEmit`, `npx vitest run`; submodule unchanged (R1).
- [ ] Browser smoke (Delft sample + the parcels fixture) at 1440×900: apply the "Flat roofs" preset → roofs recolour on the map and the legend shows the rule rows + Unmatched; switch to Single colour → one colour, legend one row; Surface type → palette; edit the unmatched swatch → map updates; a rule draft survives switching layers; legend heading opens Style; select a building → identity trail, SUMMARY numbers, RULE MATCH counts, PARTS expand, GEOMETRY; select a surface via PARTS; shift-click two buildings → multi summary; select a parcel → geo feature details; Color by attribute `use` → two colours on the map and in the legend (or the deferred muted line, per T29's probe). Both themes for the details panel and the legend.
- [ ] Docs: `docs/roadmap.md` 12.3 complete WITH the exceptions listed precisely (drag handle → 12.6, legend counts and Raw object → 12.4, raster colormap deferred, geo colour-by-attribute or stroke colour if deferred by the probe); `docs/architecture-notes.md` records `effectiveRules` (one array, two consumers, synthetic catch-all rules) and the geo per-feature colour path (or its deferral); the design spec's Right panel section gets an "Implemented" note. Push.

**Order: T25 → T26 (probes first) → T27 → T28 → T29 → T30 → T31 → T32 → T33 → T34 → T35.** Models: T25/T27/T34 sonnet; T26/T28/T29/T30/T31/T32/T33 opus. Reviewers: opus for T26/T29/T30/T31/T32/T33/T35, sonnet elsewhere.

## Slice 12.4 — Linked data and filtering (outline)

- `src/ui/drawer/DataDrawer.tsx` (header: active layer name, Records / Summary tabs, counts `total · matching · selected` with units, Show selected records toggle, Export, Expand, Close; footer mirrors the attribution when expanded), `RecordsView.tsx` (FilterBar; `Buildings | Raw objects` view — buildings = root-type rows via `buildRootTypeWhere`, parts by expansion through a children query on the flat table's parent column (verify the column name in `layerRows.ts`); `Columns` chooser with structural columns off by default; `DataGrid`; `Pagination` at 20 / 50 / 100), `SummaryView.tsx` (from `StatsTab`, scoped All | Matching, streaming wording "currently loaded").
- `queryStore`: delete `syncToMap`; add `view: "buildings" | "raw"`, `showSelectedOnly: boolean`, `columns: ReadonlyArray<string> | null`. `mapFilterSync` runs on apply/clear for non-streaming layers and drops selections outside the id set (rule 3). Streaming: `Table only` pill before Apply, chip text "listed (table only)".
- Filter indicators: `LayerRow` chip, map chip (`src/ui/viewport/FilterChip.tsx`), `FilterSection` summary with `Edit in table` / `Clear filter`.
- `ExportDialog` scope `Selected (n)`; the counts come from one `useLayerCounts(layerId)` hook used by the header, the chips and the dialog.
- Empty / no-table / error / loading states per layer kind; never another layer's rows.

## Slice 12.5 — Scene controls and remaining capabilities (outline)

- `CitySceneHandle` gains `zoomIn()`, `zoomOut()`, `resetNorth()`, `fitObjects(layerId, objectIds)` (per-object bounds: add `getObjectBoundsGeodetic(objectId)` to the plugin handle if the mesh does not expose it — submodule-first; streaming layers use the resident record's bbox). `CameraControls` and `AddressSearch` move out of the viewport into `src/ui/viewport/CameraCluster.tsx` (bottom-right: zoom, north, Fit, Zoom to selection, `Top-down | Angled | Free 3D`), `SelectModeControl.tsx` (top-left `Feature | Surface`, Surface disabled for non-city active layers), `SceneButtons.tsx` (top-right `Sun & shade`, `Scene settings`).
- `src/ui/scene/SunShadeSheet.tsx` (nonmodal; from `SolarMenu`; `solarStore.timeZone: "Europe/Amsterdam" | "UTC" | "browser"` with `Intl` formatting; presets; play / speed), `src/ui/scene/SceneSettingsSheet.tsx` (BASEMAP, CONTEXT = Google 3D + terrain, RENDERING = `RenderingPanel` content, SCENE APPEARANCE = weather effect with the "visual effect only" note, PRESENTATION LOOKS = `None | Cartoon | Cyber | Wireframe` with the override note; background presets are deferred).
- Header: workspace menu (New, Open… list, Rename), Save, Share; Measure and Box select removed from the UI and from `ToolMode` where nothing else uses them (`selectionStore.toolMode` stays typed but the toolbar entries go); status bar trimmed.
- Delete `ViewerToolbar`, `SolarMenu`, `SceneThemeMenu`, `WeatherMenu`, `RenderingPanel`, `ViewModeToggle`, `ThemeToggleButton` and their CSS sections.

## Slice 12.6 — Verification (outline)

- Browser smokes for the nine acceptance scenarios at 1440×900 and 1280×720 (`scripts/smoke/ui-redesign.md` written as a script; screenshots attached to the review).
- `git diff main...develop | codex exec -m gpt-6-astra "Review …"`; resolve Critical and Important findings.
- `docs/architecture-notes.md`: decision record for the workspace store and the coordination invariants, the fit-on-first-layer rule, persistence v4; `docs/roadmap.md` 12 complete; `DESIGN.md` layout section updated; `docs/ui-redesign-handoff.md` marked implemented.

## Risks and open technical questions

- Per-object geodetic bounds for `Zoom to selection` (12.5) may need a plugin change; scope it early in 12.5.
- `Color by attribute` for vector layers depends on `geoLayerSync` painting per feature; verify before promising it in 12.3.
- Building-oriented rows need the flat table's parent column semantics; verify in `layerRows.ts` / `layerTables.ts` before 12.4.
- `useTheme` "system" mode must keep the OS-preference behaviour that the landing page relies on.

---

## Slice 12.2 — Shell and layer management (detailed)

Written 2026-09-06 after 12.1 landed (HEAD 6cc9e80). Read the approved design's "Shell layout", "Header (Workspace)", "Left panel (Layer)" and "Add layer dialog" sections before any task; they are the UI contract and are not repeated here.

Outcome: the new grid and regions exist with the NEW left panel and header, and the OLD inspector, table panel and scene menus still doing their jobs inside the new frame. A geo-only workspace enters the viewer. Rules move out of the inspector into the active layer's STYLE section (12.3 reshapes Style; 12.2 only relocates it).

Rulings that amend the outlines above:

- `ViewerToolbar` is replaced by `WorkspaceHeader` in THIS slice. Its pick-mode buttons, `ViewModeToggle`, `SceneThemeMenu`, `SolarMenu`, `WeatherMenu`, the rendering-settings gear and a new `Scene` popover holding `BasemapPanel` + `GoogleTilesPanel` mount inside the header's right group as a temporary "scene group" (one component, `src/ui/header/SceneControlsTemp.tsx`) until 12.5 moves them onto the map. 12.5 deletes `SceneControlsTemp` and those menus.
- The camera-fit producers: with a geo-only workspace reachable, the viewport no longer unmounts while geo rows exist, so the "geo rows outlive the scene" case from 12.1 disappears. The stream predicate gets its geo term back in workspace form (`useLayerStore.getState().layers.length === 1 && geo rows === 0`, i.e. only this stream's own row exists), and `App` fits the FIRST geo layer of an empty workspace explicitly (`fitBounds(resolveGeoLayerBounds(layer))`) right after adding it. A city layer joining a geo-first workspace does not fit (already true).
- Workspace name: `useWorkspaceStore` gains `name: string` (default `"Untitled workspace"`) and `setName`; Save writes it as the snapshot `label`; Restore sets it from the label; the header shows it. No new persistence field.
- Interface appearance: `useTheme` gains a preference `"system" | "light" | "dark"` (storage key stays `roofy-theme`; the stored value `"system"` or absent means follow `prefers-color-scheme`; the effective theme is what `data-theme` shows). The header's theme toggle goes; Preferences owns it.

Deferred or dropped by the 12.2 plan review (recorded in the design spec's Deferred section): workspace Duplicate / Delete and layer Duplicate (12.5's header polish, or dropped if unused); Preferences → Units and Reduce motion (dropped: metric only, reduced motion honoured by CSS); raster colormap (no engine support); streaming "Refresh visible" (12.5).

### Execution order for 12.2

**T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20 → T21 → T22 → T23 → T24** (12.2's tasks are numbered 13–24 so `task-brief` can address them), one at a time, each commit green. T14 (shell grid) mounts the OLD `LeftSidebar` and `InspectorPanel` inside the new grid so the app keeps working; T19 swaps in the new left panel; T23 deletes the old modules.

### File map for 12.2

- Create `src/ui/shell/shellStore.ts`, `src/ui/shell/ViewerShell.tsx`, `src/ui/shell/ResizeHandle.tsx`, `src/ui/shell/LeftRail.tsx`.
- Create `src/ui/header/WorkspaceHeader.tsx`, `src/ui/header/WorkspaceMenu.tsx`, `src/ui/header/PreferencesMenu.tsx`, `src/ui/header/SceneControlsTemp.tsx`.
- Create `src/features/layers/layerPresentation.ts`.
- Create `src/ui/layers/LayerList.tsx`, `src/ui/layers/LayerRow.tsx`, `src/ui/layers/LayerRowMenu.tsx`, `src/ui/layers/ActiveLayerPanel.tsx`, `src/ui/layers/StyleSection.tsx`, `src/ui/layers/FilterSection.tsx`, `src/ui/layers/DetailsSection.tsx`, `src/ui/sidebar/LeftPanel.tsx`.
- Modify `src/features/workspace/workspaceStore.ts` (name), `src/features/theme/useTheme.ts` (preference), `src/app/App.tsx` (shell, header, landing condition, geo-first fit, workspace name), `src/scene/NavaraViewport.tsx` (stream predicate geo term), `src/ui/inspector/InspectorPanel.tsx` (no Rules tab, no geo override, hidden when the selection is empty), `src/ui/table/TablePanel.tsx` (height/open from `shellStore`), `src/ui/layers/AddLayerDialog.tsx` + `SourcePicker.tsx` + `GeospatialSourceForm.tsx` (File / URL / Catalog with detection), `src/app/app.css` (new sections `VIEWER SHELL`, `HEADER`, `LEFT PANEL`, `LAYER LIST`, `ACTIVE LAYER`; old `TOOLBAR`, `LEFT SIDEBAR`, `LAYER PANEL`, `THEME TOGGLE`, `VIEW MODE TOGGLE (toolbar)` sections removed in T23).
- Delete (T23) `src/ui/toolbar/ViewerToolbar.tsx`, `src/ui/ThemeToggleButton.tsx`, `src/ui/sidebar/LeftSidebar.tsx`, `src/ui/layers/LayerPanel.tsx`, `src/ui/layers/GeoLayerRow.tsx`, `src/ui/inspector/GeoLayerInspector.tsx` (its style form moves into `StyleSection`), and their tests; `LodSelector`, `AppearanceSelector`, `LayerTypeToggles`, `StreamingLodControl`, `BasemapPanel`, `GoogleTilesPanel` are reused, not deleted.

### Task 13: shellStore and workspace name

**Review rulings (binding, 2026-09-06 plan review):** `ShellState` also carries `rightCollapsed: boolean` (default false) with `setRightCollapsed` / `toggleRightCollapsed` — collapsing the details panel is NOT clearing the selection. `openSections` is PER LAYER: `Readonly<Record<string, ReadonlyArray<PanelSection>>>`, default `["style"]` for an unknown layer id, `toggleSection(layerId, s)`. `requestedSection` is `{ layerId: string; section: PanelSection } | null`; `requestSection(layerId, section)` activates that layer (`activateLayer`), sets `leftCollapsed = false`, opens the section for that layer and stores the request; `ActiveLayerPanel` consumes it. Defaults come from the viewport: `defaultShellState(innerWidth, innerHeight)` — left 300 / right 340 (272 / 320 below 1360px), drawer 280 (220 below 800px tall); `clampDrawerHeight(px, innerHeight)` = `min(max(px, 160), min(800, innerHeight - 200))`, pure and tested. `workspaceStore` gains `resetName()`; "New workspace" calls it.

**Files:** create `src/ui/shell/shellStore.ts`; modify `src/features/workspace/workspaceStore.ts`; tests `tests/unit/ui/shell/shellStore.test.ts`, extend `tests/unit/features/workspace/workspaceStore.test.ts`.

**Interfaces (produces):**

```ts
// shellStore.ts — session-only UI state, never persisted
export type PanelSection = "style" | "filter" | "details";
export interface ShellState {
  readonly leftCollapsed: boolean;      // default false
  readonly leftWidth: number;           // default 300, clamped 240..420
  readonly rightWidth: number;          // default 340, clamped 280..480
  readonly drawerOpen: boolean;         // default false
  readonly drawerHeight: number;        // default 280, clamped 160..(viewport - 200) by the component, store clamps 160..800
  readonly drawerExpanded: boolean;     // default false
  readonly openSections: ReadonlyArray<PanelSection>;   // default ["style"]
  readonly requestedSection: PanelSection | null;       // set by the legend / "Edit in table" to open + scroll a section; consumed by ActiveLayerPanel
}
export interface ShellActions {
  setLeftCollapsed(v: boolean): void; toggleLeftCollapsed(): void;
  setLeftWidth(px: number): void; setRightWidth(px: number): void;
  openDrawer(): void; closeDrawer(): void; toggleDrawer(): void;
  setDrawerHeight(px: number): void; setDrawerExpanded(v: boolean): void;
  toggleSection(s: PanelSection): void; requestSection(s: PanelSection | null): void;
}
export const SHELL_LIMITS = { leftMin: 240, leftMax: 420, rightMin: 280, rightMax: 480, drawerMin: 160, drawerMax: 800 } as const;
export const useShellStore: ...;

// workspaceStore.ts additions
readonly name: string;                 // default "Untitled workspace"
setName(name: string): void;           // trims; empty → default
```

Tests: defaults; clamping at each limit; `toggleSection` adds/removes; `requestSection` opens the section too (`openSections` gains it); `setName("  ")` → default.

- [ ] Steps: failing tests → implement (plain `create<T>()`) → green → commit `feat(shell): shell store for panel, drawer and section state; workspace name`.

### Task 14: ViewerShell grid with the old regions inside

**Review rulings (binding):** the right column is `0` when `right === null || rightCollapsed`; when `rightCollapsed && right !== null` the shell renders a glass pill on the map's right edge (`Details · {rightTitle}`, prop `rightTitle: string`) that calls `setRightCollapsed(false)`; the right panel's left edge carries a `ResizeHandle` writing `setRightWidth`. `drawerExpanded` gets NO UI in this slice (12.4 adds Expand together with the attribution mirror; the map is never hidden in 12.2). `App` keeps rendering, as siblings after `<ViewerShell>` exactly as today: `UnavailableLayersBanner`, `ShareDialog`, the toast, `AddLayerDialog` / `StacBrowserDialog` portals; `RenderingPanel` stays inside the map slot; `TablePanel`'s mount/unmount `setTablePanelOpen` registration and its DuckDB props are unchanged. Tests assert real sizing (computed `--left-w`/`--right-w`/`--drawer-h` values), not only class names.

**Files:** create `src/ui/shell/ViewerShell.tsx`, `src/ui/shell/ResizeHandle.tsx`; modify `src/app/App.tsx` (viewer branch), `src/ui/table/TablePanel.tsx` (reads `drawerHeight`/`setDrawerHeight`/`closeDrawer` from `shellStore` instead of props; `onCollapse`/`onHeightChange` props removed), `src/app/app.css` (`VIEWER SHELL` section rewritten); tests `tests/unit/ui/shell/ViewerShell.test.tsx`, update `tests/unit/ui/table/TablePanel.test.tsx`, `tests/unit/app/*` for the removed `App` state.

**Interfaces (produces):**

```tsx
export interface ViewerShellProps {
  readonly header: ReactNode;
  readonly left: ReactNode; // full-height left panel (or rail when collapsed — the caller passes LeftRail)
  readonly map: ReactNode; // the viewport + its overlays
  readonly drawer: ReactNode | null; // null = closed; rendered under the map only
  readonly right: ReactNode | null; // null = no selection → column width 0
  readonly status: ReactNode;
}
export function ViewerShell(props: ViewerShellProps): ReactElement;
```

Grid (`.viewer-shell`): rows `var(--header-h) 1fr var(--statusbar-h)`; columns `var(--left-w) 1fr var(--right-w)`; areas `"header header header" "left map right" "status status status"`. The map cell is a column flex: `.map-column > .map-area { flex: 1 1 auto; min-height: 0 }` and `.map-column > .drawer-area { flex: 0 0 var(--drawer-h) }`; `.viewer-shell.drawer-expanded .map-area { display: none }` and the drawer takes the column. `--left-w` is `40px` when collapsed (the rail), `--right-w` is `0` when `right` is null. Widths come from `shellStore` as inline custom properties on the shell element. `ResizeHandle` is a vertical (or horizontal for the drawer) pointer-drag handle: `interface ResizeHandleProps { axis: "x" | "y"; onDelta(px: number): void; label: string }` (the old `LeftSidebar` handle logic moves here, with `setPointerCapture` guarded). Body `min-width: 1024px`.
Tests: renders the six regions in the right areas (class names); `right === null` sets `--right-w: 0`; collapsed left sets `--left-w: 40px`; `drawerExpanded` hides the map area.

- [ ] Steps: failing tests → implement → `App` viewer branch returns `<ViewerShell header={<ViewerToolbar …/>} left={<LeftSidebar …/>} map={viewport + overlays} drawer={drawerOpen ? <TablePanel …/> : null} right={selections.length > 0 || geoSelection ? <InspectorPanel …/> : null} status={<StatusBar …/>}/>` (the inspector-open toggle and `inspectorOpen` state are removed: the right column follows the selection) → suite green → commit `feat(shell): grid with the drawer under the map column and a selection-driven right column`.

### Task 15: WorkspaceHeader, menus, Preferences, theme preference

**Review rulings (binding):** the theme preference becomes a store, `src/features/theme/themeStore.ts` (`preference: ThemePreference`, `theme: Theme` effective, `setPreference`; `installThemeListener()` installed once by `App` subscribes to `matchMedia("(prefers-color-scheme: dark)")` and writes `document.documentElement.dataset.theme` — the effective theme is ALWAYS stamped, "system" only means it follows the OS; storage key stays `roofy-theme` and legacy stored values `"dark"`/`"light"` read as explicit preferences); `useTheme()` becomes a thin selector hook. The landing page's `ThemeToggleButton` is replaced by the same `PreferencesMenu` and `ThemeToggleButton` + its test are deleted in THIS task. Tests: OS change while System updates the stamp; an explicit override ignores OS changes; legacy stored values; landing → viewer keeps the theme. `onSave(): Promise<boolean>` — "Saved · just now" shows only on `true`; New workspace resets the workspace name; the name button truncates with an ellipsis at `max-width: 240px`; `SceneControlsTemp` is icon-only with tooltips; the header also carries the right-collapse button (`Collapse details panel` / `Expand details panel`, disabled when there is no selection).

**Files:** create `src/ui/header/{WorkspaceHeader,WorkspaceMenu,PreferencesMenu,SceneControlsTemp}.tsx`; modify `src/features/theme/useTheme.ts`, `src/app/App.tsx` (header mount; Save uses the workspace name as label; Restore sets the name; "New workspace" = `handleClose`; "Open…" lists snapshots via the existing `persistenceStore.list()` and calls `handleRestore(id)`), `src/app/app.css` (`HEADER` section); tests `tests/unit/ui/header/*.test.tsx`, `tests/unit/features/theme/useTheme.test.ts`, update `tests/unit/ui/viewerToolbar.test.tsx` → moved to `tests/unit/ui/header/WorkspaceHeader.test.tsx`.

**Interfaces:**

```tsx
export interface WorkspaceHeaderProps {
  readonly onSave(): void; readonly onShare(): void; readonly canShare: boolean;
  readonly onNewWorkspace(): void; readonly onOpenWorkspace(id: string): void;
  readonly snapshots: ReadonlyArray<SnapshotSummary>;
  readonly sceneControls: ReactNode;   // <SceneControlsTemp …/> until 12.5
}
// useTheme
export type ThemePreference = "system" | "light" | "dark";
export function useTheme(): { theme: Theme; preference: ThemePreference; setPreference(p: ThemePreference): void };
```

Header anatomy (left → right): `RoofyLockup`, the workspace name button (`WorkspaceMenu`: Rename inline, New workspace, Open… submenu of snapshots with date, Save), the left-collapse button (`aria-label="Collapse layers panel"` / "Expand layers panel"), spacer, `sceneControls`, Save (ghost, icon + text; after a save shows "Saved · just now" muted for 5 s), Share, Preferences (gear → `PreferencesMenu` popover: INTERFACE APPEARANCE segmented System / Light / Dark). Menus follow the existing popover pattern (`SolarMenu`'s open state + outside-click close) and the "Menu" shadow from DESIGN.md. No theme toggle button anywhere else.
`SceneControlsTemp`: the pick-mode pair (Feature / Surface with the existing `PickMode` icons; Measure and Box select are NOT rendered any more), `ViewModeToggle`, `SceneThemeMenu`, `SolarMenu`, `WeatherMenu`, the rendering gear, and a `Scene` popover button hosting `BasemapPanel` + `GoogleTilesPanel`. Marked with a `data-temporary="12.5"` attribute and a comment.
Tests: header renders name, Save/Share/Preferences; Preferences sets `data-theme` for light/dark and clears the override for system (mock `matchMedia`); New workspace calls the prop; Rename writes `workspaceStore.name`; Save label = name (App test: `persistenceStore.save` receives `label === name`).

- [ ] Steps: failing tests → implement → suite → commit `feat(header): workspace header with menu, Save, Share and Preferences; interface appearance follows the system by default`.

### Task 16: layerPresentation (pure)

**Review rulings (binding):** `LayerStateInput` gains `counts?: { readonly buildings: number; readonly objects: number }` where `buildings` counts ROOT `Building` objects (BuildingParts excluded — use the model's parent links / `toplevelCityObjectType` from `@cityjson/navara-core`) and `objects` counts root objects of every type; the line reads "1,204 buildings · LoD 2.2" when every root object is a Building, else "2,231 objects · LoD 2.2". Streaming reads "Streaming · 1,240 currently loaded" (the words "currently loaded" are mandatory). Loading / error / unavailable rows get their inputs from T17's row sources; `layerStateLine` only formats.

**Files:** create `src/features/layers/layerPresentation.ts`; test `tests/unit/features/layers/layerPresentation.test.ts`.

```ts
export type LayerKind = "city" | "streaming" | "vector" | "raster" | "tiles";
export function layerKindOf(item: ActiveLayer): LayerKind; // city Layer → isStreaming ? "streaming" : "city"; geo by kind: geojson → vector, raster-xyz → raster, 3d-tiles → tiles
export interface LayerStateInput {
  readonly kind: LayerKind;
  readonly objectCount?: number; // static city: Object.keys(model.objects).length
  readonly lod?: string | null; // static city: selectedLod
  readonly residentCount?: number; // streaming: getResidentModel().featureCount
  readonly streamStatus?: StreamStatus; // streaming
  readonly featureCount?: number; // vector: features.length when data is inline
  readonly error?: string | null; // any: the load/parse error message
  readonly unavailable?: boolean; // restored placeholder awaiting a re-link
}
export function layerStateLine(input: LayerStateInput): string;
// examples: "1,204 buildings · LoD 2.2" (objects are counted as "objects" when the model has non-building types: "2,231 objects · LoD 2.2"), "Streaming · 1,240 loaded", "Streaming · fetching…", "6 features", "Raster", "3D Tiles", "Error · could not parse", "Needs re-link"
export function pluralize(n: number, unit: string): string; // "1 building", "2 buildings"; uses Intl.NumberFormat("en-GB")-style grouping via the existing `formatCount` in src/ui/table/tableText.ts if importable without pulling UI, else a local formatter
```

Tests: one per example line; `layerKindOf` for all five kinds.

- [ ] Steps: failing tests → implement → commit `feat(layers): one presentation function for a layer's kind and state line`.

### Task 17: LayerList and LayerRow

**Review rulings (binding):** the list renders three extra non-activatable row kinds besides store rows: (a) unavailable placeholders from `App`'s `unavailableLayers` (prop `extraRows`), state "Needs re-link", action `Re-link` (calls the existing `handleResolveUnavailableLayer` path) and `Dismiss`; (b) loading rows — `useLayerFileLoader` gains `pending: ReadonlyArray<{ id: string; name: string }>` (one entry per in-flight add), state "Loading…"; (c) error rows — the loader gains `failed: ReadonlyArray<{ id: string; name: string; message: string; retry(): void }>`, state "Error · <message>", actions `Retry` and `Dismiss` (`dismissFailed(id)`). A failed add therefore always leaves a visible row (design scenario 9). Tests for each row kind and for "an error row is not activatable".

**Files:** create `src/ui/layers/{LayerList,LayerRow,LayerRowMenu}.tsx`; `src/app/app.css` (`LAYER LIST` section); tests `tests/unit/ui/layers/{LayerList,LayerRow}.test.tsx`.

```tsx
export interface LayerListProps { readonly onZoomToLayer(item: ActiveLayer): void; readonly onOpenTable(layerId: string): void; }
export function LayerList(props): ReactElement;   // rows in unifiedLayerOrder; reads both stores + workspace active id
export interface LayerRowProps {
  readonly item: ActiveLayer; readonly active: boolean; readonly stateLine: string; readonly kind: LayerKind;
  readonly filterChip: ReactNode | null;   // 12.4 fills; null now
  readonly onActivate(): void; readonly onToggleVisible(): void; readonly onRename(name: string): void;
  readonly onZoom(): void; readonly onOpenTable: (() => void) | null; readonly onRemove(): void;
}
```

Row anatomy per the design (eye button, type icon by `LayerKind`, name, state line under it, the chip slot at the end of the state line, an overflow `⋯` button opening `LayerRowMenu`: Zoom to layer, Open table (city kinds only), Rename, Remove). Row click (not on a button) → `activateLayer(id)`. Double-click the name → inline rename input (Enter commits, Escape cancels) — keep the existing behaviour. Hidden rows at 55% opacity. Remove: city → `closeStreamingLayer(getStreamPlugin(), id)` then `removeLayer(id)`; geo → `removeGeoLayer(id)`. The list has `role="list"`, rows `role="listitem"` with `aria-current="true"` on the active one. Keyboard: rows are focusable (`tabIndex=0`), Enter activates.
Tests: renders city, streaming, vector, raster rows with the right state lines; click activates (workspace store); eye toggles `visible`; menu Remove removes; Open table absent on a vector row; `aria-current` on the active row.

- [ ] Steps: failing tests → implement → commit `feat(layers): one layer list for every layer kind`.

### Task 18: ActiveLayerPanel with Style (relocated rules), Filter (summary) and Details

**Review rulings (binding):** this task moves `src/ui/inspector/RuleBuilderTab.tsx` to `src/ui/layers/RulesEditor.tsx` AND updates `InspectorPanel`'s import (and the moved test's imports/mocks) in the SAME commit — the inspector keeps its Rules tab until T20 so every commit compiles. Per-layer `openSections` and the `{ layerId, section }` request (T13) are consumed here: on mount and whenever `requestedSection.layerId` is the active layer, open the section, `scrollIntoView`, then `requestSection(null)`. Vector style is the EXISTING model only — one `color`, `fillOpacity`, `lineWidthPx`, `pointSizePx` (no separate stroke colour); raster → opacity only (a colormap is deferred, no engine support); tiles → "No style options". Details gains an Extent row (from `model.metadata.geographicalExtent` when present, else the model bbox, formatted with the CRS) and labels the reused control "Streaming level of detail (applies to every streaming layer)" because it is global. Streaming subscriptions stay inside the components that need them (render-cost split).

**Files:** create `src/ui/layers/{ActiveLayerPanel,StyleSection,FilterSection,DetailsSection}.tsx`; `src/app/app.css` (`ACTIVE LAYER` section); modify `src/ui/inspector/RuleBuilderTab.tsx` → renamed/moved to `src/ui/layers/RulesEditor.tsx` (same content, no tab chrome; props `{ model: CityModel; layerId: string }` unchanged) with its test moved; tests `tests/unit/ui/layers/{ActiveLayerPanel,StyleSection,FilterSection,DetailsSection}.test.tsx`.

- `ActiveLayerPanel` reads `useActiveLayer()`; when null renders nothing. Title = name (Outfit 500 16px), kind line (`"City model · CityJSON 2.0"` from `modelRef`/`detectEncoding`, `"Streaming city model · FlatCityBuf"`, `"Vector layer · GeoJSON"`, `"Raster layer"`, `"3D Tiles"`), action row: `Zoom to layer` (ghost) and, for city kinds, `Open table` / `Close table` (ghost, from `shellStore.drawerOpen`). Three disclosures driven by `shellStore.openSections`; `requestedSection` opens + `scrollIntoView` + clears itself.
- `StyleSection`: city → `<RulesEditor model layerId/>` (streaming passes the resident model as `RuleBuilderTab` did); geo vector → the fill/stroke/opacity form from `GeoLayerInspector` (moved here); raster → opacity slider; tiles → a muted "No style options" line.
- `FilterSection`: reads `layerQuery(useQueryStore.getState(), id).applied` (subscribe via the hook); when null → muted "No filter. Filters apply to the map and the table together." (streaming: "…Table only — map filtering for streaming layers is not available yet."); when set → the conditions rendered in mono via the existing `valueText`/`OP_LABELS` from `tableText.ts`, buttons `Edit in table` (opens the drawer and `requestSection(null)`; 12.4 focuses the filter bar) and `Clear filter` (`useQueryStore.clearFilter(id)` + `clearMapFilter(id)`). Raster/tiles → "This layer cannot be filtered."
- `DetailsSection`: definition rows Source (file name or URL, truncated middle), Format, CRS (`epsgOf` from `TablePanel` moved into `layerPresentation.ts` as `crsLabel`), Objects (counts by type from `availableObjectTypes` + `model.objects`, streaming from `useStreamStore.types`), then `<LodSelector/>`, `<AppearanceSelector/>`, `<LayerTypeToggles/>`, and for streaming `<StreamingLodControl/>` + the camera-sync toggle (SYNC / FROZEN from `LayerPanel`) + the resident-cache line with its tooltip; a `Metadata` disclosure with `JSON.stringify(model.metadata, null, 2)` in a `<pre>`.
  Tests: each section for city / streaming / vector / raster; FilterSection with and without an applied filter; Details shows LoD selector for static and streaming control for streaming; `requestedSection` opens and clears.

- [ ] Steps: failing tests → implement → commit `feat(layers): the active layer's Style, Filter and Details under the list; rules leave the inspector`.

### Task 19: LeftPanel + LeftRail replace LeftSidebar/LayerPanel

**Files:** create `src/ui/sidebar/LeftPanel.tsx`, `src/ui/shell/LeftRail.tsx`; modify `src/app/App.tsx` (mount; `onZoomToLayer` → `fitLayer` / `handleFlyToGeoLayer`; `onOpenTable` → `shellStore.openDrawer` + `activateLayer`); `src/app/app.css` (`LEFT PANEL` section); tests `tests/unit/ui/sidebar/LeftPanel.test.tsx`, `tests/unit/ui/shell/LeftRail.test.tsx`.
`LeftPanel`: "LAYERS" mono label + ghost `+ Add layer` (opens `AddLayerDialog`), `<LayerList/>`, hairline, `<ActiveLayerPanel/>` in its own scroll container; the right-edge `ResizeHandle` writing `setLeftWidth`. `LeftRail` (40px): a `Layers` icon button with the layer-count badge that expands the panel, and the active layer's kind icon. Empty list state: "No layers yet" + the Add layer button.
Tests: renders list + active panel; rail expands; Add layer opens the dialog.

- [ ] Steps: failing tests → implement → suite → commit `feat(shell): left panel with the layer list and the active layer's configuration; rail when collapsed`.

### Task 20: Inspector trimmed to the selection

**Files:** modify `src/ui/inspector/InspectorPanel.tsx` (delete the Rules tab and `RuleBuilderTab` import, the geo-override branch, the `activeTab === "rules"` paths; the panel renders selection content only; `onClose` = `useSelectionStore.clear`), `src/app/App.tsx` (right region null when no selection — done in T14; the geo feature selection renders `GeoFeatureDetailsTemp` = the old `GeoAttributes` list from the deleted overlay recreated minimally inside the inspector as a `Feature` tab until 12.3), tests `tests/unit/ui/inspector/InspectorPanel.test.tsx`.
Tests: no "Rules" tab; a geo selection shows the feature's properties; empty selection → App renders no inspector.

- [ ] Steps: failing tests → implement → commit `refactor(inspector): selection only — rules and layer style live under the layer`.

### Task 21: Add layer dialog — File / URL / Catalog with detection

**Review rulings (binding):** the correction must reach the loader. Contract: `onAddFile(file: File, override?: DetectedSource)`, `onAddFiles(files, override?)`, `onAddUrl(url: string, override?: DetectedSource)`; `useLayerFileLoader`'s existing `LayerOverrides` gains `encoding?: CityModelEncoding` and every branch that today calls `detectEncoding` / `isCityParquetUrl` on the name honours the override first; the geo path calls `geoLayerFromUrl(url, { kind: override.geoKind })` (extend its signature) instead of reclassifying. End-to-end tests: a URL ending `.json` overridden to FlatCityBuf takes the streaming route (`openStreamingLayer` called); a `.txt` URL overridden to GeoJSON calls `addGeoLayer` with `kind: "geojson"`; a `.city.json` file with no override still routes as CityJSON.

**Files:** modify `src/ui/layers/AddLayerDialog.tsx` (`SourceTab = "file" | "url" | "catalog"`), `src/ui/layers/SourcePicker.tsx` (split: the drop zone + Browse/Choose folder stays for the file tab; the URL form becomes `src/ui/layers/UrlSourceForm.tsx`), `src/ui/layers/GeospatialSourceForm.tsx` (its URL kinds fold into `UrlSourceForm` through detection; its name field stays), create `src/features/layers/detectSource.ts`:

```ts
export type DetectedSource =
  | {
      readonly kind: "city";
      readonly encoding: CityModelEncoding;
      readonly label: string;
    } // "CityJSON", "CityJSONSeq", "FlatCityBuf · streams as the camera moves", "CityParquet", "CityGML (zip)"
  | {
      readonly kind: "geo";
      readonly geoKind: GeoLayerKind;
      readonly label: string;
    } // "GeoJSON", "XYZ raster tiles", "3D Tiles"
  | { readonly kind: "unknown"; readonly label: "Unknown format" };
export function detectSourceFromName(nameOrUrl: string): DetectedSource; // composes detectEncoding, classifyCityParquetUrl, classifyGeoUrl
export const SOURCE_OVERRIDES: ReadonlyArray<DetectedSource>; // the options for "Change…"
```

Dialog: tabs File | URL | Catalog; the File tab shows the drop zone; after a file is chosen or dropped (do not add yet) show `Detected: <label> [Change…]` and the filled `Add layer` button; URL tab: input + `Detect` (on blur / Enter) → same line; Catalog tab: `StacBrowser` unchanged. `Add layer` routes by the (possibly overridden) detection: city → the existing `onAddFile` / `onAddUrl`; geo → `addGeoLayer` through `geoLayerFromUrl` / `parseGeoJsonText`. A geo add returns to the viewer (T22). Tests: `detectSourceFromName` for every extension; the dialog shows the detection line and the override select; adding a `.geojson` URL calls `addGeoLayer`.

- [ ] Steps: failing tests → implement → commit `feat(layers): one Add layer dialog — File, URL, Catalog — with format detection and a correction control`.

### Task 22: Geo-only workspaces enter the viewer; fit producers revisited

**Review rulings (binding):** ONE authoritative predicate for both fit producers — workspace ROWS, not live registries. Stream: fit iff `useLayerStore.getState().layers.length === 1 && layers[0].id === <this stream's layer id> && useGeoLayerStore.getState().layers.length === 0` at registration (the stream's own row already exists then; any other city row — registered or not — means the workspace was not empty). Static: unchanged (`previousLayerCountRef` over rows). Tests: a stream joining an existing-but-not-yet-registered static row does not fit; geo-first then static does not fit; static-first then stream does not fit; the first stream of an empty workspace fits once; Task 6's "geo rows outlived the last scene" test is deleted with a comment (the viewport no longer unmounts while geo rows exist). First-geo fit: an `App` effect keyed on `unifiedLayerOrder(...).length` going 0 → 1 with a geo layer, running only when `!isAutoFitSuppressed()`; it awaits the scene handle (`awaitSceneHandle`), re-checks that the layer is still in the store (else cancels), and calls `fitBounds(bounds)` when `resolveGeoLayerBounds(layer)` returns bounds. Read the bounds helper first (it lives with `handleFlyToGeoLayer` in `App.tsx` / `src/scene/geoLayerSync.ts`) and state in the report what it returns for inline GeoJSON (bounds), URL GeoJSON before its fetch (none → no fit; acceptable, documented), raster and tiles (none → no fit). Restore keeps its saved camera (suppression covers the effect). Tests: inline geo fits once; raster does not fit; removal before `ready` cancels; a restore does not fit.

**Files:** modify `src/app/App.tsx` (`hasWorkspace = layers.length > 0 || geoLayers.length > 0`; the viewer branch condition `hasWorkspace || engineBooting`; on `addGeoLayer` from the dialog or the landing page, when the unified order had length 0 before the add → `sceneRef.current?.fitBounds(resolveGeoLayerBounds(layer))` once the scene is ready via `applyCameraWhenReady`-style gating), `src/scene/NavaraViewport.tsx` (stream predicate: `workspaceWasEmpty = streams.size === 0 && liveRef.current.size === 0 && useGeoLayerStore.getState().layers.length === 0` — the geo term returns because the viewport no longer unmounts while geo rows exist; update the comment and the Task 6 test "fits the first stream of a scene even when geo rows outlived the last one" → replaced by "does not fit when a stream joins a geo-only workspace"), the landing page's `SourcePicker` gets the same detection so a dropped `.geojson` enters the viewer; tests `tests/unit/app/appGeoOnly.test.tsx` (a GeoJSON add from the landing page shows the viewer with the geo row active and fits once; adding a city layer afterwards does not fit), update `tests/unit/scene/navaraViewportStreaming.test.tsx`.

- [ ] Steps: failing tests → implement → commit `feat(app): a geospatial-only workspace enters the viewer; the first content of a scene fits once, whatever its kind`.

### Task 23: Delete the old shell modules and CSS

**Review rulings (binding):** delete CSS BY SURVIVING CONSUMER, not by section banner: keep `ViewModeToggle`'s rules, the `.tb-btn` family used by `SceneControlsTemp`, the geo style rules now used by `StyleSection` (move them under `ACTIVE LAYER`), `.layer-type-toggles`; `ThemeToggleButton` is already gone (T15). For every deleted selector, grep `src` for its consumers first and list the audit in the report. T24 checks each temporary popover visually in both themes.

**Files:** delete `src/ui/toolbar/ViewerToolbar.tsx`, `src/ui/ThemeToggleButton.tsx`, `src/ui/sidebar/LeftSidebar.tsx`, `src/ui/layers/LayerPanel.tsx`, `src/ui/layers/GeoLayerRow.tsx`, `src/ui/inspector/GeoLayerInspector.tsx` and their tests; remove the CSS sections `TOOLBAR`, `TOOL RAIL`, `LEFT SIDEBAR`, `LAYER PANEL` (keep the `.layer-type-toggles` rules used by `LayerTypeToggles`; move them under `ACTIVE LAYER`), `THEME TOGGLE`, `PICK MODE TOGGLE` (if `SceneControlsTemp` has its own), `INSPECTOR PANEL` rules for the removed tabs; gate `grep -rn "left-sidebar\|layer-item\|tb-btn\|theme-toggle" src` returns only what `SceneControlsTemp` still uses (list them in the report). Tests green; `npx vp check` clean.

- [ ] Steps: delete → fix references → suite → commit `refactor(shell): remove the old toolbar, sidebar and layer panel`.

### Task 24: Slice gate

**Review rulings (binding):** the smoke also covers: the header at 1280px with a 60-character workspace name (ellipsis, no overflow); every temporary popover (`SceneControlsTemp`) in both themes; right panel collapse → pill → expand with the selection preserved; a failed URL add showing an error row with Retry; Escape clearing the selection versus the collapse button keeping it.

- [ ] `npx vp check src tests`, `npx tsc -b --noEmit`, `npx vitest run`, submodule `pnpm typecheck` + `pnpm vitest run` unchanged.
- [ ] Browser smoke (Delft + a GeoJSON URL) at 1440×900 and 1280×720: layer rows for both kinds; row click activates without moving the camera; Open table opens the drawer UNDER the map with the left panel still full height; collapse both panels (right collapses with Escape/clear); resize the left panel; Add layer dialog detection line for `.fcb`, `.geojson`, `.city.json`; geo-only workspace from the landing page enters the viewer and fits; Preferences switches appearance; Save → New workspace → Open… restores with the name.
- [ ] Docs: `docs/roadmap.md` 12.2 complete; `docs/architecture-notes.md` records the shell store and the "viewer whenever any layer exists" rule; `DESIGN.md` Layout section rewritten for the new grid (the other session's untracked copy is left alone — edit only if it is tracked by then; otherwise record the layout in the design spec's "Shell layout" section, which is tracked). Push.
