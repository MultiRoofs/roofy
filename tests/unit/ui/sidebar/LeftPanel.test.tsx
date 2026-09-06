/**
 * The redesign's left panel: the workspace's layers over the ACTIVE layer's
 * own configuration, in one full-height column.
 *
 * It replaces `LeftSidebar` + `LayerPanel`, and the three things it owns that
 * neither of those did are what this file pins:
 *
 *  - the two halves are ONE panel — the list in the top region, the active
 *    layer's panel under a hairline in its own scroll container — so nothing
 *    has to be scrolled past to reach the other;
 *  - "Open table" is the panel's own wiring (activate + open the drawer), not
 *    a boolean threaded down from `App`;
 *  - a row's `⋯` popover must survive the list's scroll container. It is
 *    absolutely positioned inside a box with `overflow-y: auto`, which clips
 *    it — so it is PORTALLED, and the test asserts both halves of that: it is
 *    outside the list in the DOM, and a real press (mousedown, then click)
 *    still reaches its items rather than being eaten by the dismiss listener.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { LeftPanel } from "../../../../src/ui/sidebar/LeftPanel";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import {
  defaultShellState,
  useShellStore,
} from "../../../../src/ui/shell/shellStore";
import type {
  CityModel,
  CityObject,
} from "../../../../src/domain/citymodel/types";

vi.mock("../../../../src/features/streaming/openStreamingLayer", () => ({
  closeStreamingLayer: vi.fn(),
}));

function reset(): void {
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useStreamStore.setState({ streams: {} });
  useShellStore.setState(defaultShellState(1440, 900));
}

beforeEach(reset);

afterEach(() => {
  cleanup();
  reset();
});

function cityObject(): CityObject {
  return {
    id: "b0",
    objectType: "Building",
    surfaces: [],
    attributes: {},
    children: [],
    parents: [],
    bbox: null,
    lod: null,
  } as CityObject;
}

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: { b0: cityObject() },
    vertexCount: 0,
  };
}

function layer(
  overrides: Partial<Layer> & { id: string; name: string },
): Layer {
  return {
    model: model(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    ...overrides,
  } as Layer;
}

function seed(...layers: ReadonlyArray<Layer>): void {
  useLayerStore.setState({ layers });
  useWorkspaceStore.setState({ activeLayerId: layers[0]?.id ?? null });
}

function renderPanel(props: Partial<Parameters<typeof LeftPanel>[0]> = {}): {
  onZoomToLayer: ReturnType<typeof vi.fn>;
} {
  const onZoomToLayer = vi.fn();
  render(
    <LeftPanel
      onAddFile={vi.fn()}
      onAddFiles={vi.fn()}
      onAddUrl={vi.fn(async () => ({ ok: true }) as const)}
      loading={false}
      onZoomToLayer={onZoomToLayer}
      dismissFailed={vi.fn()}
      {...props}
    />,
  );
  return { onZoomToLayer };
}

/** Open a row's `⋯` popover and return it. Its items are named the same as
 *  the active layer's own action buttons ("Zoom to layer", "Open table"), so
 *  every assertion below is scoped to one or the other. */
function openRowMenu(name: string): HTMLElement {
  fireEvent.click(
    screen.getByRole("button", { name: `Layer actions for ${name}` }),
  );
  return screen.getByRole("dialog", { name: "Layer actions" });
}

/** A real press on a popover item: mousedown FIRST, which is what the
 *  dismiss listener sees. `fireEvent.click` alone never raises it, so a
 *  portalled item that the outside-click handler closes before the click
 *  lands would pass vacuously. */
function press(item: HTMLElement): void {
  fireEvent.mouseDown(item);
  fireEvent.click(item);
}

describe("LeftPanel", () => {
  it("puts the layer list and the active layer's panel in one column", () => {
    seed(layer({ id: "l1", name: "Delft" }));
    renderPanel();

    expect(screen.getByText("LAYERS")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Layers" })).toBeTruthy();
    expect(screen.getByLabelText("Active layer: Delft")).toBeTruthy();
  });

  it("scrolls the active layer's panel on its own, under a hairline", () => {
    seed(layer({ id: "l1", name: "Delft" }));
    const { container } = render(
      <LeftPanel
        onAddFile={vi.fn()}
        onAddFiles={vi.fn()}
        onAddUrl={vi.fn(async () => ({ ok: true }) as const)}
        loading={false}
        onZoomToLayer={vi.fn()}
        dismissFailed={vi.fn()}
      />,
    );

    // Two scroll regions, not one: the list must not be scrolled past to
    // reach the configuration of the layer that is highlighted in it.
    expect(container.querySelector(".left-panel-list")).not.toBeNull();
    const active = container.querySelector(".left-panel-active");
    expect(active).not.toBeNull();
    expect(active?.querySelector(".active-layer")).not.toBeNull();
  });

  it("opens the Add layer dialog from the panel's own button", () => {
    seed(layer({ id: "l1", name: "Delft" }));
    renderPanel();

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("says so, and offers the one way out, when there are no layers", () => {
    renderPanel();

    expect(screen.getByText("No layers yet")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Layers" })).toBeNull();
    // The empty state is not a dead end.
    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("is not empty while an add is still in flight", () => {
    renderPanel({ pending: [{ id: "add-1", name: "delft.city.json" }] });

    expect(screen.queryByText("No layers yet")).toBeNull();
    expect(screen.getByText("delft.city.json")).toBeTruthy();
  });

  it("resizes the shell's left column from its right-edge handle", () => {
    seed(layer({ id: "l1", name: "Delft" }));
    renderPanel();

    const handle = screen.getByRole("separator", {
      name: "Resize layers panel",
    });
    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 });
    // The handle is on the panel's RIGHT edge: dragging right widens it.
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 340, pointerId: 1 }),
    );
    expect(useShellStore.getState().leftWidth).toBe(340);

    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 400, pointerId: 1 }),
    );
    expect(useShellStore.getState().leftWidth).toBe(340);
  });

  it("opens a row's table by activating it and opening the drawer", () => {
    seed(layer({ id: "l1", name: "Delft" }), layer({ id: "l2", name: "Rome" }));
    renderPanel();
    expect(useShellStore.getState().drawerOpen).toBe(false);

    const menu = openRowMenu("Rome");
    press(within(menu).getByRole("button", { name: "Open table" }));

    expect(useWorkspaceStore.getState().activeLayerId).toBe("l2");
    expect(useShellStore.getState().drawerOpen).toBe(true);
  });

  it("hangs the row menu outside the list, so its scroll box cannot clip it", () => {
    seed(layer({ id: "l1", name: "Delft" }));
    const { container } = render(
      <LeftPanel
        onAddFile={vi.fn()}
        onAddFiles={vi.fn()}
        onAddUrl={vi.fn(async () => ({ ok: true }) as const)}
        loading={false}
        onZoomToLayer={vi.fn()}
        dismissFailed={vi.fn()}
      />,
    );

    const popover = openRowMenu("Delft");
    expect(container.querySelector(".left-panel-list")?.contains(popover)).toBe(
      false,
    );
    expect(document.body.contains(popover)).toBe(true);
  });

  it("flies to a layer from the list AND from the active layer's panel", () => {
    seed(layer({ id: "l1", name: "Delft" }));
    const { onZoomToLayer } = renderPanel();

    const menu = openRowMenu("Delft");
    press(within(menu).getByRole("button", { name: "Zoom to layer" }));
    expect(onZoomToLayer).toHaveBeenCalledTimes(1);
    expect(onZoomToLayer.mock.calls[0]?.[0]).toMatchObject({
      kind: "city",
      layer: { id: "l1" },
    });

    // The panel's own button — the same handler, so a caller wires zoom once.
    const active = screen.getByLabelText("Active layer: Delft");
    press(within(active).getByRole("button", { name: "Zoom to layer" }));
    expect(onZoomToLayer).toHaveBeenCalledTimes(2);
  });
});
