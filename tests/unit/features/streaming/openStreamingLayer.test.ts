import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkerResponse } from "../../../../src/features/streaming/workerProtocol";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { makeGrid } from "../../../../src/features/streaming/tileGrid";
import type { FcbHeaderModel } from "../../../../src/domain/citymodel/flatcitybuf/fcbSource";

/** Same fake Worker double as workerClient.test.ts: jsdom has no real
 *  Worker, so WorkerClient's constructor is stubbed at the global level. */
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

/** Fires the 'opened' response for the most recent postMessage call. */
function respondOpened(
  worker: FakeWorker,
  header: FcbHeaderModel,
  admission: unknown = null,
): void {
  const call = worker.postMessage.mock.calls.at(-1) as [{ id: number }];
  worker.onmessage?.({
    data: { type: "opened", id: call[0].id, header, admission },
  } as unknown as MessageEvent<WorkerResponse>);
}

const HEADER: FcbHeaderModel = {
  version: "1.0",
  featuresCount: 1000,
  extent: [0, 0, 0, 1000, 1000, 40],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
  epsg: 28992,
};

beforeEach(() => {
  FakeWorker.instances.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
  useLayerStore.getState().removeAllLayers();
  useStreamStore.setState({ streams: {} });
});

describe("openStreamingLayer", () => {
  it("registers a streaming Layer and a matching StreamState when the file is admitted (URL source)", async () => {
    const { openStreamingLayer } =
      await import("../../../../src/features/streaming/openStreamingLayer");
    const promise = openStreamingLayer({
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });
    const worker = currentWorker();
    // The open request must carry the URL, not a blob.
    const sent = worker.postMessage.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(sent.type).toBe("open");
    expect(sent.url).toBe("https://x/a.fcb");
    expect("blob" in sent).toBe(false);

    respondOpened(worker, HEADER, null);
    const layerId = await promise;

    const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
    expect(layer).toBeDefined();
    expect(layer!.isStreaming).toBe(true);
    expect(layer!.model.bbox).toEqual(HEADER.extent);
    expect(layer!.model.objects).toEqual({});

    const stream = useStreamStore.getState().get(layerId);
    expect(stream).toBeDefined();
    expect(stream!.grid).toEqual(makeGrid(HEADER.extent!));
    expect(stream!.header).toEqual(HEADER);
    expect(stream!.status).toBe("idle");
    expect(stream!.level).toBeNull();
  });

  it("passes a local Blob straight through as `blob`, never converting it to an ArrayBuffer", async () => {
    const { openStreamingLayer } =
      await import("../../../../src/features/streaming/openStreamingLayer");
    const blob = new Blob(["fake fcb bytes"]);
    const promise = openStreamingLayer({
      source: { blob },
      name: "local.fcb",
      modelRef: { type: "file", fileName: "local.fcb" },
    });
    const worker = currentWorker();
    const sent = worker.postMessage.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(sent.type).toBe("open");
    expect(sent.blob).toBe(blob); // same reference — not re-encoded
    expect("url" in sent).toBe(false);

    respondOpened(worker, HEADER, null);
    await promise;
  });

  it("rejects, terminates the worker, and registers nothing when admission refuses the file", async () => {
    const { openStreamingLayer } =
      await import("../../../../src/features/streaming/openStreamingLayer");
    const promise = openStreamingLayer({
      source: { url: "https://x/degrees.fcb" },
      name: "degrees.fcb",
      modelRef: { type: "url", url: "https://x/degrees.fcb" },
    });
    const worker = currentWorker();
    respondOpened(worker, HEADER, {
      code: "non-metric-crs",
      message:
        "This file's reference system could not be established as metric.",
    });

    await expect(promise).rejects.toThrow(/could not be established as metric/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(Object.keys(useStreamStore.getState().streams)).toHaveLength(0);
  });

  it("rejects and terminates the worker when the open itself errors", async () => {
    const { openStreamingLayer } =
      await import("../../../../src/features/streaming/openStreamingLayer");
    const promise = openStreamingLayer({
      source: { url: "https://x/missing.fcb" },
      name: "missing.fcb",
      modelRef: { type: "url", url: "https://x/missing.fcb" },
    });
    const worker = currentWorker();
    const call = worker.postMessage.mock.calls[0]![0] as { id: number };
    worker.onmessage?.({
      data: {
        type: "error",
        id: call.id,
        message: "404 not found",
        aborted: false,
      },
    } as unknown as MessageEvent<WorkerResponse>);

    await expect(promise).rejects.toThrow(/404 not found/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(useLayerStore.getState().layers).toHaveLength(0);
  });

  it("applies rules/rulesEnabled/visible overrides onto the created layer", async () => {
    const { openStreamingLayer } =
      await import("../../../../src/features/streaming/openStreamingLayer");
    const promise = openStreamingLayer({
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
      visible: false,
      rulesEnabled: false,
    });
    const worker = currentWorker();
    respondOpened(worker, HEADER, null);
    const layerId = await promise;
    const layer = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId)!;
    expect(layer.visible).toBe(false);
    expect(layer.rulesEnabled).toBe(false);
    expect(layer.rules).toEqual([]);
  });
});
