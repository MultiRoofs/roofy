import type { BasemapOption } from "../../scene/basemaps";
export interface CustomBasemap {
  readonly title: string;
  readonly url: string;
  readonly attribution?: string;
}
export function customBasemapOption(value: unknown): BasemapOption | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CustomBasemap>;
  if (
    typeof v.title !== "string" ||
    !v.title.trim() ||
    typeof v.url !== "string"
  )
    return null;
  const url = v.url.trim();
  if (!["{x}", "{y}", "{z}"].every((key) => url.includes(key))) return null;
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) return null;
  } catch {
    return null;
  }
  return {
    id: "custom",
    label: v.title.trim(),
    source: { type: "raster-tile", url, maxZoom: 22 },
    attribution:
      typeof v.attribution === "string" && v.attribution.trim()
        ? [v.attribution.trim()]
        : [],
  };
}
