/**
 * Component tests for RuleBuilderTab's static-vs-streaming field-source
 * branching: for a static layer, the condition-field dropdown walks the
 * `CityModel` (`collectAttributeFields`, unchanged); for a streaming layer
 * it must come from `getResidentModel(layerId, version)` instead (object
 * attribute keys from the resident records, unioned with the worker's
 * precomputed `surfaceAttrKeys`) — never from a `CityModel`, since a
 * streaming layer's `model` prop has no real objects.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RuleBuilderTab } from "../../../../src/ui/inspector/RuleBuilderTab";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { CellCache } from "@cityjson/navara-flatcitybuf";
import { buildResidentModel } from "@cityjson/navara-flatcitybuf";
import type { CityModel } from "../../../../src/domain/citymodel/types";

/** The streaming layer's plugin handle, reduced to the one method the UI
 *  reaches: the resident-model merge (which the plugin owns and memoises on
 *  its own commit counter). Built over a real `CellCache` so the merge under
 *  test is the real `buildResidentModel`, not a hand-written stand-in. */
function residentHandle(cache: unknown) {
  return {
    getResidentModel: () =>
      buildResidentModel(cache as Parameters<typeof buildResidentModel>[0]),
  };
}

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
  useStreamStore.setState({ streams: {} });
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
    isStreaming: false,
    ...overrides,
  };
}

function fieldOptionTexts(): string[] {
  return screen
    .getAllByRole("option")
    .map((o) => o.textContent)
    .filter((t): t is string => t !== null);
}

describe("RuleBuilderTab — streaming field source", () => {
  beforeEach(() => {
    const cache = new CellCache<never>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set(
      "2/0/0",
      {
        objects: [
          {
            id: "a",
            objectType: "Building",
            attributes: { roofType: "gabled" },
            bbox: [0, 0, 0, 1, 1, 1],
            lod: "2.2",
            surfaceCount: 4,
            roofMetrics: [],
            footprintAreaSqM: 10,
            volumeCuM: 20,
            parents: [],
            children: [],
          },
        ],
        surfaceAttrKeys: ["slope"],
      } as never,
      { triangles: 1, bytes: 1 },
    );
    useStreamStore.setState({
      streams: { L: { handle: residentHandle(cache), version: 1 } as never },
    });
    useLayerStore.setState({
      layers: [baseLayer({ isStreaming: true })],
      activeLayerId: "L",
    });
  });

  it("sources condition fields from the resident model, not the (empty) CityModel prop", () => {
    render(<RuleBuilderTab model={emptyModel()} layerId="L" />);
    fireEvent.click(screen.getByText("+ Add Rule"));

    const options = fieldOptionTexts();
    expect(options).toContain("roofType"); // object attribute on the record
    expect(options).toContain("slope"); // surfaceAttrKeys from the cell
  });
});

describe("RuleBuilderTab — static field source (unchanged)", () => {
  it("still walks the CityModel's objects and surfaces", () => {
    const model: CityModel = {
      ...emptyModel(),
      objects: {
        a: {
          id: "a",
          objectType: "Building",
          attributes: { yearBuilt: 1990 },
          surfaces: [
            {
              type: "RoofSurface",
              rings: [],
              attributes: { pitch: 30 },
              lod: "2.2",
            },
          ],
          bbox: [0, 0, 0, 1, 1, 1],
          children: [],
          parents: [],
          lod: "2.2",
        },
      },
    };
    useLayerStore.setState({
      layers: [baseLayer({ model, isStreaming: false })],
      activeLayerId: "L",
    });

    render(<RuleBuilderTab model={model} layerId="L" />);
    fireEvent.click(screen.getByText("+ Add Rule"));

    const options = fieldOptionTexts();
    expect(options).toContain("yearBuilt");
    expect(options).toContain("pitch");
  });
});
