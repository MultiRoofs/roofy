/**
 * Adding a geospatial layer, in one place, for both doors into the app.
 *
 * A geospatial source has no parsing step, no CRS gate and no engine call to
 * make — it IS its description — so it never goes near `useLayerFileLoader`.
 * That leaves the two callers (the Add Layer dialog and the landing page's URL
 * field) doing the same three things by hand, and one of them forgetting the
 * third: `addGeoLayer` writes a row, and NOTHING in the workspace invariants
 * activates it. Rule 4's reconciler only fills an active id that is `null`, so
 * a geo layer added while a city model is active would land in the list
 * unselected — the panels would go on describing the other layer.
 *
 * Hence this module: add, then {@link activateLayer}, and hand back a result
 * the caller can render. It imports `layerCoordination` (which imports the geo
 * store); nothing in the store imports this, so the direction stays one-way.
 */
import { geoLayerFromUrl, parseGeoJsonText } from "./classifyGeoSource";
import {
  useGeoLayerStore,
  type GeoLayerInput,
  type GeoLayerKind,
} from "./geoLayerStore";
import { activateLayer } from "../workspace/layerCoordination";

export type GeoAddResult =
  | { readonly ok: true; readonly id: string }
  /** A sentence for the user, already written for them — the caller renders
   *  it where the attempt was made. */
  | { readonly ok: false; readonly error: string };

/** Add the layer and make it the active one. */
function commit(input: GeoLayerInput): GeoAddResult {
  const id = useGeoLayerStore.getState().addGeoLayer(input);
  activateLayer(id);
  return { ok: true, id };
}

/**
 * A URL-backed geospatial layer of a KNOWN kind.
 *
 * `kind` is passed, never re-derived: the user has been shown the detected
 * format and may have corrected it, and what they see selected must be what
 * is added. `name` is the optional label from the dialog; empty falls back to
 * the URL's own last segment.
 */
export function addGeoSourceFromUrl(
  url: string,
  kind: GeoLayerKind,
  name?: string,
): GeoAddResult {
  const input = geoLayerFromUrl(url, kind);
  if (input === null) return { ok: false, error: "That is not a valid URL." };
  const trimmedName = name?.trim();
  return commit(trimmedName ? { ...input, name: trimmedName } : input);
}

/**
 * A dropped or browsed GeoJSON document.
 *
 * VALIDATED before it becomes a layer: a CityJSON file is valid JSON with a
 * `type` of its own and this app's primary format is CityJSON, so the likeliest
 * mistake here is answered by name (see `parseGeoJsonText`).
 */
export async function addGeoSourceFromFile(file: File): Promise<GeoAddResult> {
  const parsed = parseGeoJsonText(await file.text());
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return commit({
    name: file.name,
    kind: "geojson",
    // INLINE, and knowingly not persistable: the alternative is holding a
    // `File` the browser will not give back after a reload. The layer saves as
    // a re-linkable row instead (see `geoLayerSnapshot`).
    config: { data: parsed.data },
  });
}
