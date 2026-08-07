/**
 * Fetch orchestration for CityParquet sources.
 *
 * The fixture is the real two-building package from the parser package, read
 * off disk and served by a fake `HttpClient`: the point of these tests is the
 * ORCHESTRATION (which URLs are fetched, which names are kept, what a failure
 * reads like), and using genuine bytes means a wrong file selection surfaces as
 * a parse failure rather than as a green test over a stub.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  cityParquetLayerNameFromUrl,
  loadCityParquetFromFiles,
  loadCityParquetFromUrl,
} from "../../../../src/features/cityparquet/loadCityParquet";
import { MAX_CITYPARQUET_FILES } from "../../../../src/features/cityparquet/objectStorage";
import type { HttpClient } from "../../../../src/platform/types";

const FIX =
  "/data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/two-buildings-cityparquet";

function notFoundText() {
  return { ok: false, status: 404, statusText: "Not Found", text: "" };
}

function notFoundBytes() {
  return {
    ok: false,
    status: 404,
    statusText: "Not Found",
    bytes: new Uint8Array(),
  };
}

/** A client serving the fixture package at any path ending in its file names. */
async function packageHttp(): Promise<HttpClient> {
  const parquet = await readFile(`${FIX}/building.parquet`);
  const meta = await readFile(`${FIX}/metadata.json`, "utf8");
  return {
    async fetchText(url) {
      if (url.endsWith("metadata.json"))
        return { ok: true, status: 200, statusText: "OK", text: meta };
      return notFoundText();
    },
    async fetchBytes(url) {
      if (url.endsWith("building.parquet"))
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          bytes: new Uint8Array(parquet),
        };
      return notFoundBytes();
    },
  };
}

/** A GCS listing client over a fixed set of object names. */
async function bucketHttp(
  names: readonly string[],
  options: { readonly withManifest?: boolean } = {},
): Promise<{ http: HttpClient; fetched: string[] }> {
  const parquet = await readFile(`${FIX}/building.parquet`);
  const meta = await readFile(`${FIX}/metadata.json`, "utf8");
  const fetched: string[] = [];
  const http: HttpClient = {
    async fetchText(url) {
      if (url.includes("/storage/v1/b/")) {
        const prefix = decodeURIComponent(
          /[?&]prefix=([^&]*)/.exec(url)?.[1] ?? "",
        );
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: JSON.stringify({
            items: names
              .filter((n) => n.startsWith(prefix))
              .map((name) => ({ name })),
          }),
        };
      }
      if (options.withManifest === true && url.endsWith("metadata.json")) {
        return { ok: true, status: 200, statusText: "OK", text: meta };
      }
      return notFoundText();
    },
    async fetchBytes(url) {
      fetched.push(url);
      if (url.endsWith(".parquet"))
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          bytes: new Uint8Array(parquet),
        };
      return notFoundBytes();
    },
  };
  return { http, fetched };
}

describe("loadCityParquetFromUrl", () => {
  it("loads a single table url", async () => {
    const model = await loadCityParquetFromUrl(
      "https://x.org/p/building.parquet",
      await packageHttp(),
    );
    expect(Object.keys(model.objects).length).toBe(3);
    expect(model.sourceEncoding).toBe("cityparquet");
  });

  it("loads a package directory via metadata.json", async () => {
    const model = await loadCityParquetFromUrl(
      "https://x.org/p/",
      await packageHttp(),
    );
    expect(Object.keys(model.objects).length).toBe(3);
  });

  it("surfaces a friendly 404", async () => {
    await expect(
      loadCityParquetFromUrl("https://x.org/missing.parquet", {
        async fetchText() {
          return notFoundText();
        },
        async fetchBytes() {
          return notFoundBytes();
        },
      }),
    ).rejects.toThrow(/404|not found/i);
  });

  it("hints at CORS when the fetch never returns a response", async () => {
    await expect(
      loadCityParquetFromUrl("https://x.org/t.parquet", {
        async fetchText() {
          return notFoundText();
        },
        async fetchBytes() {
          throw new TypeError("Failed to fetch");
        },
      }),
    ).rejects.toThrow(/CORS/i);
  });

  it("rejects a url that is not a CityParquet source", async () => {
    await expect(
      loadCityParquetFromUrl("https://x.org/model.city.json"),
    ).rejects.toThrow(/CityParquet/i);
  });

  // `detectEncoding` strips one ".gz" and calls this cityparquet, so the loader
  // must at least TRY it — the reader's "not a Parquet file" is the honest
  // report, and a "never was CityParquet" here would contradict the router.
  it("fetches a .parquet.gz and fails in the reader, not the classifier", async () => {
    await expect(
      loadCityParquetFromUrl("https://x.org/p/building.parquet.gz", {
        async fetchText() {
          return notFoundText();
        },
        async fetchBytes() {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            bytes: new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
          };
        },
      }),
    ).rejects.toThrow(/Parquet/i);
  });

  it("explains an unlistable https wildcard", async () => {
    await expect(
      loadCityParquetFromUrl("https://x.org/tiles/*/building.parquet"),
    ).rejects.toThrow(/gs:\/\//);
  });

  it("loads one object out of a bucket (storage-table)", async () => {
    const { http, fetched } = await bucketHttp([]);
    const model = await loadCityParquetFromUrl(
      "gs://bkt/delft/building.parquet",
      http,
    );
    expect(Object.keys(model.objects).length).toBe(3);
    expect(fetched).toEqual([
      "https://storage.googleapis.com/bkt/delft/building.parquet",
    ]);
  });

  it("lists a bucket prefix and takes its .parquet tables (storage-dir)", async () => {
    const { http, fetched } = await bucketHttp([
      "delft/", // zero-byte directory placeholder
      "delft/building.parquet",
      "delft/notes.txt",
      "delft/sub/other.parquet", // deeper than the prefix
    ]);
    const model = await loadCityParquetFromUrl("gs://bkt/delft/", http);
    expect(Object.keys(model.objects).length).toBe(3);
    expect(fetched).toEqual([
      "https://storage.googleapis.com/bkt/delft/building.parquet",
    ]);
  });

  it("prefers a listed metadata.json over the listing (storage-dir)", async () => {
    const { http, fetched } = await bucketHttp(
      ["delft/metadata.json", "delft/building.parquet", "delft/stray.parquet"],
      { withManifest: true },
    );
    const model = await loadCityParquetFromUrl("gs://bkt/delft/", http);
    expect(Object.keys(model.objects).length).toBe(3);
    // The manifest declares one table; "stray.parquet" is NOT loaded.
    expect(fetched).toEqual([
      "https://storage.googleapis.com/bkt/delft/building.parquet",
    ]);
  });

  it("drops sidecar tables, with a warning (storage-dir)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { http, fetched } = await bucketHttp([
      "delft/building.parquet",
      "delft/materials.parquet",
      "delft/textures.parquet",
    ]);
    await loadCityParquetFromUrl("gs://bkt/delft/", http);
    expect(fetched).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2"));
    warn.mockRestore();
  });

  it("errors when a prefix holds no object tables", async () => {
    const { http } = await bucketHttp(["delft/notes.txt"]);
    await expect(
      loadCityParquetFromUrl("gs://bkt/delft/", http),
    ).rejects.toThrow(/No \.parquet object tables found/i);
  });

  it("expands a wildcard across a bucket (storage-glob)", async () => {
    const { http, fetched } = await bucketHttp([
      "tiles/a/building.parquet",
      "tiles/b/building.parquet",
      "tiles/b/materials.parquet",
      "tiles/b/notes.txt",
      "other/c/building.parquet",
    ]);
    const model = await loadCityParquetFromUrl(
      "gs://bkt/tiles/*/building.parquet",
      http,
    );
    expect(Object.keys(model.objects).length).toBe(3);
    expect(fetched).toEqual([
      "https://storage.googleapis.com/bkt/tiles/a/building.parquet",
      "https://storage.googleapis.com/bkt/tiles/b/building.parquet",
    ]);
  });

  it("errors when a wildcard matches nothing", async () => {
    const { http } = await bucketHttp(["tiles/a/notes.txt"]);
    await expect(
      loadCityParquetFromUrl("gs://bkt/tiles/*/building.parquet", http),
    ).rejects.toThrow(/matched no \.parquet|No \.parquet/i);
  });

  it("refuses a wildcard over the file cap", async () => {
    const names = Array.from(
      { length: MAX_CITYPARQUET_FILES + 1 },
      (_, i) => `tiles/${String(i)}/building.parquet`,
    );
    const { http } = await bucketHttp(names);
    await expect(
      loadCityParquetFromUrl("gs://bkt/tiles/*/building.parquet", http),
    ).rejects.toThrow(
      `The wildcard matches ${String(MAX_CITYPARQUET_FILES + 1)} files; the viewer loads at most ${String(MAX_CITYPARQUET_FILES)} at once — narrow the pattern.`,
    );
  });

  it("fails the whole load when one file of a set is missing", async () => {
    const parquet = await readFile(`${FIX}/building.parquet`);
    const http: HttpClient = {
      async fetchText(url) {
        if (url.includes("/storage/v1/b/"))
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: JSON.stringify({
              items: [
                { name: "tiles/a/building.parquet" },
                { name: "tiles/b/building.parquet" },
              ],
            }),
          };
        return notFoundText();
      },
      async fetchBytes(url) {
        if (url.endsWith("a/building.parquet"))
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            bytes: new Uint8Array(parquet),
          };
        return notFoundBytes();
      },
    };
    await expect(
      loadCityParquetFromUrl("gs://bkt/tiles/*/building.parquet", http),
    ).rejects.toThrow(/404/);
  });

  // `Promise.all` rejects on the first failure but stops nothing: without the
  // pool's shared failed-flag the other workers keep draining the cursor and
  // issue every remaining request of a load that has already failed.
  it("stops fetching after the first failure", async () => {
    const parquet = await readFile(`${FIX}/building.parquet`);
    const names = Array.from(
      { length: 40 },
      (_, i) => `tiles/${String(i).padStart(2, "0")}/building.parquet`,
    );
    const fetched: string[] = [];
    const http: HttpClient = {
      async fetchText(url) {
        if (url.includes("/storage/v1/b/"))
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: JSON.stringify({ items: names.map((name) => ({ name })) }),
          };
        return notFoundText();
      },
      async fetchBytes(url) {
        fetched.push(url);
        // A real macrotask of latency, so the pool's later waves have room to
        // run after the rejection if nothing stops them — counting
        // synchronously would pass either way.
        await new Promise((resolve) => setTimeout(resolve, 1));
        // ONLY the first tile fails: every other worker succeeds and would
        // happily drain the remaining 34 targets on its own.
        if (url.endsWith("tiles/00/building.parquet")) return notFoundBytes();
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          bytes: new Uint8Array(parquet),
        };
      },
    };
    await expect(
      loadCityParquetFromUrl("gs://bkt/tiles/*/building.parquet", http),
    ).rejects.toThrow(/404/);
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Only the requests already in flight when the first failed: the six the
    // pool opens at once, never all 40.
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.length).toBeLessThanOrEqual(6);
  });
});

/**
 * A `File` as a folder picker hands it over: `webkitRelativePath` carries the
 * path INSIDE the chosen folder, and the constructor cannot set it.
 */
function pickedFile(content: BlobPart, relativePath: string): File {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  const file = new File([content], name);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

/** A manifest for a two-tile package, both tables in subfolders. */
function tiledManifest(): string {
  return JSON.stringify({
    type: "Feature",
    stac_version: "1.1.0",
    id: "tiled",
    assets: {
      a: {
        href: "./a/building.parquet",
        type: "application/vnd.apache.parquet",
        roles: ["data", "cityparquet-objects"],
      },
      b: {
        href: "./b/building.parquet",
        type: "application/vnd.apache.parquet",
        roles: ["data", "cityparquet-objects"],
      },
    },
  });
}

describe("loadCityParquetFromFiles", () => {
  it("assembles a picked folder", async () => {
    const parquet = await readFile(`${FIX}/building.parquet`);
    const meta = await readFile(`${FIX}/metadata.json`);
    const files = [
      new File([parquet], "building.parquet"),
      new File([meta], "metadata.json"),
    ];
    const model = await loadCityParquetFromFiles(files);
    expect(Object.keys(model.objects).length).toBe(3);
  });

  it("takes every .parquet when the folder has no manifest", async () => {
    const parquet = await readFile(`${FIX}/building.parquet`);
    const model = await loadCityParquetFromFiles([
      new File([parquet], "building.parquet"),
      new File([new Uint8Array()], "materials.parquet"),
      new File(["x"], "readme.txt"),
    ]);
    expect(Object.keys(model.objects).length).toBe(3);
  });

  it("resolves manifest hrefs inside the picked folder", async () => {
    const parquet = await readFile(`${FIX}/building.parquet`);
    const meta = await readFile(`${FIX}/metadata.json`);
    // A folder picker prefixes every path with the folder the user chose; the
    // manifest's "building.parquet" must still resolve through it.
    const model = await loadCityParquetFromFiles([
      pickedFile(parquet, "delft/building.parquet"),
      pickedFile(meta, "delft/metadata.json"),
    ]);
    expect(Object.keys(model.objects).length).toBe(3);
  });

  it("loads a nested (tiled) package by path, not by base name", async () => {
    const parquet = await readFile(`${FIX}/building.parquet`);
    const model = await loadCityParquetFromFiles([
      pickedFile(parquet, "tiled/a/building.parquet"),
      pickedFile(parquet, "tiled/b/building.parquet"),
      pickedFile(tiledManifest(), "tiled/metadata.json"),
    ]);
    expect(Object.keys(model.objects).length).toBe(3);
  });

  // The sharp end of the same bug: keying by base name kept only the LAST
  // "building.parquet" and read it twice, so a broken first tile loaded
  // silently and the model was built from the wrong data.
  it("reads every tile, so a broken one is not skipped", async () => {
    const parquet = await readFile(`${FIX}/building.parquet`);
    await expect(
      loadCityParquetFromFiles([
        pickedFile(new Uint8Array([1, 2, 3, 4]), "tiled/a/building.parquet"),
        pickedFile(parquet, "tiled/b/building.parquet"),
        pickedFile(tiledManifest(), "tiled/metadata.json"),
      ]),
    ).rejects.toThrow(/Parquet/i);
  });

  it("refuses a selection with two files at the same path", async () => {
    await expect(
      loadCityParquetFromFiles([
        new File(["a"], "building.parquet"),
        new File(["b"], "building.parquet"),
      ]),
    ).rejects.toThrow(/two files/i);
  });

  it("rejects a folder with no tables", async () => {
    await expect(
      loadCityParquetFromFiles([new File(["x"], "readme.txt")]),
    ).rejects.toThrow(/no CityParquet object tables/i);
  });

  it("names the file a manifest declares but the folder lacks", async () => {
    const meta = await readFile(`${FIX}/metadata.json`);
    await expect(
      loadCityParquetFromFiles([new File([meta], "metadata.json")]),
    ).rejects.toThrow(/building\.parquet/);
  });
});

describe("cityParquetLayerNameFromUrl", () => {
  it("names layers sensibly", () => {
    expect(
      cityParquetLayerNameFromUrl("https://x.org/delft/building.parquet"),
    ).toBe("building");
    expect(cityParquetLayerNameFromUrl("https://x.org/delft/")).toBe("delft");
    expect(
      cityParquetLayerNameFromUrl(
        "gs://cityparquet/3dbag_tiled/*/building.parquet",
      ),
    ).toBe("3dbag_tiled");
  });

  it("falls back to the bucket when a source names no folder", () => {
    expect(cityParquetLayerNameFromUrl("gs://cityparquet/")).toBe(
      "cityparquet",
    );
    expect(cityParquetLayerNameFromUrl("gs://cityparquet/*.parquet")).toBe(
      "cityparquet",
    );
  });

  it("survives a url it cannot classify", () => {
    expect(cityParquetLayerNameFromUrl("not a url")).toBe("not a url");
  });
});
