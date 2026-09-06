/**
 * The active layer's own panel: everything the layer row stopped carrying
 * when it became a two-line block (Task 17), laid out as a form under the
 * list.
 *
 * Three things are pinned here. The panel FOLLOWS the workspace's one active
 * layer and renders nothing when there is none — there is no "first layer"
 * fallback. Its three sections are disclosures whose open/closed state is the
 * shell's per-layer `openSections`, so switching layers and coming back finds
 * the panel as it was left. And a `requestedSection` from elsewhere in the UI
 * (the legend, "Edit in table") is CONSUMED here: opened, scrolled to, and
 * cleared, so the request cannot fire a second time on the next render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/** The map-filter bridge reaches DuckDB; the Filter section only needs its
 *  one clearing call, and nothing here exercises it. */
vi.mock("../../../../src/features/query/mapFilterSync", () => ({
  clearMapFilter: vi.fn(),
}));

const { ActiveLayerPanel } =
  await import("../../../../src/ui/layers/ActiveLayerPanel");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { useStreamStore } =
  await import("../../../../src/features/streaming/streamStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useShellStore, defaultShellState } =
  await import("../../../../src/ui/shell/shellStore");
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

/**
 * jsdom implements NO `scrollIntoView`, so there is no method to `vi.spyOn`
 * — the property is defined for the duration of a test and DELETED again
 * afterwards, rather than assigned once and left on `Element.prototype` for
 * whatever runs next. The panel calls it as `?.()`, so its absence is the
 * normal case and stays exercised everywhere else.
 */
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: scrollIntoView,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useStreamStore.setState({ streams: {} });
  useWorkspaceStore.setState({ activeLayerId: null });
  useShellStore.setState(defaultShellState(1440, 900));
});

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  };
}

function cityLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "Delft",
    model: emptyModel(),
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

function activateCity(overrides: Partial<Layer> = {}): Layer {
  const layer = cityLayer(overrides);
  useLayerStore.setState({ layers: [layer] });
  useWorkspaceStore.setState({ activeLayerId: layer.id });
  return layer;
}

function activateGeo(): string {
  const id = useGeoLayerStore.getState().addGeoLayer({
    name: "roads",
    kind: "geojson",
    config: { url: "https://x/roads.geojson" },
  });
  useWorkspaceStore.setState({ activeLayerId: id });
  return id;
}

const noZoom = () => {};

describe("ActiveLayerPanel — which layer it describes", () => {
  it("renders nothing at all when no layer is active", () => {
    const { container } = render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    expect(container.firstChild).toBeNull();
  });

  it("names the layer and says what kind of thing it is", () => {
    activateCity({ name: "Delft" });
    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    expect(screen.getByText("Delft")).toBeTruthy();
    expect(screen.getByText("City model · CityJSON")).toBeTruthy();
  });

  it("names a streaming layer's kind differently", () => {
    activateCity({
      name: "Delft stream",
      isStreaming: true,
      model: { ...emptyModel(), sourceEncoding: "flatcitybuf" },
    });
    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    expect(screen.getByText("Streaming city model · FlatCityBuf")).toBeTruthy();
  });

  it("describes a geospatial layer with the same head", () => {
    activateGeo();
    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    expect(screen.getByText("roads")).toBeTruthy();
    expect(screen.getByText("Vector layer · GeoJSON")).toBeTruthy();
  });
});

describe("ActiveLayerPanel — the action row", () => {
  it("hands the whole active item back to the zoom callback", () => {
    const layer = activateCity();
    const onZoomToLayer = vi.fn();
    render(<ActiveLayerPanel onZoomToLayer={onZoomToLayer} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom to layer" }));
    expect(onZoomToLayer).toHaveBeenCalledWith({ kind: "city", layer });
  });

  it("opens and closes the data drawer, saying which it will do", () => {
    activateCity();
    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(useShellStore.getState().drawerOpen).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close table" }));
    expect(useShellStore.getState().drawerOpen).toBe(false);
  });

  it("offers no table for a geospatial layer: there is none behind it", () => {
    activateGeo();
    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    expect(screen.queryByRole("button", { name: "Open table" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom to layer" })).toBeTruthy();
  });
});

describe("ActiveLayerPanel — the three disclosures", () => {
  it("opens on Style alone, which is the shell's default", () => {
    activateCity();
    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    expect(
      screen
        .getByRole("button", { name: "Style" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Filter" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Details" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("records an opened section against the LAYER, not the panel", () => {
    activateCity({ id: "L" });
    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(useShellStore.getState().openSections["L"]).toEqual([
      "style",
      "filter",
    ]);
    expect(
      screen.getByText(
        "No filter. Filters apply to the map and the table together.",
      ),
    ).toBeTruthy();
  });
});

describe("ActiveLayerPanel — consuming a section request", () => {
  it("leaves the section the request already opened OPEN, scrolls to it and clears the request", () => {
    activateCity({ id: "L" });
    // Through the store's OWN entry point — what the legend and a filter chip
    // call — rather than a hand-written `requestedSection`: `requestSection`
    // activates the layer and opens the section itself, so what the panel
    // still owes is the scroll and the clear. Written this way because
    // `toggleSection` TOGGLES: an unguarded effect would close the very
    // section the request had just opened, and a test that seeded a CLOSED
    // section could never see that.
    useShellStore.getState().requestSection("L", "details");
    expect(useShellStore.getState().openSections["L"]).toContain("details");

    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);

    expect(useShellStore.getState().openSections["L"]).toContain("details");
    expect(scrollIntoView).toHaveBeenCalled();
    // Cleared, so a later unrelated re-render cannot re-open a section the
    // user has since closed.
    expect(useShellStore.getState().requestedSection).toBeNull();
  });

  it("opens a requested section that is somehow still closed", () => {
    // The defensive half of the same effect. `requestSection` always opens
    // the section itself, so this state is not reachable through it — the
    // request is seeded directly to prove the panel does not simply ASSUME
    // the section is open.
    activateCity({ id: "L" });
    useShellStore.setState({
      requestedSection: { layerId: "L", section: "details" },
    });

    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);

    expect(useShellStore.getState().openSections["L"]).toContain("details");
    expect(useShellStore.getState().requestedSection).toBeNull();
  });

  it("ignores a request aimed at another layer", () => {
    activateCity({ id: "L" });
    useShellStore.setState({
      requestedSection: { layerId: "OTHER", section: "details" },
    });
    render(<ActiveLayerPanel onZoomToLayer={noZoom} />);
    expect(useShellStore.getState().openSections["L"]).toBeUndefined();
    expect(useShellStore.getState().requestedSection).not.toBeNull();
  });
});
