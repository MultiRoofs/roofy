import { describe, expect, it } from "vitest";
import {
  CITYMODEL_ENCODING_PRIORITY,
  getPreferredCityModelEncoding,
  isSupportedCityModelEncoding,
} from "../../../../src/domain/citymodel/supportedEncodings";

describe("CITYMODEL_ENCODING_PRIORITY", () => {
  it("keeps the agreed city-model encoding order", () => {
    expect(CITYMODEL_ENCODING_PRIORITY).toEqual([
      "cityjson",
      "cityjsonseq",
      "flatcitybuf",
      "citygml",
    ]);
  });
});

describe("isSupportedCityModelEncoding", () => {
  it("accepts the supported encodings", () => {
    expect(isSupportedCityModelEncoding("cityjson")).toBe(true);
    expect(isSupportedCityModelEncoding("cityjsonseq")).toBe(true);
    expect(isSupportedCityModelEncoding("flatcitybuf")).toBe(true);
  });

  it("rejects unrelated values", () => {
    expect(isSupportedCityModelEncoding("citygml-xml")).toBe(false);
    expect(isSupportedCityModelEncoding("obj")).toBe(false);
  });
});

describe("getPreferredCityModelEncoding", () => {
  it("returns the highest-priority supported encoding", () => {
    expect(getPreferredCityModelEncoding(["flatcitybuf", "cityjsonseq"])).toBe(
      "cityjsonseq",
    );
  });

  it("returns null when no encodings are provided", () => {
    expect(getPreferredCityModelEncoding([])).toBeNull();
  });
});
