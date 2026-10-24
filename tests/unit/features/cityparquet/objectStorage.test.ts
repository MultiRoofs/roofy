import { describe, expect, it } from "vitest";
import {
  globToRegExp,
  globLiteralPrefix,
  listStorageEntries,
  listStorageObjects,
  storageObjectUrl,
  MAX_CITYPARQUET_FILES,
} from "../../../../src/features/cityparquet/objectStorage";
import type { HttpClient } from "../../../../src/platform/types";

describe("globToRegExp", () => {
  it("* stays inside a path segment, ** crosses", () => {
    const r = globToRegExp("tiles/*/building.parquet");
    expect(r.test("tiles/10-640-324/building.parquet")).toBe(true);
    expect(r.test("tiles/a/b/building.parquet")).toBe(false);
    expect(
      globToRegExp("tiles/**/building.parquet").test(
        "tiles/a/b/building.parquet",
      ),
    ).toBe(true);
    expect(globToRegExp("a.parquet").test("aXparquet")).toBe(false); // dot escaped
  });
  it("extracts the literal prefix", () => {
    expect(globLiteralPrefix("tiles/*/building.parquet")).toBe("tiles/");
    expect(globLiteralPrefix("no-wildcard/building.parquet")).toBe(
      "no-wildcard/building.parquet",
    );
  });
});

function fakeHttp(pages: Record<string, unknown>): HttpClient {
  return {
    async fetchText(url: string) {
      for (const [match, body] of Object.entries(pages))
        if (url.includes(match))
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: typeof body === "string" ? body : JSON.stringify(body),
          };
      return { ok: false, status: 404, statusText: "Not Found", text: "" };
    },
    async fetchBytes() {
      throw new Error("unused");
    },
  };
}

describe("listStorageObjects", () => {
  it("paginates the GCS JSON API", async () => {
    const http = fakeHttp({
      "pageToken=tok2": { items: [{ name: "t/2/building.parquet" }] },
      "storage/v1/b/bkt/o": {
        items: [{ name: "t/1/building.parquet" }],
        nextPageToken: "tok2",
      },
    });
    const names = await listStorageObjects(
      { provider: "gcs", bucket: "bkt" },
      "t/",
      http,
    );
    expect(names).toEqual(["t/1/building.parquet", "t/2/building.parquet"]);
  });
  it("parses S3 ListObjectsV2 XML with continuation", async () => {
    const http = fakeHttp({
      "continuation-token=abc":
        "<ListBucketResult><Contents><Key>t/2.parquet</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>",
      "list-type=2":
        "<ListBucketResult><Contents><Key>t/1.parquet</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>abc</NextContinuationToken></ListBucketResult>",
    });
    const names = await listStorageObjects(
      { provider: "s3", bucket: "bkt" },
      "t/",
      http,
    );
    expect(names).toEqual(["t/1.parquet", "t/2.parquet"]);
  });
  it("builds encoded object urls", () => {
    expect(
      storageObjectUrl({ provider: "gcs", bucket: "b" }, "a b/c.parquet"),
    ).toBe("https://storage.googleapis.com/b/a%20b/c.parquet");
  });
  it("builds encoded object urls for s3", () => {
    expect(
      storageObjectUrl({ provider: "s3", bucket: "b" }, "a b/c.parquet"),
    ).toBe("https://b.s3.amazonaws.com/a%20b/c.parquet");
  });
  it("errors naming the bucket and the http status", async () => {
    const http = fakeHttp({});
    await expect(
      listStorageObjects({ provider: "gcs", bucket: "missing" }, "t/", http),
    ).rejects.toThrow(/missing/);
    await expect(
      listStorageObjects({ provider: "gcs", bucket: "missing" }, "t/", http),
    ).rejects.toThrow(/404/);
  });
  it("unescapes XML entities in S3 keys", async () => {
    const http = fakeHttp({
      "list-type=2":
        "<ListBucketResult><Contents><Key>a&amp;b/c &lt;1&gt;.parquet</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>",
    });
    const names = await listStorageObjects(
      { provider: "s3", bucket: "bkt" },
      "",
      http,
    );
    expect(names).toEqual(["a&b/c <1>.parquet"]);
  });
  it("caps the file budget at a documented constant", () => {
    expect(MAX_CITYPARQUET_FILES).toBe(64);
  });
});

describe("listStorageEntries", () => {
  it("pairs each GCS object with its size (sent as a string), and asks for it", async () => {
    const urls: string[] = [];
    const base = fakeHttp({
      "storage/v1/b/bkt/o": {
        items: [
          { name: "t/1/building.parquet", size: "351272960" },
          { name: "t/2/building.parquet" },
          { name: "t/3/building.parquet", size: "nope" },
        ],
      },
    });
    const http: HttpClient = {
      ...base,
      fetchText: (url) => {
        urls.push(url);
        return base.fetchText(url);
      },
    };
    const entries = await listStorageEntries(
      { provider: "gcs", bucket: "bkt" },
      "t/",
      http,
    );
    expect(entries).toEqual([
      { name: "t/1/building.parquet", size: 351272960 },
      { name: "t/2/building.parquet", size: null },
      { name: "t/3/building.parquet", size: null },
    ]);
    expect(decodeURIComponent(urls[0]!)).toContain("items/size");
  });

  it("pairs each S3 key with its <Size>", async () => {
    const http = fakeHttp({
      "list-type=2":
        "<ListBucketResult><Contents><Key>t/1.parquet</Key><Size>610</Size></Contents><Contents><Key>t/2.parquet</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>",
    });
    const entries = await listStorageEntries(
      { provider: "s3", bucket: "bkt" },
      "t/",
      http,
    );
    expect(entries).toEqual([
      { name: "t/1.parquet", size: 610 },
      { name: "t/2.parquet", size: null },
    ]);
  });
});
