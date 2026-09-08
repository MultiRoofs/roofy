/**
 * Escape clears the selection.
 *
 * The one keyboard shortcut the viewer shell owns: a selection is the app's
 * most persistent piece of state (it colours the model, fills the inspector
 * and decides which layer is active), and until now the only way out of one
 * was to click empty sky and hope the ray missed everything.
 *
 * WHO GETS THE KEY. Several things listen for Escape on `window` in the
 * capture phase; none of them stop propagation, so on one press they all run.
 * That is deliberate, and the order is:
 *
 *  1. A modal (`.modal-backdrop`) — its own trap owns the key outright. This
 *     hook stands down, exactly as `RenderingPanel` does, and for the same
 *     reason: a user closing a dialog is not asking to lose their selection.
 *  2. A text field with the focus — Escape there means "abandon what I am
 *     typing" (the inline rename inputs read it that way), never "throw away
 *     the selection behind the field".
 *  3. Everything else, all at once. The rendering panel and every header
 *     popover (workspace, scene, scene theme, solar, weather, preferences)
 *     close on the same press that clears the selection. That is the intended
 *     reading, not an oversight:
 *     every one of them is "step back", none hides another's effect, and
 *     making them take turns would only mean pressing Escape twice.
 *
 * Installed once, by the app shell.
 */
import { useEffect } from "react";
import { useSelectionStore } from "./selectionStore";
import { useSceneSheetStore } from "../sceneSheet/sceneSheetStore";

const TEXT_ENTRY = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useEscapeClearsSelection(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase, so this sees the modal BEFORE the modal's own handler
      // has closed it and React has flushed the backdrop out of the DOM.
      if (document.querySelector(".modal-backdrop")) return;
      if (useSceneSheetStore.getState().sheet !== null) {
        useSceneSheetStore.getState().setSheet(null);
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (TEXT_ENTRY.has(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      useSelectionStore.getState().clear();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
