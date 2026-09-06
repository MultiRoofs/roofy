/**
 * Pure resolution of the workspace's one active-layer id against the two
 * layer stores, plus hooks that follow it. `resolveActiveLayer` and
 * `unifiedLayerOrder` are pure (no store reads) so they can be unit-tested
 * without React or Zustand.
 */
import { useLayerStore, type Layer } from "../layers/layerStore";
import { useGeoLayerStore, type GeoLayer } from "../geoLayers/geoLayerStore";
import { useWorkspaceStore } from "./workspaceStore";

export type ActiveLayer =
  | { readonly kind: "city"; readonly layer: Layer }
  | { readonly kind: "geo"; readonly layer: GeoLayer };

export function resolveActiveLayer(
  activeLayerId: string | null,
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): ActiveLayer | null {
  if (activeLayerId === null) return null;
  const city = layers.find((l) => l.id === activeLayerId);
  if (city) return { kind: "city", layer: city };
  const geo = geoLayers.find((l) => l.id === activeLayerId);
  if (geo) return { kind: "geo", layer: geo };
  return null;
}

/** City layers in add order, then geo layers in add order. */
export function unifiedLayerOrder(
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): ReadonlyArray<string> {
  return [...layers.map((l) => l.id), ...geoLayers.map((l) => l.id)];
}

export function useActiveLayer(): ActiveLayer | null {
  const activeLayerId = useWorkspaceStore((s) => s.activeLayerId);
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  return resolveActiveLayer(activeLayerId, layers, geoLayers);
}

export function useActiveCityLayer(): Layer | null {
  const active = useActiveLayer();
  return active?.kind === "city" ? active.layer : null;
}
