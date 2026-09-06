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
 */
import { useHeaderMenu } from "../header/useHeaderMenu";

export interface LayerRowMenuProps {
  readonly onZoom: () => void;
  /** `null` for a row with no table — a geospatial layer has no attributes
   *  to open. The item is then absent rather than disabled: a permanently
   *  greyed row teaches nothing. */
  readonly onOpenTable: (() => void) | null;
  /** Puts the ROW into its rename edit; the row owns that state and commits
   *  it, because the field lives in the row, not in this popover. */
  readonly onStartRename: () => void;
  readonly onRemove: () => void;
}

export function LayerRowMenu({
  onZoom,
  onOpenTable,
  onStartRename,
  onRemove,
}: LayerRowMenuProps) {
  // Kept whole rather than destructured: `toggle` and `setOpen` are declared
  // as METHODS on `HeaderMenu`, and pulling them out is the unbound-method
  // reference the lint objects to. Called through the object, they are calls.
  const menu = useHeaderMenu();

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
        aria-label="Layer actions"
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

      {menu.open && (
        <div
          className="header-popover layer-row-menu-popover"
          role="dialog"
          aria-label="Layer actions"
        >
          <button
            type="button"
            className="menu-item"
            onClick={() => act(onZoom)}
          >
            Zoom to layer
          </button>
          {onOpenTable !== null && (
            <button
              type="button"
              className="menu-item"
              onClick={() => act(onOpenTable)}
            >
              Open table
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
        </div>
      )}
    </div>
  );
}
