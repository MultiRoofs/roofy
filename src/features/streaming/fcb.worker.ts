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
import { makeGrid, cellCentre, type Grid } from "./tileGrid";
import type {
  CellGeometry,
  WorkerRequest,
  WorkerResponse,
} from "./workerProtocol";

const ctx = self as unknown as Worker;
let reader: FcbReader | undefined;
let grid: Grid | undefined;
let controller: AbortController | null = null;

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
        // Task 11 populates `objects`/`surfaceAttrKeys` from toObjectRecords
        // and records this cell in the worker cache BEFORE transferring —
        // the buffers below are detached by postMessage.
        post(
          {
            type: "cell",
            id: msg.id,
            key,
            geometry,
            objects: [],
            surfaceAttrKeys: [],
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

    if (msg.type === "cancel") {
      controller?.abort();
      return;
    }
    if (msg.type === "close") {
      controller?.abort();
      reader = undefined;
      grid = undefined;
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
