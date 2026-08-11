/**
 * The inspector's geo view: a selected geospatial layer's info, opacity and
 * (for a vector layer) style — the controls that used to live inline in the
 * layer row, now in the same selection-driven panel a city layer's config
 * uses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GeoLayerInspector } from "../../../../src/ui/inspector/GeoLayerInspector";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";

afterEach(() => {
  cleanup();
  useGeoLayerStore.setState({ layers: [], activeGeoLayerId: null });
});

const geoStore = () => useGeoLayerStore.getState();

function addGeoJson(name = "roads"): string {
  return geoStore().addGeoLayer({
    name,
    kind: "geojson",
    config: { url: "https://x/roads.geojson" },
  });
}

function layerById(id: string): GeoLayer {
  return geoStore().layers.find((l) => l.id === id)!;
}

/** The panel hands `GeoLayerInspector` a LIVE record (InspectorPanel
 *  subscribes to the store — Task 9). A detached snapshot would go stale
 *  after the first edit, and the second edit's whole-style spread would
 *  resurrect old values — so the harness must mirror the live contract. */
function Host({ id }: { readonly id: string }) {
  const layer = useGeoLayerStore((s) => s.layers.find((l) => l.id === id));
  return layer ? <GeoLayerInspector layer={layer} /> : null;
}

function renderInspector(id: string) {
  return render(<Host id={id} />);
}

describe("GeoLayerInspector — info", () => {
  it("names the layer, its kind and its source", () => {
    const id = addGeoJson();
    renderInspector(id);

    expect(screen.getByText("roads")).toBeTruthy();
    expect(screen.getByText("GeoJSON")).toBeTruthy();
    expect(screen.getByText("https://x/roads.geojson")).toBeTruthy();
  });

  it("shows a tileset info-only — no opacity, no style", () => {
    const id = geoStore().addGeoLayer({
      name: "tiles",
      kind: "3d-tiles",
      config: { url: "https://x/tileset.json" },
    });
    renderInspector(id);

    expect(screen.getByText("3D Tiles tileset")).toBeTruthy();
    expect(screen.queryByLabelText("Opacity")).toBeNull();
    expect(screen.queryByLabelText("Layer color")).toBeNull();
  });
});

describe("GeoLayerInspector — opacity", () => {
  it("offers the opacity slider for raster and pushes it to the store", () => {
    const id = geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    renderInspector(id);

    expect(screen.queryByLabelText("Layer color")).toBeNull();
    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "0.4" },
    });
    expect(layerById(id).opacity).toBeCloseTo(0.4);
  });

  it("fades a vector layer through the same slider", () => {
    const id = addGeoJson();
    renderInspector(id);

    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "0.3" },
    });
    expect(layerById(id).opacity).toBeCloseTo(0.3);
  });
});

describe("GeoLayerInspector — a vector layer's style", () => {
  it("offers colour, point size, line width and fill opacity", () => {
    const id = addGeoJson();
    renderInspector(id);

    const color = screen.getByLabelText("Layer color") as HTMLInputElement;
    expect(color.type).toBe("color");
    expect(screen.getByLabelText("Point size")).toBeTruthy();
    expect(screen.getByLabelText("Line width")).toBeTruthy();
    expect(screen.getByLabelText("Fill opacity")).toBeTruthy();
  });

  it("writes a colour edit through as a FRESH style object", () => {
    const id = addGeoJson();
    renderInspector(id);

    const before = layerById(id).style;
    fireEvent.change(screen.getByLabelText("Layer color"), {
      target: { value: "#00ff00" },
    });

    const after = layerById(id).style;
    expect(after.color).toBe("#00ff00");
    expect(after).not.toBe(before);
    expect(after.pointSizePx).toBe(before.pointSizePx);
    expect(after.lineWidthPx).toBe(before.lineWidthPx);
  });

  it("commits point size and line width as numbers", () => {
    const id = addGeoJson();
    renderInspector(id);

    fireEvent.change(screen.getByLabelText("Point size"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Line width"), {
      target: { value: "5" },
    });

    expect(layerById(id).style.pointSizePx).toBe(8);
    expect(layerById(id).style.lineWidthPx).toBe(5);
  });

  it("leaves the size alone while its box is empty mid-edit", () => {
    const id = addGeoJson();
    renderInspector(id);

    fireEvent.change(screen.getByLabelText("Point size"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Point size"), {
      target: { value: "" },
    });

    expect(layerById(id).style.pointSizePx).toBe(8);
  });

  it("commits fill opacity from its own slider, leaving layer opacity alone", () => {
    const id = addGeoJson();
    renderInspector(id);

    fireEvent.change(screen.getByLabelText("Fill opacity"), {
      target: { value: "0.25" },
    });

    expect(layerById(id).style.fillOpacity).toBeCloseTo(0.25);
    expect(layerById(id).opacity).toBe(1);
  });
});
