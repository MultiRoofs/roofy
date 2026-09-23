/// <reference types="node" />
// @vitest-environment node
/**
 * Real-data benchmark of bounded CityParquet loading (performance task 3).
 *
 * Opt-in and excluded from the ordinary suite. Three phases, one JSONL
 * record each (plus one per pan step):
 *
 * 1. `open` — `openCityParquetStream` over a lazy file-backed Blob (or the
 *    real URL with `AUDIT_HTTP=1`): footer + packed bbox/parents per row
 *    group. Records time, bytes read, retained heap + ArrayBuffer delta (≈ index size) and peaks.
 * 2. `read-1km` — `readRows(index.query(box))` for a 1 km box around
 *    Yokohama station, at every LoD (`lod: null`, the worst case) and at the
 *    ladder's middle rung.
 * 3. `pan` — ten 1 km views stepping 600 m from the station towards Kannai,
 *    driven through the REAL stream worker core (`installStreamWorker` +
 *    the CityParquet adapter) with the planner's rules (probe vs
 *    VIEWPORT_FEATURE_BUDGET, `chooseLevel`, `lodForCellSize`) and the main
 *    thread's resident `CellCache` budgets (4 M triangles / 512 MiB), whose
 *    evictions are sent to the worker exactly as the plugin does.
 *
 * Environment: `AUDIT_FILE` (default the local Yokohama building table),
 * `AUDIT_HTTP=1` (read the published URL instead; `AUDIT_URL` overrides it),
 * `AUDIT_LOG` (JSONL path; defaults to a /tmp file, like
 * `cityparquet-profile.test.ts`, so a rerun cannot truncate the committed
 * evidence — pass the `docs/performance/…` path explicitly to refresh it).
 * Run with `NODE_OPTIONS="--max-old-space-size=4096 --expose-gc"`. Heap peaks
 * come from a 50 ms sampler and are lower bounds.
 *
 * UNITS in this file and in the README's prose: heap and RSS in binary MiB/GiB
 * (`/ 2 ** 20`), bytes read over the wire in decimal MB/GB (`/ 1e6`), matching
 * how each is reported by its source.
 */
import { it } from "vitest";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import proj4 from "proj4";
import { ensureProjDef } from "@cityjson/navara-core";
// By source path, like every other plugin-internal import in this file: this
// script is outside `tsconfig.app.json`'s `include`, so the barrel resolves to
// the package's BUILT types here, and these two landed after the last build.
import {
  localMetricFrameFromDescriptor,
  type LocalMetricFrameDescriptor,
} from "../../packages/cityjson-navara-plugins/packages/navara-core/src/geo/localMetricFrame";
import {
  asyncBufferFromBlob,
  asyncBufferFromHttp,
  type RangeBuffer,
} from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/rangeSource";
import { openCityParquetStream } from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/streamReader";
import {
  createCityParquetSourceAdapter,
  MAX_FETCH_READ_BYTES,
} from "../../packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/cityParquetSourceAdapter";
import { installStreamWorker } from "../../packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/streamWorkerCore";
import { CellCache } from "../../packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/cellCache";
import {
  cellStatsFromGeometry,
  commitNormal,
  lodToWireLabel,
  type FetchedCell,
} from "../../packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/commitPlanner";
import {
  chooseLevel,
  lodForCellSize,
} from "../../packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/levelPolicy";
import {
  cellSize,
  keysCovering,
  makeGrid,
  type CellKey,
} from "../../packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/tileGrid";
import {
  RESIDENT_BYTE_BUDGET,
  RESIDENT_TRIANGLE_BUDGET,
  VIEWPORT_FEATURE_BUDGET,
} from "../../packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/constants";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../packages/cityjson-navara-plugins/packages/navara-flatcitybuf/src/workerProtocol";
import type { BBox3 } from "@cityjson/navara-core";

const DEFAULT_FILE = "/data2/hideba/roofy-perf-data/yokohama-building.parquet";
const DEFAULT_URL =
  "https://cityparquet.open3d.city/data/plateau/yokohama-shi/building.parquet";
const STATION: [number, number] = [139.622, 35.466];
const KANNAI: [number, number] = [139.638, 35.444];
const HALF_BOX_M = 500;
const PAN_STEPS = 10;
const PAN_STEP_M = 600;

const http = process.env.AUDIT_HTTP === "1";
const file = process.env.AUDIT_FILE ?? DEFAULT_FILE;
const url = process.env.AUDIT_URL ?? DEFAULT_URL;
const present = http || fs.existsSync(file);
const log =
  process.env.AUDIT_LOG ??
  `/tmp/cityparquet-stream-${http ? "http" : "node"}.jsonl`;

type Box = [number, number, number, number];

/**
 * WGS84 degrees -> the stream's index space, whichever of the two it is.
 *
 * A projected source names a metric EPSG and proj4 does the work; a GEOGRAPHIC
 * one (PLATEAU's EPSG:6697) names no EPSG and carries a bucket frame instead,
 * where the same conversion is two multiplications. Built once — proj4's
 * three-argument call re-parses both CRS definitions on every invocation.
 */
function indexPlacer(header: {
  epsg: number | null;
  frame: LocalMetricFrameDescriptor | null;
}): (p: readonly [number, number]) => readonly [number, number] {
  const { epsg } = header;
  if (epsg !== null) {
    ensureProjDef(epsg);
    const toXY = proj4("WGS84", `EPSG:${epsg}`) as {
      forward(c: [number, number]): [number, number];
    };
    return (p) => toXY.forward([p[0], p[1]]);
  }
  if (!header.frame) {
    throw new Error(
      "This stream reports neither a metric EPSG nor a bucket frame, so its index space has no definition to place a query point in.",
    );
  }
  const frame = localMetricFrameFromDescriptor(header.frame);
  return (p) => frame.toMetric(p[0], p[1]);
}
/** A worker request before `send` numbers it. */
type Outgoing = WorkerRequest extends infer R
  ? R extends WorkerRequest
    ? Omit<R, "id">
    : never
  : never;

if (!present) {
  console.warn(
    `cityparquet-stream: skipped, ${file} is absent (set AUDIT_FILE, or AUDIT_HTTP=1 to read ${url}).`,
  );
}

interface Counter {
  requests: number;
  bytes: number;
  /** Transport answers other than a 206 (thrown fetches, other statuses). */
  anomalies: string[];
}

/** Counts ranged-GET requests and the bytes their 206 answers carried. */
function countingFetch(
  counter: Counter,
  inner: typeof fetch = globalThis.fetch.bind(globalThis),
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("Range");
    counter.requests++;
    let res: Response;
    try {
      res = await inner(input, init);
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      counter.anomalies.push(
        `fetch threw for ${range ?? init?.method ?? "GET"}: ${String(error)}${cause instanceof Error ? ` (${cause.message})` : ""}`,
      );
      throw error;
    }
    const m = /bytes=(\d+)-(\d+)/.exec(range ?? "");
    if (res.status === 206 && m)
      counter.bytes += Number(m[2]) - Number(m[1]) + 1;
    else if (range) counter.anomalies.push(`HTTP ${res.status} for ${range}`);
    return res;
  };
}

/** A file-backed Blob whose reads are counted (slices stay lazy). */
function countingBlob(blob: Blob, counter: Counter) {
  return {
    size: blob.size,
    slice(start?: number, end?: number) {
      const part = blob.slice(start, end);
      counter.requests++;
      counter.bytes += part.size;
      return part;
    },
  } as unknown as Blob;
}

function gc(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

it.skipIf(!present)(
  `streams the Yokohama building table by viewport (${http ? url : file})`,
  { timeout: 30 * 60_000 },
  async () => {
    fs.writeFileSync(log, "");
    const baseline = performance.now();
    let peakHeap = 0;
    let peakRss = 0;
    const sample = () => {
      const m = process.memoryUsage();
      peakHeap = Math.max(peakHeap, m.heapUsed);
      peakRss = Math.max(peakRss, m.rss);
    };
    const resetPeaks = () => {
      peakHeap = 0;
      peakRss = 0;
      sample();
    };
    const timer = setInterval(sample, 50);
    const record = (stage: string, extra: Record<string, unknown>) => {
      sample();
      const m = process.memoryUsage();
      fs.appendFileSync(
        log,
        JSON.stringify({
          date: new Date().toISOString(),
          source: http ? url : file,
          transport: http ? "http" : "blob",
          stage,
          elapsedMs: Math.round(performance.now() - baseline),
          heapUsedMB: +(m.heapUsed / 2 ** 20).toFixed(1),
          arrayBuffersMB: +(m.arrayBuffers / 2 ** 20).toFixed(1),
          rssMB: +(m.rss / 2 ** 20).toFixed(1),
          peakHeapMB: +(peakHeap / 2 ** 20).toFixed(1),
          peakRssMB: +(peakRss / 2 ** 20).toFixed(1),
          maxRSSMB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
          ...extra,
        }) + "\n",
      );
    };

    try {
      // ---- 1. open -------------------------------------------------------
      const openCounter: Counter = { requests: 0, bytes: 0, anomalies: [] };
      let buffer: RangeBuffer;
      if (http) {
        buffer = await asyncBufferFromHttp(url, {
          fetch: countingFetch(openCounter) as typeof fetch,
        });
      } else {
        buffer = asyncBufferFromBlob(await fs.openAsBlob(file));
      }
      gc();
      const retained = () => {
        const m = process.memoryUsage();
        return m.heapUsed + m.arrayBuffers;
      };
      const heapBefore = retained();
      resetPeaks();
      let t = performance.now();
      const stream = await openCityParquetStream([buffer]);
      const openMs = performance.now() - t;
      const openBytes = buffer.bytesRead();
      gc();
      const h = stream.header;
      record("open", {
        ms: Math.round(openMs),
        bytesRead: openBytes,
        byteLength: buffer.byteLength,
        fractionRead: +(openBytes / buffer.byteLength).toFixed(4),
        httpRequests: http ? openCounter.requests : undefined,
        // heap + ArrayBuffers: the index is typed arrays, off the V8 heap.
        retainedDeltaMB: +((retained() - heapBefore) / 2 ** 20).toFixed(1),
        objectsCount: h.objectsCount,
        indexedRows: stream.index.rowCount,
        invalidBBoxRows: h.invalidBBoxRows,
        epsg: h.epsg,
        // The bucket frame the index is in when there is no EPSG — without it
        // a run's `box` numbers below have no stated origin.
        frame: h.frame,
        lods: h.lods,
        extent: h.extent.map((v) => Math.round(v)),
      });

      // Yokohama's two query points, placed in whatever INDEX SPACE the stream
      // reports — that is the space `index.query` and the tile grid speak, and
      // since the geographic-to-ENU milestone a 6697 source has no EPSG at all:
      // it indexes in bucket metres about its own frame. Reaching for
      // `EPSG:null` here is what broke this script.
      const toIndexXY = indexPlacer(h);
      const [sx, sy] = toIndexXY(STATION);
      const [kx, ky] = toIndexXY(KANNAI);
      const box = (x: number, y: number): Box => [
        x - HALF_BOX_M,
        y - HALF_BOX_M,
        x + HALF_BOX_M,
        y + HALF_BOX_M,
      ];

      // ---- 2. one 1 km read at every LoD and at the middle rung -----------
      const midLod = h.lods[Math.floor((h.lods.length - 1) / 2)] ?? null;
      for (const lod of [null, midLod]) {
        const q = box(sx, sy);
        const ranges = stream.index.query(q);
        const rowsInRanges = ranges.reduce((n, r) => n + r.end - r.start, 0);
        const bytes0 = buffer.bytesRead();
        const req0 = openCounter.requests;
        gc();
        resetPeaks();
        t = performance.now();
        let objects = 0;
        let batches = 0;
        for await (const batch of stream.readRows(
          ranges,
          lod,
          new AbortController().signal,
        )) {
          batches++;
          objects += Object.keys(batch.objects).length;
        }
        record("read-1km", {
          lod,
          ms: Math.round(performance.now() - t),
          centreLngLat: STATION,
          box: q.map((v) => Math.round(v)),
          readCost: stream.index.readCost(q),
          viewportFeatureBudget: VIEWPORT_FEATURE_BUDGET,
          ranges: ranges.length,
          rowsInRanges,
          batches,
          objectsDecoded: objects,
          // The gate the adapter applies before reading anything.
          plannedBytes: stream.estimateReadBytes(ranges, lod),
          maxFetchReadBytes: MAX_FETCH_READ_BYTES,
          bytesRead: buffer.bytesRead() - bytes0,
          httpRequests: http ? openCounter.requests - req0 : undefined,
        });
      }

      // ---- 3. a 10-view pan through the real worker core -----------------
      const panCounter: Counter = { requests: 0, bytes: 0, anomalies: [] };
      const source = http
        ? { url }
        : { blob: countingBlob(await fs.openAsBlob(file), panCounter) };
      const realFetch = globalThis.fetch;
      if (http) {
        globalThis.fetch = countingFetch(panCounter, realFetch) as typeof fetch;
      }
      let onResponse: (m: WorkerResponse) => void = () => undefined;
      const ctx = {
        onmessage: null as ((ev: MessageEvent<WorkerRequest>) => void) | null,
        postMessage(m: WorkerResponse) {
          onResponse(m);
        },
      };
      installStreamWorker(ctx, createCityParquetSourceAdapter());
      let nextId = 1;
      const send = (req: Outgoing): number => {
        const id = nextId++;
        ctx.onmessage?.({
          data: { ...req, id },
        } as MessageEvent<WorkerRequest>);
        return id;
      };
      /** Sends `req` and collects its responses up to the terminal one. */
      const request = (req: Outgoing) =>
        new Promise<WorkerResponse[]>((resolve, reject) => {
          const out: WorkerResponse[] = [];
          let id = -1;
          onResponse = (m) => {
            if (m.id !== id) return;
            out.push(m);
            if (m.type === "error") reject(new Error(m.message));
            else if (m.type !== "cell") resolve(out);
          };
          id = send(req);
        });

      try {
        gc();
        resetPeaks();
        t = performance.now();
        const [opened] = await request({
          type: "open",
          source,
        });
        if (opened?.type !== "opened" || opened.admission) {
          throw new Error(`open refused: ${JSON.stringify(opened)}`);
        }
        const header = opened.header as { extent: BBox3; lods: string[] };
        record("pan-open", {
          ms: Math.round(performance.now() - t),
          bytesRead: panCounter.bytes,
          requests: panCounter.requests,
        });
        const grid = makeGrid(header.extent);
        const cache = new CellCache<null>({
          maxTriangles: RESIDENT_TRIANGLE_BUDGET,
          maxBytes: RESIDENT_BYTE_BUDGET,
        });
        // The keys THIS HARNESS believes the worker holds — its own
        // bookkeeping of what it posted minus what it evicted, never read
        // back from the worker (there is no protocol message for that).
        const postedCellKeys = new Set<CellKey>();
        /** Sum of `retainedBytes` over the cells still in `postedCellKeys`. */
        let retainedPosted = 0;
        const retainedOf = new Map<CellKey, number>();
        const len = Math.hypot(kx - sx, ky - sy);
        const [ux, uy] = [(kx - sx) / len, (ky - sy) / len];
        const panStart = performance.now();
        const panBytes0 = panCounter.bytes;
        resetPeaks();
        for (let step = 0; step < PAN_STEPS; step++) {
          const view = box(
            sx + ux * PAN_STEP_M * step,
            sy + uy * PAN_STEP_M * step,
          );
          const stepBytes0 = panCounter.bytes;
          const stepReq0 = panCounter.requests;
          t = performance.now();
          const [probed] = await request({ type: "probe", bbox: view });
          const probeCount = probed?.type === "probed" ? probed.count : -1;
          if (probeCount > VIEWPORT_FEATURE_BUDGET) {
            record("pan-step", {
              step,
              refused: "probe-over-budget",
              probeCount,
            });
            continue;
          }
          const level = chooseLevel(grid, view);
          if (level === null) throw new Error("no level for a 1 km view");
          const size = cellSize(grid, level);
          const lod = lodToWireLabel(lodForCellSize(header.lods, size));
          const desired = keysCovering(grid, view, level);
          const missing = desired.filter((k) => !cache.has(k));
          const fetched = new Map<CellKey, FetchedCell>();
          let triangles = 0;
          let objects = 0;
          if (missing.length > 0) {
            const responses = await request({
              type: "fetch",
              bbox: view,
              level,
              cells: missing,
              lod,
              hiddenTypes: [],
              rules: [],
              rulesEnabled: false,
            });
            for (const m of responses) {
              if (m.type !== "cell") continue;
              // Exactly as the plugin meters it: the transferred geometry
              // PLUS what the worker says it retains for the cell.
              const stats = cellStatsFromGeometry(m.geometry, m.retainedBytes);
              retainedPosted += m.retainedBytes;
              triangles += stats.triangles;
              objects += m.objects.length;
              fetched.set(m.key, {
                entry: null,
                stats,
              } as unknown as FetchedCell);
              postedCellKeys.add(m.key);
              retainedOf.set(m.key, m.retainedBytes);
            }
            // A requested cell the fetch found empty is resident too (the
            // plugin marks it with an empty geometry), so it is not refetched.
            for (const k of missing) {
              if (!fetched.has(k)) {
                fetched.set(k, {
                  entry: null,
                  stats: { triangles: 0, bytes: 0 },
                } as unknown as FetchedCell);
              }
            }
          }
          const evicted = commitNormal(
            cache as unknown as Parameters<typeof commitNormal>[0],
            desired,
            fetched,
          );
          if (evicted.length > 0) {
            send({ type: "evict", cells: evicted });
            for (const k of evicted) postedCellKeys.delete(k);
            for (const k of evicted) retainedPosted -= retainedOf.get(k) ?? 0;
          }
          const totals = cache.totals();
          record("pan-step", {
            step,
            ms: Math.round(performance.now() - t),
            probeCount,
            level,
            cellSizeM: size,
            lod,
            desiredCells: desired.length,
            fetchedCells: missing.length,
            populatedCells: [...fetched.values()].filter(
              (f) => f.stats.triangles > 0,
            ).length,
            objectsBaked: objects,
            trianglesBaked: triangles,
            evictedCells: evicted.length,
            residentCells: cache.keys().length,
            cellsPostedNotEvicted: postedCellKeys.size,
            residentTriangles: totals.triangles,
            residentMeteredMB: +(totals.bytes / 2 ** 20).toFixed(1),
            workerRetainedEstimateMB: +(retainedPosted / 2 ** 20).toFixed(1),
            stepBytesRead: panCounter.bytes - stepBytes0,
            stepRequests: panCounter.requests - stepReq0,
            cumulativeBytesRead: panCounter.bytes - panBytes0,
          });
        }
        gc(); // heapUsed/arrayBuffers now ≈ what the worker retains
        record("pan-summary", {
          steps: PAN_STEPS,
          stepM: PAN_STEP_M,
          ms: Math.round(performance.now() - panStart),
          cumulativeBytesRead: panCounter.bytes - panBytes0,
          cellsPostedNotEvicted: postedCellKeys.size,
          transportAnomalies: panCounter.anomalies,
          note: "peak* covers the pan only; main-thread meshes are not built in Node",
        });
        send({ type: "close" });
      } catch (error) {
        record("pan-error", {
          message: error instanceof Error ? error.message : String(error),
          transportAnomalies: panCounter.anomalies.slice(-10),
        });
        throw error;
      } finally {
        globalThis.fetch = realFetch;
      }
    } finally {
      clearInterval(timer);
    }
  },
);
