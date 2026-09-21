// @vitest-environment node
//
// Times static-mesh LoD switches through the real `CityModelMesh.setLod` and
// counts geometry rebuilds. Runs on a synthetic model with Nishitokyo's LoD
// shape (84,394 objects with LoDs 0/1, 468 with 0/1/2), in EPSG:32654 — or on
// the real file when AUDIT_FILE points at a downloaded Nishitokyo parquet.
//
//   AUDIT_LOG=/path/out.jsonl npx vitest run -c scripts/performance/vitest.config.ts lod-switch
import { it, expect, vi } from "vitest";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { CityModelMesh } from "../../packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityModelMesh";
import { readCityParquetTable } from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/tableReader";
import { decodeTableObjects } from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/decodeTable";
import { normalizeCityParquetCrs } from "../../src/features/cityparquet/normalizeCityParquetCrs";
import {
  mergeBBox,
  type BBox3,
  type CityModel,
  type CityObject,
  type Surface,
  type Vec3,
} from "@cityjson/navara-core";

function prism(cx: number, cy: number, h: number, lod: string): Surface[] {
  const ring: Vec3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ring.push([cx + 6 * Math.cos(a), cy + 6 * Math.sin(a), 0]);
  }
  const top = ring.map(([x, y]) => [x, y, h] as Vec3);
  const s = (type: Surface["type"], r: Vec3[]): Surface => ({
    type,
    rings: [r],
    attributes: {},
    lod,
  });
  const walls = ring.map((p, i) => {
    const q = ring[(i + 1) % 6]!;
    return s("WallSurface", [p, q, top[(i + 1) % 6]!, top[i]!]);
  });
  return [
    s("GroundSurface", [...ring].reverse()),
    s("RoofSurface", top),
    ...walls,
  ];
}

function syntheticNishitokyo(): CityModel {
  const objects: Record<string, CityObject> = {};
  const n = 84_862;
  const side = Math.ceil(Math.sqrt(n));
  let bbox: BBox3 | null = null;
  for (let i = 0; i < n; i++) {
    const cx = 370_000 + (i % side) * 20;
    const cy = 3_950_000 + Math.floor(i / side) * 20;
    const footprint: Surface = { ...prism(cx, cy, 0, "0")[0]!, lod: "0" };
    const surfaces = [footprint, ...prism(cx, cy, 9, "1")];
    if (i % 181 === 0 && i / 181 < 468)
      surfaces.push(...prism(cx, cy, 10, "2"));
    const b: BBox3 = [cx - 6, cy - 6, 0, cx + 6, cy + 6, 10];
    bbox = mergeBBox(bbox, b);
    objects[`B${i}`] = {
      id: `B${i}`,
      objectType: "Building",
      attributes: {},
      surfaces,
      bbox: b,
      children: [],
      parents: [],
      lod: null,
    };
  }
  return {
    sourceEncoding: "cityparquet",
    metadata: { referenceSystem: "EPSG:32654" },
    objects,
    bbox,
    vertexCount: 0,
  };
}

async function realNishitokyo(file: string): Promise<CityModel> {
  const bytes = fs.readFileSync(file);
  const objects = decodeTableObjects(await readCityParquetTable(bytes));
  let bbox: BBox3 | null = null;
  for (const o of Object.values(objects)) bbox = mergeBBox(bbox, o.bbox);
  return normalizeCityParquetCrs({
    sourceEncoding: "cityparquet",
    metadata: { referenceSystem: "EPSG:6697" },
    objects,
    bbox,
    vertexCount: 0,
  });
}

it("counts and times static LoD switches", async () => {
  const log = process.env.AUDIT_LOG ?? "/tmp/lod-switch.jsonl";
  const source = process.env.AUDIT_FILE ? "nishitokyo-file" : "synthetic";
  const model = process.env.AUDIT_FILE
    ? await realNishitokyo(process.env.AUDIT_FILE)
    : syntheticNishitokyo();
  const rebuild = vi.spyOn(
    CityModelMesh.prototype as unknown as { rebuildGeometry(): void },
    "rebuildGeometry",
  );
  const record = (step: string, ms: number, mesh: CityModelMesh) => {
    const entry = {
      source,
      step,
      ms: Math.round(ms * 10) / 10,
      rebuilds: rebuild.mock.calls.length,
      triangles: mesh.triangleCount(),
      heapMB: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
    };
    fs.appendFileSync(log, JSON.stringify(entry) + "\n");
    return entry;
  };

  let t = performance.now();
  const mesh = new CityModelMesh({
    id: "audit",
    model,
    crs: model.metadata.referenceSystem,
    lod: ["2", "1", "0"],
  });
  record("construct [2,1,0]", performance.now() - t, mesh);

  const steps: Array<[string, readonly string[]]> = [
    ["[2,1,0] -> [2]", ["2"]],
    ["[2] -> [2,1,0]", ["2", "1", "0"]],
    ["[2,1,0] -> [2,1]", ["2", "1"]],
    ["[2,1] -> [1,2] (reordered)", ["1", "2"]],
    ["[1,2] -> [2]", ["2"]],
    ["[2] -> [2,1]", ["2", "1"]],
  ];
  const results = [];
  for (const [step, lod] of steps) {
    rebuild.mockClear();
    t = performance.now();
    mesh.setLod(lod);
    results.push(record(step, performance.now() - t, mesh));
  }
  // What the no-op step cost before: the same rebuild, forced.
  rebuild.mockClear();
  t = performance.now();
  (mesh as unknown as { rebuildGeometry(): void }).rebuildGeometry();
  record(
    "forced rebuild under [2,1] (pre-fix cost)",
    performance.now() - t,
    mesh,
  );

  const byStep = Object.fromEntries(results.map((r) => [r.step, r]));
  expect(byStep["[2,1,0] -> [2,1]"]!.rebuilds).toBe(0);
  expect(byStep["[2,1] -> [1,2] (reordered)"]!.rebuilds).toBe(0);
  expect(byStep["[2] -> [2,1]"]!.rebuilds).toBe(1);
  expect(byStep["[2] -> [2,1]"]!.triangles).toBeGreaterThan(
    byStep["[1,2] -> [2]"]!.triangles,
  );
  mesh.dispose();
}, 600_000);
