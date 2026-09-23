import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const runQuery = vi.fn();
/** Whoever asked to hear about the engine dying, as a real set: a case drives a
 *  death through it, so the inert stub would leave the dialog's request hanging
 *  for ever — which is the very thing it is asserting against. */
const deathListeners = new Set<() => void>();
vi.mock("../../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn((listener: () => void) => {
    deathListeners.add(listener);
    return () => deathListeners.delete(listener);
  }),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: (sql: string) => runQuery(sql),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const runExport = vi.fn();
vi.mock("../../../../src/insights/familyViews", () => ({
  ensureFamilyView: vi.fn(async () => ({ ok: true }) as const),
  dropFamilyView: vi.fn(async () => {}),
  dropFamilyViews: vi.fn(async () => {}),
}));
vi.mock("../../../../src/features/cityparquet/familySourceCrs", () => ({
  familySourceCrs: vi.fn(async () => "EPSG:6697"),
}));

vi.mock("../../../../src/insights/export", () => ({
  runExport: (request: unknown) => runExport(request),
}));

const downloadBlob = vi.fn();
vi.mock("../../../../src/platform/download", () => ({
  downloadBlob: (blob: Blob, name: string) => downloadBlob(blob, name),
  downloadText: vi.fn(),
}));

// TYPED parameter: an argument-less `vi.fn` is not callable with the layer id,
// and the assertion below reads the id it was called with. It resolves an
// OUTCOME, because the dialog reads one — a refresh that did not land must not
// leave Export offering a stale resident set.
const refreshStreamingTable = vi.fn(
  async (_layerId: string): Promise<{ ok: boolean; message?: string }> => ({
    ok: true,
  }),
);
vi.mock(
  "../../../../src/features/layers/layerTableLifecycle",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../src/features/layers/layerTableLifecycle")
    >()),
    refreshStreamingTable: (layerId: string) => refreshStreamingTable(layerId),
  }),
);

const { ExportDialog } = await import("../../../../src/ui/table/ExportDialog");
// A SIBLING module, like `tableText.ts`: a function exported beside a
// component costs the file fast refresh, and the linter says so.
const { exportFileName } =
  await import("../../../../src/ui/table/exportFileName");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useFamilyStore, buildLayerFamilies, resetFamilyStoreForTest } =
  await import("../../../../src/features/layers/familyStore");
const { useSelectionStore } =
  await import("../../../../src/features/selection/selectionStore");

const READER_TABLE = {
  table: "layer_1",
  sourceName: "layer_1.city.json",
  source: async () => new Uint8Array([1]),
  reader: "read_cityjson" as const,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
    { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
    { name: "parents", type: "VARCHAR[]", kind: "nested" as const },
    { name: "children", type: "VARCHAR[]", kind: "nested" as const },
    { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" as const },
  ],
  lods: [
    { label: "1.2", suffix: "1_2" },
    { label: "2.2", suffix: "2_2" },
  ],
  extension: "city.json" as const,
  sourceBytes: null,
  sourceFeatureIds: null,
  rowCount: 10,
};

const FALLBACK_TABLE = {
  ...READER_TABLE,
  sourceName: null,
  source: null,
  reader: null,
  extension: null,
  lods: [],
};

function open(over: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(
    <ExportDialog
      layerId="L"
      layerName="delft"
      table={READER_TABLE}
      epsg={7415}
      selectedLod="2.2"
      isStreaming={false}
      onClose={onClose}
      {...over}
    />,
  );
  return { onClose };
}

beforeEach(() => {
  resetFamilyStoreForTest();
  deathListeners.clear();
  runQuery.mockReset();
  runQuery.mockResolvedValue({
    ok: true,
    columns: ["value"],
    rows: [{ value: "Building" }, { value: "SolitaryVegetationObject" }],
  });
  runExport.mockReset();
  runExport.mockResolvedValue({
    blob: new Blob(["x"]),
    fileName: "delft.csv",
    warnings: [],
  });
  downloadBlob.mockReset();
  refreshStreamingTable.mockClear();
  refreshStreamingTable.mockResolvedValue({ ok: true });
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
  useLayerStore.setState({ layers: [] });
  useSelectionStore.setState({ selections: [] });
});

afterEach(cleanup);

describe("exportFileName", () => {
  it("names the file after the layer, extension swapped", () => {
    expect(exportFileName("delft.city.json", "csv")).toBe("delft.csv");
    expect(exportFileName("delft", "parquet")).toBe("delft.parquet");
    expect(exportFileName("delft.city.json", "cityparquet.zip")).toBe(
      "delft.cityparquet.zip",
    );
  });

  it("strips only a TRAILING known extension, never at the first dot", () => {
    // Splitting at the first dot deleted the part of the name that said which
    // extract the file was.
    expect(exportFileName("Delft LoD 2.2", "csv")).toBe("Delft_LoD_2.2.csv");
    expect(exportFileName("3dbag.v2024.city.json", "csv")).toBe(
      "3dbag.v2024.csv",
    );
    // A chain: 3D BAG serves `.city.json.gz` and both halves have to go.
    expect(exportFileName("tile.city.json.gz", "parquet")).toBe("tile.parquet");
    expect(exportFileName("archive.zip", "json")).toBe("archive.json");
    // An extension we do not know is part of the name, not something to eat.
    expect(exportFileName("model.xyz", "csv")).toBe("model.xyz.csv");
  });

  it("replaces what a file name has no business holding", () => {
    expect(exportFileName("Rotterdam / centrum", "csv")).toBe(
      "Rotterdam_centrum.csv",
    );
    expect(exportFileName("a:b*c?", "csv")).toBe("a_b_c.csv");
    // …but a LETTER is a letter in any script. `\w` is ASCII, so it used to
    // spell Zürich "Z_rich" and leave 東京 with no stem at all — a PLATEAU
    // extract downloaded as "export.csv".
    expect(exportFileName("Zürich Altstadt", "csv")).toBe(
      "Zürich_Altstadt.csv",
    );
    expect(exportFileName("東京.city.json", "csv")).toBe("東京.csv");
    // Nothing but an extension leaves no stem — better than a file called
    // ".csv", which most browsers will not save at all.
    expect(exportFileName(".city.json", "csv")).toBe("export.csv");
    expect(exportFileName("   ", "csv")).toBe("export.csv");
  });
});

describe("ExportDialog", () => {
  it("lists the layer's TOP-LEVEL object types, all selected", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT DISTINCT "object_type" AS "value" FROM "layer_1" WHERE "parents" IS NULL AND "object_type" IS NOT NULL ORDER BY 1',
    );
    expect(
      (screen.getByLabelText("Building") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("lists the ATTRIBUTE columns only — never the fixed prefix", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.getByLabelText("b3_h_dak_max")).toBeTruthy();
    expect(screen.queryByLabelText("feature_id")).toBeNull();
    expect(screen.queryByLabelText("object_type")).toBeNull();
  });

  it("offers the layer's LoDs by LABEL, valued by SUFFIX, defaulted to the selected one", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    const lod = screen.getByLabelText("Level of detail") as HTMLSelectElement;
    // The user reads "1.2"; the option's value is what a column name is built
    // from. Conflating the two is what spelled 3D BAG's `geometry_lod0_0` as
    // `geometry_lod0`.
    expect([...lod.options].map((o) => o.textContent)).toEqual(["1.2", "2.2"]);
    expect([...lod.options].map((o) => o.value)).toEqual(["1_2", "2_2"]);
    expect(lod.value).toBe("2_2");
  });

  it("falls back to the HIGHEST rung when the layer's LoD is not in the ladder", async () => {
    open({ selectedLod: "9.9" });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(
      (screen.getByLabelText("Level of detail") as HTMLSelectElement).value,
    ).toBe("2_2");
  });

  it("keeps the reader's own spelling of LoD 0", async () => {
    open({
      table: {
        ...READER_TABLE,
        lods: [{ label: "0.0", suffix: "0_0" }],
      },
      selectedLod: "0.0",
    });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    const lod = screen.getByLabelText("Level of detail") as HTMLSelectElement;
    expect(lod.value).toBe("0_0");
    expect([...lod.options].map((o) => o.textContent)).toEqual(["0.0"]);
  });

  it("hides the LoD picker and every geometry format for a fallback table, and says why", async () => {
    open({ table: FALLBACK_TABLE, epsg: 7415 });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.queryByLabelText("Level of detail")).toBeNull();
    expect(screen.getByLabelText("Parquet")).toBeTruthy();
    expect(screen.getByLabelText("CSV")).toBeTruthy();
    expect(screen.getByLabelText("JSON")).toBeTruthy();
    expect(screen.queryByLabelText("CityParquet package (.zip)")).toBeNull();
    expect(screen.queryByLabelText("CityJSON")).toBeNull();
    expect(
      screen.getByText(
        "This layer has no CityJSON source in DuckDB; geometry formats need one",
      ),
    ).toBeTruthy();
  });

  it("offers CityJSON, CityJSONSeq and FlatCityBuf DISABLED, with the reason", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    for (const label of ["CityJSON", "CityJSONSeq", "FlatCityBuf"]) {
      const radio = screen.getByLabelText(label) as HTMLInputElement;
      expect(radio.disabled).toBe(true);
      expect(radio.closest("label")!.title).toBe(
        "Not available in the browser build of the cityjson extension (writes an empty file)",
      );
    }
  });

  it("still exports ATTRIBUTES when the layer's bytes cannot be re-obtained", async () => {
    // A missing source costs the CityParquet package and nothing else: CSV,
    // JSON and Parquet are written from the browsing table, which is right
    // there. Disabling the whole button left a re-opened session unable to
    // take a CSV out of a table it was busily browsing.
    open({ table: { ...READER_TABLE, source: null } });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    const button = screen.getByRole("button", {
      name: "Export",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByLabelText("CityParquet package (.zip)")).toBeNull();
    expect(
      screen.getByText("Re-link the file to export this layer"),
    ).toBeTruthy();
  });

  it("wears the app's real modal chrome", async () => {
    // `modal-dialog`, a bare <h2> and a bare × exist in NO stylesheet here, so
    // the dialog rendered as unstyled text over the viewport: no panel, no
    // width bound, no max-height scroll.
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    const dialog = screen.getByRole("dialog");
    expect(dialog.className.split(" ")).toContain("modal");
    expect(dialog.getAttribute("aria-labelledby")).toBe("export-dialog-title");
    expect(document.getElementById("export-dialog-title")?.className).toBe(
      "modal-title",
    );
    expect(screen.getByRole("button", { name: "Close" }).className).toBe(
      "modal-close",
    );
  });

  it("sends the LoD the user picked, not the one it opened on", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Level of detail"), {
      target: { value: "1_2" },
    });
    fireEvent.click(screen.getByLabelText("CityParquet package (.zip)"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    expect(
      (runExport.mock.calls[0]![0] as { lodSuffix: string }).lodSuffix,
    ).toBe("1_2");
  });

  it("exports the WHOLE layer when that is the choice, filter or no filter", async () => {
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [{ id: "c", column: "b3_h_dak_max", op: ">", value: 10 }],
    });
    useQueryStore.getState().applyFilter("L");
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Whole layer"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    expect(
      (runExport.mock.calls[0]![0] as { where: string | null }).where,
    ).toBeNull();
  });

  it("falls back to the whole layer when the filter is cleared under it", async () => {
    // The filter bar is still live behind this modal. A stale "filter" scope
    // would compile nothing and export everything while the radio still
    // claimed otherwise.
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [{ id: "c", column: "b3_h_dak_max", op: ">", value: 10 }],
    });
    useQueryStore.getState().applyFilter("L");
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(
      (screen.getByLabelText("Current filter") as HTMLInputElement).checked,
    ).toBe(true);

    useQueryStore.getState().clearFilter("L");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Whole layer") as HTMLInputElement).checked,
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(runExport).toHaveBeenCalled());
    expect(
      (runExport.mock.calls[0]![0] as { where: string | null }).where,
    ).toBeNull();
  });

  it("says why the button is dead while the table is being rebuilt", async () => {
    useLayerTableStore.setState({
      tables: {
        L: {
          state: "ready",
          info: READER_TABLE as never,
          rebuilding: true,
        },
      },
    });
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    const button = screen.getByRole("button", {
      name: "Refreshing table…",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows §6.1's sentence when the engine dies under the type probe", async () => {
    // THE OFF-QUEUE HAZARD. `duckdb.ts` used to leave a request its worker died
    // under unsettled for ever, and this dialog awaits one OUTSIDE the table
    // FIFO — so the type list stayed empty and Export stayed disabled with
    // nothing on screen to explain it. Every primitive now settles with its
    // ordinary failure value, which this fake reproduces: the request answers
    // only when the death does.
    runQuery.mockImplementation(
      () =>
        new Promise((resolve) => {
          deathListeners.add(() => {
            resolve({ ok: false, message: "Analytics engine stopped" });
          });
        }),
    );
    open();
    await waitFor(() => expect(deathListeners.size).toBeGreaterThan(0));
    for (const listener of Array.from(deathListeners)) {
      deathListeners.delete(listener);
      listener();
    }
    expect(await screen.findByText("Analytics engine stopped")).toBeTruthy();
  });

  it("shows the reason a type probe failed instead of a silently dead button", async () => {
    runQuery.mockResolvedValue({
      ok: false,
      message: "Catalog Error: Table with name layer_1 does not exist!",
    });
    open();
    expect(
      await screen.findByText(
        "Catalog Error: Table with name layer_1 does not exist!",
      ),
    ).toBeTruthy();
  });

  it("ignores Escape and the backdrop while an export is in flight", async () => {
    let finish: (result: unknown) => void = () => {};
    runExport.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { onClose } = open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    const button = await screen.findByRole("button", { name: "Exporting…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    finish({ blob: new Blob(["x"]), fileName: "delft.csv", warnings: [] });
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
  });

  it("warns that streaming exports include only currently loaded records", async () => {
    open({ table: FALLBACK_TABLE, isStreaming: true });
    expect(
      await screen.findByText(
        "Exports include currently loaded records only, not the whole dataset.",
      ),
    ).toBeTruthy();
  });

  it("does NOT warn for a family's table, which is read from the file", async () => {
    // A CityParquet family's rows come from the FILE (R-B′), so an export of one
    // is not limited to what the camera delivered.
    useFamilyStore.getState().setFamilies(
      "L",
      buildLayerFamilies([
        {
          key: "building",
          href: "building.parquet",
          size: null,
          source: { url: "https://x/building.parquet" },
        },
      ]),
    );
    open({ table: FALLBACK_TABLE, isStreaming: true });
    await waitFor(() =>
      expect(screen.queryByText(/currently loaded records only/)).toBeNull(),
    );
  });

  it("forces one table rebuild when it opens on a streaming layer", async () => {
    open({ table: FALLBACK_TABLE, isStreaming: true });
    await waitFor(() =>
      expect(refreshStreamingTable).toHaveBeenCalledWith("L"),
    );
  });

  it("does NOT rebuild for a static layer", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(refreshStreamingTable).not.toHaveBeenCalled();
  });

  it("REFUSES to export when the refresh it asked for did not land", async () => {
    // A failed rebuild restores the PREVIOUS table as `ready` — correct for
    // the grid, and the reason the store cannot be asked this. Without the
    // outcome the dialog just stopped saying "Refreshing table…" and wrote
    // whatever was resident at the last successful build.
    refreshStreamingTable.mockResolvedValue({
      ok: false,
      message: "IO Error: boom",
    });
    open({ table: FALLBACK_TABLE, isStreaming: true });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not be rebuilt");
    // The ENGINE'S own sentence, not a canned one: "IO Error" and "the layer
    // was removed" want different next moves.
    expect(alert.textContent).toContain("IO Error: boom");
    const button = screen.getByRole("button", { name: "Export" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(runExport).not.toHaveBeenCalled();
  });

  it("REFUSES to export a resident table the FILE has superseded", async () => {
    // R-B′/R-C′ interim hazard: once a family's view exists, the layer's old
    // resident table is frozen at whatever was loaded when it was last built —
    // and `refreshStreamingTable` rightly refuses to rebuild it. Exporting it
    // would hand back that snapshot as if it were the layer, with nothing on
    // screen to say so, so the dialog refuses until a family's own table is
    // the one it was handed.
    useLayerTableStore.setState({
      tables: {
        L: { state: "ready", info: FALLBACK_TABLE },
        "L::building": {
          state: "ready",
          info: {
            ...FALLBACK_TABLE,
            table: "layer_9",
            fileBacked: true,
            familyKey: "building",
          },
        },
      },
    } as never);
    open({ table: FALLBACK_TABLE, isStreaming: true });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("object family");
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(runExport).not.toHaveBeenCalled();
  });

  it("exports one family's view while ANOTHER family's view exists", async () => {
    // The refusal is about a RESIDENT table the file has superseded, never about
    // a sibling family: refusing here would tell the user to "export the
    // family's own table" — which is exactly what they are doing.
    const buildingTable = {
      ...FALLBACK_TABLE,
      table: "layer_9",
      fileBacked: true,
      familyKey: "building",
    };
    useLayerTableStore.setState({
      tables: {
        "L::building": { state: "ready", info: buildingTable },
        "L::bridge": {
          state: "ready",
          info: {
            ...FALLBACK_TABLE,
            table: "layer_10",
            fileBacked: true,
            familyKey: "bridge",
          },
        },
      },
    } as never);
    open({ table: buildingTable, isStreaming: true });

    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("exports a FAMILY's own file-backed table without complaint", async () => {
    const familyTable = {
      ...FALLBACK_TABLE,
      table: "layer_9",
      fileBacked: true,
      familyKey: "building",
    };
    useLayerTableStore.setState({
      tables: { "L::building": { state: "ready", info: familyTable } },
    } as never);
    open({ table: familyTable, isStreaming: true });

    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("waits while the table it was HANDED is rebuilding, by its own key", async () => {
    // The `rebuilding` flag has to be read from the entry that holds THIS
    // table: a family's view lives under `${layerId}::${family}`, so a lookup
    // by the bare layer id would watch a table this dialog is not exporting.
    const familyTable = {
      ...FALLBACK_TABLE,
      table: "layer_9",
      fileBacked: true,
      familyKey: "building",
    };
    useLayerTableStore.setState({
      tables: {
        "L::building": {
          state: "ready",
          info: familyTable,
          rebuilding: true,
        },
      },
    } as never);
    open({ table: familyTable, isStreaming: true });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refreshing table…" }),
      ).toBeTruthy(),
    );
  });

  it("exports normally when the refresh succeeded", async () => {
    open({ table: FALLBACK_TABLE, isStreaming: true });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("defaults the scope to the whole layer when nothing is applied", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(
      (screen.getByLabelText("Whole layer") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Current filter") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("defaults the scope to the filter when one is applied", async () => {
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [{ id: "c", column: "b3_h_dak_max", op: ">", value: 10 }],
    });
    useQueryStore.getState().applyFilter("L");
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(
      (screen.getByLabelText("Current filter") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("disables selected export with no active-layer selection", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(
      (screen.getByLabelText("Selected records") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("exports a selected child as its complete root feature, independent of the filter", async () => {
    useLayerStore.setState({
      layers: [
        {
          id: "L",
          name: "delft",
          isStreaming: false,
          model: {
            objects: {
              B1: { id: "B1", parents: [], children: ["P1"] },
              P1: { id: "P1", parents: ["B1"], children: [] },
            },
          },
        },
      ] as never,
    });
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: "L", objectId: "P1" });
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [{ id: "c", column: "b3_h_dak_max", op: ">", value: 99 }],
    });
    useQueryStore.getState().applyFilter("L");
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Selected records"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(runExport).toHaveBeenCalled());
    expect((runExport.mock.calls[0]![0] as { where: string }).where).toBe(
      'COALESCE("feature_id", "id") IN (\'B1\')',
    );
  });

  it("runs an attribute export with the chosen columns and downloads it", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("CSV"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    const request = runExport.mock.calls[0]![0] as {
      kind: string;
      format: string;
      table: string;
      columns: Array<{ name: string }>;
      where: string | null;
      fileName: string;
    };
    expect(request.kind).toBe("attributes");
    expect(request.format).toBe("csv");
    expect(request.table).toBe("layer_1");
    expect(request.columns.map((c) => c.name)).toEqual([
      "id",
      "feature_id",
      "object_type",
      "b3_h_dak_max",
    ]);
    expect(request.where).toBeNull();
    expect(request.fileName).toBe("delft.csv");
  });

  it("carries the type selection into an ATTRIBUTE export too", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("SolitaryVegetationObject"));
    fireEvent.click(screen.getByLabelText("CSV"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    const request = runExport.mock.calls[0]![0] as {
      rootTypes: string[];
      allRootTypes: string[];
    };
    expect(request.rootTypes).toEqual(["Building"]);
    // The full set travels beside it, so the exporter can tell "all of them"
    // (no predicate) from a strict subset.
    expect(request.allRootTypes).toEqual([
      "Building",
      "SolitaryVegetationObject",
    ]);
  });

  it("carries the compiled filter as the export scope", async () => {
    useQueryStore.getState().setFilter("L", {
      logic: "AND",
      conditions: [{ id: "c", column: "b3_h_dak_max", op: ">", value: 10 }],
    });
    useQueryStore.getState().applyFilter("L");
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    expect(
      (runExport.mock.calls[0]![0] as { where: string | null }).where,
    ).toBe('"b3_h_dak_max" > 10');
  });

  it("runs a CityParquet export with the LoD, the EPSG and the chosen root types", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("SolitaryVegetationObject"));
    fireEvent.click(screen.getByLabelText("CityParquet package (.zip)"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    const request = runExport.mock.calls[0]![0] as {
      kind: string;
      lodSuffix: string;
      epsg: number;
      rootTypes: string[];
      attributes: string[];
      reader: string;
      fileName: string;
    };
    expect(request.kind).toBe("cityparquet");
    // The SUFFIX travels, not the label.
    expect(request.lodSuffix).toBe("2_2");
    expect(request.epsg).toBe(7415);
    expect(request.rootTypes).toEqual(["Building"]);
    expect(request.attributes).toEqual(["b3_h_dak_max"]);
    expect(request.reader).toBe("read_cityjson");
    expect(request.fileName).toBe("delft.cityparquet.zip");
  });

  it("carries a DERIVED layer's own feature ids into the CityParquet request", async () => {
    // Decisions recorded item 4: a derived reader-backed layer's Export
    // INCLUDES CityParquet — which is only true if the request tells the
    // writer which of the parent's features the copy holds.
    open({ table: { ...READER_TABLE, sourceFeatureIds: ["a", "b"] } });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("CityParquet package (.zip)"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    const request = runExport.mock.calls[0]![0] as {
      kind: string;
      sourceFeatureIds: ReadonlyArray<string> | null;
    };
    expect(request.kind).toBe("cityparquet");
    expect(request.sourceFeatureIds).toEqual(["a", "b"]);
  });

  it("sends null for an ordinary layer, so the export reads the whole source", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("CityParquet package (.zip)"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(runExport).toHaveBeenCalled());
    expect(
      (
        runExport.mock.calls[0]![0] as {
          sourceFeatureIds: ReadonlyArray<string> | null;
        }
      ).sourceFeatureIds,
    ).toBeNull();
  });

  it("refuses CityParquet without an EPSG code, with a sentence", async () => {
    open({ epsg: null });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.queryByLabelText("CityParquet package (.zip)")).toBeNull();
    expect(
      screen.getByText(
        "This layer has no EPSG code, so a CityParquet package cannot be written.",
      ),
    ).toBeTruthy();
  });

  it("cannot export with no object types selected", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Building"));
    fireEvent.click(screen.getByLabelText("SolitaryVegetationObject"));
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows the export's own error and stays open", async () => {
    runExport.mockRejectedValue(new Error("IO Error: could not write"));
    const { onClose } = open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "IO Error: could not write",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Export" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("falls back to an offered format when the table loses its reader", async () => {
    const { rerender } = render(
      <ExportDialog
        layerId="L"
        layerName="delft"
        table={READER_TABLE}
        epsg={7415}
        selectedLod="2.2"
        isStreaming={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("CityParquet package (.zip)"));

    // A streaming rebuild lands: the table comes back as a fallback.
    rerender(
      <ExportDialog
        layerId="L"
        layerName="delft"
        table={FALLBACK_TABLE}
        epsg={7415}
        selectedLod={null}
        isStreaming={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText("CityParquet package (.zip)")).toBeNull();
    // A radio is still checked, and it is one the layer can actually serve.
    expect((screen.getByLabelText("Parquet") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("re-seeds the attribute list when the table's columns change", async () => {
    const { rerender } = render(
      <ExportDialog
        layerId="L"
        layerName="delft"
        table={READER_TABLE}
        epsg={7415}
        selectedLod="2.2"
        isStreaming={false}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    expect(screen.getByLabelText("b3_h_dak_max")).toBeTruthy();

    rerender(
      <ExportDialog
        layerId="L"
        layerName="delft"
        table={{
          ...READER_TABLE,
          columns: [
            { name: "id", type: "VARCHAR", kind: "scalar" as const },
            { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
            { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
            { name: "bouwjaar", type: "BIGINT", kind: "castText" as const },
          ],
        }}
        epsg={7415}
        selectedLod="2.2"
        isStreaming={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText("b3_h_dak_max")).toBeNull();
    expect(
      (screen.getByLabelText("bouwjaar") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("shows the export's warnings after a successful download", async () => {
    runExport.mockResolvedValue({
      blob: new Blob(["x"]),
      fileName: "delft.cityparquet.zip",
      warnings: ["cityparquet_validate reported 3 findings."],
    });
    open();
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      await screen.findByText("cityparquet_validate reported 3 findings."),
    ).toBeTruthy();
  });
});
