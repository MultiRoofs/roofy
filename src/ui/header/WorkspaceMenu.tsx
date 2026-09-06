/**
 * The workspace's name, and the menu behind it.
 *
 * The header used to carry a save icon and a "Close file" X — two anonymous
 * glyphs for a subject that has a name, a history and four things you can do
 * to it. Naming the workspace on its own button turns those into one place:
 * the button says which workspace you are in, and opening it says what can be
 * done to it.
 *
 * "New workspace" is what "Close file" was: it empties the workspace and hands
 * you back the landing page. Said as a beginning rather than as an ending,
 * because that is what the user is doing — and because it now also resets the
 * name, which "close" would not have implied.
 *
 * Rename is INLINE rather than a dialog: it is one field and the name is
 * already on screen behind the menu. Escape abandons the edit and is kept from
 * the popover's own Escape handler (`stopPropagation`), so the first press
 * cancels the rename rather than dismissing the menu under the user's hands.
 */
import { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../../features/workspace/workspaceStore";
import type { SnapshotSummary } from "../../persistence/types";
import { useHeaderMenu } from "./useHeaderMenu";

export interface WorkspaceMenuProps {
  readonly snapshots: ReadonlyArray<SnapshotSummary>;
  readonly onNewWorkspace: () => void;
  readonly onOpenWorkspace: (id: string) => void;
  readonly onSave: () => void;
}

/** The date a snapshot was saved, in the reader's own locale. Defensive about
 *  the value because it comes off disk: a snapshot written by an older build
 *  can carry anything, and a menu row reading "Invalid Date" is worse than a
 *  row with no date. */
function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function WorkspaceMenu({
  snapshots,
  onNewWorkspace,
  onOpenWorkspace,
  onSave,
}: WorkspaceMenuProps) {
  const name = useWorkspaceStore((s) => s.name);
  const setName = useWorkspaceStore((s) => s.setName);
  const { open, setOpen, toggle, rootRef, triggerRef } = useHeaderMenu();
  const [renaming, setRenaming] = useState(false);
  const [openListShown, setOpenListShown] = useState(false);
  const [draft, setDraft] = useState(name);
  const fieldRef = useRef<HTMLInputElement>(null);

  // A menu that is dismissed mid-rename must not reopen still in the edit it
  // was abandoned in, nor still showing a snapshot list nobody asked for.
  useEffect(() => {
    if (open) return;
    setRenaming(false);
    setOpenListShown(false);
  }, [open]);

  useEffect(() => {
    if (renaming) fieldRef.current?.select();
  }, [renaming]);

  /** Keep the edit. `setName` trims and falls back to the default name, so an
   *  empty field cannot leave the workspace unnamed. */
  const keepRename = () => {
    setName(draft);
    setRenaming(false);
  };

  /**
   * Enter: keep the edit AND leave the menu — the user has finished.
   *
   * Blur does NOT do this. Blur fires on the mousedown that is on its way to
   * another menu item, and closing the menu there would unmount the item
   * before its click landed: "rename, then Save" would silently save nothing.
   * Blur therefore only commits; the menu decides its own fate.
   */
  const commitRename = () => {
    keepRename();
    setOpen(false);
    triggerRef.current?.focus();
  };

  const act = (run: () => void) => {
    run();
    setOpen(false);
  };

  return (
    <div className="header-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-name-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setDraft(name);
          toggle();
        }}
      >
        <span className="workspace-name-text">{name}</span>
        <svg className="workspace-name-caret" viewBox="0 0 24 24" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="header-popover workspace-menu-popover"
          role="menu"
          aria-label="Workspace"
        >
          {renaming ? (
            <div className="workspace-menu-rename">
              <input
                ref={fieldRef}
                className="workspace-rename-field"
                aria-label="Workspace name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitRename();
                    return;
                  }
                  if (e.key !== "Escape") return;
                  // Escape belongs to the field while an edit is in progress:
                  // the menu's own handler would close the popover instead,
                  // and `useEscapeClearsSelection` already stands down for a
                  // focused text field.
                  e.stopPropagation();
                  setDraft(name);
                  setRenaming(false);
                }}
                onBlur={keepRename}
              />
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => setRenaming(true)}
            >
              Rename
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => act(onNewWorkspace)}
          >
            New workspace
          </button>

          <button
            type="button"
            role="menuitem"
            className="menu-item"
            aria-expanded={openListShown}
            onClick={() => setOpenListShown((v) => !v)}
          >
            Open…
          </button>

          {openListShown && (
            <div className="workspace-menu-snapshots">
              {snapshots.length === 0 ? (
                <p className="workspace-menu-empty">No saved workspaces yet</p>
              ) : (
                snapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    role="menuitem"
                    className="menu-item workspace-snapshot"
                    onClick={() => act(() => onOpenWorkspace(snapshot.id))}
                  >
                    <span className="workspace-snapshot-label">
                      {snapshot.label}
                    </span>
                    <span className="workspace-snapshot-date">
                      {formatSavedAt(snapshot.savedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="menu-sep" />

          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => act(onSave)}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
