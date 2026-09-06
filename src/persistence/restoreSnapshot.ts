/**
 * Restore viewer state from a ProjectSnapshot.
 *
 * Writes to Zustand stores. The caller is responsible for:
 * - Reloading the city models (if layer modelRefs are URLs)
 * - Repositioning the camera (returns the viewState for this)
 * - Activating the saved layer (returns `activeLayer` for this — the index it
 *   carries is into the SNAPSHOT's lists, and only the caller knows which of
 *   those layers actually came back)
 */

import type { ProjectSnapshot, ViewState } from "./types";
import { normalizeSceneTheme, normalizeViewMode } from "./types";
import { migrateSnapshot } from "./migrateSnapshot";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useSolarStore } from "../features/solar/solarStore";

export interface RestoredSnapshot {
  readonly viewState: ViewState;
  /** Which layer to activate once the caller has added them back, resolved
   *  against the SNAPSHOT's own two lists. Absent (a v3 document, or a
   *  workspace saved with nothing active) means "the first layer in unified
   *  order" — the caller's fallback, because only it knows what landed. */
  readonly activeLayer: ProjectSnapshot["activeLayer"];
}

export function restoreSnapshot(snapshot: ProjectSnapshot): RestoredSnapshot {
  // Version gate FIRST, before any store write: a rejected restore must leave
  // the workspace exactly as it was, not half-applied. v3 is carried forward
  // here rather than rejected — see `migrateSnapshot`.
  const outcome = migrateSnapshot(snapshot);
  if (!outcome.ok) throw outcome.error;
  const migrated = outcome.snapshot;

  // Restore pick mode (clear selection — it's transient). `geoSelection` is
  // cleared with the rest: a restore replaces every geo layer, so a retained
  // feature would name a layer id that no longer exists and leave a stale
  // attribute panel over the new workspace.
  useSelectionStore.setState({
    mode: migrated.pickMode,
    selections: [],
    hovered: null,
    geoSelection: null,
  });

  // Restore datetime with validation
  const dt = new Date(migrated.viewState.datetime);
  if (!isNaN(dt.getTime())) {
    useSolarStore.getState().setDatetime(dt);
  }

  // Neither the view mode nor the scene theme is written to its store here,
  // unlike the pick mode and the datetime. The mode's reason is the camera:
  // entering one FLIES it, and the caller applies the saved camera in the same
  // breath, so App.tsx sets the mode itself, before the camera. The theme
  // simply keeps it company — both are handed back validated, and the caller
  // decides when to apply them.
  return {
    viewState: {
      ...migrated.viewState,
      viewMode: normalizeViewMode(migrated.viewState.viewMode),
      sceneTheme: normalizeSceneTheme(migrated.viewState.sceneTheme),
    },
    activeLayer: migrated.activeLayer,
  };
}
