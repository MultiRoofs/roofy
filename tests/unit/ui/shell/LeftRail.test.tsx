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
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

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
    // Defaults, like every other field of this fixture: a layer with no
    // rules colours by surface type. A case that needs a mode sets one.
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

  it("counts the rows the stores know nothing about too", () => {
    // What the PANEL would list, not what one store holds: an add in flight,
    // one that failed and a layer waiting for its file are all rows behind
    // the rail, and a badge that ignored them would read `1` over a list of
    // four.
    useLayerStore.setState({ layers: [layer("l1", "Delft")] });

    const { container } = render(
      <LeftRail
        extraRows={[
          {
            id: "u1",
            name: "houses",
            kind: "unavailable",
            onRelink: () => {},
            onDismiss: () => {},
          },
        ]}
        pending={[{ id: "add-1", name: "rome.city.json" }]}
        failed={[
          {
            id: "add-2",
            name: "paris.city.json",
            message: "boom",
            retry: () => {},
          },
        ]}
      />,
    );

    expect(container.querySelector(".left-rail-badge")?.textContent).toBe("4");
  });

  it("says the count out loud for a screen reader", () => {
    useLayerStore.setState({ layers: [layer("l1", "Delft")] });

    render(<LeftRail />);

    // The badge is a glyph; the DESCRIPTION is the sentence. It is not in the
    // button's NAME, because a name that changes with every add is a name a
    // screen-reader user cannot learn.
    const button = screen.getByRole("button", { name: "Show layers panel" });
    const described = button.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    expect(document.getElementById(described!)?.textContent).toBe("1 layer");
  });

  it("expands the panel", () => {
    render(<LeftRail />);

    // NOT "Expand layers panel": that is the header chevron's name, and two
    // controls answering to one name is one control the user cannot aim at.
    fireEvent.click(screen.getByRole("button", { name: "Show layers panel" }));

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

  it("shows a state dot only while there are failed adds", () => {
    const { container, rerender } = render(<LeftRail failedCount={0} />);

    expect(container.querySelector(".left-rail-dot")).toBeNull();

    rerender(<LeftRail failedCount={2} />);

    expect(container.querySelector(".left-rail-dot")).not.toBeNull();
    const button = screen.getByRole("button", { name: "Show layers panel" });
    const described = button.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    const ids = described!.split(" ");
    const failedText = ids
      .map((id) => document.getElementById(id)?.textContent)
      .find((text) => text?.includes("failed"));
    expect(failedText).toBe("2 failed adds");
  });
});
