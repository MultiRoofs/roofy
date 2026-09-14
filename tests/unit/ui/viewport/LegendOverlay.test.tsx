/**
 * Component tests for the viewport legend.
 *
 * Rules are PER-LAYER, so a flat list of rule names is ambiguous the moment
 * two layers are loaded: two layers can legitimately carry rules with the
 * same name and different colours, and nothing on screen said which colour
 * belonged to which layer. The legend therefore groups its entries under the
 * owning layer's name — including in the single-layer case, so the reading
 * doesn't change shape when a second layer arrives.
 *
 * The heading is a BUTTON that opens the layer's Style section; the data the
 * overlay renders is pinned in `legendModel.test.ts`, so these tests are about
 * the overlay's own behaviour: grouping, hiding, the heading click and the
 * presentation-size class.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { LegendOverlay } from "../../../../src/ui/viewport/LegendOverlay";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { Rule } from "../../../../src/features/rules/types";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useShellStore } from "../../../../src/ui/shell/shellStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useShellStore.setState({
    leftCollapsed: false,
    rightCollapsed: false,
    openSections: {},
    requestedSection: null,
  });
  useSelectionStore.setState({ selections: [], geoSelection: null });
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
    // The legend reads the MODE now — a layer with no rules colours by
    // surface type, so the surface palette is its contribution.
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
    derivedFrom: null,
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
          colorBy: "rules",
          rules: [rule({ id: "r1", name: "Flat roofs" })],
        }),
        baseLayer({
          id: "b",
          name: "Rotterdam",
          colorBy: "rules",
          rules: [rule({ id: "r2", name: "Steep roofs", color: "#00ff00" })],
        }),
      ],
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
          colorBy: "rules",
          rules: [rule({ id: "r1", name: "Flat roofs" })],
        }),
      ],
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
          colorBy: "rules",
          rules: [rule({ id: "shared", name: "Flat roofs" })],
        }),
        baseLayer({
          id: "b",
          name: "Rotterdam",
          colorBy: "rules",
          rules: [rule({ id: "shared", name: "Flat roofs", color: "#00ff00" })],
        }),
      ],
    });

    render(<LegendOverlay />);

    expect(screen.getAllByText("Flat roofs")).toHaveLength(2);
    expect(
      within(screen.getByRole("group", { name: "Rotterdam" })).getByText(
        "Flat roofs",
      ),
    ).toBeTruthy();
  });

  it("omits hidden layers", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({
          id: "a",
          name: "Delft",
          visible: false,
          colorBy: "rules",
          rules: [rule({ id: "r1", name: "Flat roofs" })],
        }),
        baseLayer({
          id: "b",
          name: "Rotterdam",
          colorBy: "rules",
          rules: [rule({ id: "r2", name: "Steep roofs" })],
        }),
      ],
    });

    const { container } = render(<LegendOverlay />);

    expect(screen.queryByRole("group", { name: "Delft" })).toBeNull();
    expect(screen.getByRole("group", { name: "Rotterdam" })).toBeTruthy();
    expect(container.querySelector(".legend-overlay")).toBeTruthy();
  });

  it("renders nothing when no layer is visible", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({ id: "a", name: "Delft", visible: false }),
        baseLayer({ id: "b", name: "Rotterdam", visible: false }),
      ],
    });

    const { container } = render(<LegendOverlay />);

    expect(container.querySelector(".legend-overlay")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("clicking a group heading opens that layer's Style section", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({
          id: "a",
          name: "Delft",
          colorBy: "rules",
          rules: [rule({ id: "r1", name: "Flat roofs" })],
        }),
      ],
    });
    useShellStore.setState({ leftCollapsed: true });

    render(<LegendOverlay />);

    fireEvent.click(screen.getByRole("button", { name: "Delft" }));

    // requestSection activates the layer, opens Style and un-collapses the
    // left panel.
    expect(useWorkspaceStore.getState().activeLayerId).toBe("a");
    expect(useShellStore.getState().leftCollapsed).toBe(false);
    expect(useShellStore.getState().openSections.a).toContain("style");
  });

  it("grows to the presentation size when both panels are collapsed", () => {
    useLayerStore.setState({
      layers: [baseLayer({ id: "a", name: "Delft", colorBy: "rules" })],
    });
    useShellStore.setState({ leftCollapsed: true, rightCollapsed: true });

    const { container } = render(<LegendOverlay />);

    expect(container.querySelector(".legend-presentation")).toBeTruthy();
  });

  it("is presentation-sized when the left panel is collapsed and nothing is selected", () => {
    // A right panel that does not exist (no selection) counts as collapsed.
    useLayerStore.setState({
      layers: [baseLayer({ id: "a", name: "Delft", colorBy: "rules" })],
    });
    useShellStore.setState({ leftCollapsed: true, rightCollapsed: false });
    useSelectionStore.setState({ selections: [], geoSelection: null });

    const { container } = render(<LegendOverlay />);

    expect(container.querySelector(".legend-presentation")).toBeTruthy();
  });

  it("is not presentation-sized while a selection holds the right panel open", () => {
    useLayerStore.setState({
      layers: [baseLayer({ id: "a", name: "Delft", colorBy: "rules" })],
    });
    useShellStore.setState({ leftCollapsed: true, rightCollapsed: false });
    useSelectionStore.setState({
      selections: [
        {
          kind: "object",
          layerId: "a",
          objectId: "obj1",
        },
      ],
      geoSelection: null,
    });

    const { container } = render(<LegendOverlay />);

    expect(container.querySelector(".legend-presentation")).toBeNull();
  });
});

it("collapses and expands through an icon in the legend header", () => {
  useLayerStore.setState({ layers: [baseLayer({ id: "a", name: "Delft" })] });
  render(<LegendOverlay />);
  const collapse = screen.getByRole("button", { name: "Collapse legend" });
  expect(collapse.textContent).toBe("");
  expect(collapse.closest(".legend-header")).toBeTruthy();
  expect(collapse).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(collapse);
  expect(screen.queryByRole("group", { name: "Delft" })).toBeNull();
  expect(screen.getByText("Legend")).toBeTruthy();
  const expand = screen.getByRole("button", { name: "Expand legend" });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(expand);
  expect(screen.getByRole("group", { name: "Delft" })).toBeTruthy();
  expect(screen.queryByText("Hide legend")).toBeNull();
});
