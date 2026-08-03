/**
 * Restore viewer state from a ProjectSnapshot.
 *
 * Writes to Zustand stores. The caller is responsible for:
 * - Reloading the city models (if layer modelRefs are URLs)
 * - Repositioning the camera (returns the viewState for this)
 */

import type { ProjectSnapshot, ViewState } from "./types";
import { SNAPSHOT_VERSION, UnsupportedSnapshotVersionError } from "./types";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useSolarStore } from "../features/solar/solarStore";

export function restoreSnapshot(snapshot: ProjectSnapshot): ViewState {
  // Version gate FIRST, before any store write: a rejected restore must leave
  // the workspace exactly as it was, not half-applied.
  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new UnsupportedSnapshotVersionError(snapshot.version ?? "unknown");
  }

  // Restore pick mode (clear selection — it's transient)
  useSelectionStore.setState({
    mode: snapshot.pickMode,
    selections: [],
    hovered: null,
  });

  // Restore datetime with validation
  const dt = new Date(snapshot.viewState.datetime);
  if (!isNaN(dt.getTime())) {
    useSolarStore.getState().setDatetime(dt);
  }

  return snapshot.viewState;
}
