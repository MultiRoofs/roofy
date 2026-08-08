/**
 * Routing tests for useLayerFileLoader: `.fcb` (URL or File) must go through
 * `openStreamingLayer` (viewport streaming), never through `loadFromUrl`/
 * `parseText` (the deleted whole-file `.fcb` path — loadCityModel.ts throws
 * a clear error if anything still reaches it for `.fcb`). Everything else
 * must be unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { gzipSync } from "node:zlib";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { classifyCityParquetUrl } from "../../../../src/features/cityparquet/sourceClassify";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { useLayerFileLoader } from "../../../../src/features/layers/useLayerFileLoader";
import { setStreamPlugin } from "../../../../src/features/streaming/streamPlugin";
import type { StreamPlugin } from "../../../../src/features/streaming/streamPlugin";
import type { FcbStreamLayerHandle } from "@cityjson/navara-flatcitybuf";
import type { FcbHeaderModel } from "@cityjson/navara-flatcitybuf";

/** The CityParquet READER is faked, its ROUTING is not: `sourceClassify` and
 *  `cityParquetLayerNameFromUrl` stay real (that is what decides which arm a
 *  URL takes and what the layer is called), while the two I/O entry points are
 *  replaced — parsing real parquet bytes is `navara-cityparquet`'s own test. */
const cityparquet = vi.hoisted(() => ({
  loadCityParquetFromUrl: vi.fn(),
  loadCityParquetFromFiles: vi.fn(),
}));

vi.mock(
  "../../../../src/features/cityparquet/loadCityParquet",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../src/features/cityparquet/loadCityParquet")
    >()),
    loadCityParquetFromUrl: cityparquet.loadCityParquetFromUrl,
    loadCityParquetFromFiles: cityparquet.loadCityParquetFromFiles,
  }),
);

const PARQUET_MODEL: CityModel = {
  sourceEncoding: "cityparquet",
  metadata: { referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992" },
  bbox: null,
  objects: {},
  vertexCount: 0,
};

const HEADER: FcbHeaderModel = {
  version: "1.0",
  featuresCount: 10,
  extent: [0, 0, 0, 100, 100, 10],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
  epsg: 28992,
};

/** The engine is faked at the plugin seam, not at `Worker`: `openStream` now
 *  owns the worker, admission, the CRS gate and the vertical datum, and the
 *  real `FlatCityBufPlugin` cannot be imported under Node at all (Global
 *  Constraints -> NODE_IMPORT_SAFE = false). */
let openStream: ReturnType<typeof vi.fn>;

function installPlugin(): void {
  openStream = vi.fn((opts: { id: string }) =>
    Promise.resolve({
      id: opts.id,
      grid: { originX: 0, originY: 0, rootCell: 100, maxLevel: 3 },
      header: HEADER,
      level: null,
      ladder: [],
      typesSeen: [],
      status: "idle",
      message: null,
      version: 0,
      onStatus: () => () => undefined,
      onLadder: () => () => undefined,
      onTypes: () => () => undefined,
      onCommit: () => () => undefined,
    } as unknown as FcbStreamLayerHandle),
  );
  setStreamPlugin({ openStream, remove: vi.fn() } as unknown as StreamPlugin);
}

beforeEach(() => {
  installPlugin();
  useLayerStore.getState().removeAllLayers();
  useStreamStore.setState({ streams: {} });
});

afterEach(() => {
  setStreamPlugin(null);
});

describe("useLayerFileLoader — .fcb routing", () => {
  it("addLayerFromUrl routes a .fcb URL through openStreamingLayer, producing an isStreaming layer", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/delft.fcb");
    });
    expect(openStream).toHaveBeenCalledTimes(1);
    expect(
      (openStream.mock.calls[0]![0] as { source: unknown }).source,
    ).toEqual({ url: "https://x/delft.fcb" });

    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("addLayerFromFile routes a .fcb File through openStreamingLayer as a Blob, not text()", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File(["fake fcb bytes"], "local.fcb");
    const textSpy = vi.spyOn(file, "text");

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });
    const source = (openStream.mock.calls[0]![0] as { source: { blob: Blob } })
      .source;
    expect(source.blob).toBe(file);
    expect(textSpy).not.toHaveBeenCalled();

    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.isStreaming).toBe(true);
    expect(layers[0]!.modelRef).toEqual({
      type: "file",
      fileName: "local.fcb",
    });
  });

  it("surfaces an admission refusal as the hook's error state, and adds no layer", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    openStream.mockRejectedValueOnce(new Error("refused: degrees"));

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/degrees.fcb");
    });

    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(result.current.error).toMatch(/refused: degrees/);
  });

  it("a non-.fcb URL is unaffected — still goes through the plain CityJSON path, never opening a stream", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    // A CityJSON URL will fail to fetch in this test environment (no
    // network mock), which is fine — the point is that the streaming plugin
    // is never asked for it.
    await act(async () => {
      await result.current.addLayerFromUrl("https://x/model.city.json");
    });
    expect(openStream).not.toHaveBeenCalled();
  });

  it("reports a clear error (and adds no layer) when a .fcb is opened before the 3D engine is up", async () => {
    setStreamPlugin(null);
    const { result } = renderHook(() => useLayerFileLoader());
    await act(async () => {
      await result.current.addLayerFromUrl("https://x/delft.fcb");
    });
    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(result.current.error).toMatch(/3D engine is not running yet/);
  });
});

// ---------------------------------------------------------------------------
// addLayerFromFile overrides — the "re-link a snapshot-restored unavailable
// layer" path (App.tsx) needs the saved rules/rulesEnabled/visible/lodMode
// to survive re-selecting the file, not silently revert to fresh-layer
// defaults.
// ---------------------------------------------------------------------------

const MINIMAL_CITYJSON = JSON.stringify({
  type: "CityJSON",
  version: "2.0",
  CityObjects: {},
  vertices: [],
});

describe("useLayerFileLoader — addLayerFromFile overrides", () => {
  it("applies rules/rulesEnabled/visible overrides for a plain (non-streaming) file", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File([MINIMAL_CITYJSON], "restored.city.json");
    const rule = {
      id: "r1",
      name: "r1",
      color: "#ff0000",
      conditions: [],
      logic: "AND" as const,
      enabled: true,
    };

    await act(async () => {
      await result.current.addLayerFromFile(file, {
        rules: [rule],
        rulesEnabled: false,
        visible: false,
      });
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.rules).toEqual([rule]);
    expect(layer.rulesEnabled).toBe(false);
    expect(layer.visible).toBe(false);
  });

  it("applies rules/rulesEnabled/visible overrides for a streaming (.fcb) file", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File(["fake fcb bytes"], "restored.fcb");

    await act(async () => {
      await result.current.addLayerFromFile(file, {
        rulesEnabled: false,
        visible: false,
      });
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.rulesEnabled).toBe(false);
    expect(layer.visible).toBe(false);
  });

  it("sets manual lodMode when overrides.lodMode is 'manual'", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File([MINIMAL_CITYJSON], "restored.city.json");

    await act(async () => {
      await result.current.addLayerFromFile(file, { lodMode: "manual" });
    });

    expect(useLayerStore.getState().layers[0]!.lodMode).toBe("manual");
  });

  it("does not apply a saved selectedLod that isn't among the re-linked file's availableLods", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File([MINIMAL_CITYJSON], "restored.city.json"); // no LoDs at all

    await act(async () => {
      await result.current.addLayerFromFile(file, { selectedLod: "2.2" });
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.availableLods).toEqual([]);
    expect(layer.selectedLod).toBeNull(); // NOT forced to "2.2"
  });

  it("gunzips a dropped .city.json.gz instead of parsing its compressed bytes", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    // The real gunzip runs — nothing here is stubbed, so feeding the parser
    // raw deflate output (what `file.text()` used to do) fails the test.
    const gz = new Uint8Array(gzipSync(Buffer.from(MINIMAL_CITYJSON)));
    const file = new File(
      [gz as unknown as BlobPart],
      "compressed.city.json.gz",
    );

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });

    expect(result.current.error).toBeNull();
    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.name).toBe("compressed.city.json.gz");
  });

  it("with no overrides, behaves exactly as before (fresh-layer defaults)", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File([MINIMAL_CITYJSON], "plain.city.json");

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.rules).toEqual([]);
    expect(layer.rulesEnabled).toBe(true);
    expect(layer.visible).toBe(true);
    expect(layer.lodMode).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// CityParquet routing. The arm is chosen by `isCityParquetUrl`, NOT by
// `detectEncoding`: a `gs://` bucket or a package directory has no extension
// to detect, and handing either to the CityJSON path would parse a listing —
// or parquet bytes — as JSON.
// ---------------------------------------------------------------------------

/** A picked file, with the relative path a folder picker would have set. */
function pickedFile(relativePath: string): File {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  const file = new File(["PAR1"], name);
  // Not assignable: `webkitRelativePath` is a read-only accessor on File.
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

describe("useLayerFileLoader — CityParquet routing", () => {
  beforeEach(() => {
    cityparquet.loadCityParquetFromUrl.mockReset();
    cityparquet.loadCityParquetFromFiles.mockReset();
    cityparquet.loadCityParquetFromUrl.mockResolvedValue(PARQUET_MODEL);
    cityparquet.loadCityParquetFromFiles.mockResolvedValue(PARQUET_MODEL);
  });

  it("addLayerFromFile routes a .parquet File through loadCityParquetFromFiles", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File(["PAR1"], "building.parquet");

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });

    expect(cityparquet.loadCityParquetFromFiles).toHaveBeenCalledWith([file]);
    expect(openStream).not.toHaveBeenCalled();
    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.model.sourceEncoding).toBe("cityparquet");
    expect(layer.modelRef).toEqual({
      type: "file",
      fileName: "building.parquet",
    });
    expect(result.current.error).toBeNull();
  });

  it("addLayerFromUrl routes a .parquet URL through loadCityParquetFromUrl, naming the layer after the table", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const url = "https://x/delft/building.parquet";

    await act(async () => {
      await result.current.addLayerFromUrl(url);
    });

    expect(cityparquet.loadCityParquetFromUrl).toHaveBeenCalledWith(url);
    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.model.sourceEncoding).toBe("cityparquet");
    expect(layer.name).toBe("building");
    expect(layer.modelRef).toEqual({ type: "url", url });
  });

  it("addLayerFromUrl routes an extension-less gs:// package directory too", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    await act(async () => {
      await result.current.addLayerFromUrl("gs://bucket/delft/");
    });

    expect(cityparquet.loadCityParquetFromUrl).toHaveBeenCalledWith(
      "gs://bucket/delft/",
    );
    expect(useLayerStore.getState().layers[0]!.name).toBe("delft");
  });

  it("addLayerFromFiles loads a picked folder as one layer, named after the folder", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const files = [
      pickedFile("delft/a/building.parquet"),
      pickedFile("delft/b/building.parquet"),
    ];

    await act(async () => {
      await result.current.addLayerFromFiles(files);
    });

    expect(cityparquet.loadCityParquetFromFiles).toHaveBeenCalledWith(files);
    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.name).toBe("delft");
    expect(layers[0]!.modelRef).toEqual({ type: "file", fileName: "delft" });
    expect(layers[0]!.model.sourceEncoding).toBe("cityparquet");
  });

  it("addLayerFromFiles applies overrides like the single-file path", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    await act(async () => {
      await result.current.addLayerFromFiles(
        [pickedFile("delft/building.parquet")],
        { rulesEnabled: false, visible: false },
      );
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.rulesEnabled).toBe(false);
    expect(layer.visible).toBe(false);
  });

  it("surfaces the unlistable-wildcard explanation, and adds no layer", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    // The real classifier is what refuses this shape; the mock only stands in
    // for the fetching that would follow if it did not.
    cityparquet.loadCityParquetFromUrl.mockImplementation((url: string) => {
      classifyCityParquetUrl(url);
      return Promise.resolve(PARQUET_MODEL);
    });

    await act(async () => {
      await result.current.addLayerFromUrl(
        "https://x/tiles/*/building.parquet",
      );
    });

    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(result.current.error).toMatch(/cannot be listed/);
  });

  /**
   * A `.parquet.gz` URL must enter THIS arm, so the failure the user reads is
   * the reader's. Routed by extension alone it would have gone to the CityJSON
   * loader and been reported as malformed JSON — a message about the wrong
   * format entirely, for a file whose only real problem is that CityParquet
   * defines no gzipped spelling.
   */
  it("routes a .parquet.gz URL here, and surfaces the reader's refusal", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    cityparquet.loadCityParquetFromUrl.mockRejectedValue(
      new Error(
        "This file could not be read as Parquet while reading its footer. It may be truncated or corrupt, or use a Parquet feature this reader does not support.",
      ),
    );

    await act(async () => {
      await result.current.addLayerFromUrl(
        "https://x/delft/building.parquet.gz",
      );
    });

    expect(cityparquet.loadCityParquetFromUrl).toHaveBeenCalledWith(
      "https://x/delft/building.parquet.gz",
    );
    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(result.current.error).toMatch(/could not be read as Parquet/);
  });

  it("leaves a .city.json URL on the CityJSON path", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/model.city.json");
    });

    expect(cityparquet.loadCityParquetFromUrl).not.toHaveBeenCalled();
  });
});
