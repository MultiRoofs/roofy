/**
 * The left panel's collapsed form: a 40 px rail.
 *
 * A collapsed panel used to be an EMPTY column — the shell reserved 40 px and
 * nothing was drawn in it, so the only way back was the header's chevron and
 * the workspace's own size was invisible while it was closed. The rail says
 * both things in the width it has: how many layers there are, and which one
 * every other panel is currently describing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LeftRail } from "../../../../src/ui/shell/LeftRail";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import {
  defaultShellState,
  useShellStore,
} from "../../../../src/ui/shell/shellStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

function reset(): void {
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useShellStore.setState({
    ...defaultShellState(1440, 900),
    leftCollapsed: true,
  });
}

beforeEach(reset);

afterEach(() => {
  cleanup();
  reset();
});

const emptyModel: CityModel = {
  sourceEncoding: "cityjson",
  metadata: {},
  bbox: null,
  objects: {},
  vertexCount: 0,
};

function layer(id: string, name: string): Layer {
  return {
    id,
    name,
    model: emptyModel,
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
  } as Layer;
}

describe("LeftRail", () => {
  it("counts every layer, city and geospatial alike", () => {
    useLayerStore.setState({ layers: [layer("l1", "Delft")] });
    useGeoLayerStore.getState().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });

    const { container } = render(<LeftRail />);

    expect(container.querySelector(".left-rail-badge")?.textContent).toBe("2");
  });

  it("expands the panel", () => {
    render(<LeftRail />);

    fireEvent.click(
      screen.getByRole("button", { name: "Expand layers panel" }),
    );

    expect(useShellStore.getState().leftCollapsed).toBe(false);
  });

  it("shows the active layer's kind, and names it", () => {
    useLayerStore.setState({ layers: [layer("l1", "Delft")] });
    useWorkspaceStore.setState({ activeLayerId: "l1" });

    const { container } = render(<LeftRail />);

    const kind = container.querySelector(".left-rail-kind");
    expect(kind?.getAttribute("title")).toBe("Delft");
    expect(kind?.querySelector(".layer-kind-icon")).not.toBeNull();
  });

  it("shows no kind icon when nothing is active", () => {
    const { container } = render(<LeftRail />);

    expect(container.querySelector(".left-rail-kind")).toBeNull();
    expect(container.querySelector(".left-rail-badge")?.textContent).toBe("0");
  });
});
