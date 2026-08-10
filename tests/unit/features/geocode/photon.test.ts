/**
 * The Photon geocoder client.
 *
 * `fetch` is MOCKED throughout — a unit test that reached photon.komoot.io
 * would be a flaky test and an unsolicited load on someone else's free public
 * service.
 *
 * What matters here is what the UI cannot check for itself: the request the
 * provider's usage terms expect (a bounded `limit`, the abort signal), and a
 * label built out of whatever subset of `name/street/city/state/country` a
 * feature happens to carry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PHOTON_ATTRIBUTION,
  photonRequestUrl,
  searchAddresses,
} from "../../../../src/features/geocode/photon";

interface FeatureInput {
  readonly coords?: readonly [number, number];
  readonly props?: Record<string, unknown>;
}

function feature({ coords = [4.36, 52.01], props = {} }: FeatureInput) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: coords },
    properties: props,
  };
}

function mockFetch(body: unknown, init?: { ok?: boolean; status?: number }) {
  const fn = vi.fn(async () => ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("photonRequestUrl", () => {
  it("asks for a bounded number of results and escapes the query", () => {
    const url = new URL(photonRequestUrl("Delft & Co"));
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api/");
    expect(url.searchParams.get("q")).toBe("Delft & Co");
    expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(10);
    expect(url.searchParams.get("lang")).toBe("en");
  });
});

describe("searchAddresses", () => {
  it("makes no request at all for an empty query", async () => {
    const fetchMock = mockFetch({ features: [] });
    expect(await searchAddresses("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps features to label + lng/lat, in GeoJSON order", async () => {
    mockFetch({
      features: [
        feature({
          coords: [4.357, 52.011],
          props: { name: "Delft", state: "South Holland", country: "NL" },
        }),
      ],
    });
    const [first] = await searchAddresses("Delft");
    expect(first).toEqual({
      label: "Delft, South Holland, NL",
      lng: 4.357,
      lat: 52.011,
    });
  });

  it("keeps a feature's extent when it has one", async () => {
    mockFetch({
      features: [
        feature({
          props: { name: "Delft", extent: [4.31, 52.05, 4.41, 51.97] },
        }),
      ],
    });
    const [first] = await searchAddresses("Delft");
    expect(first!.extent).toEqual([4.31, 52.05, 4.41, 51.97]);
  });

  it("names a street address when the feature has no name", async () => {
    mockFetch({
      features: [
        feature({
          props: {
            street: "Julianalaan",
            housenumber: "134",
            city: "Delft",
            country: "Netherlands",
          },
        }),
      ],
    });
    const [first] = await searchAddresses("Julianalaan 134");
    expect(first!.label).toBe("Julianalaan 134, Delft, Netherlands");
  });

  it("never repeats a part of the label", async () => {
    // Photon does this for cities: `name` and `city` are both "Delft".
    mockFetch({
      features: [
        feature({ props: { name: "Delft", city: "Delft", country: "NL" } }),
      ],
    });
    const [first] = await searchAddresses("Delft");
    expect(first!.label).toBe("Delft, NL");
  });

  it("drops duplicate results, keeping the first", async () => {
    mockFetch({
      features: [
        feature({ coords: [4.1, 52.1], props: { name: "Delft" } }),
        feature({ coords: [4.9, 52.9], props: { name: "Delft" } }),
      ],
    });
    const results = await searchAddresses("Delft");
    expect(results).toHaveLength(1);
    expect(results[0]!.lng).toBe(4.1);
  });

  it("skips malformed features rather than emitting NaN coordinates", async () => {
    mockFetch({
      features: [
        { type: "Feature", properties: { name: "No geometry" } },
        feature({ coords: ["x", 3] as never, props: { name: "Junk" } }),
        feature({ coords: [1, 2], props: { name: "Good" } }),
      ],
    });
    const results = await searchAddresses("q");
    expect(results.map((r) => r.label)).toEqual(["Good"]);
  });

  it("forwards the abort signal so a stale request can be cancelled", async () => {
    const fetchMock = mockFetch({ features: [] });
    const controller = new AbortController();
    await searchAddresses("Delft", controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("q=Delft"),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("throws on an HTTP error, so the UI can say the search is unavailable", async () => {
    mockFetch({}, { ok: false, status: 429 });
    await expect(searchAddresses("Delft")).rejects.toThrow(/429/);
  });

  it("credits OpenStreetMap and Photon", () => {
    expect(PHOTON_ATTRIBUTION).toMatch(/OpenStreetMap/);
    expect(PHOTON_ATTRIBUTION).toMatch(/Photon/);
  });
});
