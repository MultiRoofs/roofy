/** Optional saved static-layer selection. Undefined retains legacy behavior;
 * an empty array deliberately hides all labelled geometry. */
export function normalizeSelectedLods(
  value: unknown,
): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every(
      (lod: unknown) =>
        typeof lod === "string" &&
        /^\d+(?:\.\d+)?$/.test(lod) &&
        Number.isFinite(Number(lod)),
    )
  ) {
    return undefined;
  }
  return [...new Set(value as string[])].sort((a, b) => Number(b) - Number(a));
}
