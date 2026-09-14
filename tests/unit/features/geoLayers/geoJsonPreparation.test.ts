import { afterEach, describe, expect, it, vi } from "vitest";
import { installGeoJsonPreparation } from "../../../../src/features/geoLayers/geoJsonPreparation";
import { resetGeoJsonDocumentCache } from "../../../../src/features/geoLayers/geoLayerDocument";
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import {
  GEO_STABLE_FEATURE_KEY,
  readGeoStableFeatureId,
} from "../../../../src/features/geoLayers/geoJsonRecords";

const store = () => useGeoLayerStore.getState();
const geoDocument = (name = "roof") => ({
  type: "FeatureCollection",
  features: [
    { type: "Feature", id: name, properties: { name }, geometry: null },
  ],
});

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  useGeoLayerStore.setState({ layers: [] });
  resetGeoJsonDocumentCache();
  vi.unstubAllGlobals();
});

function addUrl(url = "https://example.test/roofs.geojson"): string {
  return store().addGeoLayer({
    name: "Roofs",
    kind: "geojson",
    config: { url },
  });
}
function layer(id: string): Extract<GeoLayer, { kind: "geojson" }> {
  const selected = store().layers.find((candidate) => candidate.id === id);
  if (selected?.kind !== "geojson")
    throw new Error(`Missing GeoJSON layer ${id}`);
  return selected;
}

describe("installGeoJsonPreparation", () => {
  it("fetches and prepares URL GeoJSON while retaining the URL source", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => geoDocument() });
    vi.stubGlobal("fetch", fetch);
    const id = addUrl();
    stop = installGeoJsonPreparation();

    await vi.waitFor(() => expect(layer(id).config.preparation).toBe("ready"));
    expect(fetch).toHaveBeenCalledWith("https://example.test/roofs.geojson");
    expect(layer(id).config.url).toBe("https://example.test/roofs.geojson");
    const prepared = layer(id).config.preparedData as ReturnType<
      typeof geoDocument
    >;
    expect(readGeoStableFeatureId(prepared.features[0]!.properties!)).toBe(
      "id:string:roof",
    );
  });

  it("ignores a URL result after the layer is relinked or removed", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = (value) => done({ ok: true, json: async () => value });
          }),
      ),
    );
    const id = addUrl();
    stop = installGeoJsonPreparation();
    store().relinkGeoJsonLayer(id, geoDocument("replacement"));
    resolve(geoDocument("old"));

    await Promise.resolve();
    await Promise.resolve();
    const prepared = layer(id).config.preparedData as ReturnType<
      typeof geoDocument
    >;
    expect(prepared.features[0]!.properties!.name).toBe("replacement");
    store().removeGeoLayer(id);
    expect(store().layers).toEqual([]);
  });

  it("retries a rejected URL request with a new generation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => geoDocument("recovered"),
      });
    vi.stubGlobal("fetch", fetch);
    const id = addUrl();
    stop = installGeoJsonPreparation();
    await vi.waitFor(() => expect(layer(id).config.preparation).toBe("failed"));

    store().retryGeoJsonPreparation(id);
    await vi.waitFor(() => expect(layer(id).config.preparation).toBe("ready"));
    expect(
      (layer(id).config.preparedData as ReturnType<typeof geoDocument>)
        .features[0]!.properties!.name,
    ).toBe("recovered");
  });

  it("invalidates pending work after the app lifecycle unsubscribes", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = (value) => done({ ok: true, json: async () => value });
          }),
      ),
    );
    const id = addUrl();
    stop = installGeoJsonPreparation();
    stop();
    stop = undefined;
    resolve(geoDocument());

    await Promise.resolve();
    await Promise.resolve();
    expect(layer(id).config.preparation).toBe("loading");
    expect(layer(id).config.preparedData).toBeUndefined();
  });

  it("does not mutate the original inline document or persist a prepared clone", () => {
    const inline = geoDocument();
    const id = store().addGeoLayer({
      name: "Inline",
      kind: "geojson",
      config: { data: inline },
    });
    const prepared = layer(id).config.preparedData as ReturnType<
      typeof geoDocument
    >;
    expect(inline.features[0]!.properties).toEqual({ name: "roof" });
    expect(readGeoStableFeatureId(prepared.features[0]!.properties!)).toBe(
      "id:string:roof",
    );
    expect(prepared.features[0]!.properties!).toHaveProperty(
      GEO_STABLE_FEATURE_KEY,
    );
    expect(inline.features[0]!.properties).toEqual({ name: "roof" });
  });
});

describe("remove and recreate identity", () => {
  it("does not let an old same-id URL result prepare a recreated layer", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = (value) => done({ ok: true, json: async () => value });
          }),
      ),
    );
    const id = addUrl();
    stop = installGeoJsonPreparation();
    const original = layer(id);
    useGeoLayerStore.setState({ layers: [] });
    useGeoLayerStore.setState({ layers: [original] });
    resolve(geoDocument("old"));
    await Promise.resolve();
    await Promise.resolve();
    // The recreated record starts its own resolution; the old callback cannot
    // publish a prepared source into it, even though id and URL coincide.
    expect(layer(id).config.preparedData).toBeUndefined();
  });
});
