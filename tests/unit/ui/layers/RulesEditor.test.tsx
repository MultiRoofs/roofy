/**
 * Component tests for RulesEditor.
 *
 * Two things are proven here. First, the static-vs-streaming field-source
 * branching: for a static layer, the condition-field dropdown walks the
 * `CityModel` (`collectAttributeFields`, unchanged); for a streaming layer
 * it must come from `getResidentModel(layerId, version)` instead (object
 * attribute keys from the resident records, unioned with the worker's
 * precomputed `surfaceAttrKeys`) — never from a `CityModel`, since a
 * streaming layer's `model` prop has no real objects.
 *
 * Second, the `Rules` branch's own anatomy: preset chips, the rule rows with
 * their precedence controls, the unmatched colour, and the ordering of the
 * attribute select. The editor offers no way to re-point itself — rules are
 * per-layer, and the layer is chosen in the list — and no On/Off switch: the
 * layer's NAME and its MODE both belong to `StyleSection` above it, and are
 * tested there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { RulesEditor } from "../../../../src/ui/layers/RulesEditor";
import { downloadText } from "../../../../src/platform/download";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { Rule } from "../../../../src/features/rules/types";
import { RULE_PRESETS } from "../../../../src/features/rules/presets";
import { CATCH_ALL_RULE_ID_PREFIX } from "../../../../src/features/rules/colorBy";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { CellCache } from "@cityjson/navara-flatcitybuf";
import { buildResidentModel } from "@cityjson/navara-flatcitybuf";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useRuleDraftStore } from "../../../../src/features/rules/ruleDraftStore";
import {
  NEW_RULE_COLOR_HEX,
  SINGLE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

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
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useStreamStore.setState({ streams: {} });
  useRuleDraftStore.setState({ drafts: {} });
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
    ...overrides,
  };
}

/** A preset chip carries a swatch plus its label; the label is its
 *  accessible name. */
function presetChip(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label}$`) });
}

function ruleRows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Rules" })).getAllByRole(
    "listitem",
  );
}

function readLayer(id = "L") {
  return useLayerStore.getState().layers.find((l) => l.id === id)!;
}

function makeRule(over: Partial<Rule> = {}): Rule {
  return {
    id: `r-${over.name ?? "x"}`,
    name: "A rule",
    color: "#ff0000",
    logic: "AND",
    conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
    enabled: true,
    ...over,
  };
}

function fieldOptionTexts(): string[] {
  return screen
    .getAllByRole("option")
    .map((o) => o.textContent)
    .filter((t): t is string => t !== null);
}

describe("RulesEditor — streaming field source", () => {
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
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });
  });

  it("sources condition fields from the resident model, not the (empty) CityModel prop", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    fireEvent.click(screen.getByText("+ Add rule"));

    const options = fieldOptionTexts();
    expect(options).toContain("roofType"); // object attribute on the record
    expect(options).toContain("slope"); // surfaceAttrKeys from the cell
  });
});

describe("RulesEditor — static field source (unchanged)", () => {
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
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });

    render(<RulesEditor model={model} layerId="L" />);
    fireEvent.click(screen.getByText("+ Add rule"));

    const options = fieldOptionTexts();
    expect(options).toContain("yearBuilt");
    expect(options).toContain("pitch");
  });
});

// ---------------------------------------------------------------------------
// Target-layer picker
// ---------------------------------------------------------------------------

describe("RulesEditor — exporting rules", () => {
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
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });

    render(<RulesEditor model={emptyModel()} layerId="L" />);
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(screen.getByText("Export rules"));

    // The STORE's rules, not the prop's, and pretty-printed — the file is
    // meant to be read and edited by hand.
    expect(downloadText).toHaveBeenCalledWith(
      JSON.stringify(rules, null, 2),
      "rules.json",
    );
  });
});

describe("RulesEditor — no On/Off toggle of its own", () => {
  it("offers no rules on/off switch: the mode is the `Color by` select's", () => {
    // The editor used to carry an On/Off checkbox in its header that wrote
    // `rulesEnabled`. Two controls for one fact (this one and the section's
    // `Color by`) is exactly the disagreement 12.3 removes (R10).
    useLayerStore.setState({ layers: [baseLayer({ name: "Delft" })] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    render(<RulesEditor model={emptyModel()} layerId="L" />);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("On")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("opens a new rule on the palette's new-rule colour, not a local literal", () => {
    useLayerStore.setState({ layers: [baseLayer({})] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    fireEvent.click(screen.getByText("+ Add rule"));

    // `scene/cityColors.ts` is the app's ONE colour answer, and the collision
    // test there can only pin a value this file actually uses.
    expect(screen.getByLabelText("Rule colour")).toHaveProperty(
      "value",
      NEW_RULE_COLOR_HEX,
    );
  });
});

describe("RulesEditor — the layer it edits", () => {
  it("offers no picker: the editor follows the workspace's active layer", () => {
    // It used to carry a target `<select>` that let the Rules tab point at a
    // DIFFERENT layer from the one the rest of the UI described.
    useLayerStore.setState({
      layers: [
        baseLayer({ id: "L", name: "Delft" }),
        baseLayer({ id: "R", name: "Rotterdam" }),
      ],
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    expect(
      screen.queryByRole("combobox", { name: /rules target layer/i }),
    ).toBeNull();
    expect(screen.queryByText("Rotterdam")).toBeNull();
  });

  it("edits land on the layer it was given", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({ id: "L", name: "Delft" }),
        baseLayer({ id: "R", name: "Rotterdam" }),
      ],
    });
    useWorkspaceStore.setState({ activeLayerId: "R" });
    render(<RulesEditor model={emptyModel()} layerId="R" />);

    fireEvent.click(presetChip("Flat roofs"));

    const state = useLayerStore.getState();
    expect(state.layers.find((l) => l.id === "R")!.rules).toHaveLength(1);
    expect(state.layers.find((l) => l.id === "L")!.rules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unsaved draft survives switching layers (Task 27)
// ---------------------------------------------------------------------------

describe("RulesEditor — unsaved draft survives switching layers", () => {
  beforeEach(() => {
    useLayerStore.setState({
      layers: [
        baseLayer({ id: "A", name: "Delft" }),
        baseLayer({ id: "B", name: "Rotterdam" }),
      ],
    });
  });

  it("restores the unsaved form's values when the layer is revisited", () => {
    const { rerender } = render(
      <RulesEditor model={emptyModel()} layerId="A" />,
    );

    fireEvent.click(screen.getByText("+ Add rule"));
    fireEvent.change(screen.getByPlaceholderText("Rule name"), {
      target: { value: "Steep south roofs" },
    });
    fireEvent.click(screen.getByText("+ Condition"));

    // Two condition rows now (the default one plus the added one).
    expect(screen.getAllByText("x")).toHaveLength(2);

    // Switch to layer B: its editor starts closed and empty, not carrying
    // A's half-typed form.
    rerender(<RulesEditor model={emptyModel()} layerId="B" />);
    expect(screen.queryByPlaceholderText("Rule name")).toBeNull();
    expect(screen.getByText("+ Add rule")).toBeTruthy();

    // Back to A: the same in-progress values are still there.
    rerender(<RulesEditor model={emptyModel()} layerId="A" />);
    expect(screen.getByPlaceholderText("Rule name")).toHaveProperty(
      "value",
      "Steep south roofs",
    );
    expect(screen.getAllByText("x")).toHaveLength(2);
  });

  it("clears the draft on Save", () => {
    render(<RulesEditor model={emptyModel()} layerId="A" />);

    fireEvent.click(screen.getByText("+ Add rule"));
    fireEvent.change(screen.getByPlaceholderText("Rule name"), {
      target: { value: "New rule" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(useRuleDraftStore.getState().drafts.A).toBeNull();
    expect(screen.queryByPlaceholderText("Rule name")).toBeNull();
    expect(
      useLayerStore.getState().layers.find((l) => l.id === "A")!.rules,
    ).toHaveLength(1);
  });

  it("clears the draft on Cancel", () => {
    render(<RulesEditor model={emptyModel()} layerId="A" />);

    fireEvent.click(screen.getByText("+ Add rule"));
    fireEvent.change(screen.getByPlaceholderText("Rule name"), {
      target: { value: "Discarded" },
    });
    fireEvent.click(screen.getByText("Cancel"));

    expect(useRuleDraftStore.getState().drafts.A).toBeNull();
    expect(screen.queryByPlaceholderText("Rule name")).toBeNull();
    expect(
      useLayerStore.getState().layers.find((l) => l.id === "A")!.rules,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Presets (Task 28)
// ---------------------------------------------------------------------------

describe("RulesEditor — preset chips", () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [baseLayer({})] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
  });

  it("renders all five presets, each with its colour and its description", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    expect(RULE_PRESETS.map((p) => p.label)).toEqual([
      "Flat roofs",
      "South-facing",
      "Steep roofs",
      "Large roofs",
      "Solar suitable",
    ]);
    for (const preset of RULE_PRESETS) {
      const chip = presetChip(preset.label);
      expect(chip.getAttribute("title")).toBe(preset.description);
      const swatch = chip.querySelector(".preset-chip-swatch") as HTMLElement;
      expect(swatch.style.backgroundColor).not.toBe("");
    }
  });

  it("appends the preset's rule, keeping the ones already there", () => {
    useLayerStore.setState({
      layers: [baseLayer({ rules: [makeRule({ name: "Mine" })] })],
    });
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    fireEvent.click(presetChip("Steep roofs"));

    expect(readLayer().rules.map((r) => r.name)).toEqual([
      "Mine",
      "Steep roofs",
    ]);
  });

  it("flips a surface-coloured layer to `rules`: a preset that paints nothing is a dead control", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    fireEvent.click(presetChip("Flat roofs"));
    expect(readLayer().colorBy).toBe("rules");
  });

  it("leaves a single-coloured layer alone: only `surface` is the undecided mode", () => {
    useLayerStore.setState({ layers: [baseLayer({ colorBy: "single" })] });
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    fireEvent.click(presetChip("Flat roofs"));
    expect(readLayer().colorBy).toBe("single");
  });
});

// ---------------------------------------------------------------------------
// The rule list (Task 28)
// ---------------------------------------------------------------------------

describe("RulesEditor — rule rows", () => {
  const three = () => [
    makeRule({ id: "a", name: "Alpha" }),
    makeRule({ id: "b", name: "Beta", enabled: false }),
    makeRule({
      id: "c",
      name: "Gamma",
      logic: "OR",
      conditions: [
        { field: "areaSqM", operator: ">", value: 50 },
        { field: "azimuthDeg", operator: "<=", value: 225 },
      ],
    }),
  ];

  beforeEach(() => {
    useLayerStore.setState({
      layers: [baseLayer({ colorBy: "rules", rules: three() })],
    });
    useWorkspaceStore.setState({ activeLayerId: "L" });
  });

  it("shows each rule's name and its condition", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    const rows = ruleRows();
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Alpha")).toBeTruthy();
    expect(within(rows[0]!).getByText("inclinationDeg < 10")).toBeTruthy();
    expect(
      within(rows[2]!).getByText("areaSqM > 50 OR azimuthDeg <= 225"),
    ).toBeTruthy();
  });

  it("toggles one rule's own enabled flag", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    fireEvent.click(screen.getByLabelText("Enabled: Alpha"));
    expect(readLayer().rules.map((r) => r.enabled)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("deletes the rule it was asked to", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete: Beta" }));
    expect(readLayer().rules.map((r) => r.name)).toEqual(["Alpha", "Gamma"]);
  });

  it("moves a rule up and down, because precedence is first-match-wins", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);

    fireEvent.click(screen.getByRole("button", { name: "Move up: Gamma" }));
    expect(readLayer().rules.map((r) => r.name)).toEqual([
      "Alpha",
      "Gamma",
      "Beta",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Move down: Alpha" }));
    expect(readLayer().rules.map((r) => r.name)).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
    ]);
  });

  it("disables the first row's Move up and the last row's Move down", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    expect(
      screen.getByRole("button", { name: "Move up: Alpha" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Move down: Alpha" }),
    ).toHaveProperty("disabled", false);
    expect(
      screen.getByRole("button", { name: "Move down: Gamma" }),
    ).toHaveProperty("disabled", true);
  });

  it("never renders a synthetic catch-all as a row", () => {
    // The unmatched and single-colour rules are DERIVED (`effectiveRules`) and
    // must never reach the store — but if one ever does, it is a rendering
    // device, not something the user wrote, and editing or deleting it would
    // mean nothing.
    useLayerStore.setState({
      layers: [
        baseLayer({
          colorBy: "rules",
          rules: [
            makeRule({ id: "a", name: "Alpha" }),
            makeRule({
              id: `${CATCH_ALL_RULE_ID_PREFIX}unmatched`,
              name: "Unmatched",
              conditions: [],
            }),
          ],
        }),
      ],
    });
    render(<RulesEditor model={emptyModel()} layerId="L" />);

    expect(ruleRows()).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Delete: Unmatched" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The unmatched colour (Task 28)
// ---------------------------------------------------------------------------

describe("RulesEditor — the unmatched line", () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [baseLayer({ colorBy: "rules" })] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
  });

  it("explains precedence and names the default colour", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    expect(screen.getByText(/First matching rule wins/)).toBeTruthy();
    expect(screen.getByText("Unassigned grey")).toBeTruthy();
  });

  it("writes the swatch's colour to the layer, and then reads as a hex", () => {
    render(<RulesEditor model={emptyModel()} layerId="L" />);
    const input = screen.getByLabelText("Unmatched roofs");
    expect(input).toHaveProperty("value", UNMATCHED_COLOR_HEX);

    fireEvent.change(input, { target: { value: "#112233" } });
    expect(readLayer().unmatchedColor).toBe("#112233");
    // No longer THE unassigned grey, so the label stops claiming it is.
    expect(screen.queryByText("Unassigned grey")).toBeNull();
    expect(screen.getByText("#112233")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The attribute select's order (Task 28)
// ---------------------------------------------------------------------------

describe("RulesEditor — the attribute select's order", () => {
  it("puts the roof metrics first, then the named attributes, then the rest", () => {
    const model: CityModel = {
      ...emptyModel(),
      objects: {
        a: {
          id: "a",
          objectType: "Building",
          attributes: {
            zebra: 1,
            roofType: "gabled",
            alpha: 2,
            measuredHeight: 9,
          },
          surfaces: [],
          bbox: [0, 0, 0, 1, 1, 1],
          children: [],
          parents: [],
          lod: "2.2",
        },
      },
    };
    useLayerStore.setState({ layers: [baseLayer({ model })] });
    useWorkspaceStore.setState({ activeLayerId: "L" });

    render(<RulesEditor model={model} layerId="L" />);
    fireEvent.click(screen.getByText("+ Add rule"));

    // The operator select's options are `>` `<` … — take the field select's.
    const fields = [
      ...(screen.getByLabelText("Attribute") as HTMLSelectElement).options,
    ].map((o) => o.value);
    expect(fields).toEqual([
      "areaSqM",
      "inclinationDeg",
      "azimuthDeg",
      "elevationM",
      "measuredHeight",
      "roofType",
      "alpha",
      "zebra",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Saving a rule (Task 28)
// ---------------------------------------------------------------------------

describe("RulesEditor — saving", () => {
  it("flips a surface-coloured layer to `rules` when a NEW rule is saved", () => {
    useLayerStore.setState({ layers: [baseLayer({ colorBy: "surface" })] });
    render(<RulesEditor model={emptyModel()} layerId="L" />);

    fireEvent.click(screen.getByText("+ Add rule"));
    fireEvent.change(screen.getByPlaceholderText("Rule name"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(readLayer().colorBy).toBe("rules");
    expect(readLayer().rules.map((r) => r.name)).toEqual(["Mine"]);
  });

  it("leaves the mode alone when an EXISTING rule is updated", () => {
    // Editing is not a decision about how the layer is coloured.
    useLayerStore.setState({
      layers: [
        baseLayer({ colorBy: "surface", rules: [makeRule({ name: "Mine" })] }),
      ],
    });
    render(<RulesEditor model={emptyModel()} layerId="L" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit: Mine" }));
    fireEvent.click(screen.getByText("Update"));

    expect(readLayer().colorBy).toBe("surface");
  });
});

// ---------------------------------------------------------------------------
// An OPEN EDIT form survives switching layers too (Task 27 carry)
// ---------------------------------------------------------------------------

describe("RulesEditor — an open EDIT form survives switching layers", () => {
  it("comes back still editing the same rule, with the same values", () => {
    useLayerStore.setState({
      layers: [
        baseLayer({
          id: "A",
          name: "Delft",
          rules: [makeRule({ name: "Mine" })],
        }),
        baseLayer({ id: "B", name: "Rotterdam" }),
      ],
    });
    const { rerender } = render(
      <RulesEditor model={emptyModel()} layerId="A" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit: Mine" }));
    fireEvent.change(screen.getByPlaceholderText("Rule name"), {
      target: { value: "Mine, renamed" },
    });

    rerender(<RulesEditor model={emptyModel()} layerId="B" />);
    expect(screen.queryByPlaceholderText("Rule name")).toBeNull();

    rerender(<RulesEditor model={emptyModel()} layerId="A" />);
    expect(screen.getByPlaceholderText("Rule name")).toHaveProperty(
      "value",
      "Mine, renamed",
    );
    // Still an EDIT, not a fresh add: saving updates the rule rather than
    // appending a second one.
    fireEvent.click(screen.getByText("Update"));
    expect(readLayer("A").rules.map((r) => r.name)).toEqual(["Mine, renamed"]);
  });
});
