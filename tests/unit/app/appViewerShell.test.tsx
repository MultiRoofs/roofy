/**
 * The viewer branch's shell wiring: the layout state that used to be `App`'s
 * own (`inspectorOpen`, `leftSidebarCollapsed`, `leftSidebarWidth`,
 * `tableOpen`, `tableHeight`) now lives in `shellStore`, and the right column
 * follows the SELECTION rather than a toggle.
 *
 * The engine is never imported: `NavaraViewport` is mocked (jsdom has no
 * WebGL, and `@navaramap/three` crashes at module scope under Node).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import type {
  ProjectStateStore,
  SnapshotSummary,
} from "../../../src/persistence/types";
import type { CityObject } from "../../../src/domain/citymodel/types";

// jsdom ships no `matchMedia`, which `useTheme` reads on its first render.
window.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

vi.mock("../../../src/scene/NavaraViewport", () => ({
  NavaraViewport: forwardRef<CitySceneHandle, Record<string, unknown>>(
    function MockNavaraViewport(_props, ref) {
      useImperativeHandle(ref, () => null as unknown as CitySceneHandle, []);
      return <div data-testid="navara-viewport" />;
    },
  ),
}));

vi.mock("../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { App } = await import("../../../src/app/App");
const { useLayerStore } =
  await import("../../../src/features/layers/layerStore");
const { useSelectionStore } =
  await import("../../../src/features/selection/selectionStore");
const { useGeoLayerStore } =
  await import("../../../src/features/geoLayers/geoLayerStore");
const { useWorkspaceStore } =
  await import("../../../src/features/workspace/workspaceStore");
const { useShellStore, defaultShellState } =
  await import("../../../src/ui/shell/shellStore");
const { useSceneSheetStore } =
  await import("../../../src/features/sceneSheet/sceneSheetStore");

const emptyStore: ProjectStateStore = {
  list: async (): Promise<SnapshotSummary[]> => [],
  load: async () => null,
  save: async () => "snapshot-1",
  remove: async () => {},
};

const building: CityObject = {
  id: "NL.IMBAG.Pand.0503100000025028",
  objectType: "Building",
  attributes: { measuredHeight: 12 },
  surfaces: [],
  bbox: [0, 0, 0, 10, 5, 3],
  children: [],
  parents: [],
  lod: "2.2",
};

const model = {
  sourceEncoding: "cityjson" as const,
  metadata: { referenceSystem: "EPSG:7415" },
  bbox: null,
  objects: { [building.id]: building },
  vertexCount: 0,
};

function renderViewer() {
  useLayerStore.getState().addLayer({
    id: "city-1",
    name: "delft.city.json",
    model,
    modelRef: { type: "url", url: "https://example.test/delft.city.json" },
    visible: true,
    rules: [],
    isStreaming: false,
  });
  const { container } = render(<App persistenceStore={emptyStore} />);
  return () => container.querySelector(".viewer-shell") as HTMLElement;
}

/** A picked feature of a real geo layer: `App` drops a geo selection whose
 *  layer is gone, so the layer has to exist. */
function selectGeoFeature(
  properties: Readonly<Record<string, unknown>> = {},
): void {
  const geoLayerId = useGeoLayerStore.getState().addGeoLayer({
    name: "roads",
    kind: "geojson",
    config: { url: "https://x/roads.geojson" },
  });
  act(() => {
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId, batchId: 7, properties });
  });
}

function select(): void {
  act(() => {
    useSelectionStore.getState().select({
      kind: "object",
      layerId: "city-1",
      objectId: building.id,
    });
  });
}

beforeEach(() => {
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useSelectionStore.setState({ selections: [], geoSelection: null });
  useGeoLayerStore.setState({ layers: [] });
  useSceneSheetStore.setState({ sheet: null });
  // jsdom is 1024×768, below both of `defaultShellState`'s breakpoints.
  useShellStore.setState(defaultShellState(1440, 900));
});

afterEach(cleanup);

describe("App viewer shell", () => {
  it("opens the right column for a GEO feature too, and closes it on clear", () => {
    const shell = renderViewer();

    selectGeoFeature();

    expect(shell().querySelector(".shell-right")).not.toBeNull();
    expect(shell().style.getPropertyValue("--right-w")).toBe("340px");

    act(() => useSelectionStore.getState().clear());

    expect(shell().style.getPropertyValue("--right-w")).toBe("0");
    expect(shell().querySelector(".shell-right")).toBeNull();
  });

  it("names the collapsed pill after what is selected", () => {
    renderViewer();
    select();
    act(() => useShellStore.getState().setRightCollapsed(true));

    // One object: the id's tail, which is what distinguishes it.
    expect(
      screen.getByRole("button", { name: "Details · …100000025028" }),
    ).toBeTruthy();

    act(() => {
      useSelectionStore.getState().toggleSelect({
        kind: "object",
        layerId: "city-1",
        objectId: "second-building",
      });
    });
    expect(
      screen.getByRole("button", { name: "Details · 2 selected" }),
    ).toBeTruthy();

    selectGeoFeature();
    expect(
      screen.getByRole("button", { name: "Details · Feature" }),
    ).toBeTruthy();
  });

  it("gives the right column no width until something is selected", () => {
    const shell = renderViewer();

    expect(shell().style.getPropertyValue("--right-w")).toBe("0");
    expect(shell().querySelector(".shell-right")).toBeNull();

    select();

    expect(shell().style.getPropertyValue("--right-w")).toBe("340px");
    expect(shell().querySelector(".details-panel")).not.toBeNull();
  });

  // A geo feature pick has no city-object identity (`GeoFeatureSelection` is
  // deliberately outside the `Selection` union — see its doc comment), so it
  // never reaches the building details. `App` renders the SAME `DetailsPanel`
  // for every selection kind; the geo view shows the layer name, a summary
  // and the feature's own properties.
  it("shows the picked geo feature's layer name and properties", () => {
    const shell = renderViewer();

    selectGeoFeature({ highway: "residential", lanes: 2 });

    const right = shell().querySelector(".shell-right") as HTMLElement;
    expect(right).not.toBeNull();
    expect(within(right).getByText("roads")).toBeTruthy();
    expect(within(right).getAllByText("highway").length).toBeGreaterThan(0);
    expect(within(right).getAllByText("residential").length).toBeGreaterThan(0);
    expect(within(right).getAllByText("lanes").length).toBeGreaterThan(0);
    expect(within(right).getAllByText("2").length).toBeGreaterThan(0);
    // No city tabs for a geo feature: there is nothing for them to tab
    // between.
    expect(within(right).queryByRole("button", { name: "Object" })).toBeNull();
  });

  // The close button is NOT the same affordance as the header's collapse
  // chevron (WorkspaceHeader.test.tsx covers that one): closing the panel
  // from its own "×" clears the selection outright, same as Escape
  // (`useEscapeClearsSelection`) — Task 20 reverses the T14 "collapse only"
  // behaviour on purpose, so there is no pill to bring the panel back.
  it("clears the selection when the details panel's own close button is used", () => {
    const shell = renderViewer();
    select();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(shell().querySelector(".details-panel")).toBeNull();
    expect(shell().querySelector(".shell-right")).toBeNull();
    expect(useSelectionStore.getState().selections).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Details ·/ })).toBeNull();
  });

  it("collapses the left panel to the rail through the shell store", () => {
    const shell = renderViewer();
    expect(shell().style.getPropertyValue("--left-w")).toBe("300px");
    expect(shell().querySelector(".left-panel")).not.toBeNull();
    expect(shell().querySelector(".left-rail")).toBeNull();

    act(() => useShellStore.getState().toggleLeftCollapsed());

    expect(shell().style.getPropertyValue("--left-w")).toBe("40px");
    // The rail is a different COMPONENT, not the panel with a class on it:
    // 40px holds a count and the active layer's kind, and nothing else.
    expect(shell().querySelector(".left-panel")).toBeNull();
    expect(shell().querySelector(".left-rail")).not.toBeNull();
  });

  it("puts the layer list and the active layer's panel in the left slot", () => {
    const shell = renderViewer();

    const left = shell().querySelector(".shell-left");
    expect(left?.querySelector(".layer-list")).not.toBeNull();
    // The active layer follows the workspace's own rule — the one layer there
    // is, activated by `installWorkspaceInvariants` when it landed.
    expect(left?.querySelector(".active-layer")).not.toBeNull();
    // And the sidebar that used to be here is off the render tree.
    expect(shell().querySelector(".left-sidebar")).toBeNull();
  });

  it("expands the panel again from the rail", () => {
    const shell = renderViewer();
    act(() => useShellStore.getState().setLeftCollapsed(true));

    // By ROLE, which is only unambiguous because the rail's button and the
    // header's chevron are named differently ("Show" vs "Expand") — two
    // controls answering to one name is one control the user cannot aim at.
    fireEvent.click(screen.getByRole("button", { name: "Show layers panel" }));

    expect(useShellStore.getState().leftCollapsed).toBe(false);
    expect(shell().querySelector(".left-panel")).not.toBeNull();
  });

  it("puts the drawer under the map when the shell store opens it", () => {
    const shell = renderViewer();
    expect(shell().querySelector(".drawer-area")).toBeNull();

    act(() => useShellStore.getState().openDrawer());

    expect(
      shell().querySelector(".map-column > .drawer-area .table-panel"),
    ).not.toBeNull();
    expect(shell().style.getPropertyValue("--drawer-h")).toBe("280px");
  });
  it("retains the viewport for a new empty workspace and routes its add actions", async () => {
    const shell = renderViewer();
    const viewport = screen.getByTestId("navara-viewport");
    select();
    act(() => {
      useShellStore.getState().openDrawer();
      useSceneSheetStore.getState().setSheet("sun");
    });

    fireEvent.click(screen.getByRole("button", { name: "Untitled workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));

    await waitFor(() =>
      expect(screen.getByText("Add a layer to start")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("navara-viewport")).toBe(viewport);
    expect(screen.queryByRole("button", { name: "Browse catalog" })).toBeNull();
    expect(shell().querySelector(".drawer-area")).toBeNull();
    expect(shell().querySelector(".shell-right")).toBeNull();
    expect(useSelectionStore.getState().selections).toHaveLength(0);
    expect(useSceneSheetStore.getState().sheet).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add layer" }));
    expect(screen.getByRole("tab", { name: "File" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    expect(screen.getByRole("tab", { name: "URL" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Catalog" }));
    expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
