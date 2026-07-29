/**
 * Empirical evidence for the design's central claim: a commit ("fetch")
 * costs exactly ONE reader.select() call, no matter how many cells are
 * requested — never one select() per cell.
 *
 * Uses a fake FcbReader (via vi.doMock on fcbSource/@cityjson/flatcitybuf)
 * and a fake `self` global so fcb.worker.ts can be exercised directly,
 * without a real .fcb file or a real Worker thread.
 */
import { describe, it, expect, vi } from "vitest";
import {
  assertCellGeometry,
  type WorkerResponse,
} from "../../../../src/features/streaming/workerProtocol";

interface FakeCityJSONFeature {
  toCityJSON: () => {
    type: "CityJSONFeature";
    id: string;
    vertices: [number, number, number][];
    CityObjects: Record<
      string,
      {
        type: string;
        geometry: {
          type: string;
          lod: string;
          boundaries: number[][][];
        }[];
      }
    >;
  };
}

/** A minimal feature: a single quad "roof", vertices already in real-world
 *  coordinates (the fake header's transform is scale=1/translate=0, so
 *  "quantized" and "real" coincide) centred at (cx, cy). */
function fakeFeature(id: string, cx: number, cy: number): FakeCityJSONFeature {
  const vertices: [number, number, number][] = [
    [cx - 5, cy - 5, 0],
    [cx + 5, cy - 5, 0],
    [cx + 5, cy + 5, 10],
    [cx - 5, cy + 5, 10],
  ];
  return {
    toCityJSON: () => ({
      type: "CityJSONFeature",
      id,
      vertices,
      CityObjects: {
        [id]: {
          type: "Building",
          geometry: [
            { type: "MultiSurface", lod: "2", boundaries: [[[0, 1, 2, 3]]] },
          ],
        },
      },
    }),
  };
}

type FakeSelectOpts = { limit?: number };

describe("fcb.worker — single traversal per commit", () => {
  it("issues exactly one reader.select() per fetch, regardless of how many cells are requested", async () => {
    vi.resetModules();

    let selectCalls = 0;
    const fakeReader = {
      header: {},
      select: vi.fn(async (opts: FakeSelectOpts) => {
        selectCalls++;
        if (opts.limit === 0) {
          return {
            featuresCount: 3,
            [Symbol.asyncIterator]: () => (async function* () {})(),
          };
        }
        return {
          featuresCount: 3,
          [Symbol.asyncIterator]: () =>
            (async function* () {
              yield fakeFeature("a", 100, 100); // -> cell 2/0/0
              yield fakeFeature("c", 150, 150); // -> cell 2/0/0 (merged with a)
              yield fakeFeature("b", 500, 100); // -> cell 2/1/0
              // Owned by cell 2/2/2, which is NOT in the requested `cells`
              // list below — exercises the "outside the requested cover"
              // filter, not just the traversal count.
              yield fakeFeature("d", 900, 900);
            })(),
        };
      }),
    };

    vi.doMock("@cityjson/flatcitybuf", () => ({
      FcbReader: class {},
      toCityJSONMetadata: () => ({
        type: "CityJSON",
        version: "2.0",
        transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
        CityObjects: {},
        vertices: [],
        metadata: {},
      }),
    }));

    vi.doMock("../../../../src/domain/citymodel/flatcitybuf/fcbSource", () => ({
      openFcb: vi.fn(async () => fakeReader),
      checkAdmission: vi.fn(() => null),
      headerModel: vi.fn(() => ({
        version: "2.0",
        featuresCount: undefined,
        extent: [0, 0, 0, 1000, 1000, 30],
        referenceSystem: undefined,
        epsg: null,
      })),
    }));

    const posted: WorkerResponse[] = [];
    const fakeSelf = {
      postMessage: (msg: WorkerResponse) => posted.push(msg),
      onmessage: null as
        | ((ev: { data: unknown }) => void | Promise<void>)
        | null,
    };
    vi.stubGlobal("self", fakeSelf);

    await import("../../../../src/features/streaming/fcb.worker");
    const handler = fakeSelf.onmessage;
    if (!handler) throw new Error("worker module did not register onmessage");

    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "fetch",
        id: 1,
        bbox: [0, 0, 1000, 200],
        level: 2,
        // FOUR requested cells, only two of which ever receive data. If the
        // worker issued one select() per cell (the ~37N-traversal design
        // this task exists to replace), selectCalls would be 4, not 1.
        cells: ["2/0/0", "2/1/0", "2/2/0", "2/0/1"],
        lod: null,
        rules: [],
        rulesEnabled: false,
      },
    });

    expect(selectCalls).toBe(1);
    expect(fakeReader.select).toHaveBeenCalledTimes(1);

    const cellMsgs = posted.filter(
      (m): m is Extract<WorkerResponse, { type: "cell" }> => m.type === "cell",
    );
    expect(cellMsgs.map((m) => m.key).sort()).toEqual(["2/0/0", "2/1/0"]);
    // Task 9's own invariant, run against Task 10's real output.
    for (const m of cellMsgs) assertCellGeometry(m.geometry);
    // Cell 2/0/0 got two merged objects (a, c); 2/1/0 got one (b) — a quad
    // triangulates to 2 triangles each, so 4 vs 2.
    const byKey = new Map(cellMsgs.map((m) => [m.key, m]));
    expect(byKey.get("2/0/0")!.geometry.triangleCount).toBe(4);
    expect(byKey.get("2/1/0")!.geometry.triangleCount).toBe(2);

    expect(posted.filter((m) => m.type === "done").length).toBe(1);

    vi.unstubAllGlobals();
    vi.doUnmock("@cityjson/flatcitybuf");
    vi.doUnmock("../../../../src/domain/citymodel/flatcitybuf/fcbSource");
  });
});
