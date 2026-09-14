### Task 8: Switch Measure solids on

**Files:**

- Create: `src/ui/processing/SolidParams.tsx`
- Modify: `src/features/processing/toolRegistry.ts` (`implemented: true`), `src/ui/processing/useLodOptions.ts`, `src/ui/processing/ToolView.tsx`, and the two suites that used `measure-solids` AS their unimplemented example: `tests/unit/features/processing/eligibility.test.ts` and `tests/unit/ui/processing/lodSelect.test.tsx` (Step 5, same commit)
- Test: `tests/unit/ui/processing/SolidParams.test.tsx`, `tests/unit/ui/processing/solidsEnabled.test.tsx`

**Interfaces:**

- Consumes: `SOLID_MEASURES`, `solidParams` (Task 6), `solidLodOptions` (Task 3).
- Produces: `SolidParams` (props `{ params, onChange }` — `RoofMetricsParams.tsx:22-28`'s shape verbatim); `useLodOptions` answers for `measure-solids` with noun `"with a solid"` and `emptyReason` `"No solid geometry in this layer"`; `ToolView` dispatches the PARAMETERS section on `toolId === "measure-solids"`.

**The noun is §6 VERBATIM, not an adapted string.** §6's option pattern is spelled out in full there: `"2.2 (1,115 buildings with a solid)"`. `ToolView` renders `` `${lod} (${plural(features, "building", "buildings")} ${noun})` ``, so the noun is `with a solid` and the rendered option is §6's own sentence. (The plan's adapted-copy proposal A1 asked for exactly this; the spec already carries it, so no owner answer gates it.)

**The flip and the hook are ONE commit.** `ToolView` renders the LoD field on `needsLod && implemented` (`ToolView.tsx:136`), so `implemented: true` without the `useLodOptions` branch shows an empty, disabled select with a `null` reason in it — a control that claims nothing and blocks nothing. This is the M2 ledger's binding rule and the single thing a reviewer can reject here without rejecting any of the machinery.

**The flip also takes TWO existing tests with it, in the same commit.** Both use `measure-solids` as their stand-in for "an unimplemented tool", and both start asserting the opposite of the truth the moment it ships: `eligibility.test.ts`'s "rejects an unimplemented tool with the release note" (which expects `{ ok: false, reason: "Not available yet" }` for it) and `lodSelect.test.tsx`'s "does not offer a LoD, or any geometry verdict, for an UNIMPLEMENTED tool" (which expects no LoD combobox and the text "Not available yet"). The INVARIANT they protect is real and must survive — §6's rule that an unimplemented tool claims no fact about the user's data — so neither is deleted. Both move to an **explicitly unimplemented tool definition**, `{ ...toolById("measure-solids"), implemented: false }`, which is a fact the test states itself rather than borrowing from the registry. That also settles Task 10: retargeting them at `validate-solids` would buy one task's grace and then need doing again, because after Task 10 every `needsLod` tool in the registry is implemented.

Step 5 does both edits; `lodSelect`'s needs the hook rather than the view, because `ToolView` reads the registry by id and a hand-made definition cannot reach it through `toolId`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ui/processing/SolidParams.test.tsx`:

```tsx
/**
 * §7.2's parameters: six measure checkboxes, the mockup's four ticked, and the
 * one validation that blocks Run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SolidParams } from "../../../../src/ui/processing/SolidParams";

afterEach(cleanup);

describe("SolidParams", () => {
  it("renders the six measures with the mockup's four ticked", () => {
    render(<SolidParams params={{}} onChange={() => {}} />);
    for (const [label, checked] of [
      ["Volume (m³)", true],
      ["Envelope area (m²)", true],
      ["Footprint area (m²)", true],
      ["Height (m)", true],
      ["Ground elevation (m)", false],
      ["Ridge elevation (m)", false],
    ] as const) {
      expect(screen.getByRole("checkbox", { name: label })).toHaveProperty(
        "checked",
        checked,
      );
    }
  });

  it("writes the whole normalised bag back, in §7.2's order", () => {
    // Written back WHOLE, like `RoofMetricsParams`: the draft then holds an
    // explicit list, which is what makes "untick everything" a state the form
    // can reach at all.
    const onChange = vi.fn();
    render(<SolidParams params={{}} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Ridge elevation (m)" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      measures: ["volume", "envelope", "footprint", "height", "ridge"],
    });
  });

  it("can be emptied, which is the state Run refuses", () => {
    const onChange = vi.fn();
    render(
      <SolidParams params={{ measures: ["volume"] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Volume (m³)" }));
    expect(onChange).toHaveBeenCalledWith({ measures: [] });
  });

  it("carries §7.2's explanations as the labels' tooltips", () => {
    render(<SolidParams params={{}} onChange={() => {}} />);
    expect(
      screen.getByTitle("Only for a closed, valid solid"),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle("Ridge minus ground at this LoD"),
    ).toBeInTheDocument();
  });
});
```

Create `tests/unit/ui/processing/solidsEnabled.test.tsx`:

```tsx
/**
 * Measure solids, switched on: the LoD select's options and their FEATURE
 * counts, §6's empty state, the PARAMETERS section, the validation that blocks
 * Run, and the frozen request the Run button produces.
 *
 * A layer of its own rather than `roofLayerFixture`'s: this tool needs a READER
 * and an available SOURCE (`eligibility.ts:55-69`) and surfaces tagged with
 * their geometry TYPE, none of which the roof fixture has.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";

vi.mock("../../../../src/features/streaming/residentModel", () => ({
  getResidentModel: vi.fn(() => ({
    objects: {},
    cellCount: 0,
    featureCount: 0,
    surfaceAttrKeys: [],
  })),
}));

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
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
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
  all: 2 as number | null,
  matching: null as number | null,
  selected: 0 as number | null,
  loading: false,
  message: null as string | null,
};
vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: () => counts,
}));

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");

const surface = (lod: string, geometryType: string | null) => ({
  type: "RoofSurface",
  rings: [],
  attributes: {},
  lod,
  geometryType,
});

/** B1 (+part B1P) and B2 both carry a Solid at 2.2; B3 has only a MultiSurface. */
function solidModel(options: { solids?: boolean } = {}): CityModel {
  const kind = options.solids === false ? "MultiSurface" : "Solid";
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
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: object("B1", "Building", [surface("2.2", kind)], [], ["B1P"]),
      B1P: object("B1P", "BuildingPart", [surface("2.2", kind)], ["B1"]),
      B2: object("B2", "Building", [surface("1.2", kind)]),
      B3: object("B3", "Building", [surface("2.2", "MultiSurface")]),
    },
  } as unknown as CityModel;
}

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function addSolidLayer(options: { solids?: boolean } = {}): string {
  const input: LayerInput = {
    name: "Delft",
    model: solidModel(options),
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: false,
  };
  const id = useLayerStore.getState().addLayer(input);
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState((state) => ({
    tables: {
      ...state.tables,
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: "layer_1.city.json",
          // A READER and an available SOURCE: without both, eligibility
          // refuses the tool before the LoD select is ever rendered.
          source: async () => new Uint8Array(),
          reader: "read_cityjson",
          extension: "city.json",
          sourceBytes: 1024,
          columns: [
            { name: "id", type: "VARCHAR", kind: "scalar" },
            { name: "feature_id", type: "VARCHAR", kind: "scalar" },
          ],
          lods: [
            { label: "2.2", suffix: "2_2" },
            { label: "1.2", suffix: "1_2" },
          ],
          rowCount: 4,
        },
      },
    },
  }));
  return id;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
});

describe("Measure solids, switched on", () => {
  it("is no longer 'Not available yet' and offers §6's LoD options", () => {
    addSolidLayer();
    render(<ToolView toolId="measure-solids" />);
    const select = screen.getByRole("combobox", { name: "LoD" });
    expect(select).not.toBeDisabled();
    // §6's own sentence: "2.2 (1,115 buildings with a solid)". 2.2 counts B1
    // (through its part) — one FEATURE, not two rows. B3's MultiSurface is not
    // a solid, and B2's solid is at 1.2.
    expect(
      [...select.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual([
      "2.2 (1 building with a solid)",
      "1.2 (1 building with a solid)",
    ]);
  });

  it("shows §6's empty state and blocks Run when nothing has a solid", () => {
    addSolidLayer({ solids: false });
    render(<ToolView toolId="measure-solids" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toBeDisabled();
    expect(
      screen.getByText("No solid geometry in this layer"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("renders the PARAMETERS section and lists the promised columns", () => {
    addSolidLayer();
    render(<ToolView toolId="measure-solids" />);
    expect(screen.getByRole("checkbox", { name: "Volume (m³)" })).toBeChecked();
    expect(
      screen.getByText(
        "solid_volume_m3, solid_envelope_m2, solid_footprint_m2, solid_height_m, solid_valid",
      ),
    ).toBeInTheDocument();
  });

  it("blocks Run with §6's message when every measure is unticked", () => {
    addSolidLayer();
    render(<ToolView toolId="measure-solids" />);
    for (const label of [
      "Volume (m³)",
      "Envelope area (m²)",
      "Footprint area (m²)",
      "Height (m)",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    expect(screen.getByText("Pick at least one measure")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    // `<prefix>valid` is still promised: §7.2 writes it always.
    expect(screen.getByText("solid_valid")).toBeInTheDocument();
  });

  it("freezes the normalised parameters, the LoD and the typed columns", () => {
    const id = addSolidLayer();
    render(<ToolView toolId="measure-solids" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "measure-solids",
        targetLayerId: id,
        // §6's default: "the layer's selected LoD when it qualifies, else the
        // highest qualifying one".
        lod: "2.2",
        prefix: "solid_",
        params: { measures: ["volume", "envelope", "footprint", "height"] },
        columns: [
          { name: "solid_volume_m3", type: "DOUBLE" },
          { name: "solid_envelope_m2", type: "DOUBLE" },
          { name: "solid_footprint_m2", type: "DOUBLE" },
          { name: "solid_height_m", type: "DOUBLE" },
          { name: "solid_valid", type: "BOOLEAN" },
        ],
      }),
    );
  });

  it("shows the workload note for a large source", () => {
    // §6, and the positive half of Task 5's test: this tool re-reads the
    // source, so the warning applies to it.
    const id = addSolidLayer();
    useLayerTableStore.setState((s) => {
      const entry = s.tables[id];
      if (entry?.state !== "ready") return s;
      return {
        tables: {
          ...s.tables,
          [id]: { ...entry, info: { ...entry.info, sourceBytes: 180_000_000 } },
        },
      };
    });
    render(<ToolView toolId="measure-solids" />);
    expect(
      screen.getByText(
        "Re-reads a 180 MB source; this can take a minute and needs memory",
      ),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/processing/SolidParams.test.tsx \
  tests/unit/ui/processing/solidsEnabled.test.tsx
```

Expected: FAIL — `SolidParams` does not exist, and every `solidsEnabled` case fails on "Not available yet" with no LoD field rendered.

- [ ] **Step 3: Write the PARAMETERS section**

Create `src/ui/processing/SolidParams.tsx`:

```tsx
/**
 * Spec §7.2's parameters: six measure checkboxes.
 *
 * A component of its own, taking `{ params, onChange }` and touching no store,
 * so §6's "PARAMETERS: tool-specific" stays one conditional in `ToolView`
 * rather than a growing branch inside the form — the same shape
 * `RoofMetricsParams` has. There is no slider and no threshold here: §7.2's
 * only parameter besides the LoD is which measures to write.
 *
 * `<prefix>valid` is not a checkbox. §7.2 writes it always, and offering a tick
 * for a column the run writes either way would be a control that does nothing.
 */
import {
  SOLID_MEASURES,
  solidParams,
  type SolidMeasure,
} from "../../features/processing/solidParams";

export function SolidParams({
  params,
  onChange,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
}) {
  // Normalised on the way in, so an untouched draft (`params: {}`) renders the
  // defaults, and written back WHOLE on every change — the draft then holds an
  // explicit list, which is what makes "untick everything" a state the form can
  // reach at all.
  const current = solidParams(params);
  const ticked = new Set<SolidMeasure>(current.measures);

  const toggle = (key: SolidMeasure) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({
      ...current,
      measures: SOLID_MEASURES.map((m) => m.key).filter((k) => next.has(k)),
    });
  };

  return (
    <div className="processing-checks">
      {SOLID_MEASURES.map((measure) => (
        // §7.2's parentheticals, which the labels trim, live here: a tooltip
        // the label carries rather than a second muted line under every box.
        <label key={measure.key} title={measure.hint ?? undefined}>
          <input
            type="checkbox"
            checked={ticked.has(measure.key)}
            onChange={() => toggle(measure.key)}
          />
          {measure.label}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Teach `useLodOptions` about solids**

In `src/ui/processing/useLodOptions.ts`, add the import:

```ts
import { solidLodOptions } from "../../features/processing/solidGeometrySource";
```

and replace the body of the `useMemo`. Find:

```ts
if (!tool.needsLod || !tool.implemented || target === null) return NO_LOD;
if (tool.id !== "roof-metrics") return NO_LOD;
const options = roofLodOptions(target);
return {
  options,
  noun: "with roof surfaces",
  emptyReason: options.length === 0 ? "No roof surfaces in this layer" : null,
};
```

and replace with:

```ts
if (!tool.needsLod || !tool.implemented || target === null) return NO_LOD;
if (tool.id === "roof-metrics") {
  const options = roofLodOptions(target);
  return {
    options,
    noun: "with roof surfaces",
    emptyReason: options.length === 0 ? "No roof surfaces in this layer" : null,
  };
}
if (tool.id === "measure-solids") {
  // §6, verbatim: the option reads "2.2 (1,115 buildings with a solid)" and
  // the empty select reads "No solid geometry in this layer". TAGS ONLY
  // (`solidLodOptions`) — opening a dropdown measures nothing.
  const options = solidLodOptions(target);
  return {
    options,
    noun: "with a solid",
    emptyReason:
      options.length === 0 ? "No solid geometry in this layer" : null,
  };
}
return NO_LOD;
```

and update the module's header comment: the paragraph beginning "AN UNIMPLEMENTED TOOL GETS NOTHING. Measure solids and Validate solids need…" now reads:

```
 * AN UNIMPLEMENTED TOOL GETS NOTHING. A tool whose executor has not shipped has
 * no source of truthful counts, and printing "No solid geometry in this layer"
 * for it would be a verdict on the user's data that the app never reached. Its
 * row already says the true thing — "Not available yet" — and its form shows no
 * LoD control at all.
```

- [ ] **Step 5: Dispatch the section and flip the tool on**

In `src/ui/processing/ToolView.tsx`, add the import beside `RoofMetricsParams`:

```ts
import { SolidParams } from "./SolidParams";
```

and after the `roof-metrics` PARAMETERS block, add the `{…}` block below — the `<>` and `</>` are only there to keep the snippet valid on its own (a bare `{…}` in a code fence is a BLOCK statement, and the formatter rewrites it into one with a stray `;` inside the JSX). They are not part of the edit:

```tsx
<>
  {toolId === "measure-solids" && (
    <fieldset className="processing-section" disabled={locked}>
      <legend className="processing-group__label">PARAMETERS</legend>
      <SolidParams
        params={f.draft.params}
        onChange={(params) => f.setDraft({ params })}
      />
      {f.paramsError !== null && (
        <p className="processing-error" role="alert">
          {f.paramsError}
        </p>
      )}
    </fieldset>
  )}
</>
```

In `src/features/processing/toolRegistry.ts`, in the `measure-solids` entry, replace the `implemented: false` line and the comment above it with:

```ts
    implemented: true,
```

- [ ] **Step 6: Move the unimplemented-tool invariant onto a definition that says so**

In `tests/unit/features/processing/eligibility.test.ts`, replace the "rejects an unimplemented tool with the release note" case:

```ts
it("rejects an unimplemented tool with the release note", () => {
  // The tool is unimplemented BY DECLARATION, not by whichever registry entry
  // has not shipped yet — Measure solids ships in this commit, and the rule
  // §6 states ("a tool whose executor has not shipped claims no fact about
  // the user's data") outlives every one of them.
  const tool = { ...toolById("measure-solids"), implemented: false };
  expect(toolEligibility(tool, base)).toEqual({
    ok: false,
    reason: "Not available yet",
  });
});
```

In `tests/unit/ui/processing/lodSelect.test.tsx`, the case "does not offer a LoD, or any geometry verdict, for an UNIMPLEMENTED tool" drives `<ToolView toolId="measure-solids" />`, which reads the registry by id and so cannot be handed a definition. Replace it with a hook-level case that can, keeping the view-level half that is still true (Measure solids is implemented now, so the honest view-level assertion moves into `solidsEnabled.test.tsx`, where Step 1 already made it). Add `renderHook` to the `@testing-library/react` import and

```ts
const { useLodOptions } =
  await import("../../../../src/ui/processing/useLodOptions");
const { toolById } =
  await import("../../../../src/features/processing/toolRegistry");
```

beside the suite's other dynamic imports, then:

```tsx
it("answers NOTHING for an unimplemented tool, whatever the layer holds", () => {
  // §6: a tool whose executor has not shipped has no source of truthful
  // counts, so printing "No solid geometry in this layer" over a layer full
  // of solids would be a verdict the app never reached. Stated on a
  // definition that declares itself unimplemented, so the invariant survives
  // every tool in the registry shipping.
  addRoofLayer();
  const target = useLayerStore.getState().layers[0]!;
  const tool = { ...toolById("measure-solids"), implemented: false };
  const { result } = renderHook(() => useLodOptions(tool, target));
  expect(result.current).toEqual({
    options: [],
    noun: "",
    emptyReason: null,
  });
});
```

(`addRoofLayer` and `useLayerStore` are the suite's own; the roof layer is used because it is the one it already stands up — the point is that a real layer with real geometry still gets nothing.)

- [ ] **Step 7: Run to pass, and verify the control in a browser**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/processing tests/unit/features/processing
npx tsc -b --noEmit
npx vp check
```

Expected: PASS, and `vp check` still 0 errors / 56 warnings.

Then, per the UI consistency rule, check the new checkbox group against its peer in a real browser: `npm run dev`, open Tools → Measure solids, and compare the six checkboxes against Roof metrics' six — same 8 px radius, same row spacing, same focus ring (they share `.processing-checks`, so a difference means a token was bypassed).

- [ ] **Step 8: Commit**

```bash
git add src/ui/processing/SolidParams.tsx src/ui/processing/useLodOptions.ts \
  src/ui/processing/ToolView.tsx src/features/processing/toolRegistry.ts \
  tests/unit/ui/processing/SolidParams.test.tsx \
  tests/unit/ui/processing/solidsEnabled.test.tsx \
  tests/unit/features/processing/eligibility.test.ts \
  tests/unit/ui/processing/lodSelect.test.tsx
git commit -m "feat: switch Measure solids on"
```

---
