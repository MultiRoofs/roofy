/**
 * The stac-geoparquet item reader.
 *
 * DuckDB is MOCKED WHOLESALE: jsdom has no WebAssembly instantiation path for
 * duckdb-wasm and no Worker, so importing the real module here would fail
 * before a single assertion ran. What is worth testing lives above the
 * database anyway — that a collection without a mirror says so instead of
 * throwing something generic, that a download or a read failure both surface
 * as an "item index" error, that projected-metre bboxes are rejected rather
 * than flown to, and that the SELECT list is built from a schema PROBE so one
 * missing column in one of 31 independently generated parquets cannot take a
 * whole collection from browsable to broken.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  queryParquetBuffer: vi.fn(),
}));

import {
  initDuckDB,
  queryParquetBuffer,
} from "../../../../src/analytics/duckdb";
import {
  buildItemsSql,
  fetchCollectionItems,
} from "../../../../src/features/stac/stacItems";
import type { StacCollectionCard } from "../../../../src/features/stac/stacTypes";

const card: StacCollectionCard = {
  id: "netherlands-3d-bag",
  title: "3D BAG",
  description: "",
  license: null,
  extent2d: null,
  lods: [],
  coTypes: [],
  version: null,
  projCodes: [],
  semanticSurfaces: null,
  textures: null,
  materials: null,
  cityObjectsTotal: null,
  itemsParquetHref:
    "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/items.parquet",
  collectionHref:
    "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/collection.json",
};

function stubParquetFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("fetchCollectionItems", () => {
  it("maps duckdb rows to StacItemRecords with validated bboxes", async () => {
    stubParquetFetch();
    vi.mocked(queryParquetBuffer).mockResolvedValue({
      columns: [],
      rows: [
        {
          id: "b",
          xmin: 4.3,
          ymin: 52.0,
          xmax: 4.4,
          ymax: 52.1,
          href: "https://data.3dbag.nl/b.city.json.gz",
          media_type: "application/city+json",
          lods: "0|1.2",
          co_types: "Building|BuildingPart",
          city_objects: 873,
          proj_code: "EPSG:7415",
        },
        {
          id: "a",
          xmin: 2677116,
          ymin: 1241839,
          xmax: 2689381,
          ymax: 1254306,
          href: "https://x/a.gml",
          media_type: "application/gml+xml",
          lods: "",
          co_types: "",
          city_objects: null,
          proj_code: null,
        },
      ],
    });
    const items = await fetchCollectionItems(card);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]); // sorted by id
    expect(items[1]).toMatchObject({
      bbox2d: [4.3, 52.0, 4.4, 52.1],
      assetHref: "https://data.3dbag.nl/b.city.json.gz",
      lods: ["0", "1.2"],
      coTypes: ["Building", "BuildingPart"],
      cityObjects: 873,
      collectionId: "netherlands-3d-bag",
    });
    expect(items[0]!.bbox2d).toBeNull(); // projected metres rejected
    expect(items[0]!.lods).toEqual([]);
  });

  it("throws a friendly error when the collection has no parquet", async () => {
    await expect(
      fetchCollectionItems({ ...card, itemsParquetHref: null }),
    ).rejects.toThrow(/no item index/i);
  });

  it("throws when the parquet fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );
    await expect(fetchCollectionItems(card)).rejects.toThrow(/item index/i);
  });

  it("throws when duckdb can't read it (returns null)", async () => {
    stubParquetFetch();
    vi.mocked(queryParquetBuffer).mockResolvedValue(null);
    await expect(fetchCollectionItems(card)).rejects.toThrow(/item index/i);
    expect(initDuckDB).toHaveBeenCalled();
  });

  it("probes the schema first and omits columns the probe did not report", async () => {
    stubParquetFetch();
    vi.mocked(queryParquetBuffer)
      .mockResolvedValueOnce({
        columns: ["column_name"],
        rows: [
          { column_name: "id" },
          { column_name: "bbox" },
          { column_name: "assets" },
        ],
      })
      .mockResolvedValueOnce({ columns: [], rows: [] });

    await fetchCollectionItems(card);

    const calls = vi.mocked(queryParquetBuffer).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![2]).toMatch(/^DESCRIBE\b/);
    const itemsSql = calls[1]![2];
    expect(itemsSql).toContain("NULL AS lods");
    expect(itemsSql).toContain("NULL AS co_types");
    expect(itemsSql).toContain("NULL AS city_objects");
    expect(itemsSql).toContain("NULL AS proj_code");
    // …while the columns the probe DID report are projected for real.
    expect(itemsSql).toContain("t.bbox['xmin']");
    // The registered file name is derived from the id, never the raw id.
    expect(calls[0]![0]).toBe(calls[1]![0]);
    expect(calls[0]![0]).toMatch(/^stac-items-[\w-]+\.parquet$/);
  });

  it("sanitizes a hostile collection id out of the SQL", async () => {
    stubParquetFetch();
    vi.mocked(queryParquetBuffer).mockResolvedValue({ columns: [], rows: [] });

    await fetchCollectionItems({ ...card, id: "a'; DROP TABLE x --" });

    const calls = vi.mocked(queryParquetBuffer).mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[0]).toMatch(/^stac-items-[A-Za-z0-9_-]+\.parquet$/);
      // The name reaches the SQL, so nothing quote-shaped may survive in it.
      expect(call[2]).toContain(`read_parquet('${call[0]}')`);
      expect(call[2]).not.toContain("DROP TABLE");
    }
  });
});

describe("buildItemsSql", () => {
  it("projects struct fields and lists as scalars when every column exists", () => {
    const sql = buildItemsSql(
      "f.parquet",
      new Set([
        "id",
        "bbox",
        "assets",
        "city3d:lods",
        "city3d:co_types",
        "city3d:city_objects",
        "proj:code",
      ]),
    );
    expect(sql).toContain("t.assets['data']['href']");
    expect(sql).toContain("array_to_string");
    expect(sql).toContain("read_parquet('f.parquet')");
    expect(sql).not.toContain("NULL AS");
  });
});
