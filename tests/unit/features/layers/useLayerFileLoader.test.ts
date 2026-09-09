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
import { zipSync, strToU8 } from "fflate";
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

/**
 * The TABLE REGISTRY is faked; the call INTO it is not.
 *
 * Every static add now goes through `addCityLayer`, so without this the real
 * `enqueueLayerTable` runs on every file drop in this file: it awaits
 * `initDuckDB`, which imports `@duckdb/duckdb-wasm`, runs `selectBundle` and
 * reaches `new Worker` under jsdom. The failure is caught and recorded, so
 * nothing goes red — but the boot attempt outlives the test that started it
 * and the engine's module state accumulates across this whole file. What these
 * tests are ABOUT is routing, so the registry is the right seam to cut.
 *
 * `enqueueLayerTable` is the only value `addCityLayer` imports from the module
 * (`LayerTableSource`/`SourceProvider` are types and erase), so a bare factory
 * is enough — no `importOriginal` spread.
 */
const tables = vi.hoisted(() => ({
  // Typed rather than bare, so `mock.calls[0]` is a two-element tuple a test
  // can destructure instead of the empty one a zero-parameter fake implies.
  enqueueLayerTable: vi.fn<(layerId: string, source: unknown) => Promise<void>>(
    async () => {},
  ),
}));

vi.mock("../../../../src/insights/layerTables", () => ({
  enqueueLayerTable: tables.enqueueLayerTable,
}));

/**
 * `loadFromUrl` PASSED THROUGH, with its arguments recorded.
 *
 * The URL city path hands the resolved encoding to the parser as a third
 * argument, and nothing else in this file can see that it did — the fetch
 * fails under Node either way, so a dropped override would look exactly like
 * an honoured one. The real function still runs, so every other test in this
 * file behaves as it did.
 */
const loadCityModel = vi.hoisted(() => ({
  loadFromUrlArgs: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock(
  "../../../../src/domain/citymodel/loadCityModel",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../src/domain/citymodel/loadCityModel")
      >();
    return {
      ...actual,
      loadFromUrl: (...args: Parameters<typeof actual.loadFromUrl>) => {
        loadCityModel.loadFromUrlArgs(...args);
        return actual.loadFromUrl(...args);
      },
    };
  },
);

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

/** The handle `openStream` resolves with. Named so a test that has to control
 *  WHEN the open resolves (the pending-row tests) can hand back the same shape
 *  the default fake would have. */
function fakeHandle(id: string): FcbStreamLayerHandle {
  return {
    id,
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
    onAppearanceThemes: () => () => {},
    appearanceThemes: [],
    onCommit: () => () => undefined,
  } as unknown as FcbStreamLayerHandle;
}

function installPlugin(): void {
  openStream = vi.fn((opts: { id: string }) =>
    Promise.resolve(fakeHandle(opts.id)),
  );
  setStreamPlugin({ openStream, remove: vi.fn() } as unknown as StreamPlugin);
}

beforeEach(() => {
  installPlugin();
  tables.enqueueLayerTable.mockClear();
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
      await result.current.addLayerFromUrl("https://x/delft.fcb", {
        attributeOrders: { Building: ["height", "name"] },
      });
    });
    expect(openStream).toHaveBeenCalledTimes(1);
    expect(
      (openStream.mock.calls[0]![0] as { source: unknown }).source,
    ).toEqual({ url: "https://x/delft.fcb" });

    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.isStreaming).toBe(true);
    expect(layers[0]!.attributeOrders).toEqual({
      Building: ["height", "name"],
    });
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
        colorBy: "surface",
        visible: false,
      });
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.rules).toEqual([rule]);
    expect(layer.colorBy).toBe("surface");
    expect(layer.visible).toBe(false);
  });

  it("applies rules/rulesEnabled/visible overrides for a streaming (.fcb) file", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File(["fake fcb bytes"], "restored.fcb");

    await act(async () => {
      await result.current.addLayerFromFile(file, {
        colorBy: "surface",
        visible: false,
      });
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.colorBy).toBe("surface");
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

  it("enqueues the dropped file's table under that layer's id, from its bytes", async () => {
    // The other half of `addCityLayer`: a layer that reached the store without
    // its table would have no table panel, no filter and no export, and
    // nothing else in this file would notice.
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File([MINIMAL_CITYJSON], "tabled.city.json");

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });

    const layerId = useLayerStore.getState().layers[0]!.id;
    expect(tables.enqueueLayerTable).toHaveBeenCalledTimes(1);
    const [enqueuedId, enqueuedSource] =
      tables.enqueueLayerTable.mock.calls[0]!;
    const source = enqueuedSource as {
      kind: string;
      reader?: string;
      extension?: string;
      bytes?: Uint8Array;
    };
    expect(enqueuedId).toBe(layerId);
    // Reader-backed, not the flat fallback: the loader HELD the bytes, so
    // DuckDB reads the file itself rather than a flattened copy of the model.
    expect(source.kind).toBe("bytes");
    expect(source.reader).toBe("read_cityjson");
    expect(source.extension).toBe("city.json");
    expect(new TextDecoder().decode(source.bytes)).toBe(MINIMAL_CITYJSON);
  });

  it("with no overrides, behaves exactly as before (fresh-layer defaults)", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File([MINIMAL_CITYJSON], "plain.city.json");

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.rules).toEqual([]);
    // A fresh layer has no rules, so it colours by surface type.
    expect(layer.colorBy).toBe("surface");
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
        { colorBy: "surface", visible: false },
      );
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.colorBy).toBe("surface");
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

describe("useLayerFileLoader — CityGML ZIP routing", () => {
  /** A real archive holding one minimal CityGML document. */
  function zipBytes(): Uint8Array {
    return zipSync({
      "city.gml": strToU8(
        `<?xml version="1.0"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
  xmlns:gml="http://www.opengis.net/gml">
  <gml:boundedBy><gml:Envelope srsName="EPSG:28992">
    <gml:lowerCorner>0 0 0</gml:lowerCorner>
    <gml:upperCorner>10 10 5</gml:upperCorner>
  </gml:Envelope></gml:boundedBy>
  <core:cityObjectMember><bldg:Building gml:id="zipped-b1">
    <bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
      <gml:exterior><gml:LinearRing>
        <gml:posList>0 0 5 10 0 5 10 10 5 0 10 5 0 0 5</gml:posList>
      </gml:LinearRing></gml:exterior>
    </gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface>
  </bldg:Building></core:cityObjectMember>
</core:CityModel>`,
      ),
    });
  }

  it("addLayerFromFile unzips a dropped .zip into a CityGML layer", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File([zipBytes() as BlobPart], "lod2.zip");

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });

    expect(result.current.error).toBeNull();
    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.model.sourceEncoding).toBe("citygml");
    expect(Object.keys(layer.model.objects)).toEqual(["zipped-b1"]);
    expect(layer.modelRef).toEqual({ type: "file", fileName: "lod2.zip" });
    // Never the streaming or CityParquet arm.
    expect(openStream).not.toHaveBeenCalled();
    expect(cityparquet.loadCityParquetFromFiles).not.toHaveBeenCalled();
  });

  it("a .zip URL is not claimed by the CityParquet arm", () => {
    // Pins the routing that lets `loadFromUrl`'s magic-byte sniff see the
    // bytes at all — `classifyCityParquetUrl` must not answer for a `.zip`.
    expect(classifyCityParquetUrl("https://example.test/lod2.zip")).toBeNull();
  });

  it("addLayerFromFile reports the archive's own sentence when it holds no GML", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File(
      [zipSync({ "readme.txt": strToU8("nothing") }) as BlobPart],
      "empty.zip",
    );

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });

    expect(result.current.error).toContain(
      "The archive contains no CityGML (.gml) file.",
    );
    expect(useLayerStore.getState().layers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// In-flight and failed adds — the layer list's own rows (Task 17).
//
// A failed add used to leave nothing on screen but a transient banner: the
// row the user was expecting simply never appeared. `pending` and `failed`
// give the list something to render for both halves of an add's life, so a
// failure always leaves a visible row with a Retry on it.
// ---------------------------------------------------------------------------

describe("useLayerFileLoader — pending and failed adds", () => {
  it("lists an in-flight add in `pending`, and drops it when the add settles", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    let release!: (handle: FcbStreamLayerHandle) => void;
    openStream.mockReturnValueOnce(
      new Promise<FcbStreamLayerHandle>((resolve) => {
        release = resolve;
      }),
    );

    let add!: Promise<string | null>;
    act(() => {
      add = result.current.addLayerFromUrl("https://x/delft.fcb");
    });

    expect(result.current.pending.map((p) => p.name)).toEqual(["delft.fcb"]);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      release(fakeHandle("l1"));
      await add;
    });

    expect(result.current.pending).toHaveLength(0);
    expect(result.current.failed).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it("leaves a failed add in `failed`, carrying the reason, with nothing left pending", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    openStream.mockRejectedValueOnce(new Error("refused: degrees"));

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/degrees.fcb");
    });

    expect(result.current.pending).toHaveLength(0);
    expect(result.current.failed).toHaveLength(1);
    expect(result.current.failed[0]!.name).toBe("degrees.fcb");
    expect(result.current.failed[0]!.message).toMatch(/refused: degrees/);
    // The old surface is untouched: App and the landing page read these.
    expect(result.current.error).toMatch(/refused: degrees/);
    expect(result.current.loading).toBe(false);
  });

  it("`retry()` re-runs the same add, and a second success clears the failed row", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    openStream.mockRejectedValueOnce(new Error("network down"));

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/delft.fcb");
    });
    expect(result.current.failed).toHaveLength(1);

    await act(async () => {
      result.current.failed[0]!.retry();
    });

    // The SAME source, asked for again.
    expect(
      (openStream.mock.calls.at(-1)![0] as { source: unknown }).source,
    ).toEqual({ url: "https://x/delft.fcb" });
    expect(result.current.failed).toHaveLength(0);
    expect(useLayerStore.getState().layers).toHaveLength(1);
  });

  it("`retry()` on a failed FILE add re-reads the same file", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    openStream.mockRejectedValueOnce(new Error("network down"));
    const file = new File(["fake fcb bytes"], "local.fcb");

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });
    expect(result.current.failed).toHaveLength(1);

    await act(async () => {
      result.current.failed[0]!.retry();
    });

    const source = (
      openStream.mock.calls.at(-1)![0] as { source: { blob: Blob } }
    ).source;
    expect(source.blob).toBe(file);
    expect(result.current.failed).toHaveLength(0);
  });

  it("`dismissFailed(id)` drops just that row", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    openStream.mockRejectedValueOnce(new Error("one"));
    openStream.mockRejectedValueOnce(new Error("two"));

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/one.fcb");
      await result.current.addLayerFromUrl("https://x/two.fcb");
    });
    expect(result.current.failed).toHaveLength(2);

    const first = result.current.failed[0]!.id;
    act(() => {
      result.current.dismissFailed(first);
    });

    expect(result.current.failed.map((f) => f.name)).toEqual(["two.fcb"]);
  });
});

describe("useLayerFileLoader — several adds at once, and retrying", () => {
  it("stays loading until BOTH concurrent adds settle, one pending row each", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    let releaseFirst!: (handle: FcbStreamLayerHandle) => void;
    let releaseSecond!: (handle: FcbStreamLayerHandle) => void;
    openStream.mockReturnValueOnce(
      new Promise<FcbStreamLayerHandle>((resolve) => {
        releaseFirst = resolve;
      }),
    );
    openStream.mockReturnValueOnce(
      new Promise<FcbStreamLayerHandle>((resolve) => {
        releaseSecond = resolve;
      }),
    );

    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => {
      first = result.current.addLayerFromUrl("https://x/one.fcb");
      second = result.current.addLayerFromUrl("https://x/two.fcb");
    });

    expect(result.current.pending.map((p) => p.name)).toEqual([
      "one.fcb",
      "two.fcb",
    ]);
    // Distinct ids: they are React keys, and two rows sharing one would
    // collapse into a single loading row.
    expect(new Set(result.current.pending.map((p) => p.id)).size).toBe(2);

    await act(async () => {
      releaseFirst(fakeHandle("l1"));
      await first;
    });
    // The FIRST to settle must not clear the spinner the second is still
    // using — the race the old boolean `loading` lost.
    expect(result.current.loading).toBe(true);
    expect(result.current.pending.map((p) => p.name)).toEqual(["two.fcb"]);

    await act(async () => {
      releaseSecond(fakeHandle("l2"));
      await second;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.pending).toHaveLength(0);
  });

  it("a retry that fails again REPLACES its row rather than adding a second", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    openStream.mockRejectedValueOnce(new Error("first attempt"));

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/delft.fcb");
    });
    expect(result.current.failed).toHaveLength(1);

    openStream.mockRejectedValueOnce(new Error("second attempt"));
    await act(async () => {
      result.current.failed[0]!.retry();
    });

    expect(result.current.failed).toHaveLength(1);
    expect(result.current.failed[0]!.message).toMatch(/second attempt/);
  });

  it("a retry keeps the overrides the original add was given", async () => {
    // The re-link path: a snapshot-restored layer carries its saved rules,
    // visibility and LoD into the add. A retry that dropped them would
    // silently revert the layer to fresh-layer defaults — the exact failure
    // `applyPostCreateOverrides` exists to prevent.
    const { result } = renderHook(() => useLayerFileLoader());
    openStream.mockRejectedValueOnce(new Error("network down"));
    const file = new File(["fake fcb bytes"], "restored.fcb");

    await act(async () => {
      await result.current.addLayerFromFile(file, {
        colorBy: "surface",
        visible: false,
      });
    });
    expect(useLayerStore.getState().layers).toHaveLength(0);

    await act(async () => {
      result.current.failed[0]!.retry();
    });

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.colorBy).toBe("surface");
    expect(layer.visible).toBe(false);
  });

  it("never shows a bald 'Error · ' for a rejection carrying no message", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    openStream.mockRejectedValueOnce(new Error(""));

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/delft.fcb");
    });

    expect(result.current.failed[0]!.message).toBe(
      "Failed to load remote file.",
    );
    expect(result.current.error).toBe("Failed to load remote file.");
  });
});

// ---------------------------------------------------------------------------
// The ENCODING override — the Add Layer dialog's correction control.
//
// Detection from a name is a guess (a server that serves FlatCityBuf from
// `/model.json` is not exotic), so the dialog shows what it guessed and lets
// the user correct it. That correction is worth nothing unless it reaches the
// ROUTING: which arm of the loader takes the source, and which parser reads
// the bytes. These are the end-to-end checks that it does.
// ---------------------------------------------------------------------------

describe("useLayerFileLoader — the encoding override", () => {
  it("takes the STREAMING route for a `.json` URL overridden to FlatCityBuf", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/model.json", {
        encoding: "flatcitybuf",
      });
    });

    expect(openStream).toHaveBeenCalledTimes(1);
    expect(
      (openStream.mock.calls[0]![0] as { source: unknown }).source,
    ).toEqual({ url: "https://x/model.json" });
    expect(useLayerStore.getState().layers[0]!.isStreaming).toBe(true);
  });

  it("takes the STREAMING route for a `.json` FILE overridden to FlatCityBuf, as a Blob", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File(["fake fcb bytes"], "model.json");
    const textSpy = vi.spyOn(file, "text");

    await act(async () => {
      await result.current.addLayerFromFile(file, { encoding: "flatcitybuf" });
    });

    const source = (openStream.mock.calls[0]![0] as { source: { blob: Blob } })
      .source;
    expect(source.blob).toBe(file);
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("keeps a `.fcb` FILE off the streaming route when the override says CityJSON — and really parses it", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    // CityJSON bytes under a `.fcb` name: the override is the only thing that
    // can route this, and the layer that lands is the proof it was honoured —
    // "openStream was not called" alone would also be true of a crash.
    const file = new File([MINIMAL_CITYJSON], "model.fcb");

    await act(async () => {
      await result.current.addLayerFromFile(file, { encoding: "cityjson" });
    });

    expect(openStream).not.toHaveBeenCalled();
    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.isStreaming).toBe(false);
    expect(layers[0]!.model.sourceEncoding).toBe("cityjson");
  });

  it("hands the override to `loadFromUrl` for a remote city model", async () => {
    loadCityModel.loadFromUrlArgs.mockClear();
    const { result } = renderHook(() => useLayerFileLoader());

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/model.json", {
        encoding: "cityjsonseq",
      });
    });

    // The fetch fails here (no network), which is beside the point: what is
    // pinned is that the corrected encoding reached the reader rather than
    // being re-derived from the URL's `.json`.
    expect(loadCityModel.loadFromUrlArgs.mock.calls[0]).toEqual([
      "https://x/model.json",
      undefined,
      "cityjsonseq",
    ]);
  });

  it("routes an extensionless URL into the CityParquet arm when the override says so", async () => {
    cityparquet.loadCityParquetFromUrl.mockResolvedValue(PARQUET_MODEL);
    const { result } = renderHook(() => useLayerFileLoader());

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/delft-package", {
        encoding: "cityparquet",
      });
    });

    expect(cityparquet.loadCityParquetFromUrl).toHaveBeenCalledWith(
      "https://x/delft-package",
    );
    expect(useLayerStore.getState().layers[0]!.model.sourceEncoding).toBe(
      "cityparquet",
    );
  });

  it("keeps a `.parquet` URL OUT of the CityParquet arm when the override says CityJSON", async () => {
    // The reader fake is module-level and keeps its calls across this file.
    cityparquet.loadCityParquetFromUrl.mockClear();
    const { result } = renderHook(() => useLayerFileLoader());

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/building.parquet", {
        encoding: "cityjson",
      });
    });

    expect(cityparquet.loadCityParquetFromUrl).not.toHaveBeenCalled();
  });

  it("hands the override to the PARSER: one text, two readings", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    // A single CityJSON line IS a one-line CityJSONSeq document, so the same
    // bytes parse under either reader — which makes the resulting model's
    // `sourceEncoding` a clean witness for which one ran.
    const file = new File([MINIMAL_CITYJSON], "ambiguous.city.json");

    await act(async () => {
      await result.current.addLayerFromFile(file, {
        encoding: "cityjsonseq",
      });
    });

    expect(useLayerStore.getState().layers[0]!.model.sourceEncoding).toBe(
      "cityjsonseq",
    );
  });

  it("routes a `.city.json` file with NO override as CityJSON, exactly as before", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File([MINIMAL_CITYJSON], "delft.city.json");

    await act(async () => {
      await result.current.addLayerFromFile(file);
    });

    expect(openStream).not.toHaveBeenCalled();
    expect(useLayerStore.getState().layers[0]!.model.sourceEncoding).toBe(
      "cityjson",
    );
  });

  it("a retry re-runs the add with the SAME override", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    openStream.mockRejectedValueOnce(new Error("network down"));

    await act(async () => {
      await result.current.addLayerFromUrl("https://x/model.json", {
        encoding: "flatcitybuf",
      });
    });
    expect(useLayerStore.getState().layers).toHaveLength(0);

    await act(async () => {
      result.current.failed[0]!.retry();
    });

    // Twice: the retry took the streaming route too. Without the override in
    // the closure it would have fetched `/model.json` as CityJSON instead.
    expect(openStream).toHaveBeenCalledTimes(2);
    expect(useLayerStore.getState().layers[0]!.isStreaming).toBe(true);
  });
});
