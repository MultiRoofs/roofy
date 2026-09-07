/**
 * The active layer's Style section: what "how is this drawn?" means for each
 * kind of layer.
 *
 * A city layer's answer is `Color by`: the semantic surface palette, the
 * user's rules, or one colour for the whole layer — one select, an
 * affected-unit line naming what is about to change, and the chosen mode's
 * own body under it. A vector layer's answer is the flat per-layer style. A
 * raster's is one slider. A tileset's is nothing, said out loud rather than
 * left as an empty box.
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
import {
  SINGLE_COLOR_HEX,
  SURFACE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

/** jsdom reports an inline `backgroundColor` back as `rgb(r, g, b)`. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

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
    rulesEnabled: false,
    colorBy: "surface",
    singleColor: SINGLE_COLOR_HEX,
    unmatchedColor: UNMATCHED_COLOR_HEX,
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

/** The `Color by` select, by its accessible name. */
function colorBySelect(): HTMLSelectElement {
  return screen.getByRole("combobox", {
    name: "Color by",
  }) as HTMLSelectElement;
}

function readLayer(id = "L") {
  return useLayerStore.getState().layers.find((l) => l.id === id)!;
}

describe("StyleSection — a city layer is coloured three ways", () => {
  it("offers exactly Surface type, Rules and Single colour", () => {
    render(<StyleSection item={city(cityLayer())} />);
    expect([...colorBySelect().options].map((o) => o.textContent)).toEqual([
      "Surface type",
      "Rules",
      "Single colour",
    ]);
  });

  it("writes the mode the select is set to", () => {
    render(<StyleSection item={city(cityLayer({ id: "L" }))} />);

    fireEvent.change(colorBySelect(), { target: { value: "rules" } });
    expect(readLayer().colorBy).toBe("rules");

    fireEvent.change(colorBySelect(), { target: { value: "single" } });
    expect(readLayer().colorBy).toBe("single");

    fireEvent.change(colorBySelect(), { target: { value: "surface" } });
    expect(readLayer().colorBy).toBe("surface");
  });

  it("names the affected unit in the mode's own words", () => {
    // The section is the one place that says WHAT is being recoloured. A user
    // who has three layers open needs the layer's name here, not just in the
    // list above.
    render(<StyleSection item={city(cityLayer({ name: "Delft" }))} />);
    expect(
      screen.getByText("Delft · Color roof surfaces by surface type"),
    ).toBeTruthy();

    fireEvent.change(colorBySelect(), { target: { value: "rules" } });
    expect(
      screen.getByText("Delft · Color roof surfaces by rules"),
    ).toBeTruthy();

    fireEvent.change(colorBySelect(), { target: { value: "single" } });
    expect(
      screen.getByText("Delft · Color roof surfaces with one colour"),
    ).toBeTruthy();
  });

  it("follows the STORE, not the item it was handed", () => {
    // `ActiveLayerPanel` hands down a record captured at render time; the mode
    // this section just wrote lives in the store. Reading the prop would show
    // the previous mode's body under the new mode's select.
    render(<StyleSection item={city(cityLayer({ colorBy: "surface" }))} />);
    fireEvent.change(colorBySelect(), { target: { value: "single" } });
    expect(screen.getByLabelText("Single colour")).toBeTruthy();
  });
});

describe("StyleSection — Surface type", () => {
  it("shows the read-only Roof / Wall / Ground palette and no rule controls", () => {
    render(<StyleSection item={city(cityLayer({ colorBy: "surface" }))} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Roof", "Wall", "Ground"]);
    expect(
      rows.map(
        (r) =>
          (r.querySelector(".surface-palette-swatch") as HTMLElement).style
            .backgroundColor,
      ),
    ).toEqual([
      rgb(SURFACE_COLOR_HEX.RoofSurface),
      rgb(SURFACE_COLOR_HEX.WallSurface),
      rgb(SURFACE_COLOR_HEX.GroundSurface),
    ]);

    expect(screen.queryByRole("button", { name: /Flat roofs/ })).toBeNull();
    expect(screen.queryByText("+ Add rule")).toBeNull();
  });
});

describe("StyleSection — Single colour", () => {
  it("offers one colour input, seeded from the layer and writing back to it", () => {
    render(
      <StyleSection item={city(cityLayer({ id: "L", colorBy: "single" }))} />,
    );

    const input = screen.getByLabelText("Single colour");
    expect(input).toHaveProperty("value", SINGLE_COLOR_HEX);

    fireEvent.change(input, { target: { value: "#123456" } });
    expect(readLayer().singleColor).toBe("#123456");
    // The mode is untouched: this is the colour of the mode, not a mode.
    expect(readLayer().colorBy).toBe("single");
  });

  it("shows no rule list: one colour has no precedence to explain", () => {
    render(<StyleSection item={city(cityLayer({ colorBy: "single" }))} />);
    expect(screen.queryByText("+ Add rule")).toBeNull();
  });
});

describe("StyleSection — Rules", () => {
  it("renders the rule editor for the layer it was given", () => {
    render(
      <StyleSection
        item={city(cityLayer({ name: "Delft", colorBy: "rules" }))}
      />,
    );
    expect(screen.getByRole("button", { name: "+ Add rule" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Flat roofs/ })).toBeTruthy();
  });

  it("renders the same editor for a streaming layer", () => {
    render(
      <StyleSection
        item={city(
          cityLayer({
            name: "Delft stream",
            isStreaming: true,
            colorBy: "rules",
          }),
        )}
      />,
    );
    expect(
      screen.getByText("Delft stream · Color roof surfaces by rules"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add rule" })).toBeTruthy();
  });

  it("edits land on the active layer", () => {
    render(
      <StyleSection item={city(cityLayer({ id: "L", colorBy: "rules" }))} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Flat roofs/ }));
    expect(readLayer().rules).toHaveLength(1);
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
