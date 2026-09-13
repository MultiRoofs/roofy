/** Private property sent to the renderer for stable feature selection. */
export const GEO_STABLE_FEATURE_KEY = "__roofy_stable_feature_id";

interface StableFeatureEnvelope {
  readonly stableId: string;
  readonly hasOriginal: boolean;
  readonly originalValue?: unknown;
}

/** Read renderer metadata without confusing a user's reserved property for it. */
export function readGeoStableFeatureId(
  properties: Readonly<Record<string, unknown>> | undefined,
): string | null {
  const value = properties?.[GEO_STABLE_FEATURE_KEY];
  return value !== null &&
    typeof value === "object" &&
    typeof (value as StableFeatureEnvelope).stableId === "string" &&
    typeof (value as StableFeatureEnvelope).hasOriginal === "boolean"
    ? (value as StableFeatureEnvelope).stableId
    : null;
}

export interface NormalizedGeoJson {
  readonly data: unknown;
  readonly featureIds: ReadonlyArray<string>;
}

/**
 * Clone a GeoJSON Feature/FeatureCollection for the engine without mutating
 * the source document. Source ids are stable only when unique; duplicate,
 * missing, and type-colliding ids fall back to the original document index.
 */
export function normalizeGeoJsonDocument(document: unknown): NormalizedGeoJson {
  const source = document as { type?: unknown; features?: unknown[] } | null;
  const features =
    source?.type === "FeatureCollection" && Array.isArray(source.features)
      ? source.features
      : source?.type === "Feature"
        ? [source]
        : [];
  const idCounts = new Map<string, number>();
  for (const feature of features) {
    const id = (feature as { id?: unknown } | null)?.id;
    if (typeof id === "string" || typeof id === "number") {
      const token = `${typeof id}:${id}`;
      idCounts.set(token, (idCounts.get(token) ?? 0) + 1);
    }
  }
  const ids: string[] = [];
  const clone = (feature: unknown, index: number) => {
    const record = feature as { id?: unknown; properties?: unknown };
    const id = record?.id;
    const token =
      typeof id === "string" || typeof id === "number"
        ? `${typeof id}:${id}`
        : null;
    const stable =
      token !== null && idCounts.get(token) === 1
        ? `id:${token}`
        : `index:${index}`;
    ids.push(stable);
    const properties =
      record?.properties && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : {};
    return {
      ...record,
      properties: {
        ...properties,
        [GEO_STABLE_FEATURE_KEY]: {
          stableId: stable,
          hasOriginal: Object.prototype.hasOwnProperty.call(
            properties,
            GEO_STABLE_FEATURE_KEY,
          ),
          ...(Object.prototype.hasOwnProperty.call(
            properties,
            GEO_STABLE_FEATURE_KEY,
          )
            ? { originalValue: properties[GEO_STABLE_FEATURE_KEY] }
            : {}),
        } satisfies StableFeatureEnvelope,
      },
    };
  };
  if (source?.type === "FeatureCollection" && Array.isArray(source.features)) {
    return {
      data: { ...source, features: source.features.map(clone) },
      featureIds: ids,
    };
  }
  if (source?.type === "Feature")
    return { data: clone(source, 0), featureIds: ids };
  return { data: document, featureIds: ids };
}

/** Do not expose renderer bookkeeping in details or export attributes. */
export function publicGeoProperties(
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const privateValue = properties[GEO_STABLE_FEATURE_KEY];
  const isEnvelope =
    privateValue !== null &&
    typeof privateValue === "object" &&
    typeof (privateValue as StableFeatureEnvelope).stableId === "string" &&
    typeof (privateValue as StableFeatureEnvelope).hasOriginal === "boolean";
  if (!isEnvelope) return properties;
  const { [GEO_STABLE_FEATURE_KEY]: _private, ...rest } = properties;
  const publicProperties: Record<string, unknown> = { ...rest };
  const envelope = privateValue as StableFeatureEnvelope;
  if (envelope.hasOriginal)
    publicProperties[GEO_STABLE_FEATURE_KEY] = envelope.originalValue;
  return publicProperties;
}

/**
 * A whole document with every feature's properties made PUBLIC — the inverse
 * of {@link normalizeGeoJsonDocument}, feature by feature.
 *
 * What it is for: a document that is already prepared cannot be handed back to
 * `addGeoLayer` as a new layer's `data`. `normalizeGeoJsonDocument` would stamp
 * a SECOND envelope over the first and record the first as the feature's
 * "original value", which {@link publicGeoProperties} then hands back as a
 * visible attribute — so the new layer's records grid, its Details, its export
 * and its "Color by attribute" list would all offer `__roofy_stable_feature_id`.
 * Stripping first makes the round trip exact: a document the FILE's own
 * properties came out of goes back in unchanged, and a file that really did
 * carry the reserved key keeps its value.
 *
 * PURE and copy-on-write: a feature with no envelope keeps its identity, and
 * the geometry objects are shared by reference (nothing in the app mutates a
 * geometry in place — every writer replaces the document).
 */
export function publicGeoDocument(document: unknown): unknown {
  const source = document as { type?: unknown; features?: unknown[] } | null;
  const strip = (feature: unknown): unknown => {
    const record = feature as { properties?: unknown } | null;
    const properties =
      record?.properties && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : null;
    if (properties === null) return feature;
    const publicProperties = publicGeoProperties(properties);
    return publicProperties === properties
      ? feature
      : { ...record, properties: publicProperties };
  };
  if (source?.type === "FeatureCollection" && Array.isArray(source.features)) {
    return { ...source, features: source.features.map(strip) };
  }
  if (source?.type === "Feature") return strip(source);
  return document;
}

/**
 * The PUBLIC properties of the feature carrying `stableId`, or null.
 *
 * A geo selection holds a SNAPSHOT of the properties it was made with
 * (`domain/selection/types.ts`), so after a run merges its results the Details
 * panel would still show the values from before the run. This is how `App.tsx`
 * re-reads them for the same feature without a new pick.
 */
export function findGeoFeatureProperties(
  document: unknown,
  stableId: string,
): Readonly<Record<string, unknown>> | null {
  const source = document as { type?: unknown; features?: unknown[] } | null;
  const features =
    source?.type === "FeatureCollection" && Array.isArray(source.features)
      ? source.features
      : source?.type === "Feature"
        ? [source]
        : [];
  for (const feature of features) {
    const properties = (feature as { properties?: unknown } | null)?.properties;
    if (properties === null || typeof properties !== "object") continue;
    const bag = properties as Record<string, unknown>;
    if (readGeoStableFeatureId(bag) === stableId)
      return publicGeoProperties(bag);
  }
  return null;
}
