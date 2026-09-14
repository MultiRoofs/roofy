/**
 * The interface appearance: a PREFERENCE (system / light / dark) and the
 * EFFECTIVE theme it resolves to.
 *
 * Why a store and not the old `useTheme` hook's local state: appearance is now
 * a setting inside Preferences rather than a toggle button, and two surfaces
 * offer it (the landing page and the viewer header). Two copies of a
 * `useState` would have disagreed the moment the app crossed between them.
 *
 * ONE RULE, and everything here exists to keep it: the effective theme is
 * ALWAYS stamped on `<html data-theme>`. "System" does not mean "no stamp" —
 * it means the stamp follows the OS. That is what lets every downstream
 * reader (brand.css's `[data-theme="light"]` block, `sceneThemePolicy`, the
 * plugins' `colors`) answer "which theme?" by reading one attribute, with no
 * second code path for "the OS decides".
 *
 * Two things write the stamp and both go through {@link stamp}:
 * {@link ThemeActions.setPreference}, synchronously, so a click paints without
 * waiting for an effect; and {@link installThemeListener}, which App installs
 * once and which re-resolves whenever the OS flips — but only while the
 * preference is "system".
 *
 * The preference is stored under a NEW key (`roofy-theme-preference`). The
 * old `roofy-theme` key is deleted on the first read and never honoured: the
 * old hook wrote it on every mount, so treating it as a choice would have
 * left every returning user pinned to an explicit theme they never picked.
 * System is the default for everyone.
 */
import { create } from "zustand";

/** What the app actually renders as. */
export type Theme = "dark" | "light";

/** What the user asked for. "system" resolves to a {@link Theme} at read
 *  time and re-resolves whenever the OS changes. */
export type ThemePreference = "system" | "light" | "dark";

/**
 * Where the PREFERENCE is kept — a new key, deliberately.
 *
 * The old hook stored an effective theme under {@link LEGACY_THEME_STORAGE_KEY}
 * and wrote it on EVERY mount, so every returning user has one whether or not
 * they ever chose anything. Reading those values as explicit preferences would
 * have meant nobody ever landed on "System": the whole point of this change
 * would have reached only brand-new users. A new key makes System the default
 * for everyone, and the old key is deleted on the first read so it cannot rot
 * in storage as a value nothing reads.
 */
export const THEME_STORAGE_KEY = "roofy-theme-preference";

/** The old hook's key. Removed on the first read, never honoured. */
export const LEGACY_THEME_STORAGE_KEY = "roofy-theme";

/** The one media query. Per the CSS spec a UA with no user preference reports
 *  `light`, so this single query answers both directions. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

export interface ThemeState {
  readonly preference: ThemePreference;
  /** The resolved theme — never null, never "system". */
  readonly theme: Theme;
}

export interface ThemeActions {
  /** Persists the preference, resolves it and stamps the result. */
  setPreference(preference: ThemePreference): void;
}

export type ThemeStore = ThemeState & ThemeActions;

/**
 * What the OS says right now.
 *
 * Guarded rather than assumed: this runs at module scope (the store's
 * initialiser), and jsdom ships no `matchMedia` — a bare call would throw
 * during the IMPORT of any module that transitively reaches this one, long
 * before a test's own `matchMedia` stub is installed. Dark is the fallback
 * because Roofy's own default look is the dark one.
 */
function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return "dark";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function readStoredPreference(): ThemePreference {
  let stored: string | null = null;
  try {
    // The old key is swept, not read — see THEME_STORAGE_KEY.
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // A blocked localStorage (private mode, a hardened profile) is not a
    // reason to fail to render: fall through to "system".
    return "system";
  }
  if (stored === "dark" || stored === "light" || stored === "system")
    return stored;
  return "system";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

/** The state the store boots with. Exported so the stored-value reading can
 *  be tested without re-importing the module. */
export function initialThemeState(): ThemeState {
  const preference = readStoredPreference();
  return { preference, theme: resolveTheme(preference) };
}

/**
 * Write the effective theme onto `<html>`.
 *
 * Deliberately not an effect: a preference click must repaint on the same
 * tick it is made, and the landing page renders `PreferencesMenu` outside any
 * component that owns the stamp.
 */
function stamp(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  ...initialThemeState(),
  setPreference: (preference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Not persisting is survivable; not applying would not be.
    }
    const theme = resolveTheme(preference);
    set({ preference, theme });
    stamp(theme);
  },
}));

/** The listener currently installed, so a second install (StrictMode's
 *  double effect, a hot reload) replaces rather than doubles it — the same
 *  idiom `installWorkspaceInvariants` uses. */
let disposeInstalled: (() => void) | null = null;

/**
 * Stamp the current effective theme and keep it in step with the OS.
 *
 * Installed ONCE by `App`. The immediate `apply()` is what puts the very
 * first stamp on the document; the `change` subscription is what makes
 * "System" mean anything after that.
 */
export function installThemeListener(): () => void {
  disposeInstalled?.();

  const apply = (): void => {
    const theme = resolveTheme(useThemeStore.getState().preference);
    if (useThemeStore.getState().theme !== theme)
      useThemeStore.setState({ theme });
    stamp(theme);
  };
  apply();

  const query =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DARK_QUERY)
      : null;

  const onChange = (): void => {
    // An explicit light/dark is an override, not a starting point: the OS may
    // flip underneath it as often as it likes.
    if (useThemeStore.getState().preference === "system") apply();
  };
  query?.addEventListener("change", onChange);

  const dispose = (): void => {
    query?.removeEventListener("change", onChange);
    if (disposeInstalled === dispose) disposeInstalled = null;
  };
  disposeInstalled = dispose;
  return dispose;
}
