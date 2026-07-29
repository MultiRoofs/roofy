/**
 * Task 11: the worker's own cell cache — recolor, on-demand surfaces, evict.
 *
 * Reuses the fake-FcbReader / fake-`self` harness from fcbWorkerTraversal.test
 * (a real Worker thread can't run under vitest/jsdom), with one important
 * upgrade: `postMessage` here is backed by Node's `structuredClone(msg,
 * {transfer})`, which performs REAL ArrayBuffer transfer — the listed
 * buffers are actually detached (byteLength -> 0), exactly like the browser.
 * A plain `posted.push(msg)` fake (as used elsewhere) would NOT exercise the
 * "cache before transfer" ordering claim at all, since nothing would ever
 * actually go dead. See the module-level comment on `fakeSelf` below.
 */
import { describe, it, expect, vi } from "vitest";
import type { WorkerResponse } from "../../../../src/features/streaming/workerProtocol";
import { srgbHexToLinear } from "../../../../src/scene/applyRuleColors";
import type { Rule } from "../../../../src/features/rules/types";

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
          semantics: { surfaces: { type: string }[]; values: number[] };
        }[];
      }
    >;
  };
}

/** A single-quad "roof" feature, tagged as a RoofSurface via semantics (so
 *  rule matching in `buildRuleColorsFromArrays` has something real to match
 *  — `resolveRuleColor` only ever colors RoofSurface vertices). */
function roofFeature(id: string, cx: number, cy: number): FakeCityJSONFeature {
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
            {
              type: "MultiSurface",
              lod: "2",
              boundaries: [[[0, 1, 2, 3]]],
              semantics: { surfaces: [{ type: "RoofSurface" }], values: [0] },
            },
          ],
        },
      },
    }),
  };
}

type FakeSelectOpts = { limit?: number };

/** Builds a fresh, isolated worker module instance (own cache, own reader)
 *  for one test. Mirrors fcbWorkerTraversal.test.ts's setup, plus the
 *  real-transfer `postMessage` described in the file header. `features` is
 *  keyed by cell so tests can control exactly which objects land where. */
async function setupWorker(features: FakeCityJSONFeature[]): Promise<{
  handler: (ev: { data: unknown }) => void | Promise<void>;
  posted: WorkerResponse[];
}> {
  vi.resetModules();

  const fakeReader = {
    header: {},
    select: vi.fn(async (opts: FakeSelectOpts) => {
      if (opts.limit === 0) {
        return {
          featuresCount: features.length,
          [Symbol.asyncIterator]: () => (async function* () {})(),
        };
      }
      return {
        featuresCount: features.length,
        [Symbol.asyncIterator]: () =>
          (async function* () {
            for (const f of features) yield f;
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
    // REAL transfer semantics, not a plain array push: `transfer`'s
    // ArrayBuffers are actually detached here, exactly as a browser's
    // postMessage would do to the worker's own copies. This is what makes
    // the cache-before-transfer tests below meaningful.
    postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => {
      const cloned = structuredClone(msg, {
        transfer: transfer ?? [],
      }) as WorkerResponse;
      posted.push(cloned);
    },
    onmessage: null as ((ev: { data: unknown }) => void | Promise<void>) | null,
  };
  vi.stubGlobal("self", fakeSelf);

  await import("../../../../src/features/streaming/fcb.worker");
  const handler = fakeSelf.onmessage;
  if (!handler) throw new Error("worker module did not register onmessage");
  return { handler, posted };
}

function teardown(): void {
  vi.unstubAllGlobals();
  vi.doUnmock("@cityjson/flatcitybuf");
  vi.doUnmock("../../../../src/domain/citymodel/flatcitybuf/fcbSource");
}

const MATCH_ALL_RULE: Rule = {
  id: "r1",
  name: "roof",
  color: "#ff0000",
  conditions: [], // matches every RoofSurface vertex, unconditionally
  logic: "AND",
  enabled: true,
};

describe("fcb.worker cache — fetch populates records", () => {
  it("fills 'cell'.objects/surfaceAttrKeys from toObjectRecords instead of the [] placeholder", async () => {
    const { handler, posted } = await setupWorker([roofFeature("a", 100, 100)]);
    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "fetch",
        id: 1,
        bbox: [0, 0, 1000, 200],
        level: 2,
        cells: ["2/0/0"],
        lod: null,
        rules: [],
        rulesEnabled: false,
      },
    });

    const cellMsg = posted.find(
      (m): m is Extract<WorkerResponse, { type: "cell" }> => m.type === "cell",
    );
    if (!cellMsg) throw new Error("no cell message posted");
    expect(cellMsg.objects).toHaveLength(1);
    expect(cellMsg.objects[0]!.id).toBe("a");
    expect(cellMsg.objects[0]!.roofMetrics).toHaveLength(1);
    // No ring geometry on the wire in the bulk 'cell' message — only via
    // the on-demand 'surfaces' request (see the describe block below).
    expect(Object.keys(cellMsg.objects[0]!)).not.toContain("rings");

    teardown();
  });
});

describe("fcb.worker cache — recolor", () => {
  it("recolors using the worker's own cache after fetch's buffers were really transferred away", async () => {
    const { handler, posted } = await setupWorker([
      roofFeature("a", 100, 100), // -> cell 2/0/0
    ]);

    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "fetch",
        id: 1,
        bbox: [0, 0, 1000, 200],
        level: 2,
        cells: ["2/0/0"],
        lod: null,
        rules: [],
        rulesEnabled: false,
      },
    });

    const cellMsg = posted.find(
      (m): m is Extract<WorkerResponse, { type: "cell" }> => m.type === "cell",
    );
    if (!cellMsg) throw new Error("no cell message posted");
    const expectedLength = cellMsg.geometry.triangleCount * 3 * 3;

    await handler({
      data: {
        type: "recolor",
        id: 2,
        cells: ["2/0/0"],
        rules: [MATCH_ALL_RULE],
        rulesEnabled: true,
      },
    });

    const recolored = posted.find(
      (m): m is Extract<WorkerResponse, { type: "recolored" }> =>
        m.type === "recolored",
    );
    if (!recolored) throw new Error("no recolored message posted");

    // If the worker had cached a REFERENCE to `a.objectIndices` (etc.)
    // instead of a `.slice()` copy taken before the 'cell' message's
    // buffers were transferred, those cached arrays would have been
    // detached down to length 0 by the transfer above — collapsing this to
    // a 0-length array instead of the real per-vertex color output.
    expect(recolored.ruleColors.length).toBe(expectedLength);
    expect(recolored.ruleColors.length).toBeGreaterThan(0);

    const [er, eg, eb] = srgbHexToLinear("#ff0000");
    for (let v = 0; v < recolored.ruleColors.length / 3; v++) {
      expect(recolored.ruleColors[v * 3]).toBeCloseTo(er, 6);
      expect(recolored.ruleColors[v * 3 + 1]).toBeCloseTo(eg, 6);
      expect(recolored.ruleColors[v * 3 + 2]).toBeCloseTo(eb, 6);
    }

    teardown();
  });

  it("falls back to a fresh copy of the cached base colors when no rule matches, without exhausting the cache on repeat calls", async () => {
    const { handler, posted } = await setupWorker([roofFeature("a", 100, 100)]);
    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "fetch",
        id: 1,
        bbox: [0, 0, 1000, 200],
        level: 2,
        cells: ["2/0/0"],
        lod: null,
        rules: [],
        rulesEnabled: false,
      },
    });
    const cellMsg = posted.find(
      (m): m is Extract<WorkerResponse, { type: "cell" }> => m.type === "cell",
    );
    if (!cellMsg) throw new Error("no cell message posted");
    const expectedLength = cellMsg.geometry.triangleCount * 3 * 3;

    // Two recolor round-trips in a row, both with rulesEnabled: false, so
    // buildRuleColorsFromArrays returns null both times and the handler
    // must fall back to the cached base colors both times. If that
    // fallback ever transferred the cache's OWN buffer instead of a copy,
    // the first call would detach it and the second would see length 0.
    for (let i = 0; i < 2; i++) {
      await handler({
        data: {
          type: "recolor",
          id: 10 + i,
          cells: ["2/0/0"],
          rules: [],
          rulesEnabled: false,
        },
      });
    }

    const recoloredMsgs = posted.filter(
      (m): m is Extract<WorkerResponse, { type: "recolored" }> =>
        m.type === "recolored",
    );
    expect(recoloredMsgs).toHaveLength(2);
    for (const r of recoloredMsgs) {
      expect(r.ruleColors.length).toBe(expectedLength);
    }

    teardown();
  });

  it("skips a key that was never fetched — no crash, no recolored message, just done", async () => {
    const { handler, posted } = await setupWorker([]);
    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "recolor",
        id: 1,
        cells: ["9/9/9"],
        rules: [MATCH_ALL_RULE],
        rulesEnabled: true,
      },
    });
    expect(posted.filter((m) => m.type === "recolored")).toHaveLength(0);
    expect(posted.filter((m) => m.type === "done")).toHaveLength(1);
    teardown();
  });
});

describe("fcb.worker cache — on-demand surfaces", () => {
  it("finds an object across ALL cached cells (not just the most recently fetched one) and returns its rings", async () => {
    const { handler, posted } = await setupWorker([
      roofFeature("a", 100, 100), // -> cell 2/0/0
      roofFeature("b", 500, 100), // -> cell 2/1/0
    ]);
    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "fetch",
        id: 1,
        bbox: [0, 0, 1000, 200],
        level: 2,
        cells: ["2/0/0", "2/1/0"],
        lod: null,
        rules: [],
        rulesEnabled: false,
      },
    });

    await handler({ data: { type: "surfaces", id: 2, objectId: "b" } });

    const surfaceMsg = posted.find(
      (m): m is Extract<WorkerResponse, { type: "surfaceData" }> =>
        m.type === "surfaceData",
    );
    if (!surfaceMsg) throw new Error("no surfaceData message posted");
    expect(surfaceMsg.objectId).toBe("b");
    expect(surfaceMsg.surfaces.length).toBeGreaterThan(0);
    // Ring geometry — the thing ResidentObjectRecord deliberately omits —
    // must be present here, since this is the on-demand path that exists
    // specifically to carry it.
    const first = surfaceMsg.surfaces[0] as { rings: unknown[] };
    expect(Array.isArray(first.rings)).toBe(true);
    expect(first.rings.length).toBeGreaterThan(0);

    teardown();
  });

  it("reports a not-found error for an object id that was never fetched", async () => {
    const { handler, posted } = await setupWorker([roofFeature("a", 100, 100)]);
    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "fetch",
        id: 1,
        bbox: [0, 0, 1000, 200],
        level: 2,
        cells: ["2/0/0"],
        lod: null,
        rules: [],
        rulesEnabled: false,
      },
    });

    await handler({ data: { type: "surfaces", id: 2, objectId: "nope" } });

    const errMsg = posted.find(
      (m): m is Extract<WorkerResponse, { type: "error" }> =>
        m.type === "error",
    );
    if (!errMsg) throw new Error("no error message posted");
    expect(errMsg.code).toBe("not-found");
    expect(errMsg.aborted).toBe(false);

    teardown();
  });
});

describe("fcb.worker cache — evict / close genuinely release memory", () => {
  it("evict drops exactly the requested cell — recolor for it afterwards is silently skipped, other cells are unaffected", async () => {
    const { handler, posted } = await setupWorker([
      roofFeature("a", 100, 100), // -> cell 2/0/0
      roofFeature("b", 500, 100), // -> cell 2/1/0
    ]);
    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "fetch",
        id: 1,
        bbox: [0, 0, 1000, 200],
        level: 2,
        cells: ["2/0/0", "2/1/0"],
        lod: null,
        rules: [],
        rulesEnabled: false,
      },
    });

    await handler({ data: { type: "evict", id: 2, cells: ["2/0/0"] } });

    await handler({
      data: {
        type: "recolor",
        id: 3,
        cells: ["2/0/0", "2/1/0"],
        rules: [MATCH_ALL_RULE],
        rulesEnabled: true,
      },
    });

    const recoloredKeys = posted
      .filter(
        (m): m is Extract<WorkerResponse, { type: "recolored" }> =>
          m.type === "recolored",
      )
      .map((m) => m.key);
    expect(recoloredKeys).toEqual(["2/1/0"]); // NOT 2/0/0 — it was evicted

    // The evicted object is unreachable via `surfaces` too — same cache.
    await handler({ data: { type: "surfaces", id: 4, objectId: "a" } });
    const evictedErr = posted.find(
      (m): m is Extract<WorkerResponse, { type: "error" }> =>
        m.type === "error" && m.id === 4,
    );
    if (!evictedErr)
      throw new Error("expected an error for the evicted object");
    expect(evictedErr.code).toBe("not-found");

    teardown();
  });

  it("close clears the ENTIRE cache, not just the current fetch's cells", async () => {
    const { handler, posted } = await setupWorker([roofFeature("a", 100, 100)]);
    await handler({ data: { type: "open", id: 0, url: "fake://irrelevant" } });
    await handler({
      data: {
        type: "fetch",
        id: 1,
        bbox: [0, 0, 1000, 200],
        level: 2,
        cells: ["2/0/0"],
        lod: null,
        rules: [],
        rulesEnabled: false,
      },
    });

    await handler({ data: { type: "close", id: 2 } });

    // Re-open (close tore down the reader too) and ask for the
    // now-supposedly-resident object — it must be gone.
    await handler({ data: { type: "open", id: 3, url: "fake://irrelevant" } });
    await handler({ data: { type: "surfaces", id: 4, objectId: "a" } });
    const errMsg = posted.find(
      (m): m is Extract<WorkerResponse, { type: "error" }> =>
        m.type === "error" && m.id === 4,
    );
    if (!errMsg) throw new Error("expected an error for the cleared cache");
    expect(errMsg.code).toBe("not-found");

    teardown();
  });
});
