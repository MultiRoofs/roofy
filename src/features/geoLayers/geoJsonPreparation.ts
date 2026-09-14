import { normalizeGeoJsonDocument } from "./geoJsonRecords";
import { resolveGeoJsonDocument } from "./geoLayerDocument";
import { useGeoLayerStore } from "./geoLayerStore";

/** Resolve URL documents once, normalize a renderer-only clone, and discard
 * late results after a layer is removed, relinked, or recreated with its old id. */
export function installGeoJsonPreparation(): () => void {
  const seen = new Map<
    string,
    {
      readonly data: unknown;
      readonly url: string | undefined;
      readonly epoch: number | undefined;
      readonly token: number;
    }
  >();
  const tokens = new Map<string, number>();
  let disposed = false;
  const reconcile = () => {
    if (disposed) return;
    const layers = useGeoLayerStore.getState().layers;
    const ids = new Set(layers.map((layer) => layer.id));
    for (const id of seen.keys())
      if (!ids.has(id)) {
        seen.delete(id);
        tokens.set(id, (tokens.get(id) ?? 0) + 1);
      }
    for (const layer of layers) {
      if (layer.kind !== "geojson") continue;
      const source = {
        data: layer.config.data,
        url: layer.config.url,
        epoch: layer.config.preparationEpoch,
      };
      const previous = seen.get(layer.id);
      if (
        previous !== undefined &&
        previous.data === source.data &&
        previous.url === source.url &&
        previous.epoch === source.epoch
      )
        continue;
      const token = (tokens.get(layer.id) ?? 0) + 1;
      tokens.set(layer.id, token);
      seen.set(layer.id, { ...source, token });
      void resolveGeoJsonDocument(layer.config)
        .then((document) => {
          const current = useGeoLayerStore
            .getState()
            .layers.find((candidate) => candidate.id === layer.id);
          if (
            disposed ||
            tokens.get(layer.id) !== token ||
            current?.kind !== "geojson" ||
            current.config.data !== source.data ||
            current.config.url !== source.url ||
            current.config.preparationEpoch !== source.epoch ||
            document === null
          )
            return;
          useGeoLayerStore
            .getState()
            .setPreparedGeoJson(
              layer.id,
              normalizeGeoJsonDocument(document).data,
            );
        })
        .catch((error: unknown) => {
          const current = useGeoLayerStore
            .getState()
            .layers.find((candidate) => candidate.id === layer.id);
          if (
            !disposed &&
            tokens.get(layer.id) === token &&
            current?.kind === "geojson" &&
            current.config.data === source.data &&
            current.config.url === source.url &&
            current.config.preparationEpoch === source.epoch
          ) {
            useGeoLayerStore
              .getState()
              .setGeoJsonPreparationError(
                layer.id,
                error instanceof Error ? error.message : String(error),
              );
          }
        });
    }
  };
  const unsubscribe = useGeoLayerStore.subscribe(reconcile);
  reconcile();
  return () => {
    disposed = true;
    unsubscribe();
  };
}
