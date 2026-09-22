/**
 * The one CityParquet add that the loader hook AND `App.tsx`'s snapshot
 * restore and share-link arms call: a restored layer's settings must reach
 * whichever path the (re-run) decision picks.
 *
 * The decision and the whole-file reader are faked at their modules; the
 * stream plugin at its seam; DuckDB's table registry at its module.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FcbStreamLayerHandle } from "@cityjson/navara-flatcitybuf";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { addCityParquetLayerFromUrl } from "../../../../src/features/cityparquet/addCityParquetLayer";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { StreamPlugin } from "../../../../src/features/streaming/streamPlugin";
import type { Rule } from "../../../../src/features/rules/types";

const mocks = vi.hoisted(() => ({
  decide: vi.fn<(input: unknown) => Promise<unknown>>(),
  loadUrl: vi.fn<(url: string) => Promise<unknown>>(),
  enqueue: vi.fn(async () => {}),
}));

vi.mock("../../../../src/features/cityparquet/streamDecision", () => ({
  decideCityParquetMode: mocks.decide,
}));
vi.mock(
  "../../../../src/features/cityparquet/loadCityParquet",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../src/features/cityparquet/loadCityParquet")
    >()),
    loadCityParquetFromUrl: mocks.loadUrl,
  }),
);
vi.mock("../../../../src/insights/layerTables", () => ({
  enqueueLayerTable: mocks.enqueue,
  nextTableName: vi.fn(() => "layer_99"),
  adoptLayerTable: vi.fn(),
}));

const HEADER = {
  version: "0.1.0",
  featuresCount: 884106,
  objectsCount: 884106,
  extent: [0, 0, 0, 1000, 1000, 100],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/32654",
  epsg: 32654,
};

function fakePlugin(): StreamPlugin & {
  openStream: ReturnType<typeof vi.fn>;
} {
  const openStream = vi.fn((opts: { id: string }) =>
    Promise.resolve({
      id: opts.id,
      grid: { originX: 0, originY: 0, rootCell: 1000, maxLevel: 4 },
      header: HEADER,
      level: null,
      ladder: [],
      typesSeen: [],
      appearanceThemes: [],
      status: "idle",
      message: null,
      version: 0,
      onStatus: () => () => {},
      onLadder: () => () => {},
      onTypes: () => () => {},
      onAppearanceThemes: () => () => {},
      onCommit: () => () => {},
    } as unknown as FcbStreamLayerHandle),
  );
  return { openStream, remove: vi.fn() };
}

const RULES: Rule[] = [];
const URL_ = "https://x.test/yokohama-shi/";

beforeEach(() => {
  mocks.decide.mockReset();
  mocks.loadUrl.mockReset();
  useLayerStore.getState().removeAllLayers();
  useStreamStore.setState({ streams: {} });
});

describe("addCityParquetLayerFromUrl", () => {
  it("streams a large source with the restored settings, under the engine hold", async () => {
    mocks.decide.mockResolvedValue({
      mode: "stream",
      source: { url: `${URL_}building.parquet` },
      totalBytes: 335 * 1024 * 1024,
    });
    const plugin = fakePlugin();
    const holdEngine = vi.fn(<T>(open: () => Promise<T>) => open());
    const layerId = await addCityParquetLayerFromUrl(
      URL_,
      {
        name: "yokohama-shi",
        rules: RULES,
        visible: false,
        hiddenTypes: ["Bridge"],
        selectedAppearance: null,
      },
      {
        resolveStreamPlugin: async () => plugin,
        holdEngine: holdEngine as <T>(open: () => Promise<T>) => Promise<T>,
      },
    );
    expect(mocks.loadUrl).not.toHaveBeenCalled();
    expect(holdEngine).toHaveBeenCalledTimes(1);
    const opts = plugin.openStream.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts).toMatchObject({
      format: "cityparquet",
      source: { url: `${URL_}building.parquet` },
      visible: false,
      hiddenTypes: ["Bridge"],
      appearance: null,
    });
    const layer = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId)!;
    expect(layer.isStreaming).toBe(true);
    expect(layer.visible).toBe(false);
    expect(layer.model.sourceEncoding).toBe("cityparquet");
    expect(layer.model.metadata.referenceSystem).toBe(HEADER.referenceSystem);
    expect(layer.modelRef).toEqual({ type: "url", url: URL_ });
  });

  it("runs a streamed open inside the hold, and releases it when the open is refused", async () => {
    mocks.decide.mockResolvedValue({
      mode: "stream",
      source: { url: `${URL_}building.parquet` },
      totalBytes: 335 * 1024 * 1024,
    });
    const plugin = fakePlugin();
    plugin.openStream.mockRejectedValueOnce(
      new Error("The server does not support range requests."),
    );
    let holds = 0;
    let peak = 0;
    const holdEngine = async <T>(open: () => Promise<T>): Promise<T> => {
      holds += 1;
      peak = Math.max(peak, holds);
      try {
        return await open();
      } finally {
        holds -= 1;
      }
    };
    await expect(
      addCityParquetLayerFromUrl(
        URL_,
        { name: "yokohama-shi" },
        { resolveStreamPlugin: async () => plugin, holdEngine },
      ),
    ).rejects.toThrow(/range requests/);
    expect(peak).toBe(1);
    expect(holds).toBe(0);
    expect(useLayerStore.getState().layers).toHaveLength(0);
  });

  it("reads a small source whole, keeping its settings (and never touches the plugin)", async () => {
    mocks.decide.mockResolvedValue({ mode: "static" });
    const model: CityModel = {
      sourceEncoding: "cityparquet",
      metadata: {
        referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
      },
      bbox: null,
      objects: {},
      vertexCount: 0,
    };
    mocks.loadUrl.mockResolvedValue(model);
    const resolveStreamPlugin = vi.fn();
    const holdEngine = vi.fn(<T>(open: () => Promise<T>) => open());
    const layerId = await addCityParquetLayerFromUrl(
      URL_,
      { name: "delft", visible: false },
      {
        resolveStreamPlugin,
        holdEngine: holdEngine as <T>(open: () => Promise<T>) => Promise<T>,
      },
    );
    expect(mocks.loadUrl).toHaveBeenCalledWith(URL_);
    expect(resolveStreamPlugin).not.toHaveBeenCalled();
    // A static load mounts the viewport as a consequence: no boot hold.
    expect(holdEngine).not.toHaveBeenCalled();
    const layer = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId)!;
    expect(layer.isStreaming).toBe(false);
    expect(layer.visible).toBe(false);
    expect(layer.name).toBe("delft");
    expect(mocks.enqueue).toHaveBeenCalledWith(layerId, {
      kind: "model",
      model,
    });
  });
});
