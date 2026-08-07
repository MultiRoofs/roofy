import { describe, expect, it } from "vitest";
import {
  classifyCityParquetUrl,
  isCityParquetUrl,
  UnlistableUrlError,
} from "../../../../src/features/cityparquet/sourceClassify";

describe("classifyCityParquetUrl", () => {
  it("classifies gs:// forms", () => {
    expect(
      classifyCityParquetUrl("gs://cityparquet/3dbag_tiled/*/building.parquet"),
    ).toEqual({
      kind: "storage-glob",
      store: { provider: "gcs", bucket: "cityparquet" },
      pattern: "3dbag_tiled/*/building.parquet",
    });
    expect(classifyCityParquetUrl("gs://b/delft/building.parquet")).toEqual({
      kind: "storage-table",
      store: { provider: "gcs", bucket: "b" },
      objectName: "delft/building.parquet",
    });
    expect(classifyCityParquetUrl("gs://b/delft/")).toEqual({
      kind: "storage-dir",
      store: { provider: "gcs", bucket: "b" },
      prefix: "delft/",
    });
    expect(classifyCityParquetUrl("gs://b/delft/metadata.json")).toEqual({
      kind: "storage-dir",
      store: { provider: "gcs", bucket: "b" },
      prefix: "delft/",
    });
  });
  it("classifies s3:// and the https GCS spelling", () => {
    expect(classifyCityParquetUrl("s3://bkt/x/*.parquet")!.kind).toBe(
      "storage-glob",
    );
    expect(
      classifyCityParquetUrl(
        "https://storage.googleapis.com/bkt/tiles/*/building.parquet",
      ),
    ).toEqual({
      kind: "storage-glob",
      store: { provider: "gcs", bucket: "bkt" },
      pattern: "tiles/*/building.parquet",
    });
  });
  it("applies the same bucket rules to s3:// and to a bucket root", () => {
    expect(classifyCityParquetUrl("s3://bkt/delft/building.parquet")).toEqual({
      kind: "storage-table",
      store: { provider: "s3", bucket: "bkt" },
      objectName: "delft/building.parquet",
    });
    expect(classifyCityParquetUrl("s3://bkt/delft")).toEqual({
      kind: "storage-dir",
      store: { provider: "s3", bucket: "bkt" },
      prefix: "delft/",
    });
    expect(classifyCityParquetUrl("gs://bkt")).toEqual({
      kind: "storage-dir",
      store: { provider: "gcs", bucket: "bkt" },
      prefix: "",
    });
  });
  it("rejects malformed and non-http schemes", () => {
    expect(classifyCityParquetUrl("ftp://host/x.parquet")).toBeNull();
    expect(classifyCityParquetUrl("./local/building.parquet")).toBeNull();
    expect(classifyCityParquetUrl("gs://")).toBeNull();
    expect(
      classifyCityParquetUrl("https://storage.googleapis.com/bkt/model.json"),
    ).toBeNull();
  });
  it("classifies plain https", () => {
    expect(classifyCityParquetUrl("https://x.org/d/building.parquet")).toEqual({
      kind: "table",
      url: "https://x.org/d/building.parquet",
    });
    expect(classifyCityParquetUrl("https://x.org/pkg/")).toEqual({
      kind: "package-dir",
      baseUrl: "https://x.org/pkg/",
    });
    expect(classifyCityParquetUrl("https://x.org/pkg/metadata.json")).toEqual({
      kind: "package-dir",
      baseUrl: "https://x.org/pkg/",
    });
    expect(classifyCityParquetUrl("https://x.org/model.city.json")).toBeNull();
    expect(
      classifyCityParquetUrl("https://x.org/file.parquet?sig=a?b"),
    ).toEqual({ kind: "table", url: "https://x.org/file.parquet?sig=a?b" });
  });
  it("throws on unlistable https wildcards, while the predicate stays total and true", () => {
    expect(() =>
      classifyCityParquetUrl("https://x.org/tiles/*/building.parquet"),
    ).toThrow(UnlistableUrlError);
    expect(isCityParquetUrl("https://x.org/tiles/*/building.parquet")).toBe(
      true,
    ); // enters the arm; the load surfaces the message
    expect(isCityParquetUrl("https://x.org/model.city.json")).toBe(false);
  });
});
