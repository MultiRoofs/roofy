import { useSolarStore } from "../../../src/features/solar/solarStore";
import { useRenderDebugStore } from "../../../src/features/debug/renderDebugStore";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Walkthrough } from "../../../src/ui/walkthrough/Walkthrough";
import { walkthroughStore } from "../../../src/features/walkthrough/walkthroughStore";
import { useLayerStore } from "../../../src/features/layers/layerStore";
import { useSelectionStore } from "../../../src/features/selection/selectionStore";
import { useWorkspaceStore } from "../../../src/features/workspace/workspaceStore";
import { useQueryStore } from "../../../src/features/query/queryStore";
import { useProcessingStore } from "../../../src/features/processing/processingStore";
import { DELFT_SAMPLE_URL } from "../../../src/features/walkthrough/steps";
import { roofModel } from "./processing/roofLayerFixture";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  useLayerStore.setState({ layers: [] });
  useSelectionStore.getState().clear();
  useProcessingStore.setState({ runs: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  walkthroughStore.setState({ phase: "idle", index: 0 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function addDelft() {
  return useLayerStore.getState().addLayer({
    name: "delft.city.jsonl",
    visible: true,
    rules: [],
    model: roofModel(),
    modelRef: { type: "url", url: DELFT_SAMPLE_URL },
  });
}
const renderTour = (onLoadSample = vi.fn()) =>
  render(
    <Walkthrough
      onLoadSample={onLoadSample}
      loading={false}
      loadError={null}
    />,
  );

describe("interactive walkthrough", () => {
  it("starts from the invitation and waits for successful loading", () => {
    walkthroughStore.setState({ phase: "welcome" });
    const load = vi.fn();
    renderTour(load);
    fireEvent.click(screen.getByRole("button", { name: "Start walkthrough" }));
    expect(
      screen.getByRole("heading", { name: "Start with Delft" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Load Delft sample" }));
    expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    act(() => {
      addDelft();
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Load Delft sample" }),
    ).toBeNull();
  });
  it("requires selecting a feature in the example layer", () => {
    const id = addDelft();
    walkthroughStore.setState({ phase: "active", index: 1 });
    renderTour();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    act(() =>
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: id, objectId: "B1" }),
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "Read its attributes" }),
    ).toBeTruthy();
  });
  it("recognises applied filters, not draft edits", () => {
    const id = addDelft();
    walkthroughStore.setState({ phase: "active", index: 4 });
    renderTour();
    act(() =>
      useQueryStore.getState().setFilter(id, {
        logic: "AND",
        conditions: [{ id: "c", column: "height", op: ">", value: 15 }],
      }),
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    act(() => useQueryStore.getState().applyFilter(id));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
  it("offers recovery if the sample is removed and Escape dismisses", () => {
    walkthroughStore.setState({ phase: "active", index: 3 });
    renderTour();
    expect(
      screen.getByRole("heading", { name: "Bring Delft back" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Load Delft sample" }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("region", { name: "Roofy walkthrough" }),
    ).toBeNull();
  });
  it("requires a time change with shadows enabled", () => {
    addDelft();
    walkthroughStore.setState({ phase: "active", index: 8 });
    const before = useSolarStore.getState().datetime.getTime();
    useRenderDebugStore.getState().setSunShadowsEnabled(false);
    renderTour();
    act(() => useSolarStore.getState().setDatetime(new Date(before + 3600000)));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    act(() => useRenderDebugStore.getState().setSunShadowsEnabled(true));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
  it("lets a dialog handle Escape without dismissing the guide", () => {
    walkthroughStore.setState({ phase: "active", index: 9 });
    renderTour();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.getByRole("region", { name: "Roofy walkthrough" }),
    ).toBeTruthy();
    dialog.remove();
  });
  it.each([
    { stale: true, note: null },
    { stale: false, note: "Undone" },
  ])("rejects invalidated volume results %o", (invalid) => {
    const id = addDelft();
    walkthroughStore.setState({ phase: "active", index: 6 });
    useProcessingStore.setState({
      runs: [
        {
          id: "run",
          targetLayerId: id,
          targetName: "Delft",
          targetDerivedFrom: null,
          sourceLayerId: null,
          sourceName: null,
          scope: "all",
          scopeCount: 1,
          featureIds: null,
          lod: "2.2",
          prefix: "solid_",
          columns: ["solid_volume_m3"],
          phase: null,
          startedAt: 0,
          elapsedMs: 1,
          summary: null,
          error: null,
          log: [],
          warnings: [],
          undoable: true,
          destination: "layer",
          newLayerName: null,
          newLayerId: null,
          toolId: "measure-solids",
          status: "done",
          params: { measures: ["volume"] },
          ...invalid,
        },
      ],
    });
    renderTour();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    act(() =>
      useProcessingStore
        .getState()
        .patchRun("run", { stale: false, note: null }),
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
  it("keeps completion available after closing the share dialog", async () => {
    addDelft();
    walkthroughStore.setState({ phase: "active", index: 9 });
    renderTour();
    const dialog = document.createElement("div");
    dialog.className = "share-dialog";
    act(() => {
      document.body.append(dialog);
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled(),
    );
    act(() => {
      dialog.remove();
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled();
  });
});

it("completes the statistics step after column statistics load", async () => {
  addDelft();
  walkthroughStore.setState({ phase: "active", index: 5 });
  renderTour();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  const stats = document.createElement("div");
  stats.className = "column-stats-popover";
  stats.innerHTML = "<dl><dt>Minimum</dt><dd>1</dd></dl>";
  document.body.append(stats);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled(),
  );
  stats.remove();
});

it("lets column statistics handle Escape without dismissing the guide", () => {
  addDelft();
  walkthroughStore.setState({ phase: "active", index: 5 });
  renderTour();
  const stats = document.createElement("div");
  stats.className = "column-stats-popover";
  document.body.append(stats);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(walkthroughStore.getState().phase).toBe("active");
  stats.remove();
});
