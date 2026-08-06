/**
 * The scene-theme popover.
 *
 * Four radios over a store, so what is worth pinning is the accessibility
 * contract (exactly one option checked, the trigger reporting the active theme)
 * and that picking one writes the store — the viewport's own wiring is asserted
 * in `navaraViewportTheme.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  DEFAULT_SCENE_THEME,
  useSceneThemeStore,
} from "../../../../src/features/sceneTheme/sceneThemeStore";
import { SceneThemeMenu } from "../../../../src/ui/toolbar/SceneThemeMenu";

beforeEach(() => {
  useSceneThemeStore.setState({ theme: DEFAULT_SCENE_THEME });
});

afterEach(() => {
  cleanup();
  useSceneThemeStore.setState({ theme: DEFAULT_SCENE_THEME });
});

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: /scene theme/i }));
  return screen.getByRole("dialog", { name: /scene theme/i });
}

describe("SceneThemeMenu", () => {
  it("keeps the popover closed until the trigger is pressed", () => {
    render(<SceneThemeMenu />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const trigger = screen.getByRole("button", { name: /scene theme/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("offers the four themes as radios, with the active one checked", () => {
    render(<SceneThemeMenu />);
    const dialog = openMenu();
    const radios = within(dialog).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(
      radios
        .map((r) => r.getAttribute("aria-checked"))
        .filter((v) => v === "true"),
    ).toHaveLength(1);
    expect(
      within(dialog)
        .getByRole("radio", { name: /photoreal/i })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("gives every theme a one-line description, so the names mean something", () => {
    render(<SceneThemeMenu />);
    const dialog = openMenu();
    for (const name of [/photoreal/i, /cartoon/i, /cyber/i, /wireframe/i]) {
      const radio = within(dialog).getByRole("radio", { name });
      // The accessible name is the label; the description is separate text
      // inside the same option, so the option carries strictly more than the
      // theme's name.
      expect(radio.textContent!.trim().length).toBeGreaterThan(12);
    }
  });

  it("writes the store when a theme is picked, and moves the checked state", () => {
    render(<SceneThemeMenu />);
    const dialog = openMenu();
    fireEvent.click(within(dialog).getByRole("radio", { name: /cyber/i }));
    expect(useSceneThemeStore.getState().theme).toBe("cyber");
    expect(
      within(dialog)
        .getByRole("radio", { name: /cyber/i })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(dialog)
        .getByRole("radio", { name: /photoreal/i })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("names the active theme on the toolbar button, so it reads without opening", () => {
    render(<SceneThemeMenu />);
    const trigger = screen.getByRole("button", { name: /scene theme/i });
    expect(trigger.getAttribute("title")).toMatch(/photoreal/i);
    // Not photoreal = the scene is being overridden, which the button says by
    // showing itself as pressed.
    expect(trigger.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /scene theme/i }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("radio", {
        name: /wireframe/i,
      }),
    );
    expect(trigger.getAttribute("title")).toMatch(/wireframe/i);
    expect(trigger.getAttribute("aria-pressed")).toBe("true");
  });

  it("closes on Escape and on an outside click", () => {
    render(<SceneThemeMenu />);
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
