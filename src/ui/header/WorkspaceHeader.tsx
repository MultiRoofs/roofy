/**
 * The viewer's header: the WORKSPACE's home.
 *
 * The design model gives each subject exactly one place — workspace in the
 * header, scene on the map, layer in the left panel, selection in the right —
 * and this component is the first half of that: identity (the lockup and the
 * workspace's name) at the left, and the things you do to the whole workspace
 * (Save, Share, Preferences) at the right. The scene's controls arrive as a
 * `sceneControls` node rather than being built here, because they are lodgers:
 * 12.5 moves them onto the map and deletes `SceneControlsTemp` whole.
 *
 * The two panel-collapse buttons sit at the header's INNER edges — the layers
 * one just after the workspace name, above the panel it closes; the details
 * one at the very end, above its panel. A collapse button that is not over the
 * thing it collapses is a button you have to learn.
 *
 * The details button is disabled when there is nothing on the right at all,
 * and that is not a defensive check: without a right column (`ViewerShell`
 * gives it width 0) the button would collapse nothing. Two things put
 * something there — a selection, or the processing toolbox, which occupies
 * the same column with or without one (spec §4.2). Miss the second and a
 * toolbox-only session can never collapse the panel, which is the only way to
 * reach §4.2's "Tools" pill. Both are read from their stores directly rather
 * than taken as props — the formulas already exist in App and in
 * `ViewerShell`, and a third copy passed down as a boolean would be a third
 * thing to keep in step.
 *
 * "Saved · just now" replaces nothing — the save toast still explains where
 * the workspace went. This is the acknowledgement AT the button, muted, for
 * five seconds, and it appears only when the save actually happened: `onSave`
 * answers `false` when the camera was not readable yet or the store refused,
 * and a tick over a save that never landed is worse than no tick at all.
 */
import { useEffect, useRef, useState } from "react";
import { RoofyLockup } from "../RoofyLockup";
import { useShellStore } from "../shell/shellStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { useProcessingStore } from "../../features/processing/processingStore";
import type { SnapshotSummary } from "../../persistence/types";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { PreferencesMenu } from "./PreferencesMenu";
import { SceneExportMenu } from "./SceneExportMenu";
import type { SceneExportFormat } from "../../features/export/browserSceneExport";

/** How long "Saved · just now" stays up. Long enough to be read by someone
 *  who was looking at the map when they clicked, short enough not to become
 *  a permanent lie about how recent the save is. */
const SAVED_NOTE_MS = 5000;

export interface WorkspaceHeaderProps {
  readonly onExportScene?: (format: SceneExportFormat) => Promise<void>;
  /** Resolves `true` only when a snapshot was really written. */
  readonly onSave: () => Promise<boolean>;
  readonly onShare: () => void;
  readonly canShare: boolean;
  readonly onNewWorkspace: () => void;
  readonly onOpenWorkspace: (id: string) => void;
  readonly snapshots: ReadonlyArray<SnapshotSummary>;
}

export function WorkspaceHeader({
  onExportScene,
  onSave,
  onShare,
  canShare,
  onNewWorkspace,
  onOpenWorkspace,
  snapshots,
}: WorkspaceHeaderProps) {
  const leftCollapsed = useShellStore((s) => s.leftCollapsed);
  const toggleLeftCollapsed = useShellStore((s) => s.toggleLeftCollapsed);
  const rightCollapsed = useShellStore((s) => s.rightCollapsed);
  const toggleRightCollapsed = useShellStore((s) => s.toggleRightCollapsed);
  const hasSelection = useSelectionStore(
    (s) => s.selections.length > 0 || s.geoSelection !== null,
  );
  const toolboxOpen = useProcessingStore((s) => s.open);

  const [savedNote, setSavedNote] = useState(false);
  /** One timer, held so a second save re-arms it instead of letting the first
   *  one's expiry take the second's note down with it. */
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  const handleSave = async () => {
    const saved = await onSave();
    if (!saved) return;
    if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    setSavedNote(true);
    savedTimerRef.current = setTimeout(
      () => setSavedNote(false),
      SAVED_NOTE_MS,
    );
  };

  return (
    <header className="workspace-header">
      {/* The mark's four fills are the --layer-* tokens from brand.css, which
          re-point under [data-theme="light"], so the logo follows the
          interface appearance with no JS. `small` picks the kit's ≤20px
          geometry. The SVG is decorative — the wordmark is the name. */}
      <RoofyLockup small />

      <WorkspaceMenu
        snapshots={snapshots}
        onNewWorkspace={onNewWorkspace}
        onOpenWorkspace={onOpenWorkspace}
        onSave={() => void handleSave()}
      />

      <button
        type="button"
        className="tb-btn"
        aria-label={
          leftCollapsed ? "Expand layers panel" : "Collapse layers panel"
        }
        data-tooltip={
          leftCollapsed ? "Expand layers panel" : "Collapse layers panel"
        }
        onClick={toggleLeftCollapsed}
      >
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
          {/* The chevron points the way the panel is about to move. */}
          <path d={leftCollapsed ? "M13 9l3 3-3 3" : "M16 9l-3 3 3 3"} />
        </svg>
      </button>

      <div className="header-spacer" />
      {onExportScene && <SceneExportMenu onExport={onExportScene} />}

      {/* The note is positioned against this wrapper, in the flexible gap to
          the button's left, rather than sitting beside it in flow: a
          confirmation that shoves Save, Share and Preferences sideways when it
          arrives — and back again five seconds later — moves the button the
          user just pressed. */}
      <span className="header-save">
        <button
          type="button"
          className="header-action"
          aria-label="Save workspace"
          onClick={() => void handleSave()}
        >
          <svg viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
          <span>Save</span>
        </button>
        {savedNote && (
          <span className="header-saved-note">Saved · just now</span>
        )}
      </span>

      {/* Named for what it OPENS: the click raises `ShareDialog`, which shows
          the link and copies it. Disabled rather than hidden when there is
          nothing to link to — a header whose buttons come and go is a header
          you cannot aim at — and the tooltip says why. */}
      <button
        type="button"
        className="header-action"
        aria-label="Share this view"
        disabled={!canShare}
        data-tooltip={
          canShare
            ? "Share this view"
            : "Sharing needs a layer loaded from a URL"
        }
        data-tooltip-align="end"
        onClick={onShare}
      >
        <svg viewBox="0 0 24 24">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        <span>Share</span>
      </button>

      <PreferencesMenu tooltip />

      <button
        type="button"
        className="tb-btn"
        aria-label={
          rightCollapsed ? "Expand details panel" : "Collapse details panel"
        }
        data-tooltip={
          rightCollapsed ? "Expand details panel" : "Collapse details panel"
        }
        data-tooltip-align="end"
        disabled={!hasSelection && !toolboxOpen}
        onClick={toggleRightCollapsed}
      >
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M15 3v18" />
          <path d={rightCollapsed ? "M11 9l-3 3 3 3" : "M8 9l3 3-3 3"} />
        </svg>
      </button>
    </header>
  );
}
