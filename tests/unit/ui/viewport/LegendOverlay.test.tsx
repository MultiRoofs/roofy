/**
 * Component tests for the viewport legend.
 *
 * Rules are PER-LAYER, so a flat list of rule names is ambiguous the moment
 * two layers are loaded: two layers can legitimately carry rules with the
 * same name and different colours, and nothing on screen said which colour
 * belonged to which layer. The legend therefore groups its entries under the
 * owning layer's name — including in the single-layer case, so the reading
 * doesn't change shape when a second layer arrives.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { LegendOverlay } from "../../../../src/ui/viewport/LegendOverlay";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { Rule } from "../../../../src/features/rules/types";
import type { CityModel } from "../../../../src/domain/citymodel/types";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
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

function rule(overrides: Partial<Rule> & { id: string; name: string }): Rule {
  return {
    color: "#ff0000",
    conditions: [],
    logic: "AND",
    enabled: true,
    ...overrides,
  };
}

function baseLayer(overrides: Partial<Layer>): Layer {
  return {
    id: "L",
    name: "test layer",
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
  };
}

describe("LegendOverlay", () => {
  it("groups rule entries under their own layer's name", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({
          id: "a",
          name: "Delft",
          rules: [rule({ id: "r1", name: "Flat roofs" })],
        }),
        baseLayer({
          id: "b",
          name: "Rotterdam",
          rules: [rule({ id: "r2", name: "Steep roofs", color: "#00ff00" })],
        }),
      ],
      activeLayerId: "a",
    });

    render(<LegendOverlay />);

    const delft = screen.getByRole("group", { name: "Delft" });
    const rotterdam = screen.getByRole("group", { name: "Rotterdam" });

    expect(within(delft).getByText("Flat roofs")).toBeTruthy();
    expect(within(delft).queryByText("Steep roofs")).toBeNull();
    expect(within(rotterdam).getByText("Steep roofs")).toBeTruthy();
    expect(within(rotterdam).queryByText("Flat roofs")).toBeNull();
  });

  it("shows the layer heading even with a single layer", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({
          id: "a",
          name: "Delft",
          rules: [rule({ id: "r1", name: "Flat roofs" })],
        }),
      ],
      activeLayerId: "a",
    });

    render(<LegendOverlay />);

    expect(
      within(screen.getByRole("group", { name: "Delft" })).getByText(
        "Flat roofs",
      ),
    ).toBeTruthy();
  });

  it("keeps same-named rules on different layers distinguishable", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({
          id: "a",
          name: "Delft",
          rules: [rule({ id: "shared", name: "Flat roofs" })],
        }),
        baseLayer({
          id: "b",
          name: "Rotterdam",
          // Same rule id AND name as the other layer's: rule ids are only
          // unique within a layer, so the legend must key by both.
          rules: [rule({ id: "shared", name: "Flat roofs", color: "#00ff00" })],
        }),
      ],
      activeLayerId: "a",
    });

    render(<LegendOverlay />);

    expect(screen.getAllByText("Flat roofs")).toHaveLength(2);
    expect(
      within(screen.getByRole("group", { name: "Rotterdam" })).getByText(
        "Flat roofs",
      ),
    ).toBeTruthy();
  });

  it("omits hidden layers and disabled rules, and renders nothing when no rule is active", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({
          id: "a",
          name: "Delft",
          visible: false,
          rules: [rule({ id: "r1", name: "Flat roofs" })],
        }),
        baseLayer({
          id: "b",
          name: "Rotterdam",
          rulesEnabled: false,
          rules: [rule({ id: "r2", name: "Steep roofs" })],
        }),
        baseLayer({
          id: "c",
          name: "Utrecht",
          rules: [rule({ id: "r3", name: "Off rule", enabled: false })],
        }),
      ],
      activeLayerId: "a",
    });

    const { container } = render(<LegendOverlay />);

    expect(container.querySelector(".legend-overlay")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });
});
