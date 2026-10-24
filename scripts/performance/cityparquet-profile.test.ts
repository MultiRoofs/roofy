// @vitest-environment node
import { it } from "vitest";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { compressors } from "hyparquet-compressors";
import {
  parquetMetadataAsync,
  parquetSchema,
  parquetReadObjects,
} from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/vendor/hyparquet/index.js";
import { DEFAULT_PARSERS } from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/vendor/hyparquet/convert.js";
import {
  parseCityFooter,
  lodFromColumnName,
  propsColumnFor,
  appearanceColumnsFor,
} from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/footer";
import { readCityParquetTable } from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/tableReader";
import { decodeTableObjects } from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/decodeTable";
import {
  buildCityMeshArrays,
  computeOriginOffset,
} from "../../packages/cityjson-navara-plugins/packages/navara-core/src/geometry/buildCityMeshArrays";
import { projectPositionsToEnu } from "../../packages/cityjson-navara-plugins/packages/navara-core/src/index";
import {
  buildPlacement,
  originLleFromOffset,
} from "../../packages/cityjson-navara-plugins/packages/navara-cityjson/src/enuPlacement";
import { geometryFromMeshArrays } from "../../packages/cityjson-navara-plugins/packages/navara-cityjson/src/cityMeshGeometry";
import { normalizeCityParquetCrs } from "../../src/features/cityparquet/normalizeCityParquetCrs";
import {
  flatRowsFromModel,
  encodeRowsAsJson,
} from "../../src/insights/layerRows";
import {
  mergeBBox,
  type BBox3,
  type CityModel,
  type CityObject,
} from "@cityjson/navara-core";
import type { CityParquetTableData } from "../../packages/cityjson-navara-plugins/packages/navara-cityparquet/src/tableReader";
it("measures the existing CityParquet stages without changing their implementations", async () => {
  const dataset = process.env.AUDIT_DATASET ?? "nishitokyo";
  const limit = Number(process.env.AUDIT_ROWS ?? 0);
  if (!["nishitokyo", "yokohama"].includes(dataset))
    throw new Error(
      "This benchmark supports the two EPSG:6697 PLATEAU fixtures only.",
    );
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new Error("AUDIT_ROWS must be a nonnegative integer.");
  const log = process.env.AUDIT_LOG ?? "/tmp/cityparquet-profile.jsonl";
  let t = performance.now();
  const baseline = t;
  function record(stage: string, extra = {}) {
    const now = performance.now();
    fs.appendFileSync(
      log,
      JSON.stringify({
        dataset,
        limit,
        stage,
        ms: now - t,
        elapsedMs: now - baseline,
        ...process.memoryUsage(),
        maxRSSKiB: process.resourceUsage().maxRSS,
        ...extra,
      }) + "\n",
    );
    t = performance.now();
  }
  record("baseline");
  const bytes = fs.readFileSync(`/tmp/${dataset}-building.parquet`);
  record("file-read", { bytes: bytes.byteLength });
  let table: CityParquetTableData | null;
  if (!limit) {
    table = await readCityParquetTable(bytes);
  } else {
    const file =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
    const metadata = await parquetMetadataAsync(file);
    const footer = parseCityFooter(metadata.key_value_metadata ?? []);
    const columnNames = parquetSchema(metadata).children.map(
      (column) => column.element.name,
    );
    const geometryColumns = columnNames
      .filter((name) => name.startsWith("geometry_lod"))
      .map((name) => ({
        name,
        lod: lodFromColumnName(name)!.lod,
        propsName: propsColumnFor(name),
        materialName: appearanceColumnsFor(name).material,
        textureName: appearanceColumnsFor(name).texture,
      }));
    const rows = await parquetReadObjects({
      file,
      metadata,
      rowStart: 0,
      rowEnd: limit,
      columns: [
        ...new Set(
          [
            "id",
            "feature_id",
            "object_type",
            "parents",
            "children",
            "bbox",
            ...geometryColumns.flatMap((g) => [
              g.name,
              g.propsName,
              g.materialName,
              g.textureName,
            ]),
            ...footer.attributes,
            "other_attributes",
          ].filter((n) => columnNames.includes(n)),
        ),
      ],
      utf8: false,
      compressors,
      parsers: {
        ...DEFAULT_PARSERS,
        geometryFromBytes: (b) => b,
        geographyFromBytes: (b) => b,
      },
    });
    table = { footer, rows, geometryColumns };
  }
  record("parquet-read", { rows: table.rows.length });
  if (process.env.AUDIT_STOP_AFTER_READ === "1") return;
  let objects: Record<string, CityObject> | null = decodeTableObjects(table);
  record("wkb-decode");
  let bbox: BBox3 | null = null;
  let vertices = 0,
    surfaces = 0;
  for (const o of Object.values(objects)) {
    bbox = mergeBBox(bbox, o.bbox);
    surfaces += o.surfaces.length;
    for (const s of o.surfaces) for (const r of s.rings) vertices += r.length;
  }
  let model: CityModel = {
    sourceEncoding: "cityparquet" as const,
    metadata: { referenceSystem: "EPSG:6697" },
    objects,
    bbox,
    vertexCount: vertices,
  };
  record("assemble-count", {
    objects: Object.keys(objects).length,
    surfaces,
    vertices,
  });
  table = null;
  objects = null;
  model = normalizeCityParquetCrs(model);
  record("geographic-to-utm");
  const origin = computeOriginOffset(model);
  const arrays = buildCityMeshArrays(model, "audit", origin, [
    "4",
    "3",
    "2",
    "1",
    "0",
  ]);
  record("triangulate", {
    triangles: arrays.triangleCount,
    arrayBytes: Object.values(arrays)
      .filter((x) => ArrayBuffer.isView(x))
      .reduce((n, x) => n + x.byteLength, 0),
  });
  const placement = buildPlacement(originLleFromOffset(origin, 32654), 0);
  projectPositionsToEnu(arrays.positions, {
    originOffset: origin,
    epsg: 32654,
    frame: placement.frame,
    heightOffset: 0,
  });
  record("utm-to-enu");
  const geometry = geometryFromMeshArrays(arrays);
  record("geometry-wrap-and-bounds");
  const rows = flatRowsFromModel(model);
  record("attribute-rows");
  const json = encodeRowsAsJson(rows);
  record("attribute-json", { jsonBytes: json.byteLength });
  geometry.dispose();
}, 180000);
