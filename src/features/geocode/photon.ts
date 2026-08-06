/**
 * Address search against Photon (https://photon.komoot.io), the OSM-based
 * geocoder built for search-as-you-type.
 *
 * WHY NOT NOMINATIM. The public Nominatim instance's usage policy forbids
 * auto-complete outright — one request per keystroke is exactly the pattern it
 * asks people not to send. Photon is the same OSM data from the same project's
 * ecosystem, keyless, and explicitly meant for this. Being someone else's free
 * service, the client below still asks for a bounded number of results and
 * sends nothing at all for a query too short to mean anything (the hook adds
 * the debounce and the abort).
 *
 * ENGINE-FREE and store-free: a function of a string and an `AbortSignal`, so
 * it is unit-testable with a mocked `fetch` and reusable from anywhere.
 * `properties.extent` is Photon's own bounding box, in ITS order
 * `[minLng, maxLat, maxLng, minLat]` — kept verbatim rather than reordered, so
 * the shape stays recognisable against the provider's docs; the one consumer
 * (`cameraHeightForExtent`) reads it by name.
 */

/** One place the user can fly to. */
export interface GeocodeResult {
  /** What the dropdown shows: name/street, city, state, country. */
  readonly label: string;
  readonly lng: number;
  readonly lat: number;
  /** Photon's bounding box `[minLng, maxLat, maxLng, minLat]`, when it has one
   *  — a city has one, a house number does not. */
  readonly extent?: readonly [number, number, number, number];
}

export const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";

/** How many suggestions to ask for. Six fills the dropdown without scrolling
 *  and keeps the load on a free service modest. */
export const GEOCODE_RESULT_LIMIT = 6;

/**
 * The credit line the dropdown carries.
 *
 * Deliberately NOT in the map's `AttributionOverlay`: that overlay credits what
 * is drawn on the globe, and no Photon data is ever drawn — it is consulted
 * while the user types and then discarded. The obligation belongs where the
 * data is shown, which is the dropdown.
 */
export const PHOTON_ATTRIBUTION =
  "Search © OpenStreetMap contributors via Photon";

/** The exact URL {@link searchAddresses} requests — exported so a test can
 *  assert the request shape without intercepting `fetch`. */
export function photonRequestUrl(query: string): string {
  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(GEOCODE_RESULT_LIMIT));
  url.searchParams.set("lang", "en");
  return url.toString();
}

/** A raw Photon feature, typed as loosely as it arrives. */
interface PhotonFeature {
  readonly geometry?: { readonly coordinates?: unknown };
  readonly properties?: Record<string, unknown>;
}

/**
 * Search for `query`, or answer `[]` without a request when there is nothing
 * to search for.
 *
 * REJECTS on an HTTP error or a network failure — the caller decides whether
 * that is a message in the dropdown or nothing at all (an abort). An aborted
 * `fetch` rejects with `AbortError`, which is the signal the hook uses to tell
 * "cancelled" apart from "broken".
 */
export async function searchAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const response = await fetch(photonRequestUrl(trimmed), { signal });
  if (!response.ok) {
    throw new Error(`Photon geocoding failed with HTTP ${response.status}.`);
  }
  const body: unknown = await response.json();
  const features = Array.isArray((body as { features?: unknown })?.features)
    ? ((body as { features: PhotonFeature[] }).features as PhotonFeature[])
    : [];

  const results: GeocodeResult[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lng, lat] = coordinates as unknown[];
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    const properties = feature.properties ?? {};
    const label = composeLabel(properties);
    if (label.length === 0 || seen.has(label)) continue;
    seen.add(label);

    const extent = readExtent(properties.extent);
    results.push(extent ? { label, lng, lat, extent } : { label, lng, lat });
  }
  return results;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * "Julianalaan 134, Delft, South Holland, Netherlands" — the parts a feature
 * actually has, in narrowing-to-widening order.
 *
 * A POI carries `name`; a plain address does not, and is only recognisable
 * from `street` + `housenumber`, so the first part falls back to those. Parts
 * that repeat are dropped (Photon reports a city's `name` AND its `city`),
 * because "Delft, Delft, NL" reads as a bug.
 */
function composeLabel(properties: Record<string, unknown>): string {
  const street = text(properties.street);
  const houseNumber = text(properties.housenumber);
  const primary =
    text(properties.name) ??
    (street === null
      ? null
      : houseNumber === null
        ? street
        : `${street} ${houseNumber}`);

  const parts: string[] = [];
  for (const part of [
    primary,
    text(properties.city),
    text(properties.state),
    text(properties.country),
  ]) {
    if (part === null) continue;
    if (parts.some((existing) => existing.toLowerCase() === part.toLowerCase()))
      continue;
    parts.push(part);
  }
  return parts.join(", ");
}

function readExtent(
  value: unknown,
): readonly [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return undefined;
  }
  const [a, b, c, d] = value as number[];
  return [a!, b!, c!, d!];
}
