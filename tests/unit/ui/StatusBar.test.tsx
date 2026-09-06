/**
 * Component tests for StatusBar's streaming status readout and its CRS
 * segment.
 *
 * Covers the exact wording the task brief pins down: "too-far" always
 * shows the fixed, user-facing "Zoom in to load features" — NOT the
 * driver's internal reason-coded message (`FcbStreamLayerHandle.commit`
 * emits `"Zoom in (${plan.reason})"`, which is debug detail, not UI copy).
 *
 * The CRS is the one toolbar pill that MOVED here rather than being deleted —
 * it had no other home, and bottom-right is where QGIS puts EPSG. StatusBar
 * reads it from the layer store itself, so these seed the store rather than
 * pass a prop.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBar } from "../../../src/ui/StatusBar";
import { useLayerStore } from "../../../src/features/layers/layerStore";
import type { Layer } from "../../../src/features/layers/layerStore";
import type { CityModel } from "../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../src/features/workspace/workspaceStore";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
});

function layerWithCrs(id: string, referenceSystem?: string): Layer {
  return {
    id,
    name: id,
    model: {
      sourceEncoding: "cityjson",
      metadata: referenceSystem ? { referenceSystem } : {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    } satisfies CityModel,
    modelRef: { type: "url", url: `https://x/${id}.city.json` },
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
  };
}

const baseProps = {
  objectCount: 10,
  triangleCount: 100,
  selectedCount: 0,
};

describe("StatusBar — streaming status", () => {
  it("shows nothing when streamStatus is undefined (non-streaming active layer)", () => {
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByText("Stream")).toBeNull();
  });

  it("shows nothing for 'idle' — nothing notable to report", () => {
    render(<StatusBar {...baseProps} streamStatus="idle" />);
    expect(screen.queryByText("Stream")).toBeNull();
  });

  it("shows 'Probing…' for 'probing'", () => {
    render(<StatusBar {...baseProps} streamStatus="probing" />);
    expect(screen.getByText("Probing…")).toBeTruthy();
  });

  it("shows 'Loading features…' for 'fetching'", () => {
    render(<StatusBar {...baseProps} streamStatus="fetching" />);
    expect(screen.getByText("Loading features…")).toBeTruthy();
  });

  it("shows the fixed 'Zoom in to load features' for 'too-far', ignoring the internal reason message", () => {
    render(
      <StatusBar
        {...baseProps}
        streamStatus="too-far"
        streamMessage="Zoom in (feature-budget)"
      />,
    );
    expect(screen.getByText("Zoom in to load features")).toBeTruthy();
    expect(screen.queryByText("Zoom in (feature-budget)")).toBeNull();
  });

  it("shows the worker's own message for 'error'", () => {
    render(
      <StatusBar
        {...baseProps}
        streamStatus="error"
        streamMessage="range read failed: 416 Range Not Satisfiable"
      />,
    );
    expect(
      screen.getByText("range read failed: 416 Range Not Satisfiable"),
    ).toBeTruthy();
  });

  it("falls back to a generic 'Streaming error' when 'error' has no message", () => {
    render(
      <StatusBar {...baseProps} streamStatus="error" streamMessage={null} />,
    );
    expect(screen.getByText("Streaming error")).toBeTruthy();
  });

  it("gives 'too-far' a visibly different status dot than 'error'", () => {
    const { container: tooFar } = render(
      <StatusBar {...baseProps} streamStatus="too-far" />,
    );
    const { container: error } = render(
      <StatusBar {...baseProps} streamStatus="error" streamMessage="x" />,
    );
    const tooFarDot = tooFar.querySelector(".status-dot.dot-partial");
    const errorDot = error.querySelector(".status-dot.dot-error");
    expect(tooFarDot).toBeTruthy();
    expect(errorDot).toBeTruthy();
  });
});

describe("StatusBar — no table toggle", () => {
  it("carries no Table button: the table is opened from the layer row", () => {
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByRole("button", { name: /table/i })).toBeNull();
  });
});

describe("StatusBar — CRS", () => {
  it("shows the active layer's EPSG code", () => {
    useLayerStore.setState({
      layers: [
        layerWithCrs("a", "https://www.opengis.net/def/crs/EPSG/0/7415"),
      ],
    });
    useWorkspaceStore.setState({ activeLayerId: "a" });
    render(<StatusBar {...baseProps} />);
    expect(screen.getByText("CRS")).toBeTruthy();
    expect(screen.getByText("EPSG:7415")).toBeTruthy();
  });

  it("reads the ACTIVE layer, not merely the first one", () => {
    useLayerStore.setState({
      layers: [
        layerWithCrs("a", "https://www.opengis.net/def/crs/EPSG/0/7415"),
        layerWithCrs("b", "EPSG:3414"),
      ],
    });
    useWorkspaceStore.setState({ activeLayerId: "b" });
    render(<StatusBar {...baseProps} />);
    expect(screen.getByText("EPSG:3414")).toBeTruthy();
    expect(screen.queryByText("EPSG:7415")).toBeNull();
  });

  it("renders no CRS segment when a layer exists but none is active", () => {
    // The bar used to fall back to `layers[0]`, so it announced an EPSG code
    // for a layer nothing else on screen was pointing at.
    useLayerStore.setState({
      layers: [
        layerWithCrs("a", "https://www.opengis.net/def/crs/EPSG/0/7415"),
      ],
    });
    useWorkspaceStore.setState({ activeLayerId: null });
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByText("CRS")).toBeNull();
  });

  it("renders no CRS segment when there are no layers", () => {
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByText("CRS")).toBeNull();
  });

  it("renders no CRS segment for a layer whose model declares none", () => {
    useLayerStore.setState({
      layers: [layerWithCrs("a")],
    });
    useWorkspaceStore.setState({ activeLayerId: "a" });
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByText("CRS")).toBeNull();
  });
});
