# UI Redesign (Milestone 12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the viewer shell around one active layer and one shared selection: a unified layer list with the active layer's Style / Filter / Details under it, a details panel that exists only while something is selected, a data drawer under the map that follows the active layer, and scene controls on the map.

**Architecture:** The stores keep their split (layer, geo-layer, selection, query, stream) and gain one small workspace store that owns the single `activeLayerId` for both layer kinds, plus a coordination module that enforces the cross-store rules (activate clears a foreign selection, a pick activates its owner, hide/remove/filter clear the selection). The React shell is rebuilt region by region (header, left panel, map overlays, details panel, drawer) as new modules under `src/ui/*`, and the old modules are deleted in the slice that replaces them. Engine bindings (`NavaraViewport`, `handleSync`, plugins) change only where the design needs a new capability (no fit-all on add, camera-cluster methods on the handle, per-object bounds).

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
- Persistence: schema v4; v3 migrates; v1/v2 keep the explicit unsupported-version error. No silent data loss.
- Desktop-first: verify at 1440×900 and 1280×720 in the real browser (`scripts/smoke/driver.mjs` or `agent-browser` with a hand-launched Chromium, see `host-tooling-quirks`).

## Slices

| Slice | Title                                                           | Depends on                    | Detailed tasks          |
| ----- | --------------------------------------------------------------- | ----------------------------- | ----------------------- |
| 12.1  | Shared context: one active layer, one selection, v4 persistence | —                             | in this document        |
| 12.2  | Shell and layer management                                      | 12.1                          | written when 12.1 lands |
| 12.3  | Styling and inspection                                          | 12.2                          | written when 12.2 lands |
| 12.4  | Linked data and filtering                                       | 12.2 (12.3 for legend counts) | written when 12.3 lands |
| 12.5  | Scene controls and remaining capabilities                       | 12.2                          | written when 12.4 lands |
| 12.6  | Verification, review, docs                                      | all                           | written when 12.5 lands |

Each later slice gets its own task-level section appended to this document (same format as 12.1) immediately before it starts, written against the code as it then exists. The slice outlines below fix the scope, the module boundaries and the interfaces so that 12.1 does not paint later slices into a corner.

---

## Slice 12.1 — Shared context (detailed)

Outcome: the app behaves by the design's interaction rules 1, 2, 4 and 5 with the OLD panels still on screen. Nothing visual changes except the removals. Every existing test still passes or is rewritten for the new rule.

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

(If `zustand/react/shallow` is not available in the pinned Zustand, select the id and the array separately and `find` in the hook body.)

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

- [ ] **Step 4: Run the whole suite; fix every compile error by switching the caller to `useWorkspaceStore` / `useActiveLayer` (Task 4 finishes this properly; here only make it compile)**

Run: `npx tsc -b --noEmit && npx vitest run`
Expected: type check clean; tests that assert old behaviour (first-add seeds active, removal picks the last) fail — they are rewritten in Task 3 and Task 4.

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
  /** Rule 1: sets the active layer; clears the selection first when it belongs to another layer. Never moves the camera. */
  export function activateLayer(id: string | null): void;
  /** Rule 4: next in unified order after the removed one, else the previous, else null. */
  export function nextActiveAfterRemoval(
    order: ReadonlyArray<string>,
    removedId: string,
    removedIndex: number,
  ): string | null;
  /** Subscribes to the layer, geo-layer and selection stores and enforces: first layer becomes active; a removed active layer hands over per nextActiveAfterRemoval; a selection whose owner is removed or hidden is cleared; a selection activates its owner. Returns a disposer. Idempotent: a second call disposes the first. */
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

// Reuse the `layer()` factory pattern from tests/unit/features/layers/layerStore.test.ts
// (a minimal CityModel with one object) — copy it here rather than importing across test files.

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

Add to `selectionStore.test.ts`:

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

export function activateLayer(id: string | null): void {
  const owner = selectionLayerId(useSelectionStore.getState());
  if (owner !== null && owner !== id) useSelectionStore.getState().clear();
  useWorkspaceStore.getState().setActiveLayerId(id);
}

export function nextActiveAfterRemoval(
  order: ReadonlyArray<string>,
  removedId: string,
  removedIndex: number,
): string | null {
  const remaining = order.filter((id) => id !== removedId);
  if (remaining.length === 0) return null;
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
  disposeInstalled = () => {
    unsubs.forEach((u) => u());
    disposeInstalled = null;
  };
  return disposeInstalled;
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

### Task 4: Wire the shell to the workspace store and remove the duplicate paths

**Files:**

- Modify: `src/app/App.tsx` (:247, :276-279, :500-510, :649, :694, :1309; install the invariants in the mount effect next to the DuckDB boot; `handleClose` :1163-1181 sets `activateLayer(null)` instead of `setActiveGeoLayer(null)`)
- Modify: `src/ui/layers/LayerPanel.tsx:75, :122, :128-133` → `useWorkspaceStore` + `activateLayer(layer.id)`
- Modify: `src/ui/layers/GeoLayerRow.tsx:43-46` → same
- Modify: `src/ui/inspector/InspectorPanel.tsx:129-162, :287, :334-338` → `displayLayer` is the active city layer or the selection's layer (no `?? layers[0]`); the geo branch renders when the active layer is geo; delete `ruleTargetOverride`; `RuleBuilderTab` gets only `{ model, layerId }`
- Modify: `src/ui/inspector/RuleBuilderTab.tsx:31-36, :125-137` → delete `layerOptions`, `onSelectLayer` and the `<select>`; the tab title reads "Rules · <layer name>"
- Modify: `src/ui/table/TablePanel.tsx:53-55, :63-64, :96-131, :179-186` → layer from `useActiveCityLayer()`; delete `syncSelection`, `tableSelection` and the checkbox; row click always writes the global selection
- Modify: `src/ui/StatusBar.tsx:50-51, :63-75` → delete the table toggle and its props; active layer from `useActiveCityLayer()`
- Modify: `src/ui/layers/LayerPanel.tsx` → add an `Open table` / `Close table` ghost button on the ACTIVE city row's actions (props `tableOpen`, `onToggleTable` threaded from `App` through `LeftSidebar`), so the table stays reachable until 12.2 builds the action row
- Tests: `tests/unit/ui/layers/LayerPanelSections.test.tsx`, `tests/unit/ui/inspector/InspectorPanel.test.tsx`, `tests/unit/ui/inspector/RuleBuilderTab.test.tsx`, `tests/unit/ui/inspector/GeoLayerInspector.test.tsx`, `tests/unit/ui/table/TablePanel.test.tsx`, `tests/unit/ui/StatusBar.test.tsx` (create if absent), `tests/unit/app/appEngineBoot.test.tsx`

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
- Modify: `src/app/App.tsx:1270-1300, :1366-1370` (the `selectedObjects` / `geoFeature` resolution and the mount), `src/app/app.css` sections `ATTRIBUTE PANEL` (:2965) and `AGGREGATION MODE SELECT` (:3136)
- Test: `tests/unit/app/appEngineBoot.test.tsx` — add "a selection renders exactly one attribute table" (query by the inspector's heading; assert `screen.queryByText(/inherited from/i)` from the overlay is absent)

- [ ] Steps: failing app test → delete the module, its mount and CSS → `npx vp check` (dead-class check: `grep -n "attribute-panel\|agg-mode" src` returns nothing) → suite green → commit `refactor(inspector): the details panel is the one attribute view; floating overlay removed`.

### Task 6: No fit-all flight on every added layer

**Files:**

- Modify: `src/scene/NavaraViewport.tsx:2380` → `if (before === 0 && liveRef.current.size > 0) setFitToken((t) => t + 1);`
- Test: `tests/unit/scene/navaraViewport.test.tsx` — the existing auto-fit case becomes two: "fits when the first layer lands" and "does not fit when a second layer lands"; the suppression case stays.

- [ ] Steps: failing test → one-line change and comment update → green → commit `fix(viewport): only the first layer of an empty workspace fits the camera`.

### Task 7: Persistence v4 with a v3 migration

**Files:**

- Modify: `src/persistence/types.ts:383, :385-404` — `SNAPSHOT_VERSION = "4"`; add
  ```ts
  /** v4: which layer was active, by position in the unified list (city layers first, then geo). Absent = the first layer. */
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
- Modify: `src/persistence/restoreSnapshot.ts:22-24` → call `migrateSnapshot`; throw the error outcome; return `viewState` and, additionally, `activeLayer` (change the return type to `{ viewState: ViewState; activeLayer: ProjectSnapshot["activeLayer"] }` and update the two callers in `App.tsx`)
- Modify: `src/persistence/captureSnapshot.ts:20-37, :39` — `CaptureInput` gains `activeLayer?: { kind; index }`; written when defined
- Modify: `src/app/App.tsx` `handleSave` :627-668 (compute `activeLayer` from `useWorkspaceStore` + `unifiedLayerOrder`), `handleRestore` :696-925 (after the per-layer loop, map `activeLayer.index` onto the ids actually added — unavailable placeholders are skipped — and call `activateLayer(id)`; when the index does not resolve, activate the first added layer), `readShareHash` path unchanged (share stays v3; add a comment saying why)
- Tests: `tests/unit/persistence/snapshotV4.test.ts` (new: round trip with `activeLayer`; v3 document migrates with `migratedFrom: "3"`; v2 is rejected with `UnsupportedSnapshotVersionError`), update `tests/unit/persistence/{snapshotV3,captureRestore}.test.ts` for the version string, `tests/unit/app/appRestoreShare.test.tsx` — "restore activates the saved layer" and "a v3 snapshot restores with the first layer active".

- [ ] Steps: failing tests → implement → `npx vitest run tests/unit/persistence tests/unit/app` → suite → commit `feat(persistence): snapshot v4 records the active layer; v3 migrates, v1/v2 stay unsupported`.

### Task 8: Slice gate

- [ ] `npx vp check && npx tsc -b --noEmit && npx vp test run` green; `cd packages/cityjson-navara-plugins && pnpm typecheck && pnpm vitest run` unchanged.
- [ ] Browser smoke on Delft: pick a building → one attribute view; open the table from the layer row → row click selects in the viewport; add a second layer (any GeoJSON URL) → the camera does not move; save, reload, restore → the saved layer is active.
- [ ] `docs/roadmap.md` 12.1 marked complete with the commit range; push.

---

## Slice 12.2 — Shell and layer management (outline)

Scope: the new grid and regions with the OLD contents where the new ones do not exist yet.

- New modules: `src/ui/shell/ViewerShell.tsx` (grid: `header / left | map-column | right / status`; map column = viewport + drawer; right column width `0` when there is no selection; props for collapse and widths), `src/ui/shell/shellStore.ts` (`leftCollapsed`, `rightCollapsed`, `leftWidth`, `rightWidth`, `drawer: { open, height, expanded }` — replaces `App`'s `inspectorOpen`, `leftSidebarCollapsed`, `leftSidebarWidth`, `tableOpen`, `tableHeight`), `src/ui/header/WorkspaceHeader.tsx` (lockup, workspace menu, Save, Share, Preferences, collapse buttons; replaces `ViewerToolbar`), `src/ui/header/PreferencesMenu.tsx` (Interface appearance: System / Light / Dark — `useTheme` gains `"system"`), `src/ui/layers/LayerList.tsx` + `LayerRow.tsx` (one row component for `ActiveLayer`-shaped items: eye, type icon, name, state line, chips, overflow menu with Zoom to layer / Open table / Rename / Remove), `src/ui/layers/LeftRail.tsx` (collapsed state), `src/ui/layers/ActiveLayerPanel.tsx` with `StyleSection.tsx`, `FilterSection.tsx`, `DetailsSection.tsx` (Details absorbs `LodSelector`, `AppearanceSelector`, `LayerTypeToggles`, `StreamingLodControl`, the resident-cache tooltip, metadata), `src/features/layers/layerPresentation.ts` (`layerStateLine(layer, stream?, table?)`, `layerTypeOf(active): "city" | "streaming" | "vector" | "raster" | "tiles"`).
- `AddLayerDialog` reworked: tabs File / URL / Catalog; detection line from `detectEncoding` / `classifyCityParquetUrl` / `classifyGeoUrl` with a `Change…` select that overrides the route; a GeoJSON-only add enters the viewer (the landing branch condition becomes `hasLayers || hasGeoLayers || engineBooting`).
- Deleted at the end of the slice: `ViewerToolbar` (pick mode, view mode, scene menus move to 12.5's map overlays — until then they are mounted temporarily inside the header's right group), `LeftSidebar`, `LayerPanel`, `GeoLayerRow`, `BasemapPanel` / `GoogleTilesPanel` move to 12.5's Scene settings sheet (temporarily under Details of the active layer? No: temporarily in a `Scene` popover from the header), CSS sections `TOOLBAR`, `LEFT SIDEBAR`, `LAYER PANEL`, `VIEWER SHELL`.
- Persistence: none.
- Tests: shellStore, ViewerShell layout classes at both collapse states, LayerRow for the five layer types, layerPresentation strings, AddLayerDialog detection and override, App landing-vs-viewer branch for a geo-only workspace.

## Slice 12.3 — Styling and inspection (outline)

- `StyleSection` for city layers: `Color by` = `Surface type` | `Rules` | `Single colour` (`src/features/rules/colorBy.ts`: `ColorBy` on `Layer` as `colorBy: "surface" | "rules" | "single"` plus `singleColor: string`, compiled to the evaluator `handleSync` already pushes — single colour is a catch-all rule); presets row; `RulesEditor` (from `RuleBuilderTab`, without the target select); per-layer drafts in `src/features/rules/ruleDraftStore.ts`; unmatched colour editable (`Layer.unmatchedColor`, threaded into `compileRuleEvaluator`'s fallback — verify the core API, add a parameter if needed, submodule-first).
- `StyleSection` for geo layers: fill / stroke / opacity (from `GeoLayerInspector`) and `Color by attribute` (`GeoLayerStyle.colorByAttribute?: { attribute: string; categories: Record<string, string> }` — verify `geoLayerSync` can paint per feature; if not, defer and say so in the section).
- `LegendOverlay` rebuilt: groups per visible layer (surface types / rules + unmatched / geo fill or categories), heading activates the layer and opens Style (shellStore `openSection: "style"`), presentation size when both panels are collapsed; counts from the layer table when it is ready, else omitted.
- `src/ui/details/DetailsPanel.tsx` (+ `IdentityTrail`, `SummarySection`, `RuleMatchSection`, `AttributesSection`, `PartsSection`, `GeometrySection`, `MultiSelectionSummary`, `GeoFeatureDetails`): replaces `InspectorPanel`, `GeoLayerInspector`, `AnalysisTab` (its content becomes an `ANALYSIS` section), `StatsTab` (moves to 12.4's Summary view). Roof metrics through `computeObjectStats`.
- Tests per component; the rule-match section against a compiled evaluator.

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
