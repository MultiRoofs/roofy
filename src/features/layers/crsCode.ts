/**
 * The bare numeric CRS code from whatever a layer calls its reference system.
 *
 * Its own module rather than a second export from a component, because a file
 * that exports both a component and a helper loses fast refresh (and the
 * linter says so). It lived under `ui/toolbar/` while `StatusBar` was its one
 * caller; it moved HERE when `layerPresentation` came to need it, because
 * nothing under `features/` may import from `ui/` (see `formatCount`'s note
 * in that file) and the spelling of a layer's reference system was never a
 * property of any panel — it is a property of the two loaders' spellings.
 *
 * The caller prepends "EPSG:" itself, so this has to strip any authority the
 * source already carries or it reads "EPSG:EPSG:7415" — which is exactly what
 * a `.fcb` rendered until this existed:
 *
 *   CityJSON: "https://www.opengis.net/def/crs/EPSG/0/7415"  (a URI)
 *   FlatCityBuf: "EPSG:7415"  (authority:code, composed in `fcbSource.ts`)
 */
export function extractCrsCode(
  referenceSystem: string | undefined,
): string | null {
  if (!referenceSystem) return null;
  const last = referenceSystem.split("/").at(-1);
  if (last === undefined || last === "") return null;
  // "EPSG:7415" -> "7415"; a bare "7415" is unchanged.
  return last.split(":").at(-1) || null;
}
