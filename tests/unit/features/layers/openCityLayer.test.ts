/**
 * The one door: every source description reaches the opener its FORMAT
 * needs, with a model reference that says which format that was.
 *
 * The openers themselves are faked (each has its own suite); what is under
 * test is the routing — the bytes over a lying name, the user's word over the
 * bytes, a URL that turns out to stream — and the settings applied after.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ opener: string; input: Record<string, unknown> }> = [];

vi.mock("../../../../src/features/streaming/openStreamingLayer", () => ({
  openStreamingLayer: vi.fn(async (input: Record<string, unknown>) => {
    calls.push({ opener: "stream", input });
    return "stream-id";
  }),
}));

vi.mock("../../../../src/features/cityparquet/addCityParquetLayer", () => ({
  addCityParquetLayerFromUrl: vi.fn(
    async (url: string, settings: Record<string, unknown>) => {
      calls.push({ opener: "parquet-url", input: { url, settings } });
      return "parquet-id";
    },
  ),
  addCityParquetLayerFromFiles: vi.fn(
    async (
      files: ReadonlyArray<File>,
      fileName: string,
      settings: Record<string, unknown>,
    ) => {
      calls.push({
        opener: "parquet-files",
        input: { files, fileName, settings },
      });
      return "parquet-id";
    },
  ),
}));

vi.mock("../../../../src/features/layers/addCityLayer", async (original) => ({
  ...(await original<
    typeof import("../../../../src/features/layers/addCityLayer")
  >()),
  addCityLayer: vi.fn((input: Record<string, unknown>) => {
    calls.push({ opener: "static", input });
    return "static-id";
  }),
}));

vi.mock("../../../../src/features/layers/ensureCrs", () => ({
  ensureModelCrsLoadable: vi.fn(async () => {}),
}));

const { openCityLayer } =
  await import("../../../../src/features/layers/openCityLayer");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");

const ROOT = resolve(__dirname, "../../../..");
const bytesOf = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(ROOT, path)));
const FCB = bytesOf("fixtures/delft.fcb");
const CITYJSON = bytesOf("fixtures/two-buildings.city.json");
const CITYJSONSEQ = bytesOf("fixtures/two-buildings.city.jsonl");

const fileOf = (bytes: Uint8Array, name: string): File =>
  new File([bytes as BlobPart], name);

const held: string[] = [];
const deps = {
  resolveStreamPlugin: vi.fn(async () => ({}) as never),
  holdEngine: async <T>(open: () => Promise<T>): Promise<T> => {
    held.push("held");
    return open();
  },
};

function serve(bytes: Uint8Array): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes as BodyInit, { status: 200 })),
  );
}

beforeEach(() => {
  calls.length = 0;
  held.length = 0;
  vi.unstubAllGlobals();
});

describe("openCityLayer — files", () => {
  it("streams a FlatCityBuf saved as .json, under the engine hold, as a Blob", async () => {
    const file = fileOf(FCB, "download.json");
    const id = await openCityLayer({ source: { kind: "file", file } }, deps);
    expect(id).toBe("stream-id");
    expect(held).toEqual(["held"]);
    const [call] = calls;
    expect(call!.opener).toBe("stream");
    expect(call!.input.source).toEqual({ blob: file });
    expect(call!.input.modelRef).toEqual({
      type: "file",
      fileName: "download.json",
      encoding: "flatcitybuf",
    });
  });

  it("parses a sequence saved as .city.json as a sequence, with its reader table", async () => {
    await openCityLayer(
      { source: { kind: "file", file: fileOf(CITYJSONSEQ, "t.city.json") } },
      deps,
    );
    const [call] = calls;
    expect(call!.opener).toBe("static");
    expect(call!.input.modelRef).toEqual({
      type: "file",
      fileName: "t.city.json",
      encoding: "cityjsonseq",
    });
    expect(call!.input.duckdb).toMatchObject({
      kind: "bytes",
      reader: "read_cityjsonseq",
    });
  });

  it("takes the user's word over the bytes", async () => {
    await expect(
      openCityLayer(
        {
          source: { kind: "file", file: fileOf(FCB, "x.fcb") },
          encoding: "cityjson",
        },
        deps,
      ),
    ).rejects.toThrow(/Invalid JSON/);
    expect(calls).toEqual([]);
  });

  it("opens a picked folder as one CityParquet package named after the folder", async () => {
    const files = [fileOf(new Uint8Array([1]), "building.parquet")];
    await openCityLayer(
      { source: { kind: "files", files, name: "delft" } },
      deps,
    );
    const [call] = calls;
    expect(call!.opener).toBe("parquet-files");
    expect(call!.input.fileName).toBe("delft");
    expect(call!.input.settings).toMatchObject({ name: "delft" });
  });
});

describe("openCityLayer — URLs", () => {
  it("streams a .fcb URL, held behind the engine", async () => {
    await openCityLayer(
      { source: { kind: "url", url: "https://x/delft.fcb" } },
      deps,
    );
    expect(held).toEqual(["held"]);
    expect(calls[0]!.input.source).toEqual({ url: "https://x/delft.fcb" });
    expect(calls[0]!.input.name).toBe("delft.fcb");
  });

  it("hands a package directory to the CityParquet opener, named after the package", async () => {
    await openCityLayer(
      { source: { kind: "url", url: "gs://city3d/yokohama-shi/" } },
      deps,
    );
    expect(calls[0]!.opener).toBe("parquet-url");
    expect(calls[0]!.input.settings).toMatchObject({ name: "yokohama-shi" });
  });

  it("re-routes a .json URL whose bytes are FlatCityBuf to the stream", async () => {
    serve(FCB);
    const id = await openCityLayer(
      { source: { kind: "url", url: "https://x/tile.json" } },
      deps,
    );
    expect(id).toBe("stream-id");
    expect(calls.map((c) => c.opener)).toEqual(["stream"]);
    expect(calls[0]!.input.modelRef).toEqual({
      type: "url",
      url: "https://x/tile.json",
      encoding: "flatcitybuf",
    });
  });

  it("records the format the bytes were read as", async () => {
    serve(CITYJSONSEQ);
    await openCityLayer(
      { source: { kind: "url", url: "https://x/tile.json" } },
      deps,
    );
    expect(calls[0]!.input.modelRef).toEqual({
      type: "url",
      url: "https://x/tile.json",
      encoding: "cityjsonseq",
    });
  });

  it("reads the first bytes of a URL whose name says nothing, before any whole download", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range");
      return range === null
        ? new Response(FCB as BodyInit, { status: 200 })
        : new Response(FCB.subarray(0, 64) as BodyInit, { status: 206 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    await openCityLayer(
      { source: { kind: "url", url: "https://x/api/asset/42" } },
      deps,
    );
    expect(calls.map((c) => c.opener)).toEqual(["stream"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchSpy.mock.calls[0]![1]?.headers).get("Range")).toBe(
      "bytes=0-65535",
    );
  });

  it("falls back to a whole read when the server ignores the range", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (new Headers(init?.headers).get("Range") === null) {
          return new Response(CITYJSON as BodyInit, { status: 200 });
        }
        const body = new ReadableStream({ cancel });
        return new Response(body, { status: 200 });
      }),
    );
    await openCityLayer(
      { source: { kind: "url", url: "https://x/api/asset/7" } },
      deps,
    );
    expect(cancel).toHaveBeenCalled();
    expect(calls[0]!.opener).toBe("static");
  });

  it("opens a saved format as saved, without guessing from the name", async () => {
    await openCityLayer(
      {
        source: { kind: "url", url: "https://x/download" },
        encoding: "flatcitybuf",
      },
      deps,
    );
    expect(calls[0]!.opener).toBe("stream");
  });
});

describe("openCityLayer — settings", () => {
  it("applies a saved LoD choice and manual mode once the layer exists", async () => {
    serve(CITYJSON);
    const setLayerLods = vi.spyOn(useLayerStore.getState(), "setLayerLods");
    const setLodMode = vi.spyOn(useLayerStore.getState(), "setLodMode");
    await openCityLayer(
      {
        source: { kind: "url", url: "https://x/a.city.json" },
        settings: { selectedLods: ["2.2"], lodMode: "manual", visible: false },
      },
      deps,
    );
    expect(calls[0]!.input.visible).toBe(false);
    expect(setLayerLods).toHaveBeenCalledWith("static-id", ["2.2"]);
    expect(setLodMode).toHaveBeenCalledWith("static-id", "manual");
  });
});
