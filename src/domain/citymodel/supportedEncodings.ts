export const CITYMODEL_ENCODING_PRIORITY = [
  "cityjson",
  "cityjsonseq",
  "flatcitybuf",
  "citygml",
] as const;

export type CityModelEncoding = (typeof CITYMODEL_ENCODING_PRIORITY)[number];

const SUPPORTED_CITYMODEL_ENCODINGS = new Set<string>(
  CITYMODEL_ENCODING_PRIORITY,
);

export function isSupportedCityModelEncoding(
  value: string,
): value is CityModelEncoding {
  return SUPPORTED_CITYMODEL_ENCODINGS.has(value);
}

export function getPreferredCityModelEncoding(
  encodings: readonly CityModelEncoding[],
): CityModelEncoding | null {
  for (const candidate of CITYMODEL_ENCODING_PRIORITY) {
    if (encodings.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}
