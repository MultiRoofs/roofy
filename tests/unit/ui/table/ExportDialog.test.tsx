import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const runQuery = vi.fn();
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
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
vi.mock("../../../../src/analytics/export", () => ({
  runExport: (request: unknown) => runExport(request),
}));

const downloadBlob = vi.fn();
vi.mock("../../../../src/platform/download", () => ({
  downloadBlob: (blob: Blob, name: string) => downloadBlob(blob, name),
  downloadText: vi.fn(),
}));

// TYPED parameter: an argument-less `vi.fn` is not callable with the layer id,
// and the assertion below reads the id it was called with.
const refreshStreamingTable = vi.fn(async (_layerId: string) => {});
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
  await import("../../../../src/analytics/layerTables");

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
  rowCount: 10,
};

const FALLBACK_TABLE = {
  ...READER_TABLE,
  sourceName: null,
  source: null,
  reader: null,
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
  useQueryStore.setState({ queries: {} });
  useLayerTableStore.setState({ tables: {}, tablePanelOpen: false });
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

  it("disables Export for a reader-backed layer whose bytes cannot be re-obtained", async () => {
    open({ table: { ...READER_TABLE, source: null } });
    await waitFor(() => expect(screen.getByLabelText("Building")).toBeTruthy());
    const button = screen.getByRole("button", {
      name: "Export",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Re-link the file to export this layer");
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
