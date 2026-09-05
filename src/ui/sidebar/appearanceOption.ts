/**
 * The `<option>` value encoding for {@link AppearanceSelector}: a theme is
 * identified by kind AND name (a file may name a texture theme and a
 * material theme alike), and the empty string is "no theme".
 */
import type { AppearanceTheme } from "@cityjson/navara-core";

/** The `<option>` value for a theme — kind and name are both needed back. */
export function appearanceOptionValue(theme: AppearanceTheme | null): string {
  return theme ? `${theme.kind}:${theme.name}` : "";
}

export function appearanceFromOptionValue(
  value: string,
  themes: ReadonlyArray<AppearanceTheme>,
): AppearanceTheme | null {
  if (value === "") return null;
  return themes.find((t) => appearanceOptionValue(t) === value) ?? null;
}
