### Task 11: The LoD select

**Files:**

- Create: `src/ui/processing/useLodOptions.ts`, `tests/unit/ui/processing/roofLayerFixture.tsx`
- Modify: `src/ui/processing/useToolForm.ts` (the draft normalisation at `:79-93`, `runReason` at `:150-152`, the return at `:165-182`), `src/ui/processing/ToolView.tsx` (a field inside the TARGET fieldset, between the Layer select ending `:126` and the Scope block at `:127`)
- Test: `tests/unit/ui/processing/lodSelect.test.tsx`

**Interfaces:**

- Consumes: `roofLodOptions`, `LodOption` (Task 7); `ToolDefinition.needsLod` (Task 8).
- Produces:
  - `useLodOptions.ts`: `export interface LodChoices { readonly options: ReadonlyArray<LodOption>; readonly noun: string; readonly emptyReason: string | null }`; `export function useLodOptions(tool: ToolDefinition, target: Layer | null): LodChoices`.
  - `roofLayerFixture.tsx`: `export function roofModel(options?: { roofs?: boolean }): CityModel`; `export function addRoofLayer(options?: { selectedLod?: string | null; roofs?: boolean }): string` — adds the layer, activates it and registers a `ready` table entry. Task 12 imports both.
  - `useToolForm` gains `lodOptions`, `lodNoun`, `lodReason`, and its returned `draft.lod` is the EFFECTIVE LoD.
- Task 12 consumes the fixture and `f.paramsError`'s place in `runReason`; Task 13 consumes the rendered select.

**An unimplemented tool renders NO LoD control and claims nothing.** `useLodOptions` returns the empty `LodChoices` for any tool with `implemented === false`, and `ToolView` renders the field only when `tool.needsLod && tool.implemented`. Measure solids and Validate solids have no source of truthful counts in M2, and a select reading "No solid geometry in this layer" over a layer full of solids is a fabricated fact. Their rows already say the true thing — "Not available yet".

**Copy.** §6's option pattern is "2.2 (1,115 buildings with a solid)" and its empty state is "No solid geometry in this layer". Roof metrics needs the roof-shaped versions, and both are decided (decisions 1 and 2): **[adapted copy]** `"2.2 (1,115 buildings with roof surfaces)"` and `"No roof surfaces in this layer"`.

**Why the default is computed and not written.** `useToolForm` must not `setDraft` from a render. It already normalises a stale `targetLayerId` by returning a corrected draft rather than writing one (`useToolForm.ts:90-92`); the LoD takes the same road.

- [ ] **Step 1: Write the shared fixture**

Create `tests/unit/ui/processing/roofLayerFixture.tsx`. Both form suites and the activation suite import it; their `vi.mock` blocks cannot be shared (they are per-file), but the data and the store setup can.

```tsx
/**
 * The layer the Roof metrics form suites run against: FOUR features — two
 * roof-bearing at LoD 2.2, one at 1.2, and one with geometry but no roof —
 * over FIVE rows. Shared because three suites assert counts over it and a
 * second copy would drift.
 */
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { ColumnInfo } from "../../../../src/insights/columnKind";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useLayerTableStore } from "../../../../src/insights/layerTables";

/** A unit square of `type` at `lod`: area 1, inclination 0, azimuth 0. */
const surface = (type: string, lod: string) => ({
  type,
  rings: [
    [
      [0, 0, 3],
      [1, 0, 3],
      [1, 1, 3],
      [0, 1, 3],
    ],
  ],
  attributes: {},
  lod,
});

const object = (
  id: string,
  objectType: string,
  surfaces: unknown[],
  parents: string[] = [],
  children: string[] = [],
) => ({
  id,
  objectType,
  attributes: {},
  surfaces,
  bbox: null,
  children,
  parents,
  lod: null,
});

/** FEATURES: B1 (+part B1P), B4, B2, B3. ROWS: those five ids. */
export const ROOF_FIXTURE_ROWS = 5;
/** Features with a roof at 2.2 (B1 through its part, and B4). */
export const ROOF_FIXTURE_FEATURES_22 = 2;
/** Features with a roof at 1.2 (B2). */
export const ROOF_FIXTURE_FEATURES_12 = 1;

/**
 * `roofs: false` turns every RoofSurface into a WallSurface, which is how a
 * test reaches §6's "no LoD qualifies" state without an empty layer.
 */
export function roofModel(options: { roofs?: boolean } = {}): CityModel {
  const roof = options.roofs === false ? "WallSurface" : "RoofSurface";
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: object("B1", "Building", [surface(roof, "2.2")], [], ["B1P"]),
      B1P: object(
        "B1P",
        "BuildingPart",
        [surface(roof, "2.2"), surface("WallSurface", "2.2")],
        ["B1"],
      ),
      B4: object("B4", "Building", [surface(roof, "2.2")]),
      B2: object("B2", "Building", [surface(roof, "1.2")]),
      // Geometry, no roof at any LoD — the contributor rule's other side, and
      // the reason the 2.2 count is 2 rather than 3.
      B3: object("B3", "Building", [surface("WallSurface", "2.2")]),
    },
  } as unknown as CityModel;
}

function column(name: string): ColumnInfo {
  return { name, type: "VARCHAR", kind: "scalar" };
}

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

/** Adds the layer, makes it active, and gives it a READY table. */
export function addRoofLayer(
  options: {
    selectedLod?: string | null;
    roofs?: boolean;
    isStreaming?: boolean;
  } = {},
): string {
  const input: LayerInput = {
    name: "roofs",
    model: roofModel(options),
    modelRef: { type: "url", url: "https://x/roofs.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: options.isStreaming ?? false,
  };
  const id = useLayerStore.getState().addLayer(input);
  if (options.selectedLod !== undefined) {
    useLayerStore.setState((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, selectedLod: options.selectedLod ?? null } : l,
      ),
    }));
  }
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: "roofs.city.json",
          source: null,
          reader: "read_cityjson",
          columns: [column("id"), column("feature_id")],
          lods: [],
          rowCount: ROOF_FIXTURE_ROWS,
        },
      },
    },
  });
  return id;
}
```

`ColumnInfo` lives in `src/insights/columnKind.ts` (that is where `ToolView.test.tsx:18` imports it from) and requires `kind`; `"scalar"` is the value every plain column uses there. Confirm both before writing the file: `grep -n "interface ColumnInfo" -A6 src/insights/columnKind.ts`.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/ui/processing/lodSelect.test.tsx`. The scaffolding is `ToolView.test.tsx`'s (`:1-90` for the mocks and `:201-222` for the reset), plus Task 1's two duckdb keys and one registry mock. **The `counts` object must be mutable and aligned with the fixture** — `ToolView.test.tsx` declares it at `:58-66` and resets it in `beforeEach`; four features means `all: 4`.

```tsx
/**
 * Spec §6's LoD select for Roof metrics: the options, their FEATURE counts,
 * the default, the empty state, and the tools that get no select at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../../src/insights/duckdb", () => ({
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  getDuckDBStatusVersion: vi.fn(() => 0),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_1"),
  retryRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

const counts = {
  all: 4 as number | null,
  matching: null as number | null,
  selected: 0 as number | null,
  loading: false,
  message: null as string | null,
};
vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: () => counts,
}));

/**
 * Roof metrics is `implemented: false` until Task 13. `TOOLS` is an array of
 * plain readonly object literals, so a getter spy has nothing to attach to —
 * the registry is MOCKED instead, the same way `useToolForm.test.tsx:54-71`
 * already enables `measure-solids`. Task 13 deletes this block and reruns
 * these assertions against the real registry.
 */
vi.mock("../../../../src/features/processing/toolRegistry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/toolRegistry")
  >("../../../../src/features/processing/toolRegistry");
  const TOOLS = actual.TOOLS.map((t) =>
    t.id === "roof-metrics" ? { ...t, implemented: true } : t,
  );
  return {
    ...actual,
    TOOLS,
    toolById: (id: string) => {
      const tool = TOOLS.find((t) => t.id === id);
      if (!tool) throw new Error(`Unknown tool: ${id}`);
      return tool;
    },
  };
});

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { addRoofLayer } = await import("./roofLayerFixture");

beforeEach(() => {
  counts.all = 4;
  counts.matching = null;
  counts.selected = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
});

describe("the LoD select (spec §6)", () => {
  it("lists each LoD with its FEATURE count, highest detail first", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    const select = screen.getByRole("combobox", {
      name: "LoD",
    }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "2.2 (2 buildings with roof surfaces)",
      "1.2 (1 building with roof surfaces)",
    ]);
  });

  it("defaults to the layer's selected LoD when it qualifies", () => {
    addRoofLayer({ selectedLod: "1.2" });
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("1.2");
  });

  it("defaults to the highest qualifying LoD when the layer's does not qualify", () => {
    addRoofLayer({ selectedLod: "0" });
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toHaveValue("2.2");
  });

  it("shows the empty state and blocks Run when no LoD qualifies", () => {
    addRoofLayer({ roofs: false });
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByText("No roof surfaces in this layer"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("does not offer a LoD for a tool that reads no geometry at one level", () => {
    addRoofLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
  });

  it("does not offer a LoD, or any geometry verdict, for an UNIMPLEMENTED tool", () => {
    // Measure solids has `needsLod: true` and no source of counts in M2. A
    // select reading "No solid geometry in this layer" over a layer full of
    // solids would be a fact the app never checked.
    addRoofLayer();
    render(<ToolView toolId="measure-solids" />);
    expect(screen.queryByRole("combobox", { name: "LoD" })).toBeNull();
    expect(screen.queryByText(/No solid geometry/)).toBeNull();
  });

  it("submits the chosen LoD with the run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.change(screen.getByRole("combobox", { name: "LoD" }), {
      target: { value: "1.2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(vi.mocked(submitRun).mock.calls[0]![0]!.lod).toBe("1.2");
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run tests/unit/ui/processing/lodSelect.test.tsx
```

Expected: FAIL — `Unable to find a label with the text of: LoD`.

- [ ] **Step 4: Write the hook**

Create `src/ui/processing/useLodOptions.ts`:

```ts
/**
 * Spec §6's LoD select, for one tool on one target.
 *
 * A hook rather than a pure function because a STREAMING target's options come
 * from the resident set, which changes on every camera settle — the
 * `useStreamStore` selector below is what subscribes the form to that
 * (`residentModel.ts` documents the version parameter as exactly this
 * subscription marker). A static layer's options never move, and the hook
 * memoises on the model's identity.
 *
 * AN UNIMPLEMENTED TOOL GETS NOTHING. Measure solids and Validate solids need
 * "does this object have a SOLID at this LoD", which nothing in M2 can answer;
 * printing "No solid geometry in this layer" for them would be a verdict on the
 * user's data that the app never reached. Their rows already say the true
 * thing — "Not available yet" — and their forms show no LoD control at all.
 */
import { useMemo } from "react";
import type { Layer } from "../../features/layers/layerStore";
import type { ToolDefinition } from "../../features/processing/types";
import {
  roofLodOptions,
  type LodOption,
} from "../../features/processing/roofGeometrySource";
import { useStreamStore } from "../../features/streaming/streamStore";

export interface LodChoices {
  readonly options: ReadonlyArray<LodOption>;
  /** The tail of an option's label: "2.2 (1,115 buildings <noun>)". */
  readonly noun: string;
  /** Spec §6: the empty select's text, and Run's reason. Null when it fits. */
  readonly emptyReason: string | null;
}

const NO_LOD: LodChoices = { options: [], noun: "", emptyReason: null };

export function useLodOptions(
  tool: ToolDefinition,
  target: Layer | null,
): LodChoices {
  // Subscribes the form to the stream's commits; 0 for a static layer.
  const version = useStreamStore((s) =>
    target === null ? 0 : (s.streams[target.id]?.version ?? 0),
  );
  const model = target?.model ?? null;
  const isStreaming = target?.isStreaming ?? false;
  return useMemo(() => {
    if (!tool.needsLod || !tool.implemented || target === null) return NO_LOD;
    if (tool.id !== "roof-metrics") return NO_LOD;
    const options = roofLodOptions(target);
    return {
      options,
      noun: "with roof surfaces",
      emptyReason:
        options.length === 0 ? "No roof surfaces in this layer" : null,
    };
    // `version` and `model` are the two things that can change the answer: a
    // streaming commit, or a layer whose model was replaced (`mergeAttributes`
    // mints a new one). `target` itself changes identity on every layer patch,
    // so it is deliberately not a dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tool.needsLod,
    tool.implemented,
    tool.id,
    target?.id,
    isStreaming,
    model,
    version,
  ]);
}
```

`streamStore.ts` loads under jsdom on this path — `tests/unit/ui/sidebar/LeftPanel.test.tsx` and `tests/unit/features/streaming/streamStore.test.ts` already import it, and it pulls in no `@navaramap/*` barrel. If the project's lint forbids the disable comment, list `target` in the deps and accept the extra recomputation: `roofLodOptions` is a tag walk, and `useToolForm` already recomputes eligibility per render.

- [ ] **Step 5: Fold the LoD into the form's draft**

Order matters here, because `lod` depends on `target`, which depends on the draft. Rename the existing `const draft: ToolDraft = …` ternary's result to `base` (`useToolForm.ts:81-92`, otherwise unchanged), keep `const target = layers.find((l) => l.id === base.targetLayerId) ?? null;` (`:93`), then add below it:

```ts
const lods = useLodOptions(tool, target);
// Spec §6: "Default: the layer's selected LoD when it qualifies, else the
// highest qualifying one." Computed, never written: a `setDraft` from a
// render is a side effect, and the stored draft is the USER's choice — one
// that stops qualifying (they switched target) must not be overwritten in
// the store, only overridden here.
const qualifies = (lod: string | null): boolean =>
  lod !== null && lods.options.some((o) => o.lod === lod);
const defaultLod = qualifies(target?.selectedLod ?? null)
  ? (target?.selectedLod ?? null)
  : (lods.options[0]?.lod ?? null);
const lod = qualifies(stored?.lod ?? null) ? (stored?.lod ?? null) : defaultLod;
const draft: ToolDraft = { ...base, lod };
```

Every line below `:93` already refers to `draft` by that name. Then extend `runReason` (`:150-152`):

```ts
// Precedence, top to bottom: what the TOOL cannot do here (eligibility),
// what the TARGET cannot offer (no qualifying LoD), then the things the user
// can fix in the form — the prefix, the parameters (Task 12), the scope.
const runReason = !eligibility.ok
  ? eligibility.reason
  : (lods.emptyReason ?? prefixError ?? scopeReason);
```

and add to the returned object (`:165-182`):

```ts
    lodOptions: lods.options,
    lodNoun: lods.noun,
    lodReason: lods.emptyReason,
```

Import `useLodOptions` at the top.

- [ ] **Step 6: Render it**

In `src/ui/processing/ToolView.tsx`, insert between the Layer `<label>` (ends `:126`) and the Scope `<div>` (`:127`):

Insert the CONTENTS of this fragment (the `{…}` expression, not the `<>` wrapper — that is only here so the snippet is valid JSX on its own and formatters leave it alone):

```tsx
<>
  {f.tool.needsLod && f.tool.implemented && (
    <label className="processing-field">
      <span>LoD</span>
      {f.lodOptions.length === 0 ? (
        // §6: "When no LoD qualifies the select shows [the empty text]
        // and Run is disabled with that reason." A disabled select with
        // one unselectable option, not a hidden field: the user has to
        // see WHICH requirement this layer fails.
        <select aria-label="LoD" disabled value="">
          <option value="">{f.lodReason}</option>
        </select>
      ) : (
        <select
          aria-label="LoD"
          value={f.draft.lod ?? ""}
          onChange={(e) => f.setDraft({ lod: e.target.value })}
        >
          {f.lodOptions.map((option) => (
            <option key={option.lod} value={option.lod}>
              {`${option.lod} (${plural(option.features, "building", "buildings")} ${f.lodNoun})`}
            </option>
          ))}
        </select>
      )}
    </label>
  )}
</>
```

`plural` is already imported (`ToolView.tsx:14`).

- [ ] **Step 7: Run the tests**

```bash
npx vitest run tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS, `ToolView.test.tsx` included (Height from extent has `needsLod: false`).

- [ ] **Step 8: Commit**

```bash
git add src/ui/processing/useLodOptions.ts src/ui/processing/useToolForm.ts \
  src/ui/processing/ToolView.tsx tests/unit/ui/processing/lodSelect.test.tsx \
  tests/unit/ui/processing/roofLayerFixture.tsx
git commit -m "feat(processing): the tool form offers the LoDs the target actually has"
```

---
