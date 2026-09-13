/**
 * `eligibleTargets`: spec §6's "a layer select listing only layers the tool can
 * target", which is more than "the table is ready".
 *
 * Measure solids is the tool these cases drive because it is the first shipped
 * one whose eligibility can fail on one ready layer and pass on another (it
 * needs a reader). Roof metrics and Height from extent need neither a reader nor
 * an extension and run on streaming targets too, so neither can discriminate the
 * ready-table `candidates` at all — which is why this suite used to mock the
 * registry to invent a tool that could.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type {
  LayerTable,
  LayerTableState,
} from "../../../../src/insights/layerTables";

vi.mock("../../../../src/insights/duckdb", () => ({
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) => String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_1"),
  retryRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

/**
 * The cross-layer tools that have not shipped yet, switched ON.
 *
 * Task 15 built their FORM while they were all `implemented: false` — and
 * `toolEligibility` refuses an unimplemented tool outright with "Not available
 * yet", which sits above every other reason, so driving the form through the
 * real registry would assert nothing about the source select, the proxy or the
 * frozen request. `toolById` is re-implemented over the patched list because
 * the real one closes over the module's own array.
 *
 * JOIN IS NOT IN THE SET: it ships in this milestone, so every Join case below
 * runs against the REAL registry entry — its readiness reasons included.
 */
const CROSS_LAYER = new Set(["aggregate-per-area", "distance-to-nearest"]);
vi.mock("../../../../src/features/processing/toolRegistry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/toolRegistry")
  >("../../../../src/features/processing/toolRegistry");
  const TOOLS = actual.TOOLS.map((tool) =>
    CROSS_LAYER.has(tool.id) ? { ...tool, implemented: true } : tool,
  );
  return {
    ...actual,
    TOOLS,
    toolById: (id: string) => {
      const tool = TOOLS.find((t) => t.id === id);
      if (!tool) throw new Error(`Unknown tool: ${id}`);
      return tool;
    },
  };
});

vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: vi.fn(() => ({
    all: 2,
    matching: null,
    selected: 0,
    loading: false,
    message: null,
  })),
}));

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { toolWorkloadNote } =
  await import("../../../../src/ui/processing/useToolForm");
const { toolById } =
  await import("../../../../src/features/processing/toolRegistry");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
const { useLayerCounts } =
  await import("../../../../src/ui/table/useLayerCounts");

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

/** A ready table's INFO, with or without the reader Measure solids needs.
 *  Split out so a case can stand the same table up with its own `columns`. */
function readyTableInfo(withReader: boolean): LayerTable {
  return {
    table: "layer_1",
    sourceName: withReader ? "delft.city.json" : null,
    source: withReader ? ({} as never) : null,
    reader: withReader ? "read_cityjson" : null,
    extension: withReader ? "city.json" : null,
    sourceBytes: null,
    columns: [],
    // An LoD 0 rung, so §7.5's "Footprint (LoD 0)" proxy is offered on a table
    // that also has a reader — which is what makes the default proxy testable.
    lods: withReader ? [{ label: "0", suffix: "0" }] : [],
    rowCount: 2,
  };
}

/** A ready table, with or without the reader Measure solids needs. */
function readyTable(withReader: boolean): LayerTableState {
  return { state: "ready", info: readyTableInfo(withReader) };
}

/** One run's provenance, so a colliding column reads as REPLACEABLE (this
 *  app wrote it) rather than as the source data's own. */
const PROVENANCE = {
  runId: "run_0",
  toolName: "Roof metrics to attributes",
  summary: "All 2 buildings",
  at: 0,
  partial: null,
  previous: null,
};

function addCityLayer(name: string, withReader: boolean): string {
  const model = {
    sourceEncoding: "cityjson",
    metadata: { referenceSystem: undefined },
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
  const input: LayerInput = {
    name,
    model,
    modelRef: { type: "url", url: `https://x/${name}.city.json` },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: false,
  };
  const id = useLayerStore.getState().addLayer(input);
  useLayerTableStore.setState({
    tables: {
      ...useLayerTableStore.getState().tables,
      [id]: readyTable(withReader),
    },
  });
  return id;
}

/** A polygon layer and a point layer, so §7.5's source select can refuse one. */
function addGeoLayer(name: string, kind: "Polygon" | "Point"): string {
  return useGeoLayerStore.getState().addGeoLayer({
    name,
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: `${name}-1`,
            properties: { zone: "A" },
            geometry:
              kind === "Polygon"
                ? {
                    type: "Polygon",
                    coordinates: [
                      [
                        [4, 52],
                        [5, 52],
                        [5, 53],
                        [4, 52],
                      ],
                    ],
                  }
                : { type: "Point", coordinates: [4, 52] },
          },
        ],
      },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useGeoLayerStore.setState({ layers: [] });
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
});

describe("the Layer select (spec §6 TARGET)", () => {
  it("offers only the layers the tool can target, not every ready table", () => {
    const withReader = addCityLayer("Delft", true);
    addCityLayer("Rotterdam", false);
    useWorkspaceStore.getState().setActiveLayerId(withReader);
    render(<ToolView toolId="measure-solids" />);
    const select = screen.getByRole("combobox", { name: "Layer" });
    expect(
      [...select.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual(["Delft"]);
  });

  it("keeps an ineligible target the user already chose, and says why", () => {
    const withReader = addCityLayer("Delft", true);
    const withoutReader = addCityLayer("Rotterdam", false);
    useWorkspaceStore.getState().setActiveLayerId(withReader);
    useProcessingStore.getState().setDraft("measure-solids", {
      targetLayerId: withoutReader,
      sourceLayerId: null,
      scope: "all",
      lod: null,
      prefix: "solid_",
      params: {},
    });
    render(<ToolView toolId="measure-solids" />);
    // §5: "A disabled row still opens the tool view" — the select is never
    // blank, and Run carries the reason.
    expect(screen.getByRole("combobox", { name: "Layer" })).toHaveValue(
      withoutReader,
    );
    expect(
      screen.getByText(
        "Needs a CityJSON or CityJSONSeq source; this layer was loaded from CityJSON",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});

describe("the OUTPUT column list, typed (spec §7)", () => {
  it("still counts the columns that exist, over typed columns", () => {
    // `existing` is `columns.filter(c => onTable.has(c.name.toLowerCase()))`
    // after this task. A filter left on the OBJECT would match nothing and the
    // replace warning would silently stop appearing.
    const id = addCityLayer("Delft", true);
    useWorkspaceStore.getState().setActiveLayerId(id);
    useLayerTableStore.setState({
      tables: {
        ...useLayerTableStore.getState().tables,
        [id]: {
          state: "ready",
          info: {
            ...readyTableInfo(true),
            columns: [{ name: "roof_area_m2", type: "DOUBLE", kind: "scalar" }],
          },
        },
      },
    });
    useComputedColumnStore
      .getState()
      .setProvenance(id, "roof_area_m2", PROVENANCE);
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByText("1 of these columns exist; they will be replaced."),
    ).toBeInTheDocument();
  });

  it("names the TABLE's spelling when a typed column collides with the file", () => {
    // §6, verbatim: "'height' belongs to the source data; choose another
    // prefix" — and the spelling in the message is the table's, which is now
    // reached through `onTable.get(c.name.toLowerCase())`.
    const id = addCityLayer("Delft", true);
    useWorkspaceStore.getState().setActiveLayerId(id);
    useLayerTableStore.setState({
      tables: {
        ...useLayerTableStore.getState().tables,
        [id]: {
          state: "ready",
          info: {
            ...readyTableInfo(true),
            columns: [
              { name: "EXTENT_height_m", type: "DOUBLE", kind: "scalar" },
            ],
          },
        },
      },
    });
    render(<ToolView toolId="height-from-extent" />);
    expect(
      screen.getByText(
        "'EXTENT_height_m' belongs to the source data; choose another prefix",
      ),
    ).toBeInTheDocument();
  });
});

/**
 * Spec §6's workload note, on a tool DEFINITION rather than on the form: the
 * two conjuncts are §6's rules, and stating them on definitions that declare
 * themselves keeps the invariant true of every registry entry, shipped or not.
 */
describe("§6's workload note", () => {
  const heavy: LayerTable = {
    ...readyTableInfo(true),
    sourceBytes: 180_000_000,
  };

  it("warns about a large source for a tool that re-reads it", () => {
    const tool = { ...toolById("measure-solids"), implemented: true };
    expect(toolWorkloadNote(tool, heavy)).toBe(
      "Re-reads a 180 MB source; this can take a minute and needs memory",
    );
  });

  it("says nothing for an UNIMPLEMENTED tool, whatever the source weighs", () => {
    // §6: a tool whose executor has not shipped claims no fact about the
    // user's data — and "this can take a minute" is a fact about a read the
    // app cannot perform.
    const tool = { ...toolById("measure-solids"), implemented: false };
    expect(toolWorkloadNote(tool, heavy)).toBeNull();
  });

  it("says nothing for a tool that never re-reads the source", () => {
    expect(toolWorkloadNote(toolById("height-from-extent"), heavy)).toBeNull();
  });

  it("says nothing without a ready table to read the size off", () => {
    const tool = { ...toolById("measure-solids"), implemented: true };
    expect(toolWorkloadNote(tool, null)).toBeNull();
  });
});

/**
 * §6's TARGET section for a cross-layer tool: a SOURCE select beside the layer
 * select, the prefix it names, and the two layers the form has to keep apart.
 */
describe("the SOURCE select and the prefix it names (§7.5, §7.7)", () => {
  it("lists the vector layers and disables a point layer", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    addGeoLayer("Points", "Point");
    render(<ToolView toolId="join-by-location" />);
    const select = screen.getByRole("combobox", { name: "Source" });
    const options = [...select.querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual(["Zones", "Points"]);
    // §7.5: a point layer is listed DISABLED with its reason.
    expect(options[1]).toBeDisabled();
    expect(options[1]).toHaveAttribute("title", "Needs areas (polygons)");
    // The first ELIGIBLE row is the one chosen.
    expect(select).toHaveValue(options[0]?.getAttribute("value"));
  });

  it("prefills the prefix from the source layer's slugified name", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    expect(screen.getByLabelText("Prefix")).toHaveValue("zones_");
  });

  it("resolves the target's own default proxy, which the log then names", () => {
    // The fixture's ready table has a reader and an LoD 0 rung, so §7.5's
    // default is the footprint — which is what the frozen bag must carry.
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeChecked();
  });

  it("warns about a large source only when the PROXY will re-read it", () => {
    // Task 5 guarded the note with `tool.needsReader`, and the three
    // cross-layer tools declare `needsReader: false` because their source read
    // is OPTIONAL — only the footprint proxy re-reads. So the guard follows the
    // resolved proxy here.
    const id = addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    useLayerTableStore.setState((state) => {
      const entry = state.tables[id];
      if (entry?.state !== "ready") return state;
      return {
        tables: {
          ...state.tables,
          [id]: {
            ...entry,
            info: { ...entry.info, sourceBytes: 180_000_000 },
          },
        },
      };
    });
    render(<ToolView toolId="join-by-location" />);
    expect(
      screen.getByText(
        "Re-reads a 180 MB source; this can take a minute and needs memory",
      ),
    ).toBeInTheDocument();

    // Switch to a proxy that reads the browsing table's `bbox` and nothing
    // else: no read, no note. A warning about a read that will not happen is
    // the false alarm Task 5's guard exists to prevent.
    fireEvent.click(screen.getByRole("radio", { name: "Extent rectangle" }));
    expect(screen.queryByText(/Re-reads a/)).toBeNull();
  });

  it("counts the SOURCE city layer's buildings for Aggregate (§7.6)", () => {
    const delft = addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="aggregate-per-area" />);
    // The counts come from the CITY layer, never from the vector TARGET —
    // §7.6: "Scope applies to the SOURCE buildings".
    expect(useLayerCounts).toHaveBeenCalledWith(delft);
    // The TARGET select lists the vector layer; the scope radios count Delft.
    expect(screen.getByRole("combobox", { name: "Layer" })).toHaveTextContent(
      "Zones",
    );
    expect(screen.getByRole("combobox", { name: "Source" })).toHaveTextContent(
      "Delft",
    );
    expect(screen.getByLabelText(/All 2 buildings/)).toBeInTheDocument();
    // **[adapted copy A12]**
    expect(
      screen.getByText("Scope applies to the source layer's buildings."),
    ).toBeInTheDocument();
  });

  it("freezes the proxy the form SHOWED, through `normaliseParams`", () => {
    // The registry's `normaliseParams` re-resolves the already-resolved bag
    // with a context that has no table. If that pass narrowed the proxy, the
    // run submitted here would be a CENTRE join while the form said footprint
    // — and §6.4's log would name a proxy that was never used. The assertion is
    // on the request the mocked `submitRun` actually received.
    addCityLayer("Delft", true);
    const zones = addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "join-by-location",
        sourceLayerId: zones,
        prefix: "zones_",
        params: expect.objectContaining({
          proxy: "footprint",
          fields: ["zone"],
          fieldTypes: { zone: "VARCHAR" },
        }),
        columns: [{ name: "zones_zone", type: "VARCHAR" }],
      }),
    );
  });

  /**
   * §7.5: `centre within` "forces the centre proxy" — in the form AND in the
   * bag `submitRun` freezes, so §6.4's log cannot name a footprint the
   * predicate overrode and §6's footprint workload note goes with it.
   */
  it("freezes the centre proxy when 'centre within' is chosen (§7.5)", () => {
    const id = addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    useLayerTableStore.setState((state) => {
      const entry = state.tables[id];
      if (entry?.state !== "ready") return state;
      return {
        tables: {
          ...state.tables,
          [id]: {
            ...entry,
            info: { ...entry.info, sourceBytes: 180_000_000 },
          },
        },
      };
    });
    render(<ToolView toolId="join-by-location" />);
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeChecked();
    expect(screen.getByText(/Re-reads a/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Predicate"), {
      target: { value: "centreWithin" },
    });
    expect(screen.getByRole("radio", { name: "Extent centre" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeDisabled();
    // No footprint, no re-read, no warning about one.
    expect(screen.queryByText(/Re-reads a/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          predicate: "centreWithin",
          proxy: "centre",
        }),
      }),
    );
  });

  it("freezes the centre proxy for Aggregate too (§7.6)", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="aggregate-per-area" />);
    fireEvent.change(screen.getByLabelText("Predicate"), {
      target: { value: "centreWithin" },
    });
    expect(screen.getByRole("radio", { name: "Extent centre" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "aggregate-per-area",
        params: expect.objectContaining({
          predicate: "centreWithin",
          proxy: "centre",
        }),
      }),
    );
  });

  it("says why a source row is unusable, in §7.5's own order", () => {
    // A layer whose document is still loading has no geometry to ask about, so
    // "Needs areas (polygons)" would be a sentence about a fact nobody knows.
    addCityLayer("Delft", true);
    const loading = useGeoLayerStore.getState().addGeoLayer({
      name: "Pending",
      kind: "geojson",
      config: { url: "https://x/zones.geojson" },
    });
    const empty = useGeoLayerStore.getState().addGeoLayer({
      name: "Empty",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
    render(<ToolView toolId="join-by-location" />);
    const options = [
      ...screen
        .getByRole("combobox", { name: "Source" })
        .querySelectorAll("option"),
    ];
    const titleOf = (id: string) =>
      options
        .find((o) => o.getAttribute("value") === id)
        ?.getAttribute("title");
    expect(titleOf(loading)).toBe("This vector layer is still loading");
    expect(titleOf(empty)).toBe("The source layer has no features");
  });

  /**
   * Residual B6. Every source row is disabled, so there is no enabled default
   * to fall back to — and a null source would take the row's reason off the
   * screen and leave Run blocked by something unrelated (Join) or by nothing at
   * all (Distance, whose parameters are valid on their own).
   */
  it("keeps a disabled source chosen, so its reason is what Run repeats", () => {
    addCityLayer("Delft", true);
    const empty = useGeoLayerStore.getState().addGeoLayer({
      name: "Empty",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
    render(<ToolView toolId="join-by-location" />);
    const select = screen.getByRole("combobox", { name: "Source" });
    expect(select).toHaveValue(empty);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(
      screen.getByText("The source layer has no features", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("never exposes Run for Distance with no usable source (§7.7)", () => {
    // Distance's own parameters (500 m, no nearest id) are valid, so nothing
    // else in the form would block it.
    addCityLayer("Delft", true);
    useGeoLayerStore.getState().addGeoLayer({
      name: "Empty",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
    render(<ToolView toolId="distance-to-nearest" />);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(
      screen.getByText("The source layer has no features", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  /** §7.6's TARGET half of the same rule: the vector layer is the one written
   *  to, so a point layer is refused there — the row with the copy table's
   *  `Needs areas (polygons)`, Run with its own `The layer has no areas`. */
  it("refuses a point-layer TARGET for Aggregate with §7.6's own sentences", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Points", "Point");
    render(<ToolView toolId="aggregate-per-area" />);
    const option = screen.getByRole("option", { name: "Points" });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute("title", "Needs areas (polygons)");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(
      screen.getByText("The layer has no areas", { selector: "p" }),
    ).toBeInTheDocument();
  });

  /**
   * §7.6's TARGET must be AREAS, so the layer the form OPENS on has to be one —
   * a disabled point layer chosen by default puts "The layer has no areas"
   * under Run on a workspace that has a perfectly good polygon layer in it.
   * The point row stays in the select for the explanation (§5).
   */
  it("opens Aggregate on a polygon layer, not on a point layer listed first", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Points", "Point");
    const zones = addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="aggregate-per-area" />);
    expect(screen.getByRole("combobox", { name: "Layer" })).toHaveValue(zones);
    const option = screen.getByRole("option", { name: "Points" });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute("title", "Needs areas (polygons)");
    expect(screen.queryByText("The layer has no areas")).toBeNull();
  });

  it("drops the parameters when the SOURCE changes, so stale fields cannot freeze", () => {
    addCityLayer("Delft", true);
    addGeoLayer("Zones", "Polygon");
    const other = addGeoLayer("Districts", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /zone/ }));
    expect(
      useProcessingStore.getState().drafts["join-by-location"]?.params,
    ).toMatchObject({ fields: [] });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: other },
    });
    expect(
      useProcessingStore.getState().drafts["join-by-location"]?.params,
    ).toEqual({});
  });
});

/**
 * A LoD is a statement about ONE layer, so a retarget drops it — but the
 * MEASURES a single-layer tool writes are not: they are a statement about what
 * the user wants written, and they survived a retarget before Task 15 taught
 * the form about a second layer. Only a cross-layer bag names the source.
 */
describe("what a retarget keeps (§6's per-tool draft)", () => {
  /** Two city layers with ready tables — `addCityLayer` merges, so both stay
   *  candidates. */
  function twoCityLayers(): readonly [string, string] {
    return [addCityLayer("Delft", true), addCityLayer("Rotterdam", true)];
  }

  it("keeps Roof metrics' measures and threshold across a layer change", () => {
    const [first, second] = twoCityLayers();
    useProcessingStore.getState().setDraft("roof-metrics", {
      targetLayerId: first,
      sourceLayerId: null,
      scope: "all",
      lod: null,
      prefix: "roof_",
      params: { measures: ["roofArea"], flatThresholdDeg: 12 },
    });
    render(<ToolView toolId="roof-metrics" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Layer" }), {
      target: { value: second },
    });
    const draft = useProcessingStore.getState().drafts["roof-metrics"];
    expect(draft?.targetLayerId).toBe(second);
    expect(draft?.params).toEqual({
      measures: ["roofArea"],
      flatThresholdDeg: 12,
    });
    // The LoD is still dropped — it was a statement about the OLD layer.
    expect(draft?.lod).toBeNull();
  });

  it("keeps Measure solids' measures across a layer change", () => {
    const [first, second] = twoCityLayers();
    useProcessingStore.getState().setDraft("measure-solids", {
      targetLayerId: first,
      sourceLayerId: null,
      scope: "all",
      lod: null,
      prefix: "solid_",
      params: { measures: ["volume"] },
    });
    render(<ToolView toolId="measure-solids" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Layer" }), {
      target: { value: second },
    });
    expect(
      useProcessingStore.getState().drafts["measure-solids"]?.params,
    ).toEqual({ measures: ["volume"] });
  });

  it("still drops a CROSS-LAYER bag, which names the source's own fields", () => {
    addCityLayer("Delft", true);
    const other = addCityLayer("Rotterdam", true);
    addGeoLayer("Zones", "Polygon");
    render(<ToolView toolId="join-by-location" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /zone/ }));
    expect(
      useProcessingStore.getState().drafts["join-by-location"]?.params,
    ).toMatchObject({ fields: [] });
    fireEvent.change(screen.getByRole("combobox", { name: "Layer" }), {
      target: { value: other },
    });
    expect(
      useProcessingStore.getState().drafts["join-by-location"]?.params,
    ).toEqual({});
  });
});
