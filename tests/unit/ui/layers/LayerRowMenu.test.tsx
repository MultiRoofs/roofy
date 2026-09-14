/**
 * The row's `⋯` popover, as a PORTAL.
 *
 * `LayerRow.test.tsx` covers what the menu offers and what its items do. This
 * file covers the three things that changed when the popover left the row's
 * DOM subtree for `document.body` (12.2 — the left panel scrolls its list, and
 * an absolutely positioned popover inside `overflow-y: auto` is clipped by
 * it):
 *
 *  - WHERE it lands. Nothing about the placement is CSS any more: the popover
 *    is `position: fixed` and this module writes `top`/`left` from the
 *    trigger's rect and the popover's own measured box — including the flip
 *    above the trigger when it would otherwise hang off the bottom of the
 *    window.
 *  - That a press OUTSIDE it still dismisses it. The dismiss listener now
 *    consults a second ref (the popover is "outside" the menu's root by DOM
 *    ancestry), and a ref pointing at the wrong element would swallow every
 *    outside press instead of only the popover's own.
 *  - That Escape still closes it AND hands the focus ring back to the `⋯`,
 *    which is the rule every popover in this app owes.
 *
 * jsdom measures nothing, so the boxes are supplied: `getBoundingClientRect`
 * on the trigger, `offsetWidth`/`offsetHeight` on the popover.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LayerRowMenu } from "../../../../src/ui/layers/LayerRowMenu";

const restores: Array<() => void> = [];

afterEach(() => {
  cleanup();
  while (restores.length > 0) restores.pop()?.();
});

function renderMenu(): HTMLElement {
  render(
    <LayerRowMenu
      name="Delft"
      onZoom={vi.fn()}
      onOpenTable={vi.fn()}
      onStartRename={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  return screen.getByRole("button", { name: "Layer actions for Delft" });
}

/** The trigger's box. Only `top`, `bottom` and `right` are read. */
function boxTrigger(
  trigger: HTMLElement,
  box: { top: number; bottom: number; right: number },
): void {
  trigger.getBoundingClientRect = () =>
    ({
      top: box.top,
      bottom: box.bottom,
      right: box.right,
      left: box.right - 20,
      width: 20,
      height: box.bottom - box.top,
      x: box.right - 20,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** The POPOVER's box, which does not exist until it opens — so the getters go
 *  on the prototype and answer only for the popover itself. */
function boxPopover(width: number, height: number): void {
  for (const [prop, value] of [
    ["offsetWidth", width],
    ["offsetHeight", height],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      prop,
    );
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("layer-row-menu-popover") ? value : 0;
      },
    });
    restores.push(() => {
      if (original)
        Object.defineProperty(HTMLElement.prototype, prop, original);
      else
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          prop
        ];
    });
  }
}

function setInnerHeight(px: number): void {
  const original = Object.getOwnPropertyDescriptor(window, "innerHeight");
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: px,
  });
  restores.push(() => {
    if (original) Object.defineProperty(window, "innerHeight", original);
  });
}

function popover(): HTMLElement {
  return screen.getByRole("dialog", { name: "Layer actions" });
}

describe("LayerRowMenu — the portalled popover's placement", () => {
  it("hangs under the trigger, right-aligned on its MEASURED width", () => {
    setInnerHeight(800);
    // Deliberately NOT the 160px the stylesheet asks for: the placement has
    // to come from what the popover MEASURES, not from a width duplicated in
    // this module and left to drift from the CSS.
    boxPopover(200, 130);
    const trigger = renderMenu();
    boxTrigger(trigger, { top: 100, bottom: 120, right: 300 });

    fireEvent.click(trigger);

    // 120 + the 6px gap; 300 − the measured 200, so the popover's right edge
    // meets the trigger's.
    expect(popover().style.top).toBe("126px");
    expect(popover().style.left).toBe("100px");
  });

  it("flips ABOVE the trigger when it would hang off the bottom", () => {
    // 180 + 6 + 130 = 316, well past the window's floor.
    setInnerHeight(200);
    boxPopover(200, 130);
    const trigger = renderMenu();
    boxTrigger(trigger, { top: 160, bottom: 180, right: 300 });

    fireEvent.click(trigger);

    // Above the TOP of the trigger, by the same gap: 160 − 6 − 130.
    expect(popover().style.top).toBe("24px");
    expect(popover().style.left).toBe("100px");
  });
});

describe("LayerRowMenu — dismissal from outside the portal", () => {
  it("closes on a press anywhere else on the page", () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    expect(popover()).toBeTruthy();

    // The document's own body: nothing to do with this menu. A dismiss guard
    // that pointed at an ANCESTOR of the popover rather than at the popover
    // would treat this as a press inside the menu and leave it open.
    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog", { name: "Layer actions" })).toBeNull();
  });

  it("closes on Escape and hands the focus ring back to the trigger", () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    expect(popover()).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Layer actions" })).toBeNull();
    // A popover that unmounts with the focus inside it strands the ring on
    // `<body>` and the keyboard user loses their place in the list.
    expect(document.activeElement).toBe(trigger);
  });
});
