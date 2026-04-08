/**
 * Restore viewer state from a ProjectSnapshot.
 *
 * Writes to Zustand stores. The caller is responsible for:
 * - Reloading the city models (if layer modelRefs are URLs)
 * - Repositioning the Three.js camera (returns the viewState for this)
 */

import type { ProjectSnapshot, ViewState } from "./types";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useSolarStore } from "../features/solar/solarStore";

export function restoreSnapshot(snapshot: ProjectSnapshot): ViewState {
  // Restore pick mode (clear selection — it's transient)
  useSelectionStore.setState({
    mode: snapshot.pickMode,
    selection: null,
    hovered: null,
  });

  // Restore datetime with validation
  const dt = new Date(snapshot.viewState.datetime);
  if (!isNaN(dt.getTime())) {
    useSolarStore.getState().setDatetime(dt);
  }

  return snapshot.viewState;
}
