/**
 * The selector hook over `themeStore`.
 *
 * Thin on purpose: the theme used to BE this hook's local state, which meant
 * every consumer had its own copy and the two surfaces that offer the setting
 * (the landing page and the viewer header) could disagree. The state lives in
 * the store now; this is the read.
 *
 * `theme` is the effective theme — already resolved, never "system" — and is
 * what UI should branch on. `preference` is what the Preferences popover
 * shows as selected.
 */
import { useThemeStore, type Theme, type ThemePreference } from "./themeStore";

export type { Theme, ThemePreference };

export function useTheme(): {
  theme: Theme;
  preference: ThemePreference;
  setPreference(p: ThemePreference): void;
} {
  const theme = useThemeStore((s) => s.theme);
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  return { theme, preference, setPreference };
}
