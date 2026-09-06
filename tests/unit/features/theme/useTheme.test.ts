/**
 * The interface-appearance PREFERENCE: system / light / dark.
 *
 * The rule these tests pin is that the EFFECTIVE theme is always stamped on
 * `<html data-theme>`. "System" is not an absence of a stamp — it is a stamp
 * that follows the OS, so nothing downstream (brand.css's `[data-theme]`
 * overrides, `sceneThemePolicy`, the plugins' `colors`) ever has to ask what
 * the OS thinks; it reads one attribute.
 *
 * `matchMedia` is faked with a listener registry rather than the inert stub
 * the App tests use, because half of what is under test here is what happens
 * when the OS flips WHILE the app is running.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useThemeStore,
  installThemeListener,
  initialThemeState,
  THEME_STORAGE_KEY,
} from "../../../../src/features/theme/themeStore";
import { useTheme } from "../../../../src/features/theme/useTheme";

type Listener = (event: MediaQueryListEvent) => void;

let osPrefersDark = false;
const listeners = new Set<Listener>();

function installMatchMedia(): void {
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches(): boolean {
      // Only the dark query is consulted by the store; the light one is
      // answered consistently so a stray reader cannot see both as false.
      return query.includes("dark") ? osPrefersDark : !osPrefersDark;
    },
    onchange: null,
    addEventListener: (_type: string, l: Listener) => {
      listeners.add(l);
    },
    removeEventListener: (_type: string, l: Listener) => {
      listeners.delete(l);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Flip the OS preference and notify everyone listening, as a real browser
 *  does when the user switches their system appearance. */
function setOsPrefersDark(value: boolean): void {
  osPrefersDark = value;
  for (const l of [...listeners]) l({ matches: value } as MediaQueryListEvent);
}

function stamped(): string | undefined {
  return document.documentElement.dataset.theme;
}

let dispose: (() => void) | null = null;

beforeEach(() => {
  osPrefersDark = false;
  installMatchMedia();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  useThemeStore.setState({ preference: "system", theme: "light" });
});

afterEach(() => {
  dispose?.();
  dispose = null;
});

describe("theme preference — stored value", () => {
  it("defaults to system when nothing has been stored", () => {
    expect(initialThemeState().preference).toBe("system");
  });

  for (const legacy of ["dark", "light"] as const) {
    it(`reads the legacy stored value "${legacy}" as an explicit preference`, () => {
      localStorage.setItem(THEME_STORAGE_KEY, legacy);
      const state = initialThemeState();
      expect(state.preference).toBe(legacy);
      // Explicit means explicit: the OS says the opposite here.
      osPrefersDark = legacy === "light";
      expect(initialThemeState().theme).toBe(legacy);
    });
  }

  it("treats an unrecognised stored value as system rather than crashing", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    expect(initialThemeState().preference).toBe("system");
  });
});

describe("theme preference — system follows the OS", () => {
  it("stamps the effective theme for system, and restamps when the OS flips", () => {
    dispose = installThemeListener();
    expect(useThemeStore.getState().theme).toBe("light");
    expect(stamped()).toBe("light");

    act(() => setOsPrefersDark(true));

    expect(useThemeStore.getState().theme).toBe("dark");
    // "System" is never an absent stamp — it is a stamp that moves.
    expect(stamped()).toBe("dark");
    expect(useThemeStore.getState().preference).toBe("system");
  });

  it("ignores OS changes once the preference is explicit", () => {
    dispose = installThemeListener();
    act(() => useThemeStore.getState().setPreference("light"));
    expect(stamped()).toBe("light");

    act(() => setOsPrefersDark(true));

    expect(useThemeStore.getState().theme).toBe("light");
    expect(stamped()).toBe("light");
  });

  it("returns to following the OS when the preference goes back to system", () => {
    dispose = installThemeListener();
    act(() => useThemeStore.getState().setPreference("light"));
    osPrefersDark = true;

    act(() => useThemeStore.getState().setPreference("system"));

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(stamped()).toBe("dark");
  });

  it("stamps without a listener installed — setPreference is not deferred", () => {
    act(() => useThemeStore.getState().setPreference("dark"));
    expect(stamped()).toBe("dark");
  });

  it("persists the preference, not the effective theme", () => {
    dispose = installThemeListener();
    act(() => useThemeStore.getState().setPreference("system"));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("stops listening once disposed", () => {
    const stop = installThemeListener();
    stop();
    act(() => setOsPrefersDark(true));
    expect(useThemeStore.getState().theme).toBe("light");
  });
});

describe("useTheme", () => {
  it("reports the preference and the effective theme, and sets the preference", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");

    act(() => result.current.setPreference("dark"));

    expect(result.current.preference).toBe("dark");
    expect(result.current.theme).toBe("dark");
  });

  it("keeps the theme across a remount — landing page to viewer shell", () => {
    const first = renderHook(() => useTheme());
    act(() => first.result.current.setPreference("light"));
    first.unmount();

    const second = renderHook(() => useTheme());
    expect(second.result.current.theme).toBe("light");
    expect(second.result.current.preference).toBe("light");
    expect(stamped()).toBe("light");
  });
});
