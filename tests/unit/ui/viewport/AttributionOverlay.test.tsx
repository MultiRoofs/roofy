import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GEOID_ATTRIBUTION } from "@cityjson/navara-core";
import { AttributionOverlay } from "../../../../src/ui/viewport/AttributionOverlay";

describe("AttributionOverlay", () => {
  it("always credits the geoid service, which is used for every georeferenced layer", () => {
    const { container } = render(<AttributionOverlay googleTiles={false} />);
    for (const line of GEOID_ATTRIBUTION) {
      expect(container.textContent).toContain(line);
    }
  });

  it("adds the Google credit only when the tiles layer is actually enabled", () => {
    expect(
      render(<AttributionOverlay googleTiles={false} />).container.textContent,
    ).not.toMatch(/Google/);
    expect(
      render(<AttributionOverlay googleTiles />).container.textContent,
    ).toMatch(/Google/);
  });

  it("credits the active basemap, and nothing when there is none", () => {
    expect(
      render(<AttributionOverlay googleTiles={false} />).container.textContent,
    ).not.toMatch(/CARTO/);
    const { container } = render(
      <AttributionOverlay
        googleTiles={false}
        basemapAttribution={["© CARTO", "© OpenStreetMap contributors"]}
      />,
    );
    expect(container.textContent).toContain("© CARTO");
  });

  it("links the OSM copyright page from a basemap credit too, not just the geoid one", () => {
    // ODbL attribution is a link obligation wherever the credit appears.
    const { container } = render(
      <AttributionOverlay
        googleTiles={false}
        basemapAttribution={["© OpenStreetMap contributors"]}
      />,
    );
    expect(
      container.querySelectorAll('a[href*="openstreetmap.org/copyright"]')
        .length,
    ).toBeGreaterThan(1);
  });

  it("links the CC BY 4.0 licence rather than only naming it", () => {
    const { container } = render(<AttributionOverlay googleTiles />);
    expect(
      container.querySelector('a[href*="creativecommons.org"]'),
    ).not.toBeNull();
  });

  it("links the OpenStreetMap copyright page, which ODbL attribution requires", () => {
    const { container } = render(<AttributionOverlay googleTiles={false} />);
    expect(
      container.querySelector('a[href*="openstreetmap.org/copyright"]'),
    ).not.toBeNull();
  });

  // The licence text is the CONSTANT, rendered once per line — not a prose copy
  // that can drift from what `@cityjson/navara-core` actually requires, and not
  // a visible copy plus a screen-reader copy (which reads the credit twice).
  it("renders exactly one credit line per GEOID_ATTRIBUTION entry", () => {
    const { container } = render(<AttributionOverlay googleTiles={false} />);
    const lines = [...container.querySelectorAll(".attribution-overlay span")];
    expect(lines).toHaveLength(GEOID_ATTRIBUTION.length);
    expect(lines.map((el) => el.textContent)).toEqual([...GEOID_ATTRIBUTION]);
  });

  it("opens every attribution link safely in a new tab", () => {
    const { container } = render(<AttributionOverlay googleTiles />);
    const anchors = [...container.querySelectorAll("a")];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
  });
});
