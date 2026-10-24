/**
 * The CRS a streamed family's FILE declares (ruling R-G / S2).
 *
 * The stream's own header cannot answer this: `streamReader` publishes the
 * PROJECTED target CRS (`target.epsg`, a UTM zone for PLATEAU), while the
 * family view's `bbox` columns are the file's own — degrees for EPSG:6697. So
 * the footer is read, once per source, and the answer is what the metric-bounds
 * refusal is written against.
 *
 * The reader package is mocked at its two exported seams: this suite is about
 * caching and about what a failure means, not about hyparquet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncBufferFromHttp = vi.fn(async (url: string) => ({ url }));
const asyncBufferFromBlob = vi.fn((blob: Blob) => ({ blob }));
const readCityParquetSchema = vi.fn(
  async (_buffer: unknown) => ({ footer: { epsg: 6697 } }) as unknown,
);

vi.mock("@cityjson/navara-cityparquet", () => ({
  asyncBufferFromHttp: (url: string) => asyncBufferFromHttp(url),
  asyncBufferFromBlob: (blob: Blob) => asyncBufferFromBlob(blob),
  readCityParquetSchema: (buffer: unknown) => readCityParquetSchema(buffer),
}));

import {
  familySourceCrs,
  resetFamilySourceCrsForTest,
} from "../../../../src/features/cityparquet/familySourceCrs";

beforeEach(() => {
  resetFamilySourceCrsForTest();
  asyncBufferFromHttp.mockClear();
  asyncBufferFromBlob.mockClear();
  readCityParquetSchema.mockClear();
  readCityParquetSchema.mockResolvedValue({ footer: { epsg: 6697 } });
});

describe("familySourceCrs", () => {
  it("reads a URL family's own EPSG code from its footer", async () => {
    await expect(
      familySourceCrs({ url: "https://x/building.parquet" }),
    ).resolves.toBe("EPSG:6697");
    expect(asyncBufferFromHttp).toHaveBeenCalledWith(
      "https://x/building.parquet",
    );
  });

  it("reads a picked File's footer through a blob buffer", async () => {
    readCityParquetSchema.mockResolvedValue({ footer: { epsg: 7415 } });
    const file = new File([new Uint8Array([1])], "building.parquet");
    await expect(familySourceCrs({ file })).resolves.toBe("EPSG:7415");
    expect(asyncBufferFromBlob).toHaveBeenCalledWith(file);
    expect(asyncBufferFromHttp).not.toHaveBeenCalled();
  });

  it("reads one source's footer once, however many families ask", async () => {
    const url = "https://x/building.parquet";
    const [a, b] = await Promise.all([
      familySourceCrs({ url }),
      familySourceCrs({ url }),
    ]);
    expect([a, b]).toEqual(["EPSG:6697", "EPSG:6697"]);
    await expect(familySourceCrs({ url })).resolves.toBe("EPSG:6697");
    expect(readCityParquetSchema).toHaveBeenCalledTimes(1);
  });

  it("answers null — a claim about nothing — when the footer cannot be read", async () => {
    readCityParquetSchema.mockRejectedValue(new Error("no ranges"));
    await expect(familySourceCrs({ url: "https://x/a.parquet" })).resolves.toBe(
      null,
    );
  });

  it("answers null for a file whose metadata names no EPSG authority", async () => {
    readCityParquetSchema.mockResolvedValue({ footer: { epsg: null } });
    await expect(familySourceCrs({ url: "https://x/a.parquet" })).resolves.toBe(
      null,
    );
  });
});
