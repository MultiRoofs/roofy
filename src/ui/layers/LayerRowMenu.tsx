/**
 * The overflow menu on a layer row.
 *
 * The incumbent row wore its actions on its face — a zoom button, a table
 * button, a trash button, all three competing with the name for a 240 px
 * line, and the trash sitting one mis-click from the eye. Here the row keeps
 * only what is worth a permanent target (the eye, which is toggled constantly)
 * and everything else moves behind one `⋯`: the actions are rarer than the
 * name is read, and a destructive one should cost a deliberate second click.
 *
 * Mechanics come from {@link useHeaderMenu} — click-outside, Escape, and the
 * focus ring handed back to the trigger — rather than a fourth hand-written
 * copy of the same two listeners.
 *
 * `role="dialog"`, not `role="menu"`: a real menu owes the keyboard arrow
 * navigation, roving tabindex and typeahead, and a half-built one lies to a
 * screen reader about what it can do. Same choice, for the same reason, as
 * `WorkspaceMenu`.
 *
 * PORTALLED, unlike the header's three, because of where the row lives: the
 * left panel scrolls its layer list (`overflow-y: auto`), and an absolutely
 * positioned popover inside a scroll container is clipped by it — the last
 * row's menu would open into a strip four pixels tall. Flipping it upwards
 * only moves the problem: a two-row list is shorter than the popover either
 * way. So the popover goes to `document.body` and is placed against the
 * trigger's rect and its OWN measured box when it opens — right-aligned on
 * the trigger, and flipped above it when it would otherwise hang off the
 * bottom of the window. Measured rather than assumed: a width duplicated
 * here from `app.css` is a width that drifts from it silently, and the
 * height is not knowable at all (the menu has three items or five).
 *
 * Two consequences the code below has to pay for:
 *  - it is "outside" the menu's root by DOM ancestry, so the dismiss listener
 *    is told about it through `useHeaderMenu`'s `popoverRef` — otherwise the
 *    mousedown that starts a click on an item closes the menu first and the
 *    click lands on nothing;
 *  - it no longer moves with the row. A scroll or a resize while it is open
 *    would leave it hanging beside the list, so both CLOSE it rather than
 *    chase the trigger (a menu is a moment, not a state).
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useHeaderMenu } from "../header/useHeaderMenu";

export interface LayerRowMenuProps {
  /** The layer's name, for the trigger's accessible name: a list of rows all
   *  announcing "Layer actions" says nothing about which layer is about to be
   *  acted on. */
  readonly name: string;
  /** `null` for a row with no extent to fly to; the item is then absent, for
   *  the same reason `onOpenTable`'s is — `GeoLayerRow` learned that a button
   *  which could only ever toast teaches users to ignore the whole cluster. */
  readonly onZoom: (() => void) | null;
  /** `null` for a row with no table — a geospatial layer has no attributes
   *  to open. The item is then absent rather than disabled: a permanently
   *  greyed row teaches nothing. */
  readonly onOpenTable: (() => void) | null;
  /** §6.2's derived-layer item. `undefined` omits it (an ordinary layer has no
   *  run log at all); `null` renders it DISABLED, for a derived layer whose run
   *  has left the 20-run history. */
  readonly onShowRunLog?: (() => void) | null;
  /** Puts the ROW into its rename edit; the row owns that state and commits
   *  it, because the field lives in the row, not in this popover. */
  readonly onStartRename: () => void;
  readonly onRemove: () => void;
}

/** The gap between the trigger and the popover, matching `.header-popover`'s
 *  `calc(100% + 0.35rem)`. */
const POPOVER_GAP = 6;

export function LayerRowMenu({
  name,
  onZoom,
  onOpenTable,
  onShowRunLog,
  onStartRename,
  onRemove,
}: LayerRowMenuProps) {
  // Kept whole rather than destructured: `toggle` and `setOpen` are declared
  // as METHODS on `HeaderMenu`, and pulling them out is the unbound-method
  // reference the lint objects to. Called through the object, they are calls.
  const menu = useHeaderMenu();
  const [at, setAt] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  // Before paint, so the popover is never painted at the previous row's
  // position for a frame. The popover is already mounted by the time this
  // runs — that is what makes measuring it here possible at all.
  useLayoutEffect(() => {
    if (!menu.open) return;
    const rect = menu.triggerRef.current?.getBoundingClientRect();
    const box = menu.popoverRef.current;
    if (!rect || !box) return;
    const { offsetWidth: width, offsetHeight: height } = box;
    const below = rect.bottom + POPOVER_GAP;
    // Flipped above the trigger when the menu would hang off the bottom of
    // the window — the last row of a list is exactly where the `⋯` is
    // reached most often, and a menu half off screen is a menu with items
    // nobody can click.
    const flip = below + height > window.innerHeight;
    setAt({
      top: flip ? rect.top - POPOVER_GAP - height : below,
      // Right-aligned on the trigger, as the in-flow version was: the row
      // fills a 240–420 px panel, so a left-anchored popover hangs off it.
      left: rect.right - width,
    });
  }, [menu.open, menu.triggerRef, menu.popoverRef]);

  // A popover pinned to the viewport cannot follow the list under it, so a
  // scroll or a resize CLOSES it rather than leaving it hanging beside the
  // row it belongs to. The scroll listener is capturing because the scroll
  // that matters happens on the list container, not on the window, and a
  // scroll event does not bubble.
  //
  // `[menu]` is a new object every render, so this re-subscribes on each one:
  // deliberate, and cheap — the body returns immediately while the menu is
  // closed, which is nearly always, and destructuring `setOpen` out of a
  // `HeaderMenu` is the unbound-method reference the lint refuses.
  useEffect(() => {
    if (!menu.open) return;
    const close = () => menu.setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const act = (run: () => void) => {
    run();
    menu.setOpen(false);
  };

  return (
    // The whole cluster swallows clicks: every one of them is an action on the
    // row, and none of them is "make this row active".
    <div
      className="layer-row-menu"
      ref={menu.rootRef}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        ref={menu.triggerRef}
        type="button"
        className="layer-row-menu-btn"
        aria-label={`Layer actions for ${name}`}
        aria-haspopup="dialog"
        aria-expanded={menu.open}
        onClick={() => menu.toggle()}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      {menu.open &&
        createPortal(
          <div
            ref={menu.popoverRef}
            className="header-popover layer-row-menu-popover"
            role="dialog"
            aria-label="Layer actions"
            style={{ top: at.top, left: at.left }}
            // The portal escapes the row in the DOM but not in the REACT
            // tree, so a click on an item still bubbles to the wrapper above
            // — which is what stops it from also activating the row.
          >
            {onZoom !== null && (
              <button
                type="button"
                className="menu-item"
                onClick={() => act(onZoom)}
              >
                Zoom to layer
              </button>
            )}
            {onOpenTable !== null && (
              <button
                type="button"
                className="menu-item"
                onClick={() => act(onOpenTable)}
              >
                Open table
              </button>
            )}
            {onShowRunLog !== undefined && (
              // DISABLED rather than absent when the run has aged out of the
              // 20-run history: a derived layer that still has its log and one
              // whose log is gone must not look the same.
              <button
                type="button"
                className="menu-item"
                disabled={onShowRunLog === null}
                onClick={() => {
                  if (onShowRunLog !== null) act(onShowRunLog);
                }}
              >
                Show run log
              </button>
            )}
            <button
              type="button"
              className="menu-item"
              onClick={() => act(onStartRename)}
            >
              Rename
            </button>
            <hr className="menu-sep" />
            <button
              type="button"
              className="menu-item menu-item-danger"
              onClick={() => act(onRemove)}
            >
              Remove
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
