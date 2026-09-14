/**
 * The GeoJSON document cache behind the Style section's attribute keys: one
 * fetch per URL, successes shared, failures evicted so the next open retries.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetGeoJsonDocumentCache,
  resolveGeoJsonDocument,
} from "../../../../src/features/geoLayers/geoLayerDocument";

afterEach(resetGeoJsonDocumentCache);

const DOC = { type: "FeatureCollection", features: [] };

function fetchReturning(body: unknown) {
  return vi.fn(
    async () =>
      ({
        ok: true,
        json: async () => body,
      }) as Response,
  );
}

describe("resolveGeoJsonDocument", () => {
  it("answers the inline document without touching the network", async () => {
    const fetchFn = vi.fn();
    await expect(
      resolveGeoJsonDocument({ data: DOC }, fetchFn as never),
    ).resolves.toBe(DOC);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers null for a re-linkable row with no source at all", async () => {
    await expect(resolveGeoJsonDocument({})).resolves.toBeNull();
  });

  it("fetches a URL once and shares the result with every later caller", async () => {
    const fetchFn = fetchReturning(DOC);

    await expect(
      resolveGeoJsonDocument({ url: "https://x/a.geojson" }, fetchFn as never),
    ).resolves.toEqual(DOC);
    await expect(
      resolveGeoJsonDocument({ url: "https://x/a.geojson" }, fetchFn as never),
    ).resolves.toEqual(DOC);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("evicts a failure, so the next attempt retries the host", async () => {
    const failing = vi.fn(async () => {
      throw new Error("connection refused");
    });
    await expect(
      resolveGeoJsonDocument({ url: "https://x/b.geojson" }, failing as never),
    ).rejects.toThrow("connection refused");

    const fetchFn = fetchReturning(DOC);
    await expect(
      resolveGeoJsonDocument({ url: "https://x/b.geojson" }, fetchFn as never),
    ).resolves.toEqual(DOC);
  });

  it("evicts an HTTP error the same way", async () => {
    const notFound = vi.fn(
      async () => ({ ok: false, status: 404 }) as Response,
    );
    await expect(
      resolveGeoJsonDocument({ url: "https://x/c.geojson" }, notFound as never),
    ).rejects.toThrow("HTTP 404");
    await expect(
      resolveGeoJsonDocument(
        { url: "https://x/c.geojson" },
        fetchReturning(DOC) as never,
      ),
    ).resolves.toEqual(DOC);
  });
});
