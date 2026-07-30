/**
 * Routing tests for useLayerFileLoader: `.fcb` (URL or File) must go through
 * `openStreamingLayer` (viewport streaming), never through `loadFromUrl`/
 * `parseText` (the deleted whole-file `.fcb` path — loadCityModel.ts throws
 * a clear error if anything still reaches it for `.fcb`). Everything else
 * must be unaffected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { WorkerResponse } from "../../../../src/features/streaming/workerProtocol";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { useLayerFileLoader } from "../../../../src/features/layers/useLayerFileLoader";
import type { FcbHeaderModel } from "../../../../src/domain/citymodel/flatcitybuf/fcbSource";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(
    public url: string | URL,
    public options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }
}

function currentWorker(): FakeWorker {
  const w = FakeWorker.instances.at(-1);
  if (!w) throw new Error("no FakeWorker constructed");
  return w;
}

const HEADER: FcbHeaderModel = {
  version: "1.0",
  featuresCount: 10,
  extent: [0, 0, 0, 100, 100, 10],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
  epsg: 28992,
};

beforeEach(() => {
  FakeWorker.instances.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
  useLayerStore.getState().removeAllLayers();
  useStreamStore.setState({ streams: {} });
});

describe("useLayerFileLoader — .fcb routing", () => {
  it("addLayerFromUrl routes a .fcb URL through openStreamingLayer, producing an isStreaming layer", async () => {
    const { result } = renderHook(() => useLayerFileLoader());

    let idPromise: Promise<string | null>;
    act(() => {
      idPromise = result.current.addLayerFromUrl("https://x/delft.fcb");
    });
    const worker = currentWorker();
    const call = worker.postMessage.mock.calls[0]![0] as {
      id: number;
      type: string;
      url?: string;
    };
    expect(call.type).toBe("open");
    expect(call.url).toBe("https://x/delft.fcb");

    await act(async () => {
      worker.onmessage?.({
        data: { type: "opened", id: call.id, header: HEADER, admission: null },
      } as unknown as MessageEvent<WorkerResponse>);
      await idPromise;
    });

    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("addLayerFromFile routes a .fcb File through openStreamingLayer as a Blob, not text()", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    const file = new File(["fake fcb bytes"], "local.fcb");
    const textSpy = vi.spyOn(file, "text");

    let idPromise: Promise<string | null>;
    act(() => {
      idPromise = result.current.addLayerFromFile(file);
    });
    const worker = currentWorker();
    const call = worker.postMessage.mock.calls[0]![0] as {
      id: number;
      type: string;
      blob?: Blob;
    };
    expect(call.type).toBe("open");
    expect(call.blob).toBe(file);
    expect(textSpy).not.toHaveBeenCalled();

    await act(async () => {
      worker.onmessage?.({
        data: { type: "opened", id: call.id, header: HEADER, admission: null },
      } as unknown as MessageEvent<WorkerResponse>);
      await idPromise;
    });

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

    let idPromise: Promise<string | null>;
    act(() => {
      idPromise = result.current.addLayerFromUrl("https://x/degrees.fcb");
    });
    const worker = currentWorker();
    const call = worker.postMessage.mock.calls[0]![0] as { id: number };

    await act(async () => {
      worker.onmessage?.({
        data: {
          type: "opened",
          id: call.id,
          header: HEADER,
          admission: { code: "non-metric-crs", message: "refused: degrees" },
        },
      } as unknown as MessageEvent<WorkerResponse>);
      await idPromise;
    });

    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(result.current.error).toMatch(/refused: degrees/);
  });

  it("a non-.fcb URL is unaffected — still goes through the plain CityJSON path, never opens a worker", async () => {
    const { result } = renderHook(() => useLayerFileLoader());
    // A CityJSON URL will fail to fetch in this test environment (no
    // network mock), which is fine — the point is that no Worker is ever
    // constructed for it.
    await act(async () => {
      await result.current.addLayerFromUrl("https://x/model.city.json");
    });
    expect(FakeWorker.instances).toHaveLength(0);
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

    let idPromise: Promise<string | null>;
    act(() => {
      idPromise = result.current.addLayerFromFile(file, {
        rulesEnabled: false,
        visible: false,
      });
    });
    const worker = currentWorker();
    const call = worker.postMessage.mock.calls[0]![0] as { id: number };
    await act(async () => {
      worker.onmessage?.({
        data: { type: "opened", id: call.id, header: HEADER, admission: null },
      } as unknown as MessageEvent<WorkerResponse>);
      await idPromise;
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
