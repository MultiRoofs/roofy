/**
 * The download's file name for a layer and a format.
 *
 * Its own module rather than a second export from `ExportDialog.tsx`, for the
 * same reason `tableText.ts` and `crsCode.ts` exist: a file that exports both
 * a component and a function loses fast refresh, and the linter says so.
 */

/** "delft.city.json" + "csv" -> "delft.csv": the layer's name with every
 *  extension it already carries replaced by the format's own. */
export function exportFileName(layerName: string, format: string): string {
  const stem = layerName.split(".")[0] || "export";
  return `${stem}.${format}`;
}
