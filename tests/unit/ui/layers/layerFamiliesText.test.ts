/**
 * What a family row SAYS about its geometry and about the package.
 *
 * The number on an opened row is the family's own FILE total, from the stream
 * header — not the objects the camera has delivered — so calling it "loaded" put
 * "884,106 loaded" beside roughly 4,500 resident objects in the recorded
 * Yokohama session. The status bar owns the loaded reading ("N of M loaded
 * objects"), and this block owns the file's own size.
 */
import { describe, expect, it } from "vitest";
import {
  geometryText,
  openedSummary,
} from "../../../../src/ui/layers/layerFamiliesText";
import { buildLayerFamilies } from "../../../../src/features/layers/familyStore";

const FAMILIES = buildLayerFamilies([
  {
    key: "building",
    href: "building.parquet",
    size: null,
    source: { url: "https://data.example/building.parquet" },
  },
  {
    key: "bridge",
    href: "bridge.parquet",
    size: null,
    source: { url: "https://data.example/bridge.parquet" },
  },
]);

describe("a family row's geometry text", () => {
  it("calls the file's own total what it is, not what is loaded", () => {
    expect(geometryText("open", 884106)).toBe("Opened · 884,106 objects");
  });

  it("says only Opened when the header never stated a count", () => {
    expect(geometryText("open", null)).toBe("Opened");
  });

  it("keeps the three other states as they are", () => {
    expect(geometryText("opening", null)).toBe("Opening…");
    expect(geometryText("failed", 12)).toBe("Failed");
    expect(geometryText("closed", 12)).toBe("Not opened");
  });
});

describe("the package summary", () => {
  it("names what is opened and counts what is not", () => {
    expect(openedSummary(FAMILIES, ["building"])).toBe(
      "Building opened · 1 more family available",
    );
  });
});
