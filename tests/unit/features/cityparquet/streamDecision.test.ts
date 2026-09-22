/**
 * The static-or-stream decision for a CityParquet source.
 *
 * Every size comes from an injected seam — the `HttpClient` (manifest and
 * bucket listings), `headLength`, `footerSize` — so these tests pin the
 * DECISION: which figure is trusted first, what a gap falls back to, and that
 * "no size at all" stays on today's static path.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CITYPARQUET_STREAM_THRESHOLD_BYTES,
  decideCityParquetMode,
} from "../../../../src/features/cityparquet/streamDecision";
import type { HttpClient } from "../../../../src/platform/types";

const MB = 1024 * 1024;

/** A client that serves one manifest for any metadata.json and fails
 *  everything else. */
function manifestHttp(assets: Record<string, unknown>): HttpClient {
  return {
    fetchText: vi.fn(async (url: string) =>
      url.endsWith("metadata.json")
        ? {
            ok: true,
            status: 200,
            statusText: "OK",
            text: JSON.stringify({ type: "Feature", assets }),
          }
        : { ok: false, status: 404, statusText: "Not Found", text: "" },
    ),
    fetchBytes: vi.fn(async () => {
      throw new Error("the decision never reads a table");
    }),
  };
}

const noHttp: HttpClient = {
  fetchText: async () => {
    throw new Error("unused");
  },
  fetchBytes: async () => {
    throw new Error("unused");
  },
};

/** A local file that CLAIMS a size, without allocating it. */
function sizedFile(name: string, size: number, relativePath?: string): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  if (relativePath !== undefined) {
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  }
  return file;
}

describe("decideCityParquetMode — urls", () => {
  it("the threshold is 128 MiB", () => {
    expect(CITYPARQUET_STREAM_THRESHOLD_BYTES).toBe(128 * 1024 * 1024);
  });

  it("streams a lone table whose HEAD says 335 MB, as {url}", async () => {
    const url = "https://x.test/yokohama-shi/building.parquet";
    const headLength = vi.fn(async () => 335 * MB);
    const mode = await decideCityParquetMode({
      kind: "url",
      url,
      http: noHttp,
      headLength,
    });
    expect(headLength).toHaveBeenCalledWith(url);
    expect(mode).toEqual({
      mode: "stream",
      source: { url },
      totalBytes: 335 * MB,
    });
  });

  it("keeps an 83 MB table static", async () => {
    const mode = await decideCityParquetMode({
      kind: "url",
      url: "https://x.test/delft/building.parquet",
      http: noHttp,
      headLength: async () => 83 * MB,
    });
    expect(mode).toEqual({ mode: "static" });
  });

  it("streams a package whose manifest sizes sum to 610 MB, object tables only", async () => {
    const http = manifestHttp({
      a: {
        href: "./a/building.parquet",
        roles: ["cityparquet-objects"],
        "file:size": 300 * MB,
      },
      b: {
        href: "./b/building.parquet",
        roles: ["cityparquet-objects"],
        "file:size": 310 * MB,
      },
      t: {
        href: "./textures.parquet",
        roles: ["cityparquet-sidecar"],
        "file:size": 900 * MB,
      },
    });
    const headLength = vi.fn(async () => null);
    const mode = await decideCityParquetMode({
      kind: "url",
      url: "https://x.test/yokohama-shi/",
      http,
      headLength,
    });
    expect(mode).toEqual({
      mode: "stream",
      source: {
        urls: [
          "https://x.test/yokohama-shi/a/building.parquet",
          "https://x.test/yokohama-shi/b/building.parquet",
        ],
      },
      totalBytes: 610 * MB,
    });
    // The manifest answered; nothing was asked of the server.
    expect(headLength).not.toHaveBeenCalled();
  });

  it("fills a manifest's missing size with a HEAD per table", async () => {
    const http = manifestHttp({
      a: {
        href: "./a/building.parquet",
        roles: ["cityparquet-objects"],
        "file:size": 100 * MB,
      },
      b: { href: "./b/building.parquet", roles: ["cityparquet-objects"] },
    });
    const headLength = vi.fn(async () => 50 * MB);
    const mode = await decideCityParquetMode({
      kind: "url",
      url: "https://x.test/pkg/",
      http,
      headLength,
    });
    expect(headLength).toHaveBeenCalledTimes(1);
    expect(headLength).toHaveBeenCalledWith(
      "https://x.test/pkg/b/building.parquet",
    );
    expect(mode).toMatchObject({ mode: "stream", totalBytes: 150 * MB });
  });

  it("reads the footer when there is no HEAD length, and streams on it", async () => {
    const url = "https://x.test/big/building.parquet";
    const footerSize = vi.fn(async () => 400 * MB);
    const mode = await decideCityParquetMode({
      kind: "url",
      url,
      http: noHttp,
      headLength: async () => null,
      footerSize,
    });
    expect(footerSize).toHaveBeenCalledWith(url);
    expect(mode).toEqual({
      mode: "stream",
      source: { url },
      totalBytes: 400 * MB,
    });
  });

  it("stays static when no size can be learned at all (no HEAD, no ranges)", async () => {
    const mode = await decideCityParquetMode({
      kind: "url",
      url: "https://x.test/unknown/building.parquet",
      http: noHttp,
      headLength: async () => {
        throw new TypeError("Failed to fetch");
      },
      footerSize: async () => {
        throw new Error("Range not supported");
      },
    });
    expect(mode).toEqual({ mode: "static" });
  });

  it("stays static when the source cannot even be resolved (the load then says why)", async () => {
    const headLength = vi.fn(async () => 999 * MB);
    // The manifest 404s.
    expect(
      await decideCityParquetMode({
        kind: "url",
        url: "https://x.test/missing/",
        http: manifestHttp({}),
        headLength,
      }),
    ).toEqual({ mode: "static" });
    // An unlistable https wildcard.
    expect(
      await decideCityParquetMode({
        kind: "url",
        url: "https://x.test/tiles/*/building.parquet",
        http: noHttp,
        headLength,
      }),
    ).toEqual({ mode: "static" });
    expect(headLength).not.toHaveBeenCalled();
  });

  it("sizes a bucket glob from the listing", async () => {
    const http: HttpClient = {
      fetchText: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: JSON.stringify({
          items: [
            { name: "t/a/building.parquet", size: String(90 * MB) },
            { name: "t/b/building.parquet", size: String(90 * MB) },
          ],
        }),
      }),
      fetchBytes: async () => {
        throw new Error("unused");
      },
    };
    const mode = await decideCityParquetMode({
      kind: "url",
      url: "gs://bkt/t/*/building.parquet",
      http,
      headLength: async () => null,
    });
    expect(mode).toEqual({
      mode: "stream",
      source: {
        urls: [
          "https://storage.googleapis.com/bkt/t/a/building.parquet",
          "https://storage.googleapis.com/bkt/t/b/building.parquet",
        ],
      },
      totalBytes: 180 * MB,
    });
  });
});

describe("decideCityParquetMode — local files", () => {
  it("streams a 200 MB picked folder as {blobs}, sidecars excluded", async () => {
    const a = sizedFile("building.parquet", 120 * MB, "pkg/a/building.parquet");
    const b = sizedFile("building.parquet", 80 * MB, "pkg/b/building.parquet");
    const textures = sizedFile(
      "textures.parquet",
      500 * MB,
      "pkg/textures.parquet",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mode = await decideCityParquetMode({
      kind: "files",
      files: [a, b, textures],
    });
    warn.mockRestore();
    expect(mode).toEqual({
      mode: "stream",
      source: { blobs: [a, b] },
      totalBytes: 200 * MB,
    });
  });

  it("streams one large dropped table as {blob}", async () => {
    const file = sizedFile("yokohama.parquet", 335 * MB);
    expect(
      await decideCityParquetMode({ kind: "files", files: [file] }),
    ).toEqual({ mode: "stream", source: { blob: file }, totalBytes: 335 * MB });
  });

  it("keeps a small selection static", async () => {
    const file = sizedFile("delft.parquet", 83 * MB);
    expect(
      await decideCityParquetMode({ kind: "files", files: [file] }),
    ).toEqual({ mode: "static" });
  });

  it("keeps a selection it cannot resolve static (the load then says why)", async () => {
    const readme = sizedFile("readme.txt", 999 * MB);
    expect(
      await decideCityParquetMode({ kind: "files", files: [readme] }),
    ).toEqual({ mode: "static" });
  });
});
