/**
 * What a city layer's source can do — said once, on the layer, so a consumer
 * asks the question it means instead of "is this streaming?".
 *
 * The switches this replaces were one boolean answering three different
 * questions, and the code read alike for all of them:
 *
 *  - `access`: where the objects live. A `resident` layer holds its whole model
 *    (`layer.model`); a `stream` layer's model is a stub and its objects are
 *    the resident cells (`useStreamStore`), drawn by the stream plugin, not by
 *    the static reconciler.
 *  - `coverage`: what those objects ARE of the source. `complete` is all of it;
 *    `viewport` is what the camera has loaded, so a count, a statistic or an
 *    empty result has to say "currently loaded".
 *  - `discovery`: whether LoDs, object types and appearance themes are known
 *    when the layer is added (`upfront`, folded from the model) or learned as
 *    cells arrive (`progressive`, from the stream store).
 *
 * Today the three move together, and two constants say so. They are separate
 * fields because they need not: a server that answers queries over a whole
 * dataset streams with `complete` coverage, and a capped whole read is
 * resident with partial coverage.
 */

import { getResidentModel } from "../streaming/residentModel";
import type { Layer } from "./layerStore";

export interface SourceCapabilities {
  readonly access: "resident" | "stream";
  readonly coverage: "complete" | "viewport";
  readonly discovery: "upfront" | "progressive";
}

/** A source read whole: CityJSON, CityJSONSeq, CityGML, a small CityParquet
 *  package, a drawn or derived layer. */
export const RESIDENT_SOURCE: SourceCapabilities = Object.freeze({
  access: "resident",
  coverage: "complete",
  discovery: "upfront",
});

/** A source streamed by viewport: FlatCityBuf, a large CityParquet package. */
export const STREAMED_SOURCE: SourceCapabilities = Object.freeze({
  access: "stream",
  coverage: "viewport",
  discovery: "progressive",
});

/** The objects a layer has right now: its model's, or its resident cells'. */
export type LayerObjects =
  | Layer["model"]["objects"]
  | ReturnType<typeof getResidentModel>["objects"];

/**
 * The objects this layer has right now.
 *
 * `streamVersion` is the layer's `useStreamStore` commit counter, read by the
 * caller through a selector: passing it is what subscribes the caller to
 * commits (see `getResidentModel`). A resident layer ignores it.
 */
export function layerObjects(
  layer: Pick<Layer, "id" | "model" | "source">,
  streamVersion: number,
): LayerObjects {
  return layer.source.access === "stream"
    ? getResidentModel(layer.id, streamVersion).objects
    : layer.model.objects;
}
