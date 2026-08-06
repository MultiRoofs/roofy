/**
 * The CRS pill prepends "EPSG:" itself, so this helper must return the bare
 * code for BOTH source spellings. A `.fcb` rendered "EPSG:EPSG:7415" until it
 * did — the URI form was the only one anyone had checked.
 */
import { describe, expect, it } from "vitest";
import { extractCrsCode } from "../../../../src/ui/toolbar/crsCode";

describe("extractCrsCode", () => {
  it("takes the code out of CityJSON's URI form", () => {
    expect(extractCrsCode("https://www.opengis.net/def/crs/EPSG/0/7415")).toBe(
      "7415",
    );
  });

  it("takes the code out of FlatCityBuf's authority:code form", () => {
    // `fcbSource.ts` composes this from the header's authority() + code().
    expect(extractCrsCode("EPSG:7415")).toBe("7415");
    expect(extractCrsCode("epsg:28992")).toBe("28992");
  });

  it("passes a bare code through", () => {
    expect(extractCrsCode("7415")).toBe("7415");
  });

  it("answers null for nothing to show", () => {
    expect(extractCrsCode(undefined)).toBeNull();
    expect(extractCrsCode("")).toBeNull();
    expect(extractCrsCode("EPSG:")).toBeNull();
  });
});
