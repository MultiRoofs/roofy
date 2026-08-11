/**
 * The Layers pane, once it holds two KINDS of layer.
 *
 * A city model and an XYZ basemap overlay share a word and nothing else — no
 * LoD, no rules, no object types, nothing to pick — so they get two titled
 * sections rather than one list with half its controls greyed out. What is
 * checked here is that the split is real (each row lands under its own
 * heading, the city rows keep every control they had) and that a geospatial
 * row's four affordances reach the store.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { LayerPanel } from "../../../../src/ui/layers/LayerPanel";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useGeoLayerStore.setState({ layers: [] });
});

const noop = () => {};
/** The URL path now reports whether a layer landed; these suites never look. */
const noopUrl = async () => ({ ok: true }) as const;

function renderPanel(onFlyToGeoLayer?: (id: string) => void) {
  return render(
    <LayerPanel
      onAddFile={noop}
      onAddFiles={noop}
      onAddUrl={noopUrl}
      loading={false}
      onFlyToGeoLayer={onFlyToGeoLayer}
    />,
  );
}

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  };
}

function addCityLayer(name: string): void {
  const layer: Layer = {
    id: `city-${name}`,
    name,
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
    // Two groups, so the object-types disclosure renders — it hides itself for
    // a layer with nothing to choose between.
    availableObjectTypes: ["Building", "Bridge"],
    isStreaming: false,
  };
  useLayerStore.setState({ layers: [layer], activeLayerId: layer.id });
}

const geoStore = () => useGeoLayerStore.getState();

function addRaster(name = "OSM"): string {
  return geoStore().addGeoLayer({
    name,
    kind: "raster-xyz",
    config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
  });
}

function addGeoJson(name = "roads"): string {
  return geoStore().addGeoLayer({
    name,
    kind: "geojson",
    config: { url: "https://x/roads.geojson" },
  });
}

function geoRows(): HTMLElement[] {
  return screen.queryAllByTestId("geo-layer-row");
}

function geoLayer(id: string) {
  return geoStore().layers.find((l) => l.id === id)!;
}

describe("LayerPanel — two sections", () => {
  it("titles both sections, and counts each independently", () => {
    addCityLayer("Delft");
    addRaster();
    renderPanel();

    expect(screen.getByText("3D City Models (1)")).toBeTruthy();
    expect(screen.getByText("Geospatial Layers (1)")).toBeTruthy();
  });

  it("shows both headings even when a section is empty, and says so", () => {
    renderPanel();

    expect(screen.getByText("3D City Models (0)")).toBeTruthy();
    expect(screen.getByText("Geospatial Layers (0)")).toBeTruthy();
    expect(geoRows()).toHaveLength(0);
    // An empty section that says nothing reads as a bug; this one explains
    // itself and points at the one button that fills it.
    expect(screen.getByText(/No geospatial layers/i)).toBeTruthy();
  });

  it("leaves the city rows' own controls alone", () => {
    addCityLayer("Delft");
    addRaster();
    renderPanel();

    // The object-types disclosure and the fly-to/remove actions still belong
    // to the city row, and only to it.
    expect(screen.getByText("Delft")).toBeTruthy();
    expect(screen.getByRole("button", { name: /object types/i })).toBeTruthy();
    // One shared "+ Add Layer" button for both sections.
    expect(screen.getAllByRole("button", { name: "+ Add Layer" })).toHaveLength(
      1,
    );
  });

  it("each section header opens the add dialog on its own tab", () => {
    renderPanel();

    fireEvent.click(
      screen.getByRole("button", { name: /add city model layer/i }),
    );
    expect(screen.getByRole("tab", { name: /city model/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(
      screen.getByRole("button", { name: /add geospatial layer/i }),
    );
    expect(screen.getByRole("tab", { name: /geospatial/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("LayerPanel — a geospatial row", () => {
  it("badges the layer's kind and shows its source in the title", () => {
    addRaster();
    renderPanel();

    const row = geoRows()[0]!;
    expect(within(row).getByText("XYZ")).toBeTruthy();
    expect(within(row).getByText("OSM").getAttribute("title")).toContain(
      "https://tile.example/{z}/{x}/{y}.png",
    );
  });

  it("toggles visibility through the eye button", () => {
    const id = addRaster();
    renderPanel();

    fireEvent.click(
      within(geoRows()[0]!).getByRole("button", { name: "Hide layer" }),
    );

    expect(geoStore().layers.find((l) => l.id === id)!.visible).toBe(false);
  });

  it("renames on double-click and commits on Enter", () => {
    const id = addRaster();
    renderPanel();

    fireEvent.doubleClick(within(geoRows()[0]!).getByText("OSM"));
    const input = within(geoRows()[0]!).getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Base imagery  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(geoStore().layers.find((l) => l.id === id)!.name).toBe(
      "Base imagery",
    );
  });

  it("offers an opacity slider for a raster layer and pushes it to the store", () => {
    const id = addRaster();
    renderPanel();

    const slider = within(geoRows()[0]!).getByLabelText(
      /opacity/i,
    ) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.4" } });

    expect(geoStore().layers.find((l) => l.id === id)!.opacity).toBeCloseTo(
      0.4,
    );
  });

  it("removes the layer", () => {
    addRaster();
    renderPanel();

    fireEvent.click(
      within(geoRows()[0]!).getByRole("button", { name: "Remove layer" }),
    );

    expect(geoStore().layers).toHaveLength(0);
  });
});

describe("LayerPanel — a vector row's style controls", () => {
  it("offers colour, point size, line width and fill opacity", () => {
    addGeoJson();
    renderPanel();

    const row = within(geoRows()[0]!);
    const color = row.getByLabelText("Layer color") as HTMLInputElement;
    expect(color.type).toBe("color");
    expect(row.getByLabelText("Point size")).toBeTruthy();
    expect(row.getByLabelText("Line width")).toBeTruthy();
    expect(row.getByLabelText("Fill opacity")).toBeTruthy();
  });

  it("fades a vector layer through the general opacity slider too", () => {
    const id = addGeoJson();
    renderPanel();

    const slider = within(geoRows()[0]!).getByLabelText(
      "Opacity",
    ) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.3" } });

    expect(geoLayer(id).opacity).toBeCloseTo(0.3);
  });

  it("writes a colour edit through as a FRESH style object", () => {
    const id = addGeoJson();
    renderPanel();

    const before = geoLayer(id).style;
    fireEvent.change(within(geoRows()[0]!).getByLabelText("Layer color"), {
      target: { value: "#00ff00" },
    });

    const after = geoLayer(id).style;
    expect(after.color).toBe("#00ff00");
    // Identity moves on every style edit — the reconciler re-describes on it.
    expect(after).not.toBe(before);
    // …and the fields the user did not touch come along unchanged.
    expect(after.pointSizePx).toBe(before.pointSizePx);
    expect(after.lineWidthPx).toBe(before.lineWidthPx);
  });

  it("commits point size and line width as numbers", () => {
    const id = addGeoJson();
    renderPanel();

    const row = within(geoRows()[0]!);
    fireEvent.change(row.getByLabelText("Point size"), {
      target: { value: "8" },
    });
    fireEvent.change(row.getByLabelText("Line width"), {
      target: { value: "5" },
    });

    expect(geoLayer(id).style.pointSizePx).toBe(8);
    expect(geoLayer(id).style.lineWidthPx).toBe(5);
  });

  it("leaves the size alone while its box is empty mid-edit", () => {
    const id = addGeoJson();
    renderPanel();

    const row = within(geoRows()[0]!);
    fireEvent.change(row.getByLabelText("Point size"), {
      target: { value: "8" },
    });
    // Clearing the box to retype it must not read as "0" and snap the layer
    // back to the app default through the store's normalization.
    fireEvent.change(row.getByLabelText("Point size"), {
      target: { value: "" },
    });

    expect(geoLayer(id).style.pointSizePx).toBe(8);
  });

  it("commits fill opacity from its own slider", () => {
    const id = addGeoJson();
    renderPanel();

    fireEvent.change(within(geoRows()[0]!).getByLabelText("Fill opacity"), {
      target: { value: "0.25" },
    });

    expect(geoLayer(id).style.fillOpacity).toBeCloseTo(0.25);
    // The general opacity is a different value and stays where it was.
    expect(geoLayer(id).opacity).toBe(1);
  });

  it("gives a raster row the opacity slider and NO style controls", () => {
    addRaster();
    renderPanel();

    const row = within(geoRows()[0]!);
    expect(row.getByLabelText("Opacity")).toBeTruthy();
    expect(row.queryByLabelText("Layer color")).toBeNull();
    expect(row.queryByLabelText("Point size")).toBeNull();
    expect(row.queryByLabelText("Line width")).toBeNull();
    expect(row.queryByLabelText("Fill opacity")).toBeNull();
  });
});

describe("LayerPanel — zoom to a geospatial layer", () => {
  it("offers the zoom button on vector and tileset rows, not raster", () => {
    addGeoJson();
    renderPanel(noop);
    expect(
      within(geoRows()[0]!).getByRole("button", { name: "Zoom to layer" }),
    ).toBeTruthy();

    cleanup();
    useGeoLayerStore.setState({ layers: [] });

    geoStore().addGeoLayer({
      name: "tiles",
      kind: "3d-tiles",
      config: { url: "https://x/tileset.json" },
    });
    renderPanel(noop);
    expect(
      within(geoRows()[0]!).getByRole("button", { name: "Zoom to layer" }),
    ).toBeTruthy();

    cleanup();
    useGeoLayerStore.setState({ layers: [] });

    addRaster();
    renderPanel(noop);
    expect(
      within(geoRows()[0]!).queryByRole("button", { name: "Zoom to layer" }),
    ).toBeNull();
  });

  it("reports the layer's id when clicked", () => {
    const id = addGeoJson();
    const spy = vi.fn();
    renderPanel(spy);

    fireEvent.click(
      within(geoRows()[0]!).getByRole("button", { name: "Zoom to layer" }),
    );

    expect(spy).toHaveBeenCalledWith(id);
  });

  // REGRESSION GUARD, not a red step: this one passes even before the
  // implementation exists (there is no zoom button at all yet). The red
  // signal for this task comes from the two tests above.
  it("renders no zoom button when the callback is absent", () => {
    addGeoJson();
    renderPanel();
    expect(
      within(geoRows()[0]!).queryByRole("button", { name: "Zoom to layer" }),
    ).toBeNull();
  });
});

describe("LayerPanel — a restored GeoJSON layer whose file is gone", () => {
  it("says the file is needed and offers to re-link it", () => {
    geoStore().addGeoLayer({ name: "parcels", kind: "geojson", config: {} });
    renderPanel();

    const row = geoRows()[0]!;
    expect(within(row).getByText(/file needed/i)).toBeTruthy();
    expect(within(row).getByLabelText(/re-link/i)).toBeTruthy();
  });
});
