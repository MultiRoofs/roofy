import { useGeoLayerStore } from "../geoLayers/geoLayerStore";

export const DELFT_LANDUSE_URL =
  "https://pub-7aad9a74319741828dbafdbf5e2df201.r2.dev/landuse_delft.geojson";

/** Keep this URL-backed so the overlay remains available to processing and sharing. */
export function ensureDelftLandUse(): string {
  const store = useGeoLayerStore.getState();
  const existing = store.layers.find(
    (layer) =>
      layer.kind === "geojson" && layer.config.url === DELFT_LANDUSE_URL,
  );
  if (existing) return existing.id;
  return store.addGeoLayer({
    name: "Delft land use (PDOK)",
    kind: "geojson",
    visible: true,
    opacity: 0.35,
    config: { url: DELFT_LANDUSE_URL },
  });
}
