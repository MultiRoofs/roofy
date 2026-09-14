/**
 * Pure resolution of the workspace's one active-layer id against the two
 * layer stores, plus hooks that follow it. `resolveActiveLayer` and
 * `unifiedLayerOrder` are pure (no store reads) so they can be unit-tested
 * without React or Zustand.
 */
import { useMemo } from "react";
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

/**
 * The active layer, whichever store it lives in.
 *
 * The `find` happens INSIDE each selector — subscribing to the whole `layers`
 * array would re-render every consumer whenever any other layer is renamed,
 * hidden or restyled — and the `{ kind, layer }` wrapper is memoised on the
 * two resolved layers, so the hook's return is a stable dependency for the
 * effects and memos that hang off it.
 */
export function useActiveLayer(): ActiveLayer | null {
  const activeLayerId = useWorkspaceStore((s) => s.activeLayerId);
  const layer = useLayerStore(
    (s) => s.layers.find((l) => l.id === activeLayerId) ?? null,
  );
  const geoLayer = useGeoLayerStore(
    (s) => s.layers.find((l) => l.id === activeLayerId) ?? null,
  );
  return useMemo(() => {
    if (layer !== null) return { kind: "city", layer };
    if (geoLayer !== null) return { kind: "geo", layer: geoLayer };
    return null;
  }, [layer, geoLayer]);
}

export function useActiveCityLayer(): Layer | null {
  const active = useActiveLayer();
  return active?.kind === "city" ? active.layer : null;
}
