/**
 * The standalone catalog dialog: its own modal contract, nothing else.
 *
 * `StacBrowser` is mocked with a one-button stub. What is under test here is
 * the SHELL — that it is a real dialog (role, title, Escape, backdrop, close
 * button) and that adding a URL flows through it WITHOUT closing it. The
 * browser's own behaviour has its own suite; asserting it again through the
 * dialog would only re-test the crawl mock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const ADDED_URL = "https://x/a.city.json";

vi.mock("../../../../src/ui/stac/StacBrowser", () => ({
  StacBrowser: (props: { onAddUrl: (url: string) => Promise<boolean> }) => (
    <button type="button" onClick={() => props.onAddUrl(ADDED_URL)}>
      stub add
    </button>
  ),
}));

import { StacBrowserDialog } from "../../../../src/ui/stac/StacBrowserDialog";

afterEach(cleanup);

const noop = () => {};
const noopUrl = async () => true;

function renderDialog(
  overrides: {
    onClose?: () => void;
    onAddUrl?: (url: string) => Promise<boolean>;
  } = {},
) {
  return render(
    <StacBrowserDialog
      onClose={overrides.onClose ?? noop}
      onAddUrl={overrides.onAddUrl ?? noopUrl}
    />,
  );
}

describe("StacBrowserDialog", () => {
  it("renders a modal dialog titled '3D city model catalog'", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("3D city model catalog")).toBeTruthy();
    // The wide variant is load-bearing: without it the collection grid
    // collapses to a single column inside the 30rem default modal.
    expect(dialog.className).toContain("modal-wide");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop mousedown", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.mouseDown(screen.getByTestId("stac-dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a mousedown that lands inside the dialog", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("forwards an added URL and stays open — the catalog is multi-add", () => {
    const onClose = vi.fn();
    const onAddUrl = vi.fn(async () => true);
    renderDialog({ onClose, onAddUrl });

    fireEvent.click(screen.getByRole("button", { name: "stub add" }));
    fireEvent.click(screen.getByRole("button", { name: "stub add" }));

    expect(onAddUrl.mock.calls).toEqual([[ADDED_URL], [ADDED_URL]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("locks the page behind it and restores the scroll on unmount", () => {
    const { unmount } = renderDialog();
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
