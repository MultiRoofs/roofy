/**
 * Component tests for RuleBuilderTab.
 *
 * Two things are proven here. First, the static-vs-streaming field-source
 * branching: for a static layer, the condition-field dropdown walks the
 * `CityModel` (`collectAttributeFields`, unchanged); for a streaming layer
 * it must come from `getResidentModel(layerId, version)` instead (object
 * attribute keys from the resident records, unioned with the worker's
 * precomputed `surfaceAttrKeys`) — never from a `CityModel`, since a
 * streaming layer's `model` prop has no real objects.
 *
 * Second, the target-layer picker: the tab edits ONE layer's rules and must
 * say which, so it renders a controlled `<select>` naming its target. The
 * selection lives in the parent (InspectorPanel), so the picker tests drive
 * it through a harness that owns the override state exactly as the panel
 * does.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { RuleBuilderTab } from "../../../../src/ui/inspector/RuleBuilderTab";
import { downloadText } from "../../../../src/platform/download";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { CellCache } from "@cityjson/navara-flatcitybuf";
import { buildResidentModel } from "@cityjson/navara-flatcitybuf";
import type { CityModel } from "../../../../src/domain/citymodel/types";

// The one download seam. Mocked rather than stubbing `URL.createObjectURL` and
// an anchor: what this tab owes the user is "the rules, as rules.json", and
// that is exactly the call — `platform/download` has its own test for the
// anchor.
vi.mock("../../../../src/platform/download", () => ({
  downloadBlob: vi.fn(),
  downloadText: vi.fn(),
}));

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
    render(
      <RuleBuilderTab
        model={emptyModel()}
        layerId="L"
        layerOptions={[{ id: "L", name: "test layer" }]}
        onSelectLayer={() => {}}
      />,
    );
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

    render(
      <RuleBuilderTab
        model={model}
        layerId="L"
        layerOptions={[{ id: "L", name: "test layer" }]}
        onSelectLayer={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("+ Add Rule"));

    const options = fieldOptionTexts();
    expect(options).toContain("yearBuilt");
    expect(options).toContain("pitch");
  });
});

// ---------------------------------------------------------------------------
// Target-layer picker
// ---------------------------------------------------------------------------

/** Owns the target-layer override exactly as InspectorPanel does: the tab
 *  itself is controlled, so the picker can only be exercised through a
 *  parent that re-targets it on `onSelectLayer`. */
function TargetHarness({
  layers,
}: {
  layers: ReadonlyArray<{ id: string; name: string; model: CityModel }>;
}) {
  const [override, setOverride] = useState<string | null>(null);
  const target = layers.find((l) => l.id === override) ?? layers[0]!;
  return (
    <RuleBuilderTab
      model={target.model}
      layerId={target.id}
      layerOptions={layers.map((l) => ({ id: l.id, name: l.name }))}
      onSelectLayer={setOverride}
    />
  );
}

describe("RuleBuilderTab — exporting rules", () => {
  it("hands the layer's rules to the one download helper", () => {
    const rules = [
      {
        id: "r1",
        name: "Tall",
        enabled: true,
        logic: "AND" as const,
        conditions: [],
        color: "#ff0000",
      },
    ];
    useLayerStore.setState({
      layers: [baseLayer({ rules })],
      activeLayerId: "L",
    });

    render(
      <RuleBuilderTab
        model={emptyModel()}
        layerId="L"
        layerOptions={[{ id: "L", name: "test layer" }]}
        onSelectLayer={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Export rules"));

    // The STORE's rules, not the prop's, and pretty-printed — the file is
    // meant to be read and edited by hand.
    expect(downloadText).toHaveBeenCalledWith(
      JSON.stringify(rules, null, 2),
      "rules.json",
    );
  });
});

describe("RuleBuilderTab — target layer picker", () => {
  const twoLayerOptions = [
    { id: "L", name: "Delft", model: emptyModel() },
    { id: "R", name: "Rotterdam", model: emptyModel() },
  ];

  function seedTwoLayers() {
    useLayerStore.setState({
      layers: [
        baseLayer({ id: "L", name: "Delft" }),
        baseLayer({ id: "R", name: "Rotterdam" }),
      ],
      activeLayerId: "L",
    });
  }

  function targetSelect(): HTMLElement {
    return screen.getByRole("combobox", { name: /rules target layer/i });
  }

  it("names its target layer and lists the alternatives", () => {
    seedTwoLayers();
    render(<TargetHarness layers={twoLayerOptions} />);

    const select = targetSelect();
    expect(select).toHaveValue("L");
    expect(
      within(select).getByRole("option", { name: "Rotterdam" }),
    ).toBeInTheDocument();
  });

  it("edits land on the layer the dropdown names", () => {
    seedTwoLayers();
    render(<TargetHarness layers={twoLayerOptions} />);

    fireEvent.change(targetSelect(), { target: { value: "R" } });
    expect(targetSelect()).toHaveValue("R");

    fireEvent.click(screen.getByRole("button", { name: "Flat roofs" }));

    const state = useLayerStore.getState();
    expect(state.layers.find((l) => l.id === "R")!.rules).toHaveLength(1);
    expect(state.layers.find((l) => l.id === "L")!.rules).toHaveLength(0);
  });
});
