/**
 * The active layer's Style section: what "how is this drawn?" means for each
 * kind of layer.
 *
 * A city layer's answer is its RULES — the editor that used to be the
 * inspector's fifth tab, five clicks from the layer it colours. A vector
 * layer's is the flat per-layer style. A raster's is one slider. A tileset's
 * is nothing, said out loud rather than left as an empty box.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StyleSection } from "../../../../src/ui/layers/StyleSection";
import {
  useLayerStore,
  type Layer,
} from "../../../../src/features/layers/layerStore";
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import type { ActiveLayer } from "../../../../src/features/workspace/activeLayer";
import type { CityModel } from "../../../../src/domain/citymodel/types";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useStreamStore.setState({ streams: {} });
  useWorkspaceStore.setState({ activeLayerId: null });
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

function city(layer: Layer): ActiveLayer {
  useLayerStore.setState({ layers: [layer] });
  useWorkspaceStore.setState({ activeLayerId: layer.id });
  return { kind: "city", layer };
}

function addGeo(kind: GeoLayer["kind"]): string {
  const store = useGeoLayerStore.getState();
  if (kind === "geojson") {
    return store.addGeoLayer({
      name: "roads",
      kind: "geojson",
      config: { url: "https://x/roads.geojson" },
    });
  }
  if (kind === "raster-xyz") {
    return store.addGeoLayer({
      name: "basemap",
      kind: "raster-xyz",
      config: { urlTemplate: "https://x/{z}/{x}/{y}.png" },
    });
  }
  return store.addGeoLayer({
    name: "mesh",
    kind: "3d-tiles",
    config: { url: "https://x/tileset.json" },
  });
}

/** The section is handed a LIVE record, exactly as `ActiveLayerPanel` hands
 *  it one: a detached snapshot would go stale after the first edit. */
function GeoHost({ id }: { readonly id: string }) {
  const layer = useGeoLayerStore((s) => s.layers.find((l) => l.id === id));
  return layer ? <StyleSection item={{ kind: "geo", layer }} /> : null;
}

describe("StyleSection — a city layer's style is its rules", () => {
  it("renders the rules editor for the layer it was given", () => {
    render(<StyleSection item={city(cityLayer({ name: "Delft" }))} />);
    expect(screen.getByText("Rules · Delft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add Rule" })).toBeTruthy();
  });

  it("renders the same editor for a streaming layer", () => {
    render(
      <StyleSection
        item={city(cityLayer({ name: "Delft stream", isStreaming: true }))}
      />,
    );
    expect(screen.getByText("Rules · Delft stream")).toBeTruthy();
  });

  it("edits land on the active layer", () => {
    render(<StyleSection item={city(cityLayer({ id: "L" }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Flat roofs" }));
    expect(
      useLayerStore.getState().layers.find((l) => l.id === "L")!.rules,
    ).toHaveLength(1);
  });
});

describe("StyleSection — a vector layer", () => {
  it("offers colour, point size, line width, fill opacity and layer opacity", () => {
    render(<GeoHost id={addGeo("geojson")} />);
    expect(screen.getByLabelText("Layer color")).toBeTruthy();
    expect(screen.getByLabelText("Point size")).toBeTruthy();
    expect(screen.getByLabelText("Line width")).toBeTruthy();
    expect(screen.getByLabelText("Fill opacity")).toBeTruthy();
    expect(screen.getByLabelText("Opacity")).toBeTruthy();
  });

  it("writes an edit straight through to the geo layer store", () => {
    const id = addGeo("geojson");
    render(<GeoHost id={id} />);
    fireEvent.change(screen.getByLabelText("Layer color"), {
      target: { value: "#ff00aa" },
    });
    expect(
      useGeoLayerStore.getState().layers.find((l) => l.id === id)!.style.color,
    ).toBe("#ff00aa");
  });
});

describe("StyleSection — a raster layer", () => {
  it("offers opacity and nothing else: its pixels arrive already drawn", () => {
    render(<GeoHost id={addGeo("raster-xyz")} />);
    expect(screen.getByLabelText("Opacity")).toBeTruthy();
    expect(screen.queryByLabelText("Layer color")).toBeNull();
    expect(screen.queryByLabelText("Fill opacity")).toBeNull();
  });
});

describe("StyleSection — a 3D tileset", () => {
  it("says it has no style options rather than showing an empty box", () => {
    render(<GeoHost id={addGeo("3d-tiles")} />);
    expect(screen.getByText("No style options")).toBeTruthy();
    expect(screen.queryByLabelText("Opacity")).toBeNull();
  });
});
