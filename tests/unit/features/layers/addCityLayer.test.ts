import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const enqueued: Array<{ layerId: string; source: unknown }> = [];
/** Set to make the next enqueue REJECT — the "a DuckDB failure must not fail a
 *  layer add" case needs a rejection, not a resolved false. */
let enqueueRejects = false;
vi.mock("../../../../src/analytics/layerTables", () => ({
  enqueueLayerTable: vi.fn(async (layerId: string, source: unknown) => {
    enqueued.push({ layerId, source });
    if (enqueueRejects) throw new Error("DuckDB is not running");
  }),
}));

const { addCityLayer, modelTableSource } =
  await import("../../../../src/features/layers/addCityLayer");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {},
  } as unknown as CityModel;
}

beforeEach(() => {
  enqueued.length = 0;
  enqueueRejects = false;
  useLayerStore.setState({ layers: [], activeLayerId: null });
});

describe("modelTableSource", () => {
  const refetch = async () => new Uint8Array(1);

  it("is reader-backed for CityJSON bytes", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: new Uint8Array(4),
        encoding: "cityjson",
        refetch,
      }),
    ).toMatchObject({
      kind: "bytes",
      reader: "read_cityjson",
      extension: "city.json",
    });
  });

  it("is reader-backed for CityJSONSeq bytes, with the seq reader", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: new Uint8Array(4),
        encoding: "cityjsonseq",
        refetch,
      }),
    ).toMatchObject({
      kind: "bytes",
      reader: "read_cityjsonseq",
      extension: "city.jsonl",
    });
  });

  it("falls back to the model for CityGML, which has no reader", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: null,
        encoding: "citygml",
        refetch,
      }),
    ).toMatchObject({ kind: "model" });
  });

  it("falls back to the model whenever there are no bytes", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: null,
        encoding: "cityjson",
        refetch,
      }),
    ).toMatchObject({ kind: "model" });
  });

  it("still builds a reader-backed table with NO provider — the table works, the package export will not", () => {
    expect(
      modelTableSource({
        model: model(),
        bytes: new Uint8Array(4),
        encoding: "cityjson",
        refetch: null,
      }),
    ).toMatchObject({ kind: "bytes", provider: null });
  });
});

describe("addCityLayer", () => {
  it("adds the layer and enqueues its table under the SAME id", () => {
    const id = addCityLayer({
      name: "delft",
      model: model(),
      modelRef: { type: "url", url: "https://x/a.city.json" },
      duckdb: { kind: "model", model: model() },
    });
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual([id]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.layerId).toBe(id);
  });

  it("passes the layer settings straight through", () => {
    const id = addCityLayer({
      name: "delft",
      model: model(),
      modelRef: { type: "file", fileName: "delft.city.json" },
      visible: false,
      rulesEnabled: false,
      hiddenTypes: ["Building"],
      duckdb: { kind: "model", model: model() },
    });
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    expect(layer.visible).toBe(false);
    expect(layer.rulesEnabled).toBe(false);
    expect(layer.hiddenTypes).toEqual(["Building"]);
  });

  it("does not let a REJECTED table build reach the caller, or the layer", async () => {
    enqueueRejects = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const id = addCityLayer({
      name: "delft",
      model: model(),
      modelRef: { type: "url", url: "https://x/a.city.json" },
      duckdb: { kind: "model", model: model() },
    });

    // The layer landed regardless: an analytics engine that cannot start must
    // not cost the user their model.
    expect(id).toBeTypeOf("string");
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual([id]);
    expect(enqueued).toHaveLength(1);

    // And the rejection is SWALLOWED, not left floating: `addCityLayer`
    // catches it rather than firing `void` at a promise that will reject.
    await Promise.resolve();
    await Promise.resolve();
    expect(unhandled).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
    warn.mockRestore();
  });
});
