### Task 13: Switch the tool on

**Files:**

- Modify: `src/features/processing/toolRegistry.ts` (the `roof-metrics` entry's `implemented`)
- Modify: `tests/unit/ui/processing/lodSelect.test.tsx`, `tests/unit/ui/processing/RoofMetricsParams.test.tsx` (drop the registry shim), `tests/unit/features/processing/eligibility.test.ts` (the "still reads Not available yet" test), `tests/unit/ui/processing/CatalogueView.test.tsx` if it used Roof metrics as its disabled-row example
- Test: `tests/unit/ui/processing/roofMetricsEnabled.test.tsx`

This task exists on its own because it is the moment the tool becomes reachable, and it is the one a reviewer should be able to reject without rejecting any of the machinery. Everything it needs — executor, registration, LoD select, parameters, validation — landed in Tasks 9, 11 and 12.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/processing/roofMetricsEnabled.test.tsx`. Copy `lodSelect.test.tsx`'s header **minus the `toolRegistry` mock** — that omission is the point of this file: it is the only suite that sees the real registry. It renders both `CatalogueView` and `ToolView`, so it needs `useShellStore` in the reset too (the catalogue's row click reaches it through `openToolView`).

```tsx
/**
 * The tool is ON: the catalogue row is enabled against the REAL registry, its
 * executor is wired, and the form it opens is usable end to end. No registry
 * mock — every other Roof metrics suite enables the tool by hand, and this one
 * is what proves the flip actually happened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// …the three vi.mock blocks from lodSelect.test.tsx, verbatim, WITHOUT the
// toolRegistry one…

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { CatalogueView } =
  await import("../../../../src/ui/processing/CatalogueView");
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
const { EXECUTORS } = await import("../../../../src/features/processing/tools");
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
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");
const { addRoofLayer } = await import("./roofLayerFixture");
// The side-effect module, so `EXECUTORS` is populated the way a real session
// populates it (`runQueue.ts` imports it; nothing here imports the tool).
await import("../../../../src/features/processing/tools/register");

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
  useShellStore.getState().requestSection(null);
});

describe("Roof metrics to attributes, switched on", () => {
  it("is registered as an executor", () => {
    expect(EXECUTORS["roof-metrics"]).toBeTypeOf("function");
  });

  it("has an enabled catalogue row on a ready city layer", () => {
    addRoofLayer();
    render(<CatalogueView />);
    const row = screen
      .getByText("Roof metrics to attributes")
      .closest("button")!;
    expect(row).toHaveAttribute("aria-disabled", "false");
    expect(row.textContent).not.toContain("Not available yet");
  });

  it("opens a form that can actually be run", () => {
    addRoofLayer();
    render(<ToolView toolId="roof-metrics" />);
    expect(screen.getByRole("combobox", { name: "LoD" })).toBeEnabled();
    expect(screen.getByLabelText("Total roof area (m²)")).toBeChecked();
    expect(
      screen.getByText(
        "roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg, roof_azimuth_deg, roof_surfaces_n",
      ),
    ).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run" });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    expect(vi.mocked(submitRun)).toHaveBeenCalledTimes(1);
    const request = vi.mocked(submitRun).mock.calls[0]![0]!;
    expect(request.toolId).toBe("roof-metrics");
    expect(request.lod).toBe("2.2");
    expect(request.params).toEqual({
      measures: [
        "area",
        "flatArea",
        "flatShare",
        "slope",
        "azimuth",
        "surfaces",
      ],
      flatThresholdDeg: 5,
    });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/ui/processing/roofMetricsEnabled.test.tsx
```

Expected: FAIL — the row is `aria-disabled="true"` with "Not available yet", there is no LoD combobox, and Run is disabled with the same reason. (`EXECUTORS["roof-metrics"]` already passes: Task 9 wired the executor; `implemented` is a registry flag, not a registration.)

- [ ] **Step 3: Flip it**

In `src/features/processing/toolRegistry.ts`, on the `roof-metrics` entry: `implemented: true`, and delete the comment Task 8 left there.

- [ ] **Step 4: Remove the scaffolding the shim was standing in for**

- `tests/unit/ui/processing/lodSelect.test.tsx` and `RoofMetricsParams.test.tsx`: delete the `vi.mock(".../toolRegistry", …)` block that enabled `roof-metrics`, and nothing else — their imports, `counts` object and reset pair stay. Both suites must pass unchanged against the real registry; if either needs another edit, the flip did not deliver what the mock was standing in for.
- `tests/unit/features/processing/eligibility.test.ts`: delete the "still reads 'Not available yet' until Task 13 switches it on" test, and replace `enabledRoof` with `toolById("roof-metrics")` in the two that used it.
- `tests/unit/ui/processing/CatalogueView.test.tsx`: if its "a disabled row still opens the tool view" case used Roof metrics, repoint it at `measure-solids`, which is still unimplemented.

- [ ] **Step 5: Run the whole suite**

```bash
npx vitest run
npx tsc -b --noEmit
npx vp check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/processing/toolRegistry.ts tests/unit
git commit -m "feat(processing): switch Roof metrics to attributes on"
```

---
