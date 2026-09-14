/**
 * Hand the browser a file.
 *
 * Extracted from `RuleBuilderTab`, which was the app's only download until the
 * table panel got an exporter. A second hand-rolled anchor is how two
 * downloads end up disagreeing about revoking the object URL — the leak is
 * invisible until a session has exported a few hundred megabytes.
 *
 * The revoke is DEFERRED to the next task, not run straight after `click()`.
 * The click dispatches synchronously, but a browser does not necessarily have
 * the blob's bytes by the time the handler returns: revoking in the same turn
 * has been observed to produce a zero-byte or cancelled download, and it gets
 * likelier the larger the blob — which is exactly the direction a
 * multi-hundred-megabyte CityParquet package points. A `setTimeout(…, 0)` costs
 * nothing and still releases the URL long before the tab could notice.
 */

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(
  text: string,
  fileName: string,
  mimeType = "application/json",
): void {
  downloadBlob(new Blob([text], { type: mimeType }), fileName);
}
