/// <reference lib="webworker" />
/**
 * Owns the FcbReader and a per-cell cache. One traversal per commit:
 * select() over the missing AABB, then bucket locally by bbox centre.
 */
import { FcbReader, toCityJSONMetadata } from "@cityjson/flatcitybuf";
import {
  dequantizeAll,
  mapMetadata,
  mergeBBox,
  parseCityObject,
} from "../../domain/citymodel/cityjson/parseHelpers";
import type {
  CityJSONObject,
  CityJSONRoot,
} from "../../domain/citymodel/cityjson/types";
import type { CityJSONFeature } from "../../domain/citymodel/cityjsonseq/types";
import type {
  BBox3,
  CityModel,
  CityObject,
} from "../../domain/citymodel/types";
import {
  checkAdmission,
  headerModel,
  openFcb,
} from "../../domain/citymodel/flatcitybuf/fcbSource";
import { buildCityMeshArrays } from "../../scene/buildCityMesh";
import { buildRuleColorsFromArrays } from "../../scene/applyRuleColors";
import { bucketFeatures } from "./bucketFeatures";
import { toObjectRecords } from "./objectRecords";
import { makeGrid, cellCentre, type CellKey, type Grid } from "./tileGrid";
import type {
  CellGeometry,
  WorkerRequest,
  WorkerResponse,
} from "./workerProtocol";

/**
 * A resident cell as retained by the worker, independent of what has already
 * been transferred to the main thread. `postMessage` DETACHES every
 * transferred `ArrayBuffer` — so once a cell's positions/normals/colors/
 * indices are handed off in `fetch`, the worker no longer owns those
 * specific typed arrays. `recolor` and `surfaces` need to keep working on
 * that cell afterwards (without re-running select()+decode), so the worker
 * keeps its own copies: the full parsed `CityModel` (never transferred — it
 * holds no ArrayBuffers of its own) plus copies of the per-vertex index
 * arrays and base colors that were about to be transferred away.
 */
interface CachedCell {
  readonly model: CityModel;
  readonly objectIndices: Uint32Array;
  readonly surfaceIndices: Uint32Array;
  readonly objectKeys: string[];
  /** Copy of the cell's base (non-rule) vertex colors, so `recolor` can fall
   *  back to them when `buildRuleColorsFromArrays` returns null (no rule
   *  matched) without needing to re-triangulate the cell to get them. */
  readonly colors: Float32Array;
}

const ctx = self as unknown as Worker;
let reader: FcbReader | undefined;
let grid: Grid | undefined;
let controller: AbortController | null = null;
/** The worker's own cell cache. Counts against the same memory budget as
 *  the main thread's cache; the main thread's `evict` message is what
 *  releases entries here (see the `evict`/`close` handlers below). Without
 *  it, this map would grow without bound as the viewport pans. */
const cells = new Map<CellKey, CachedCell>();

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === "open") {
      reader = await openFcb(
        "url" in msg ? { url: msg.url } : { blob: msg.blob },
      );
      const admission = checkAdmission(reader.header);
      const header = headerModel(reader.header);
      // checkAdmission returning null guarantees header.extent is set (its
      // "no-extent" branch is the only path that leaves it unset), but the
      // two functions are independent as far as the type checker knows.
      if (!admission && header.extent) grid = makeGrid(header.extent);
      post({ type: "opened", id: msg.id, header, admission });
      return;
    }

    if (msg.type === "probe") {
      if (!reader) throw new Error("no file open");
      controller?.abort();
      controller = new AbortController();
      // limit 0 yields an empty page but preserves the total hit count.
      // The cursor is NOT iterated, so no feature bodies are read.
      const cursor = await reader.select({
        spatial: { kind: "bbox", value: msg.bbox },
        limit: 0,
        signal: controller.signal,
      });
      post({ type: "probed", id: msg.id, count: cursor.featuresCount ?? 0 });
      return;
    }

    if (msg.type === "fetch") {
      if (!reader || !grid) throw new Error("no file open");
      controller?.abort();
      const my = new AbortController();
      controller = my;

      const cursor = await reader.select({
        spatial: { kind: "bbox", value: msg.bbox },
        signal: my.signal,
      });
      // The metadata line's transform is shared by every feature in the
      // file (CityJSONSeq semantics — same pattern as parseCityJSONSeq.ts:
      // one shared header, each feature carrying its own local vertices).
      // `toCityJSONMetadata`/`Feature.toCityJSON` return plain, JSON-shaped
      // data (no methods), so casting them into our own domain CityJSON
      // types is the same move parseCityJSONSeq makes on `JSON.parse`
      // output — not a type-unsafe escape hatch like `as never` (which
      // type-checks for ANY value, since `never` is a subtype of
      // everything; verified empirically, see task-10-report.md).
      const cjHeader = toCityJSONMetadata(
        reader.header,
      ) as unknown as CityJSONRoot;
      const metadata = mapMetadata(cjHeader.metadata);

      // Decode in chunks, yielding so a superseded fetch can be cancelled.
      const models: CityModel[] = [];
      let sinceYield = 0;
      for await (const f of cursor) {
        if (my.signal.aborted) {
          post({
            type: "error",
            id: msg.id,
            message: "aborted",
            aborted: true,
          });
          return;
        }
        const cjFeature = f.toCityJSON(
          reader.header,
        ) as unknown as CityJSONFeature;
        const realVertices = dequantizeAll(
          cjFeature.vertices,
          cjHeader.transform,
        );
        const objects: Record<string, CityObject> = {};
        let modelBBox: BBox3 | null = null;
        for (const [id, rawObj] of Object.entries(cjFeature.CityObjects) as [
          string,
          CityJSONObject,
        ][]) {
          const obj = parseCityObject(id, rawObj, realVertices);
          objects[id] = obj;
          modelBBox = mergeBBox(modelBBox, obj.bbox);
        }
        models.push({
          sourceEncoding: "flatcitybuf",
          metadata,
          bbox: modelBBox,
          objects,
          vertexCount: cjFeature.vertices.length,
        });
        if (++sinceYield >= 64) {
          sinceYield = 0;
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const resident = new Set(msg.cells);
      const buckets = bucketFeatures(models, grid, msg.level, new Set());
      for (const [key, cellModel] of buckets) {
        if (my.signal.aborted) return;
        if (!resident.has(key)) continue; // outside the requested cover
        const origin = cellCentre(grid, key, 0);
        const a = buildCityMeshArrays(cellModel, key, origin, msg.lod);
        const ruleColors = msg.rulesEnabled
          ? buildRuleColorsFromArrays(
              cellModel,
              a.objectIndices,
              a.surfaceIndices,
              a.objectKeys,
              msg.rules,
              a.colors,
            )
          : null;
        // Build the payload explicitly. Do NOT spread `a`: CityMeshArrays has
        // `colors`, CellGeometry has `baseColors`, and a spread would emit both.
        const geometry: CellGeometry = {
          positions: a.positions,
          normals: a.normals,
          baseColors: a.colors,
          ruleColors,
          objectIndices: a.objectIndices,
          surfaceIndices: a.surfaceIndices,
          objectKeys: a.objectKeys,
          triangleCount: a.triangleCount,
        };
        const { records, surfaceAttrKeys } = toObjectRecords(cellModel);

        // Record this cell in the worker cache BEFORE transferring: the
        // arrays below are detached the instant `post()`'s postMessage call
        // returns, so `.slice()` copies must be taken first. `cellModel`
        // itself is never transferred (it holds no ArrayBuffers), so it can
        // be cached by reference.
        cells.set(key, {
          model: cellModel,
          objectIndices: a.objectIndices.slice(),
          surfaceIndices: a.surfaceIndices.slice(),
          objectKeys: a.objectKeys,
          colors: a.colors.slice(),
        });

        post(
          {
            type: "cell",
            id: msg.id,
            key,
            geometry,
            objects: records,
            surfaceAttrKeys,
            lodsSeen: [],
          },
          [
            a.positions.buffer,
            a.normals.buffer,
            a.colors.buffer,
            a.objectIndices.buffer,
            a.surfaceIndices.buffer,
          ],
        );
      }
      post({ type: "done", id: msg.id });
      return;
    }

    if (msg.type === "recolor") {
      for (const key of msg.cells) {
        const cached = cells.get(key);
        // A recolor request can race a viewport move: the main thread may
        // ask to recolor a key this worker has since evicted. Skip rather
        // than error — the main thread has already dropped that cell too.
        if (!cached) continue;
        // buildRuleColorsFromArrays returns null when no rule matched
        // anything (or rulesEnabled is false); ruleColors on the wire is
        // non-nullable, so fall back to a fresh copy of the cached base
        // colors — same "ruleColors ?? baseColors" convention the
        // non-streaming path uses (see highlightMesh.ts). Always a *copy*:
        // transferring the cache's own buffer would detach it out from
        // under this cache entry.
        const ruleColors = msg.rulesEnabled
          ? (buildRuleColorsFromArrays(
              cached.model,
              cached.objectIndices,
              cached.surfaceIndices,
              cached.objectKeys,
              msg.rules,
              cached.colors,
            ) ?? cached.colors.slice())
          : cached.colors.slice();
        post({ type: "recolored", id: msg.id, key, ruleColors }, [
          ruleColors.buffer,
        ]);
      }
      post({ type: "done", id: msg.id });
      return;
    }

    if (msg.type === "surfaces") {
      for (const cached of cells.values()) {
        const obj = cached.model.objects[msg.objectId];
        if (obj) {
          post({
            type: "surfaceData",
            id: msg.id,
            objectId: msg.objectId,
            surfaces: obj.surfaces as unknown[],
          });
          return;
        }
      }
      post({
        type: "error",
        id: msg.id,
        message: `object not resident in any cached cell: ${msg.objectId}`,
        code: "not-found",
        aborted: false,
      });
      return;
    }

    if (msg.type === "evict") {
      for (const key of msg.cells) cells.delete(key);
      return;
    }

    if (msg.type === "cancel") {
      controller?.abort();
      return;
    }
    if (msg.type === "close") {
      controller?.abort();
      reader = undefined;
      grid = undefined;
      cells.clear();
      return;
    }
  } catch (e) {
    post({
      type: "error",
      id: msg.id,
      message: e instanceof Error ? e.message : String(e),
      aborted: controller?.signal.aborted ?? false,
    });
  }
};
