/**
 * A GeoJSON layer's DOCUMENT, for the parts of the UI that need more than its
 * bounds — today exactly one: the Style section's "Color by attribute" select
 * and category computation (`categorize.ts`).
 *
 * A URL-backed layer's document is what the engine draws from, but the engine
 * never hands it back, so the UI fetches it itself — through a URL-keyed
 * promise cache of the same shape as `geoLayerBounds.ts`'s `boundsByUrl`
 * (successes only: a null or a rejection is evicted, so the next open of the
 * section retries a flaky host). Inline data costs no fetch and no cache.
 *
 * ENGINE-FREE, like every module under `features/`.
 */
import type { GeoJsonLayerConfig } from "./geoLayerStore";

/** URL → in-flight-or-done document. */
const documentByUrl = new Map<string, Promise<unknown>>();

/** Test seam. */
export function resetGeoJsonDocumentCache(): void {
  documentByUrl.clear();
}

/**
 * The document a GeoJSON layer draws from, or `null` when there is none (a
 * re-linkable row with neither inline data nor a URL). REJECTS when the
 * network does — the caller decides what a failed fetch means for its UI.
 */
export function resolveGeoJsonDocument(
  config: GeoJsonLayerConfig,
  fetchFn: typeof fetch = fetch,
): Promise<unknown | null> {
  if (config.data !== undefined) return Promise.resolve(config.data);
  const url = config.url;
  if (url === undefined || url === "") return Promise.resolve(null);
  const cached = documentByUrl.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`Fetching ${url} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as unknown;
  })();
  documentByUrl.set(url, promise);
  promise.catch(() => documentByUrl.delete(url));
  return promise;
}
