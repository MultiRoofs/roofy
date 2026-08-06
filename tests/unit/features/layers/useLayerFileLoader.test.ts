/**
 * Routing tests for useLayerFileLoader: `.fcb` (URL or File) must go through
 * `openStreamingLayer` (viewport streaming), never through `loadFromUrl`/
 * `parseText` (the deleted whole-file `.fcb` path — loadCityModel.ts throws
 * a clear error if anything still reaches it for `.fcb`). Everything else
 * must be unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { useLayerFileLoader } from "../../../../src/features/layers/useLayerFileLoader";
import { setStreamPlugin } from "../../../../src/features/streaming/streamPlugin";
import type { StreamPlugin } from "../../../../src/features/streaming/streamPlugin";
import type { FcbStreamLayerHandle } from "@cityjson/navara-flatcitybuf";
import type { FcbHeaderModel } from "@cityjson/navara-flatcitybuf";

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
