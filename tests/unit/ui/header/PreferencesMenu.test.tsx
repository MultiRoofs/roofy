/**
 * The Preferences popover — the app's ONE home for interface appearance now
 * that the sun/moon toggle is gone from the header and the landing page.
 *
 * The tests care about two things: that the segmented control writes a
 * PREFERENCE (not a theme), and that whichever preference is chosen ends up
 * stamped on `<html data-theme>` — including "System", which is the case a
 * "clear the override" implementation would get wrong.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreferencesMenu } from "../../../../src/ui/header/PreferencesMenu";
import { useThemeStore } from "../../../../src/features/theme/themeStore";

/** What the deleted sun/moon button was called, in either of its two states.
 *  Appearance has one home now (this popover) and no second control anywhere. */
const THEME_TOGGLE_NAME = /toggle theme|switch to (dark|light)/i;

let osPrefersDark = false;

beforeEach(() => {
  osPrefersDark = false;
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches(): boolean {
      return query.includes("dark") ? osPrefersDark : !osPrefersDark;
    },
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  useThemeStore.setState({ preference: "system", theme: "light" });
});

afterEach(cleanup);

function openMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "Preferences" }));
}

describe("PreferencesMenu", () => {
  it("opens a popover holding the interface-appearance choice", () => {
    render(<PreferencesMenu />);
    expect(screen.queryByRole("dialog")).toBeNull();

    openMenu();

    const dialog = screen.getByRole("dialog", { name: "Preferences" });
    expect(dialog).toContainElement(
      screen.getByRole("group", { name: "Interface appearance" }),
    );
    for (const name of ["System", "Light", "Dark"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("marks the current preference as pressed", () => {
    useThemeStore.setState({ preference: "dark", theme: "dark" });
    render(<PreferencesMenu />);
    openMenu();

    expect(
      screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "System" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  for (const choice of ["light", "dark"] as const) {
    it(`stamps data-theme="${choice}" when ${choice} is chosen`, () => {
      render(<PreferencesMenu />);
      openMenu();

      fireEvent.click(
        screen.getByRole("button", {
          name: choice === "light" ? "Light" : "Dark",
        }),
      );

      expect(useThemeStore.getState().preference).toBe(choice);
      expect(document.documentElement.dataset.theme).toBe(choice);
    });
  }

  it("stamps the OS's answer — not nothing — when System is chosen", () => {
    osPrefersDark = true;
    render(<PreferencesMenu />);
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Light" }));

    fireEvent.click(screen.getByRole("button", { name: "System" }));

    expect(useThemeStore.getState().preference).toBe("system");
    // The override is cleared, the STAMP is not: everything downstream reads
    // one attribute and never has to ask the OS itself.
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("closes on Escape and puts the focus back on the gear", () => {
    render(<PreferencesMenu />);
    openMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Preferences" }),
    );
  });

  it("closes on a click outside it", () => {
    render(<PreferencesMenu />);
    openMenu();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is the only appearance control — no toggle survives beside it", () => {
    render(<PreferencesMenu />);
    openMenu();
    // Named by what a user would reach for, not by a class that no longer
    // exists anywhere: a `.theme-toggle-btn` query would pass whatever the
    // component rendered.
    expect(
      screen
        .getAllByRole("button")
        .filter((b) =>
          THEME_TOGGLE_NAME.test(
            b.getAttribute("aria-label") ?? b.textContent ?? "",
          ),
        ),
    ).toEqual([]);
  });
});
