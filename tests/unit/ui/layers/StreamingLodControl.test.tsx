/**
 * The streaming LoD control is GLOBAL because the ladder is discovered at
 * stream time, not at load time — these pin that discovery behaviour and the
 * "applies to every streaming layer" contract.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StreamingLodControl } from "../../../../src/ui/layers/StreamingLodControl";
import {
  useLayerStore,
  type Layer,
} from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import {
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

function makeLayer(id: string, isStreaming: boolean): Layer {
  return {
    id,
    name: id,
    model: { objects: {}, metadata: {} } as unknown as CityModel,
    modelRef: { type: "url", url: `https://example.com/${id}.fcb` },
    visible: true,
    rules: [],
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
    derivedFrom: null,
    isStreaming,
  };
}

/** Seed the store as `openStreamingLayer` would, ladder included. */
function seedStream(id: string, ladder: readonly string[]): void {
  useStreamStore.setState((s) => ({
    streams: {
      ...s.streams,
      [id]: {
        handle: {} as never,
        status: "idle",
        message: null,
        level: null,
        grid: null,
        ladder,
        ladderVersion: 1,
        types: [],
        typesVersion: 0,
        version: 1,
        disposers: [],
      } as never,
    },
  }));
}

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useStreamStore.setState({ streams: {} });
});

describe("StreamingLodControl", () => {
  it("renders nothing when no streaming layer is open", () => {
    useLayerStore.setState({ layers: [makeLayer("static", false)] });
    const { container } = render(<StreamingLodControl />);
    expect(container.firstChild).toBeNull();
  });

  it("offers only Auto until the stream has discovered a ladder", () => {
    useLayerStore.setState({ layers: [makeLayer("s1", true)] });
    seedStream("s1", []);
    render(<StreamingLodControl />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toBe("Auto");
  });

  it("offers the LoDs discovered in the stream, highest detail first", () => {
    useLayerStore.setState({ layers: [makeLayer("s1", true)] });
    seedStream("s1", ["1.2", "2.2", "0"]);
    render(<StreamingLodControl />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Auto",
      "LoD 2.2",
      "LoD 1.2",
      "LoD 0",
    ]);
  });

  it("unions the ladders of every open streaming layer", () => {
    useLayerStore.setState({
      layers: [makeLayer("s1", true), makeLayer("s2", true)],
    });
    seedStream("s1", ["2.2"]);
    seedStream("s2", ["1.2"]);
    render(<StreamingLodControl />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Auto",
      "LoD 2.2",
      "LoD 1.2",
    ]);
  });

  it("pins the chosen LoD on EVERY streaming layer, and leaves static ones alone", () => {
    useLayerStore.setState({
      layers: [
        makeLayer("s1", true),
        makeLayer("s2", true),
        makeLayer("static", false),
      ],
    });
    seedStream("s1", ["2.2", "1.2"]);
    seedStream("s2", ["2.2"]);
    render(<StreamingLodControl />);
    fireEvent.change(screen.getByLabelText("Streaming LoD"), {
      target: { value: "2.2" },
    });
    const layers = useLayerStore.getState().layers;
    for (const id of ["s1", "s2"]) {
      const l = layers.find((x) => x.id === id)!;
      expect([l.lodMode, l.selectedLod]).toEqual(["manual", "2.2"]);
    }
    // The static layer keeps its own per-layer selector, untouched.
    const stat = layers.find((x) => x.id === "static")!;
    expect([stat.lodMode, stat.selectedLod]).toEqual(["auto", null]);
  });

  it("hands the choice back to the driver on Auto", () => {
    useLayerStore.setState({ layers: [makeLayer("s1", true)] });
    seedStream("s1", ["2.2"]);
    render(<StreamingLodControl />);
    const select = screen.getByLabelText("Streaming LoD");
    fireEvent.change(select, { target: { value: "2.2" } });
    expect(useLayerStore.getState().layers[0]!.lodMode).toBe("manual");
    fireEvent.change(select, { target: { value: "auto" } });
    expect(useLayerStore.getState().layers[0]!.lodMode).toBe("auto");
  });

  it("shows Auto rather than claiming one value when layers disagree", () => {
    useLayerStore.setState({
      layers: [makeLayer("s1", true), makeLayer("s2", true)],
    });
    seedStream("s1", ["2.2", "1.2"]);
    seedStream("s2", ["2.2", "1.2"]);
    useLayerStore.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === "s1"
          ? { ...l, lodMode: "manual" as const, selectedLod: "2.2" }
          : { ...l, lodMode: "manual" as const, selectedLod: "1.2" },
      ),
    }));
    render(<StreamingLodControl />);
    expect(
      (screen.getByLabelText("Streaming LoD") as HTMLSelectElement).value,
    ).toBe("auto");
  });
});
