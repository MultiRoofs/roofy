/**
 * The bare numeric CRS code from whatever a layer calls its reference system.
 *
 * Its own module rather than a second export from `ViewerToolbar.tsx`, because
 * a file that exports both a component and a helper loses fast refresh (and
 * the linter says so). It is also genuinely not toolbar-specific: it is a
 * property of the two loaders' spellings — and the one caller is `StatusBar`
 * now, the toolbar having shed its information pills. The path stays put
 * because the helper is not status-bar-specific either.
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
