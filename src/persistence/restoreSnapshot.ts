/**
 * Restore viewer state from a ProjectSnapshot.
 *
 * Writes to all Zustand stores. The caller is responsible for:
 * - Reloading the city model (if modelRef is a URL)
 * - Repositioning the Three.js camera (returns the viewState for this)
 */

import type { ProjectSnapshot, ViewState } from "./types";
import { useRuleStore } from "../features/rules/ruleStore";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useSolarStore } from "../features/solar/solarStore";

export function restoreSnapshot(snapshot: ProjectSnapshot): ViewState {
  // Restore rules
  useRuleStore.setState({
    rules: [...snapshot.rules],
    enabled: snapshot.rulesEnabled,
  });

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
