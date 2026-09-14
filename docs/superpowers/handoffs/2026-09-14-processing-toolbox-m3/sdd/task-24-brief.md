### Task 24: A derived layer in the layer list, the snapshot and the export

**Files:**

- Create: `src/app/snapshotLayers.ts` — the pure "which layers go into the snapshot, and where does the active index land" decision, lifted out of `App.tsx` (2000+ lines) so it can be tested without rendering the shell.
- Modify: `src/features/layers/layerPresentation.ts`, `src/ui/layers/LayerList.tsx`, `LayerRow.tsx`, `LayerRowMenu.tsx`, `src/app/App.tsx`, `src/insights/sql.ts`, `src/ui/table/ExportDialog.tsx`.
- Test: `tests/unit/ui/layers/derivedLayerRow.test.tsx`, `tests/unit/app/derivedSnapshot.test.tsx`, additions to `tests/unit/insights/sql.test.ts`.

**Interfaces:**

- Consumes: `Layer.derivedFrom` (Task 21), `GeoLayer.derivedFrom` (Task 23), `LayerTable.sourceFeatureIds` (Task 21), `runById` (`features/processing/processingStore.ts`).
- Produces: `LayerStateInput.derivedFrom` and `cityStateLine`'s `· Derived from Delft` tail; the `Derived · not saved in workspaces` marker; the `Show run log` menu item (disabled when `runById(derivedFrom.runId)` is null); the snapshot filter and the repointed `activeLayer` index; `buildCityParquetSourceSql`'s extra `where` clause.

**Intent:** §8's persistence paragraph: the snapshot OMITS a derived layer entirely, and because `activeLayer` is an INDEX into the snapshot's own arrays (`App.tsx:1045-1056`), skipping a layer without repointing the index silently activates the wrong one on restore — that is the bug this task exists to prevent. The Save toast gains `1 derived layer is not saved; export it to keep it`, verbatim. The CityParquet export of a derived layer must carry `sourceFeatureIds` into its `where`, or it exports the parent whole. A reviewer rejects it for an index computed before the filter, for a marker that reads a name instead of `derivedFrom`, or for an export that ignores the filter.

**The plural of the Save toast is not in the copy table.** §8 gives `1 derived layer is not saved; export it to keep it` and nothing for two. The owner accepted **[adapted copy A16]** at the plan gate: `2 derived layers are not saved; export them to keep them`, the same sentence pluralised (Decisions recorded, item 5).

- [ ] **Step 1: Write the failing test for the state line and the row**

Create `tests/unit/ui/layers/derivedLayerRow.test.tsx`:

```tsx
/**
 * §6.2 and §8 on a derived layer's ROW: the state-line tail, the "not saved"
 * marker and the "Show run log" menu item.
 *
 * `layerStateLine` is pure and tested directly; the marker and the menu item
 * need the row rendered, because what is being pinned is that both read
 * `derivedFrom` rather than a name or a heuristic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { layerStateLine } from "../../../../src/features/layers/layerPresentation";

describe("cityStateLine", () => {
  it("adds §6.2's 'Derived from' tail after the LoD", () => {
    expect(
      layerStateLine({
        kind: "city",
        counts: { buildings: 312, objects: 312 },
        lod: "2.2",
        derivedFrom: { layerId: "L", layerName: "Delft", runId: "run_1" },
      }),
    ).toBe("312 buildings · LoD 2.2 · Derived from Delft");
  });

  it("says nothing extra for an ordinary layer", () => {
    expect(
      layerStateLine({
        kind: "city",
        counts: { buildings: 312, objects: 312 },
        lod: "2.2",
        derivedFrom: null,
      }),
    ).toBe("312 buildings · LoD 2.2");
  });

  it("adds the tail to a derived VECTOR layer too", () => {
    expect(
      layerStateLine({
        kind: "vector",
        featureCount: 6,
        derivedFrom: { layerId: "G", layerName: "Zones", runId: "run_2" },
      }),
    ).toBe("6 features · Derived from Zones");
  });

  it("is still outranked by an error and by 'Needs re-link'", () => {
    // The precedence contract in `layerPresentation.ts` is unchanged: a layer
    // that failed says so, derived or not.
    expect(
      layerStateLine({
        kind: "city",
        error: "boom",
        derivedFrom: { layerId: "L", layerName: "Delft", runId: "r" },
      }),
    ).toBe("Error · boom");
  });
});
```

and, for the row, a second file-level `describe` that renders `LayerRow` with the two new props. `LayerRow.test.tsx` has no `baseProps` — its helpers are `cityItem`, `handlers`, `renderRow` and `openMenu` (`LayerRow.test.tsx:28-83`), and the shape below is the same one, copied rather than imported (a fixture module shared between two suites is a third thing to keep in step):

```tsx
import { LayerRow } from "../../../../src/ui/layers/LayerRow";
import type { ActiveLayer } from "../../../../src/features/workspace/activeLayer";
import type { Layer } from "../../../../src/features/layers/layerStore";

/** The city row this file's cases are all about. Cast, because `LayerRow` is
 *  store-free and reads four fields of it. */
function cityItem(overrides: Partial<Layer> = {}): ActiveLayer {
  return {
    kind: "city",
    layer: {
      id: "l1",
      name: "Delft · solids",
      visible: true,
      isStreaming: false,
      derivedFrom: null,
      ...overrides,
    } as unknown as Layer,
  };
}

const handlers = () => ({
  onActivate: vi.fn(),
  onToggleVisible: vi.fn(),
  onRename: vi.fn(),
  onZoom: vi.fn(),
  onRemove: vi.fn(),
});

function renderRow(
  props: Partial<Parameters<typeof LayerRow>[0]> = {},
): ReturnType<typeof handlers> {
  const cbs = handlers();
  render(
    <LayerRow
      item={cityItem()}
      active={false}
      stateLine="312 buildings · LoD 2.2 · Derived from Delft"
      kind="city"
      filterChip={null}
      onOpenTable={null}
      {...cbs}
      {...props}
    />,
  );
  return cbs;
}

const openMenu = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /^Layer actions/ }));
};

afterEach(cleanup);

describe("a derived layer's row", () => {
  it("marks itself 'Derived · not saved in workspaces' (§6, §8)", () => {
    renderRow({ derived: true });
    expect(screen.getByText("Derived · not saved in workspaces")).toBeTruthy();
  });

  it("offers 'Show run log' and calls it", () => {
    const onShowRunLog = vi.fn();
    renderRow({ derived: true, onShowRunLog });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Show run log" }));
    expect(onShowRunLog).toHaveBeenCalledTimes(1);
  });

  it("disables 'Show run log' when the run has left the history", () => {
    // §6.2's own caveat: the history keeps 20 runs and a layer outlives its
    // run, so the item is disabled rather than absent — a layer that HAS a run
    // log and one whose log has aged out must not look the same.
    renderRow({ derived: true, onShowRunLog: null });
    openMenu();
    expect(screen.getByRole("button", { name: "Show run log" })).toBeDisabled();
  });

  it("shows neither on an ordinary layer", () => {
    // `onShowRunLog` is left UNDEFINED, which is what `LayerList` passes for a
    // layer with no `derivedFrom` — and the regression that matters: passing
    // `null` here instead would give every ordinary layer a disabled item.
    renderRow();
    expect(screen.queryByText("Derived · not saved in workspaces")).toBeNull();
    openMenu();
    expect(screen.queryByRole("button", { name: "Show run log" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/layers/derivedLayerRow.test.tsx
```

Expected: FAIL — `derivedFrom` is not a `LayerStateInput` field (a type error at the call), and `LayerRow` has no `derived` prop.

- [ ] **Step 3: Put the tail in the ONE place a state line is worded**

In `src/features/layers/layerPresentation.ts`:

1. `LayerStateInput` gains the field. Find:

```ts
  /** Any kind: a restored placeholder awaiting a re-link. Wins over
   *  everything but `error`. */
  readonly unavailable?: boolean;
}
```

and insert above the brace:

```ts
  /**
   * Any kind: the parent a New-layer run copied this layer from (§6.2's
   * "312 buildings · LoD 2.2 · Derived from Delft").
   *
   * The `layerName` is the COPY recorded at publication, so the tail stays
   * right after the parent is renamed or removed — "a derived layer is
   * independent of its parent from publication on" (§6).
   */
  readonly derivedFrom?: { readonly layerName: string } | null;
}
```

(structurally typed, not `DerivedFrom`: this module words a sentence and needs one field of it, and `layerPresentation` has no other reason to know the layer store's types.)

2. The tail is appended once, for every kind, AFTER the per-kind formatting and INSIDE the two refusals' shadow. Find:

```ts
export function layerStateLine(input: LayerStateInput): string {
  if (input.error != null) return `Error · ${input.error}`;
  if (input.unavailable) return "Needs re-link";
  switch (input.kind) {
    case "city":
      return cityStateLine(input);
    case "streaming":
      return streamingStateLine(input);
```

and replace the whole function's body with:

```ts
export function layerStateLine(input: LayerStateInput): string {
  if (input.error != null) return `Error · ${input.error}`;
  if (input.unavailable) return "Needs re-link";
  // ONE place, after the per-kind sentence: §6.2 spells the tail for a city
  // layer, and a derived VECTOR layer is the same fact about the same kind of
  // row. Both refusals above still outrank it — a layer that failed says so.
  const tail =
    input.derivedFrom == null
      ? ""
      : ` · Derived from ${input.derivedFrom.layerName}`;
  return `${kindStateLine(input)}${tail}`;
}

function kindStateLine(input: LayerStateInput): string {
  switch (input.kind) {
    case "city":
      return cityStateLine(input);
    case "streaming":
      return streamingStateLine(input);
```

keeping the rest of the switch exactly as it is.

- [ ] **Step 4: Give the row its marker and its menu item**

In `src/ui/layers/LayerRow.tsx`, two props on `LayerRowProps`:

```ts
  /** §6 and §8: the layer was created by a run and is not saved in
   *  workspaces. It reads `Layer.derivedFrom`, never a name. */
  readonly derived?: boolean;
  /** §6.2's extra overflow item. `null` disables it — the run history keeps
   *  20 runs (`processingStore.ts`'s `MAX_RUNS`) and a layer outlives its run,
   *  so a layer whose log has aged out must not look like one with no log. */
  readonly onShowRunLog?: (() => void) | null;
```

the marker, beside the state line. Find:

```tsx
<span className="layer-row-state-line">{stateLine}</span>
```

(the FIRST of the two occurrences — the city/geo row, not the fallback at `:312`) and insert under it:

```tsx
{
  derived === true && (
    <span className="layer-row-derived">Derived · not saved in workspaces</span>
  );
}
```

and pass the callback through to the menu. Find, on the `<LayerRowMenu …>` element (`LayerRow.tsx:246-252`):

```tsx
onZoom = { onZoom };
```

and add `onShowRunLog={onShowRunLog}` beside it — **verbatim, with no `?? null`**. The prop is a three-state one and the coalesce would destroy the distinction it exists for: `undefined` means "this layer has no run log at all" and the item is ABSENT, `null` means "it had one and the history dropped it" and the item is DISABLED. `onShowRunLog ?? null` turns every ordinary layer's `undefined` into the disabled value, so every row in the list grows a greyed "Show run log". Plus, in `src/ui/layers/LayerRowMenu.tsx`, the prop and the item. The prop, beside `onOpenTable`'s declaration:

```ts
  /** §6.2's derived-layer item. `undefined` omits it (an ordinary layer has no
   *  run log at all); `null` renders it DISABLED, for a derived layer whose run
   *  has left the 20-run history. */
  readonly onShowRunLog?: (() => void) | null;
```

and the item, directly after `Open table`'s block:

```tsx
{
  onShowRunLog !== undefined && (
    <button
      type="button"
      className="menu-item"
      disabled={onShowRunLog === null}
      onClick={() => {
        if (onShowRunLog !== null) act(onShowRunLog);
      }}
    >
      Show run log
    </button>
  );
}
```

Add `.layer-row-derived` to `src/app/app.css` beside `.layer-row-state-line`, using the same muted token the state line uses — one declaration, no new colour:

```css
.layer-row-derived {
  display: block;
  font-size: 0.72rem;
  color: var(--fg-muted);
}
```

In `src/ui/layers/LayerList.tsx`, feed both. Find:

```tsx
  } else if (kind === "city") {
    input = {
      kind,
      counts,
      lod: item.kind === "city" ? item.layer.selectedLod : null,
    };
```

and replace with:

```tsx
  } else if (kind === "city") {
    input = {
      kind,
      counts,
      lod: item.kind === "city" ? item.layer.selectedLod : null,
      derivedFrom: item.kind === "city" ? item.layer.derivedFrom : null,
    };
```

add `derivedFrom: item.kind === "geo" ? item.layer.derivedFrom : null,` to the `vector` branch's `input`, and on the `<LayerRow …>` element:

```tsx
      stateLine={layerStateLine(input)}
```

gains, beside it:

```tsx
      derived={derivedFromOf(item) !== null}
      onShowRunLog={
        derivedFromOf(item) === null
          ? undefined
          : runById(derivedFromOf(item)!.runId) === null
            ? null
            : () => openRunLog(derivedFromOf(item)!.runId)
      }
```

with one helper at the bottom of the file, beside `canZoom`:

```tsx
/** The parent a New-layer run copied this row from, for either store's kind. */
function derivedFromOf(item: ActiveLayer): DerivedFrom | null {
  return item.layer.derivedFrom;
}
```

(both `Layer` and `GeoLayer` carry the field after Tasks 21 and 23, so the union needs no branch — which is the point of giving them the same shape.) Import `runById` from `features/processing/processingStore` and `openRunLog` from `ui/processing/revealTools`.

- [ ] **Step 5: Run it and watch it pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/layers tests/unit/features/layers/layerPresentation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the failing test for the snapshot**

Create `tests/unit/app/derivedSnapshot.test.tsx`:

```tsx
/**
 * §8: "A derived layer … is not saved either: the snapshot omits it entirely
 * (it is skipped when the active-layer index and the layer order are written,
 * so nothing refers to it), Save shows the existing toast plus '1 derived
 * layer is not saved; export it to keep it'."
 *
 * The INDEX is the whole reason this file exists. `App` writes `activeLayer` as
 * a per-kind index into the arrays it is writing, so filtering the arrays
 * without recomputing the index silently activates the wrong layer on restore.
 */
import { describe, expect, it } from "vitest";
import type { DerivedFrom } from "../../../src/features/layers/layerStore";
import {
  derivedNotSavedNote,
  snapshotLayers,
} from "../../../src/app/snapshotLayers";

/**
 * `snapshotLayers` is STRUCTURALLY typed over `{ id, derivedFrom }`, so the
 * fixture is a real record of that shape and not a cast: `as never` would make
 * `L` infer as `never`, and every `out.layers.map((l) => l.name)` below would
 * then be reading a property off it.
 */
interface Row {
  readonly id: string;
  readonly name: string;
  readonly derivedFrom: DerivedFrom | null;
}

const city = (name: string, derived: boolean): Row => ({
  id: name,
  name,
  derivedFrom: derived
    ? { layerId: "p", layerName: "Delft", runId: "run_1" }
    : null,
});

describe("snapshotLayers", () => {
  it("omits every derived layer from both arrays", () => {
    const out = snapshotLayers({
      layers: [city("Delft", false), city("Delft · solids", true)],
      geoLayers: [city("Zones", false), city("Zones · buildings", true)],
      activeLayerId: "Delft",
    });
    expect(out.layers.map((l) => l.name)).toEqual(["Delft"]);
    expect(out.geoLayers.map((l) => l.name)).toEqual(["Zones"]);
    expect(out.derivedCount).toBe(2);
  });

  it("repoints the active index at the FILTERED array", () => {
    // Rotterdam is index 2 of three layers and index 1 of the two that are
    // saved. An index taken before the filter would restore Delft.
    const out = snapshotLayers({
      layers: [
        city("Delft", false),
        city("Delft · solids", true),
        city("Rotterdam", false),
      ],
      geoLayers: [],
      activeLayerId: "Rotterdam",
    });
    expect(out.activeLayer).toEqual({ kind: "city", index: 1 });
  });

  it("omits the active reference entirely when the active layer is derived", () => {
    // "nothing refers to it" (§8). An absent `activeLayer` restores the first
    // layer, which is the existing fallback.
    const out = snapshotLayers({
      layers: [city("Delft", false), city("Delft · solids", true)],
      geoLayers: [],
      activeLayerId: "Delft · solids",
    });
    expect(out.activeLayer).toBeUndefined();
  });

  it("counts nothing when no layer is derived", () => {
    const out = snapshotLayers({
      layers: [city("Delft", false)],
      geoLayers: [],
      activeLayerId: "Delft",
    });
    expect(out.derivedCount).toBe(0);
    expect(out.activeLayer).toEqual({ kind: "city", index: 0 });
  });

  it("omits the reference when NOTHING is active", () => {
    // `activeLayerId: null` is not "the first layer": the snapshot simply
    // carries no reference, which restores the existing first-layer fallback.
    // This is the shape the implementation returns, and the assertion is here
    // so a future `?? 0` cannot slip in unnoticed.
    const out = snapshotLayers({
      layers: [city("Delft", false)],
      geoLayers: [],
      activeLayerId: null,
    });
    expect(out.activeLayer).toBeUndefined();
  });
});

describe("the Save toast's extra sentence", () => {
  it("is §8's, verbatim, for one derived layer", () => {
    expect(derivedNotSavedNote(1)).toBe(
      "1 derived layer is not saved; export it to keep it",
    );
  });

  it("is null when nothing was skipped", () => {
    expect(derivedNotSavedNote(0)).toBeNull();
  });

  it("pluralises for more than one [adapted copy A16]", () => {
    expect(derivedNotSavedNote(2)).toBe(
      "2 derived layers are not saved; export them to keep them",
    );
  });
});
```

- [ ] **Step 7: Extract the snapshot's layer selection out of `App.tsx`**

`App.tsx` is 2000+ lines and the index/filter relationship is the bug this task prevents, so the decision moves into a pure module. Create `src/app/snapshotLayers.ts`:

```ts
/**
 * WHICH layers a snapshot holds, and what its active-layer reference points at
 * (spec §8).
 *
 * Extracted from `App`'s save callback because the two answers are ONE
 * decision: `ProjectSnapshot.activeLayer` is a per-kind INDEX into the very
 * arrays written beside it, so filtering the arrays and computing the index are
 * a single step — done in two places they drift, and the symptom is a restore
 * that silently opens the wrong layer.
 *
 * Pure: it takes the two lists and the active id and returns what to write.
 * STRUCTURALLY typed over `{ id, derivedFrom }` rather than over `Layer` and
 * `GeoLayer`, so `App` keeps handing it the records it already holds and the
 * test can hand it two fields.
 */

export interface SnapshotLayerSelection<L, G> {
  readonly layers: ReadonlyArray<L>;
  readonly geoLayers: ReadonlyArray<G>;
  /** `undefined` when nothing is active OR the active layer is derived. */
  readonly activeLayer:
    | { readonly kind: "city" | "geo"; readonly index: number }
    | undefined;
  /** How many layers were skipped, for the Save toast. */
  readonly derivedCount: number;
}

export function snapshotLayers<
  L extends { id: string; derivedFrom: unknown },
  G extends { id: string; derivedFrom: unknown },
>(input: {
  readonly layers: ReadonlyArray<L>;
  readonly geoLayers: ReadonlyArray<G>;
  readonly activeLayerId: string | null;
}): SnapshotLayerSelection<L, G> {
  const layers = input.layers.filter((l) => l.derivedFrom == null);
  const geoLayers = input.geoLayers.filter((l) => l.derivedFrom == null);
  const derivedCount =
    input.layers.length -
    layers.length +
    (input.geoLayers.length - geoLayers.length);
  const id = input.activeLayerId;
  // Searched in the FILTERED arrays, so a derived active layer simply is not
  // found and the reference is omitted — §8's "nothing refers to it".
  const cityIndex = id === null ? -1 : layers.findIndex((l) => l.id === id);
  const geoIndex = id === null ? -1 : geoLayers.findIndex((l) => l.id === id);
  const activeLayer =
    cityIndex >= 0
      ? ({ kind: "city", index: cityIndex } as const)
      : geoIndex >= 0
        ? ({ kind: "geo", index: geoIndex } as const)
        : undefined;
  return { layers, geoLayers, activeLayer, derivedCount };
}

/**
 * §8's extra Save sentence, or null when nothing was skipped.
 *
 * The singular is §8's own words; the plural is [adapted copy A16].
 */
export function derivedNotSavedNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 derived layer is not saved; export it to keep it"
    : `${count} derived layers are not saved; export them to keep them`;
}
```

Then in `src/app/App.tsx`, replace the `activeLayerRef` computation and the two `map`s. Find:

```ts
const activeLayerRef =
  activeLayer === null
    ? undefined
    : activeLayer.kind === "city"
      ? {
          kind: "city" as const,
          index: allLayers.indexOf(activeLayer.layer),
        }
      : {
          kind: "geo" as const,
          index: allGeoLayers.indexOf(activeLayer.layer),
        };
```

and replace with:

```ts
// §8: a derived layer is omitted from the snapshot ENTIRELY, and the
// active-layer reference is an index into the arrays written beside it —
// so the filter and the index are one decision, made in one pure place.
const selection = snapshotLayers({
  layers: allLayers,
  geoLayers: allGeoLayers,
  activeLayerId: useWorkspaceStore.getState().activeLayerId,
});
const activeLayerRef = selection.activeLayer;
```

**and delete the binding it replaced.** `const activeLayer = resolveActiveLayer(useWorkspaceStore.getState().activeLayerId, allLayers, allGeoLayers);` just above it is now unused, and so is the `resolveActiveLayer` import if nothing else in `App.tsx` calls it — `vp check`'s no-unused rule is a GATE (0 errors / 56 warnings), so leaving either behind fails the task. `grep -n "resolveActiveLayer\|activeLayer\." src/app/App.tsx` before deleting: the save callback also reads `activeLayer` for nothing else, but the RENDER has its own `const activeLayer = useActiveLayer();` at `:380` and that one stays.

then `layers: allLayers.map(…)` becomes `layers: selection.layers.map(…)`, `geoLayers: allGeoLayers.map(geoLayerSnapshot)` becomes `geoLayers: selection.geoLayers.map(geoLayerSnapshot)`, and the success toast gains the sentence. Find:

```ts
showToast(
  partialRestoreRef.current
    ? "Loaded layers saved as a new workspace. The original save still contains the layers that could not be restored."
    : "Workspace saved — you'll find it here next time you open Roofy.",
  EXPLANATION_TOAST_MS,
);
```

and replace with:

```ts
const note = derivedNotSavedNote(selection.derivedCount);
const saved = partialRestoreRef.current
  ? "Loaded layers saved as a new workspace. The original save still contains the layers that could not be restored."
  : "Workspace saved — you'll find it here next time you open Roofy.";
showToast(note === null ? saved : `${saved} ${note}`, EXPLANATION_TOAST_MS);
```

- [ ] **Step 8: Run it and watch it pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/app
```

Expected: PASS, and `appRestoreShare.test.tsx` unchanged (no layer in it is derived).

- [ ] **Step 9: Write the failing test for the CityParquet export filter**

Add to `tests/unit/insights/sql.test.ts`:

```ts
describe("buildCityParquetSourceSql on a DERIVED layer", () => {
  it("ANDs the layer's own feature ids into the where clause", () => {
    // Without it the reader re-reads the PARENT source whole and the export
    // holds every building of Delft under the derived layer's name.
    const sql = buildCityParquetSourceSql({
      scratchSchema: "x",
      reader: "read_cityjson",
      sourceFile: "layer_2.city.json",
      table: "layer_2",
      lodSuffix: "2_2",
      attributes: [],
      computedAttributes: [],
      where: null,
      sourceFeatureIds: ["a", "b"],
    });
    expect(sql).toContain(
      "WHERE COALESCE(\"feature_id\", \"id\") IN ('a', 'b')",
    );
  });

  it("combines it with a user filter rather than replacing it", () => {
    const sql = buildCityParquetSourceSql({
      scratchSchema: "x",
      reader: "read_cityjson",
      sourceFile: "layer_2.city.json",
      table: "layer_2",
      lodSuffix: "2_2",
      attributes: [],
      computedAttributes: [],
      where: "\"status\" = 'ok'",
      sourceFeatureIds: ["a"],
    });
    expect(sql).toMatch(/WHERE .*"status" = 'ok'.* AND COALESCE/s);
  });

  it("is unchanged for an ordinary layer", () => {
    const sql = buildCityParquetSourceSql({
      scratchSchema: "x",
      reader: "read_cityjson",
      sourceFile: "layer_1.city.json",
      table: "layer_1",
      lodSuffix: "2_2",
      attributes: [],
      computedAttributes: [],
      where: null,
      sourceFeatureIds: null,
    });
    expect(sql).not.toContain("WHERE");
  });
});
```

- [ ] **Step 10: Run it, then add the clause**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights/sql.test.ts
```

Expected: FAIL — `sourceFeatureIds` is not a parameter.

In `src/insights/sql.ts`, `buildCityParquetSourceSql`'s input gains:

```ts
  /**
   * A DERIVED layer's feature ROOT ids (`LayerTable.sourceFeatureIds`), or null
   * for an ordinary layer.
   *
   * One of the THREE readers of a parent's source on a derived layer's behalf
   * (with `readSource` and `resolveScope`), and every one of them has to AND
   * this in: the reader here re-reads the PARENT file, so without the clause a
   * derived layer's export holds every building of its parent.
   */
  readonly sourceFeatureIds: ReadonlyArray<string> | null;
```

and the `where` composition. Find:

```ts
const scope = buildFeatureScopeWhere(input.table, input.where);
const whereClause = scope === null ? "" : ` WHERE ${scope}`;
```

and replace with:

```ts
const scope = buildFeatureScopeWhere(input.table, input.where);
// The derived filter is over the READER's own rows, so it is a plain
// `COALESCE(...) IN (...)` and not another `buildFeatureScopeWhere` (which
// subqueries the layer TABLE — correct for the user's filter, circular here).
const cut =
  input.sourceFeatureIds === null
    ? null
    : `COALESCE("feature_id", "id") IN (${input.sourceFeatureIds
        .map((id) => quoteLiteral(id))
        .join(", ")})`;
const both = [scope, cut].filter((c): c is string => c !== null);
const whereClause = both.length === 0 ? "" : ` WHERE ${both.join(" AND ")}`;
```

In `src/ui/table/ExportDialog.tsx`, pass it. The request is built from the layer's table, so find the `CityParquetExportRequest` literal (it already carries `sourceExtension`, `lodSuffix`, `computedAttributes`) and add:

```ts
      sourceFeatureIds: table.sourceFeatureIds,
```

and thread the field through `export.ts`'s `CityParquetExportRequest` type to the `buildCityParquetSourceSql` call.

- [ ] **Step 11: Run everything and commit**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights tests/unit/ui/table tests/unit/ui/layers tests/unit/app
npx tsc -b --noEmit
npx vp check
npx vitest run > /tmp/m3-task24.log 2>&1 &
wait $!; echo "suite: $?"
```

Expected: PASS throughout; `suite: 0`.

```bash
git add src/features/layers/layerPresentation.ts \
  src/ui/layers/LayerList.tsx src/ui/layers/LayerRow.tsx src/ui/layers/LayerRowMenu.tsx \
  src/app/App.tsx src/app/snapshotLayers.ts src/app/app.css \
  src/insights/sql.ts src/insights/export.ts src/ui/table/ExportDialog.tsx \
  tests/
git commit -m "feat: a derived layer is marked, omitted from snapshots and exportable"
```
