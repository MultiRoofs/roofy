/**
 * What a geo selection becomes when its layer's `config` identity moves.
 *
 * TWO different events wear the same clothes. A RE-LINK replaces the document:
 * the batch ids are re-minted, the feature the selection names may not exist,
 * and the selection has to go (that is why `App.tsx` compares config identity
 * at all). A PROPERTY MERGE — a run's results, or its Undo — replaces the
 * config over the SAME document: the feature is still there, still has its
 * stable id, and §8 wants its new values in Details. Telling them apart is one
 * comparison of the source fields, and re-reading the properties by stable id
 * is what makes the selection correct afterwards rather than merely alive.
 *
 * The engine highlight survives on its own: `geoLayerSync` highlights by
 * `highlightedStableFeatureId` when the selection carries one and falls back to
 * the batch id only when it does not, and every normalized document's features
 * carry one.
 */
import type { GeoFeatureSelection } from "../../domain/selection/types";
import { findGeoFeatureProperties } from "./geoJsonRecords";
import type { GeoJsonLayerConfig, GeoLayer } from "./geoLayerStore";

function isGeoJsonConfig(config: unknown): config is GeoJsonLayerConfig {
  return typeof config === "object" && config !== null;
}

export function refreshedGeoSelection(input: {
  readonly selection: GeoFeatureSelection;
  readonly layer: GeoLayer | undefined;
  /** The config the layer had when the feature was picked. */
  readonly previousConfig: unknown;
}): GeoFeatureSelection | null {
  const { selection, layer, previousConfig } = input;
  if (layer === undefined || layer.kind !== "geojson") return null;
  if (layer.config === previousConfig) return selection;
  // A property-only update keeps the SOURCE the selection was made on: the
  // same inline document, the same url, the same preparation epoch. Anything
  // else is a new document and the old subject is gone.
  const previous = isGeoJsonConfig(previousConfig) ? previousConfig : null;
  const sameSource =
    previous !== null &&
    layer.config.data === previous.data &&
    layer.config.url === previous.url &&
    layer.config.preparationEpoch === previous.preparationEpoch;
  if (!sameSource || selection.stableFeatureId === undefined) return null;
  const properties = findGeoFeatureProperties(
    layer.config.preparedData,
    selection.stableFeatureId,
  );
  // The feature itself can be gone even from the same source — a re-prepare
  // that dropped it — and then there is nothing to show.
  return properties === null ? null : { ...selection, properties };
}
