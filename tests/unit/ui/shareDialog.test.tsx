/**
 * The share dialog: a link the user can SEE, plus an honest report of whether
 * it reached the clipboard.
 *
 * Sharing used to be a silent clipboard write with a 2.5 s toast — an action
 * whose only evidence vanished before most people looked at it, and which had
 * nothing to offer at all when the clipboard write was refused (an insecure
 * origin, a denied permission, a browser that only allows a write inside a
 * user gesture the `.then` had already left). So the link is now shown in a
 * selectable field that works even when nothing can be copied automatically,
 * and the copy result is stated inline, in the dialog the user is looking at.
 *
 * The component takes `copyToClipboard` as a prop rather than reaching for
 * `navigator.clipboard`: `App` passes `platform.clipboard.writeText`, and the
 * dialog stays platform-agnostic and testable under jsdom, which has no
 * clipboard at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ShareDialog } from "../../../src/ui/ShareDialog";

const URL_ = "https://viewer.test/#share=eyJ2IjozfQ";

afterEach(cleanup);

function renderDialog(
  overrides: {
    url?: string;
    onClose?: () => void;
    copyToClipboard?: (text: string) => Promise<boolean>;
  } = {},
) {
  const copyToClipboard =
    overrides.copyToClipboard ?? vi.fn(async () => true as boolean);
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <ShareDialog
      url={overrides.url ?? URL_}
      onClose={onClose}
      copyToClipboard={copyToClipboard}
    />,
  );
  return { copyToClipboard, onClose };
}

describe("ShareDialog", () => {
  it("shows the share link in a read-only field the user can select", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    const field = screen.getByLabelText("Share link") as HTMLInputElement;
    expect(field.value).toBe(URL_);
    // Read-only, not disabled: a disabled input cannot be selected, and
    // manual selection is the whole fallback when copying is refused.
    expect(field.readOnly).toBe(true);
    expect(field.disabled).toBe(false);
  });

  it("copies once on open and says so", async () => {
    const { copyToClipboard } = renderDialog();

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledTimes(1));
    expect(copyToClipboard).toHaveBeenCalledWith(URL_);

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/copied/i);
  });

  it("tells the user to copy it by hand when the clipboard refuses", async () => {
    renderDialog({ copyToClipboard: vi.fn(async () => false) });

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/couldn't copy/i);
    // ...and the link is still there to be selected.
    expect(
      (screen.getByLabelText("Share link") as HTMLInputElement).value,
    ).toBe(URL_);
  });

  it("treats a rejected clipboard write as a failure, not a blank message", async () => {
    renderDialog({
      copyToClipboard: vi.fn(async () => {
        throw new Error("NotAllowedError");
      }),
    });

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/couldn't copy/i);
  });

  it("retries on the Copy button and updates the same message", async () => {
    const copyToClipboard = vi
      .fn<(text: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderDialog({ copyToClipboard });

    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toMatch(/couldn't copy/i));

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/copied/i),
    );
    expect(copyToClipboard).toHaveBeenCalledTimes(2);
    expect(copyToClipboard).toHaveBeenLastCalledWith(URL_);
  });

  it("closes on Escape", () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the close button", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
