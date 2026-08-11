/**
 * The share link, shown rather than posted.
 *
 * Sharing used to be a clipboard write with a 2.5 s toast behind it. Two
 * things were wrong with that. The evidence was gone before most people
 * looked for it — users clicked Share repeatedly, unsure anything had
 * happened — and when the clipboard write was REFUSED (an insecure origin, a
 * denied permission, a browser that only honours a write inside the user
 * gesture the promise chain had already left) the app had nothing to offer
 * but a sentence about "clipboard permissions" and no link.
 *
 * So the link is rendered in a read-only, selectable field that works whether
 * or not anything reached the clipboard, the automatic copy still happens on
 * open (the common case stays one click), and the result is stated INLINE,
 * in `role="status"`, in the dialog the user is already looking at. The Copy
 * button retries and rewrites that same line.
 *
 * `copyToClipboard` is a prop, not a reach for `navigator.clipboard`: `App`
 * passes `platform.clipboard.writeText`, which keeps this component
 * platform-agnostic (a Tauri shell supplies its own) and testable under
 * jsdom, which has no clipboard at all.
 *
 * Everything else — focus capture/restore, scroll lock, Escape, the Tab trap
 * — is {@link useModalChrome}, shared with `AddLayerDialog` and
 * `StacBrowserDialog`, so the three dialogs cannot drift apart.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { useModalChrome } from "./useModalChrome";

export interface ShareDialogProps {
  /** The minted share URL. Fixed for the dialog's lifetime — a new share
   *  click mints a new one and remounts. */
  readonly url: string;
  readonly onClose: () => void;
  /** Resolves whether the text reached the clipboard. A rejection is treated
   *  as a refusal, not an exception: `platform.clipboard.writeText` already
   *  resolves `false` on failure, but a shell that throws must still leave
   *  the user with a message rather than a blank status line. */
  readonly copyToClipboard: (text: string) => Promise<boolean>;
}

/** What the inline line says. Not a toast: the user has to be able to read it
 *  while deciding whether to select the field by hand. */
const COPIED = "Link copied to clipboard.";
const NOT_COPIED =
  "Couldn't copy automatically — select the link above and copy it manually.";

type CopyState = "pending" | "copied" | "failed";

export function ShareDialog({
  url,
  onClose,
  copyToClipboard,
}: ShareDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CopyState>("pending");
  const fieldId = useId();

  useModalChrome(dialogRef, onClose);

  /** Which attempt is allowed to write the message. StrictMode mounts the
   *  effect twice and the Copy button can be clicked while an earlier attempt
   *  is still in flight; without this, a slow first answer could overwrite a
   *  later, truer one. */
  const attemptRef = useRef(0);

  const attemptCopy = useCallback(() => {
    const attempt = ++attemptRef.current;
    void copyToClipboard(url)
      .catch(() => false)
      .then((ok) => {
        if (attemptRef.current !== attempt) return;
        setState(ok ? "copied" : "failed");
      });
  }, [copyToClipboard, url]);

  // The automatic copy, so the common case is still one click.
  useEffect(() => {
    attemptCopy();
  }, [attemptCopy]);

  /** Select the whole link, so a manual Cmd/Ctrl-C is one keystroke away when
   *  the automatic copy was refused. */
  const selectAll = useCallback(() => {
    inputRef.current?.select();
  }, []);

  // mousedown, not click: a text selection that STARTS inside the dialog and
  // ends on the backdrop raises a click whose target is the backdrop, and
  // closing on that throws away the link the user was selecting — which in
  // this dialog is the fallback path itself.
  const handleBackdropMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      // preventDefault, or the browser's own mousedown behaviour moves focus
      // to the backdrop's nearest focusable ancestor (<body>) AFTER this
      // handler has already put focus back on the trigger.
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      data-testid="share-dialog-backdrop"
    >
      <div
        ref={dialogRef}
        className="modal share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="share-dialog-title">
            Share this view
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="share-hint">
            Anyone opening this link gets the layers, rules and viewpoint you
            are looking at now.
          </p>
          <div className="share-row">
            {/* The field's name is carried by `aria-label`, not a visible
                <label>: the dialog's title and hint already say what the box
                holds, and a third caption over one input reads as clutter. */}
            <input
              id={fieldId}
              aria-label="Share link"
              ref={inputRef}
              className="share-url"
              type="text"
              readOnly
              value={url}
              onFocus={selectAll}
              onClick={selectAll}
            />
            <button
              type="button"
              className="share-copy-btn"
              onClick={attemptCopy}
            >
              Copy
            </button>
          </div>
          {/* Always mounted, so a screen reader has the live region in place
              before the first answer lands in it. */}
          <p
            className={`share-status${state === "failed" ? " is-error" : ""}`}
            role="status"
          >
            {state === "copied" ? COPIED : state === "failed" ? NOT_COPIED : ""}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
