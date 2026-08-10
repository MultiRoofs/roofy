/**
 * Component tests for `ViewerToolbar`'s tool-mode buttons, and for the
 * information it must NOT carry.
 *
 * Task B16 ruling: under `NavaraViewport` the box-select and measure tools
 * have no consumers at all — `acceptsPointer` gates pointer events on
 * `toolMode`, so picking either one only turns selection off. Both buttons
 * are therefore disabled and say so in their tooltip, while the two pick-mode
 * buttons stay live. These tests pin all three halves of that: the dead
 * buttons are inert AND labelled, and the live ones still dispatch.
 *
 * The second block pins the toolbar as CONTROLS ONLY: it renders with a fully
 * populated layer store precisely so a re-added pill would show something and
 * fail, rather than passing vacuously against an empty store.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewerToolbar } from "../../../src/ui/toolbar/ViewerToolbar";
import { useLayerStore } from "../../../src/features/layers/layerStore";
import type { Layer } from "../../../src/features/layers/layerStore";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
});

const baseProps = {
  pickMode: "object" as const,
  toolMode: "select" as const,
  onSetPickMode: () => undefined,
  onSetToolMode: () => undefined,
  onClose: () => undefined,
  onToggleInspector: () => undefined,
  onToggleLeftSidebar: () => undefined,
  onFitAll: () => undefined,
  theme: "dark" as const,
  onToggleTheme: () => undefined,
};

/**
 * The one button whose tooltip starts with `prefix`.
 *
 * `data-tooltip`, not `title`: the toolbar's icon buttons carry the app's own
 * CSS bubble now (a native tip took ~1s to appear), and `title` is gone from
 * every one of them so the two can never both draw.
 */
function buttonByTooltipPrefix(prefix: string): HTMLButtonElement {
  const match = screen
    .getAllByRole("button")
    .find((b) => (b.getAttribute("data-tooltip") ?? "").startsWith(prefix));
  if (!match) throw new Error(`no button tooltipped ${prefix}…`);
  return match as HTMLButtonElement;
}

describe("ViewerToolbar — tools with no Navara implementation", () => {
  for (const [name, prefix] of [
    ["box select", "Box select"],
    ["measure", "Measure distance"],
  ] as const) {
    it(`disables ${name} and says why in the tooltip`, () => {
      render(<ViewerToolbar {...baseProps} />);
      const btn = buttonByTooltipPrefix(prefix);
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("data-tooltip")).toContain(
        "temporarily unavailable during the Navara migration",
      );
      // The tooltip is not the accessible name — `aria-label` is, and it must
      // survive the `title` removal or the button becomes anonymous.
      expect(btn.getAttribute("aria-label")).toContain(
        "temporarily unavailable during the Navara migration",
      );
      expect(btn.getAttribute("title")).toBeNull();
    });

    it(`never dispatches a tool mode from the ${name} button`, () => {
      const onSetToolMode = vi.fn();
      render(<ViewerToolbar {...baseProps} onSetToolMode={onSetToolMode} />);
      fireEvent.click(buttonByTooltipPrefix(prefix));
      expect(onSetToolMode).not.toHaveBeenCalled();
    });
  }

  it("box select stays disabled in surface pick mode too (it is not mode-gated any more)", () => {
    render(<ViewerToolbar {...baseProps} pickMode="surface" />);
    expect(buttonByTooltipPrefix("Box select").disabled).toBe(true);
  });

  it("no longer carries the place search, which is a scene overlay now", () => {
    render(<ViewerToolbar {...baseProps} />);
    expect(screen.queryByTitle("Search for a place")).toBeNull();
  });

  it("leaves the object/surface pick buttons live", () => {
    const onSetPickMode = vi.fn();
    const onSetToolMode = vi.fn();
    render(
      <ViewerToolbar
        {...baseProps}
        onSetPickMode={onSetPickMode}
        onSetToolMode={onSetToolMode}
      />,
    );
    const surface = buttonByTooltipPrefix("Select surfaces");
    expect(surface.disabled).toBe(false);
    fireEvent.click(surface);
    expect(onSetPickMode).toHaveBeenCalledWith("surface");
    expect(onSetToolMode).toHaveBeenCalledWith("select");
  });
});

/** A layer with everything the deleted pills used to read: a CRS, a LoD, an
 *  enabled rule and a name. */
function loadedLayer(): Layer {
  return {
    id: "L",
    name: "two-buildings.city.json",
    model: {
      sourceEncoding: "cityjson",
      metadata: {
        referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415",
      },
      bbox: null,
      objects: {
        b1: {
          id: "b1",
          objectType: "Building",
          attributes: {},
          surfaces: [],
          bbox: null,
          children: [],
          parents: [],
          lod: "2.2",
        },
      },
      vertexCount: 0,
    },
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [
      {
        id: "r1",
        name: "tall",
        color: "#4ec84e",
        conditions: [],
        logic: "AND",
        enabled: true,
      },
    ],
    rulesEnabled: true,
    selectedLod: "2.2",
    availableLods: ["2.2"],
    lodMode: "manual",
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: ["Building"],
    isStreaming: false,
  };
}

describe("ViewerToolbar — controls only, no scene information", () => {
  for (const [what, text] of [
    ["the object count", "Objects"],
    ["the layer count", "Layers"],
    ["the LoD", "LoD"],
    ["the rule count", "Rules"],
  ] as const) {
    it(`does not restate ${what}, which another surface already shows`, () => {
      useLayerStore.setState({ layers: [loadedLayer()], activeLayerId: "L" });
      render(<ViewerToolbar {...baseProps} />);
      expect(screen.queryByText(text)).toBeNull();
    });
  }

  it("does not carry the file name, the CRS or a separate sun pill", () => {
    useLayerStore.setState({ layers: [loadedLayer()], activeLayerId: "L" });
    const { container } = render(<ViewerToolbar {...baseProps} />);
    expect(container.querySelector(".toolbar-file")).toBeNull();
    expect(container.querySelector(".meta-pills")).toBeNull();
    expect(container.querySelector(".sun-pill")).toBeNull();
    // The CRS is not deleted, it MOVED — see StatusBar.test.tsx.
    expect(screen.queryByText("EPSG:7415")).toBeNull();
  });
});
