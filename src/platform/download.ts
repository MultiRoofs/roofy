/**
 * Hand the browser a file.
 *
 * Extracted from `RuleBuilderTab`, which was the app's only download until the
 * table panel got an exporter. A second hand-rolled anchor is how two
 * downloads end up disagreeing about revoking the object URL — the leak is
 * invisible until a session has exported a few hundred megabytes.
 *
 * `revokeObjectURL` immediately after `click()` is safe: the click has already
 * handed the URL to the browser's download machinery synchronously.
 */

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(
  text: string,
  fileName: string,
  mimeType = "application/json",
): void {
  downloadBlob(new Blob([text], { type: mimeType }), fileName);
}
