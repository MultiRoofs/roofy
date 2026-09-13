import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

const enqueued: Array<{ layerId: string; source: unknown }> = [];
/** Set to make the next enqueue REJECT — the "a DuckDB failure must not fail a
 *  layer add" case needs a rejection, not a resolved false. */
let enqueueRejects = false;
/** Set to make the next enqueue throw SYNCHRONOUSLY, the way a failure in
 *  `enqueueLayerTable`'s prelude — before it ever returns a promise — would.
 *  Deliberately not an `async` function body, which could not do that. */
let enqueueThrowsSync = false;
vi.mock("../../../../src/insights/layerTables", () => ({
  // Present for the same reason `enqueueLayerTable` is: the graph under test
  // imports the module, and a derived layer's publication (Task 21) reaches it
  // through these two names.
  nextTableName: vi.fn(() => "layer_99"),
  adoptLayerTable: vi.fn(),
  enqueueLayerTable: vi.fn((layerId: string, source: unknown) => {
    enqueued.push({ layerId, source });
    if (enqueueThrowsSync) throw new Error("DuckDB module failed to load");
    return enqueueRejects
      ? Promise.reject(new Error("DuckDB is not running"))
      : Promise.resolve();
  }),
}));

const {
  addCityLayer,
  fileSourceProvider,
  modelTableSource,
  urlSourceProvider,
} = await import("../../../../src/features/layers/addCityLayer");
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
  enqueueThrowsSync = false;
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const MINIMAL_CITYJSON = JSON.stringify({
  type: "CityJSON",
  version: "2.0",
  CityObjects: {},
  vertices: [],
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
      colorBy: "surface",
      hiddenTypes: ["Building"],
      duckdb: { kind: "model", model: model() },
    });
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    expect(layer.visible).toBe(false);
    expect(layer.colorBy).toBe("surface");
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

  it("does not let a SYNCHRONOUS throw from the enqueue reach the caller either", () => {
    // `enqueueLayerTable` runs a prelude — the sequence counter, the registry
    // lookup, the first `setState` — before it returns a promise, and a throw
    // from THERE never reaches a `.catch`. It would propagate out of a call
    // whose layer has already landed in the store, leaving the caller to
    // report a failed add the user can plainly see succeeded.
    enqueueThrowsSync = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const id = addCityLayer({
      name: "delft",
      model: model(),
      modelRef: { type: "url", url: "https://x/a.city.json" },
      duckdb: { kind: "model", model: model() },
    });

    expect(id).toBeTypeOf("string");
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual([id]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("fileSourceProvider", () => {
  it("re-reads the File on EVERY call — a fresh array each time", async () => {
    // `registerBuffer` transfers and DETACHES the array it is given, so a
    // provider that handed back one cached array would serve a zero-length
    // buffer to the second export of a layer.
    const provider = fileSourceProvider(
      new File([MINIMAL_CITYJSON], "a.city.json"),
    );

    const first = await provider();
    const second = await provider();

    expect(first).not.toBe(second);
    expect(new TextDecoder().decode(first)).toBe(MINIMAL_CITYJSON);
    expect(new TextDecoder().decode(second)).toBe(MINIMAL_CITYJSON);
  });

  it("gunzips a gzipped File by its MAGIC BYTES — no DuckDB reader gunzips", async () => {
    // The real gunzip runs; nothing here is stubbed.
    const gz = new Uint8Array(gzipSync(Buffer.from(MINIMAL_CITYJSON)));
    // The NAME says nothing useful on purpose: the bytes decide.
    const provider = fileSourceProvider(
      new File([gz as unknown as BlobPart], "a.city.json"),
    );

    expect(new TextDecoder().decode(await provider())).toBe(MINIMAL_CITYJSON);
  });
});

describe("urlSourceProvider", () => {
  it("REFETCHES on every call, and returns the DECODED bytes", async () => {
    // Through the real `fetchModelBytes` — only `fetch` is stubbed — so the
    // gunzip that makes these the same bytes the table was built from is
    // genuinely exercised rather than asserted about a mock.
    const gz = new Uint8Array(gzipSync(Buffer.from(MINIMAL_CITYJSON)));
    const fetchMock = vi.fn(
      async () => new Response(gz as unknown as BodyInit, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = urlSourceProvider("https://x/a.city.json");
    const first = await provider();
    const second = await provider();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("https://x/a.city.json");
    expect(new TextDecoder().decode(first)).toBe(MINIMAL_CITYJSON);
    expect(first).not.toBe(second);
  });

  it("propagates the loader's own sentence for a URL that has gone away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 404, statusText: "Not Found" }),
      ),
    );

    await expect(urlSourceProvider("https://x/a.city.json")()).rejects.toThrow(
      /File not found \(404\)/,
    );
  });
});
