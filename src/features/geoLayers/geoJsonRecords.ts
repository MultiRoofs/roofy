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
