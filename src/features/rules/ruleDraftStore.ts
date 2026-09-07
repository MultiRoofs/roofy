/**
 * Session-only draft state for the per-layer rule editor.
 *
 * `RulesEditor` used to keep `editingId`/`showForm` in its own `useState`,
 * and `RuleForm` kept `name`/`color`/`logic`/`conditions` in ANOTHER set of
 * `useState`s seeded ONCE from `initial`. The bug that produced was not a
 * lost draft but a LEAKED one: rendering the editor for layer B where layer
 * A's editor had been is not a remount, so B's editor came up showing A's
 * half-typed rule under B's name. (The panel's `key={layerId}` does remount
 * it in the app, which turned the same seeded-once state into a lost draft
 * there — one cause, two symptoms.)
 *
 * Moving that state here, keyed by `layerId`, answers both: the component
 * holds nothing, so there is nothing to carry across and nothing to lose.
 *
 * SESSION-ONLY, deliberately: a draft is never persisted (no localStorage,
 * no snapshot, no share link) and never captured by `persistence/`. It is
 * scratch state for a form the user has not saved yet, not a fact about the
 * layer.
 *
 * A layer's draft is dropped the moment that layer disappears from
 * `useLayerStore` — {@link installRuleDraftInvariants}, installed once by
 * `App` next to `installWorkspaceInvariants`/`installThemeListener`/
 * `installShellListeners` (same shape: a subscription to something outside
 * React, not per-render state). Without it, removing a layer while its
 * editor had an unsaved draft would leave that draft in the store forever —
 * unreachable (its `layerId` never renders again), but also never freed.
 */
import { create } from "zustand";
import type { Condition, LogicMode } from "./types";
import { useLayerStore } from "../layers/layerStore";

/** What `RuleForm` edits — the fields of a `Rule` minus `id`/`enabled`,
 *  which the editor decides on save (a fresh UUID for a new rule, the
 *  existing rule's `enabled` for an edit). */
export interface RuleFormValues {
  readonly name: string;
  readonly color: string;
  readonly logic: LogicMode;
  readonly conditions: ReadonlyArray<Condition>;
}

export interface RuleDraft {
  /** The rule being edited, or `null` for the "add a new rule" form. */
  readonly editingId: string | null;
  readonly form: RuleFormValues;
  /** Whether a form is open at all. `false` means the editor shows just the
   *  rule list and the "+ Add Rule" button. */
  readonly open: boolean;
}

export interface RuleDraftStoreState {
  /** `null` (not absent) marks "no draft" once a layer has had one, so a
   *  read never has to distinguish "never touched" from "cleared" — both
   *  read as no draft. */
  readonly drafts: Readonly<Record<string, RuleDraft | null>>;
}

export interface RuleDraftStoreActions {
  setDraft: (layerId: string, draft: RuleDraft) => void;
  clearDraft: (layerId: string) => void;
}

export type RuleDraftStore = RuleDraftStoreState & RuleDraftStoreActions;

export const useRuleDraftStore = create<RuleDraftStore>((set) => ({
  drafts: {},

  setDraft: (layerId, draft) =>
    set((state) => ({ drafts: { ...state.drafts, [layerId]: draft } })),

  clearDraft: (layerId) =>
    set((state) => ({ drafts: { ...state.drafts, [layerId]: null } })),
}));

let disposeInstalled: (() => void) | null = null;

/**
 * Drop a layer's draft the moment it leaves `useLayerStore`. Installed once,
 * by the app shell. A second install disposes the first, the same
 * single-live-installer shape as `installWorkspaceInvariants` — a hot reload
 * must not end up with two reconcilers both writing the same store.
 */
export function installRuleDraftInvariants(): () => void {
  disposeInstalled?.();

  const dropRemovedLayers = () => {
    const layerIds = new Set(useLayerStore.getState().layers.map((l) => l.id));
    const { drafts } = useRuleDraftStore.getState();
    let changed = false;
    const next: Record<string, RuleDraft | null> = { ...drafts };
    for (const [layerId, draft] of Object.entries(drafts)) {
      if (draft !== null && !layerIds.has(layerId)) {
        next[layerId] = null;
        changed = true;
      }
    }
    if (changed) useRuleDraftStore.setState({ drafts: next });
  };

  const unsubscribe = useLayerStore.subscribe(dropRemovedLayers);
  dropRemovedLayers();

  const dispose = () => {
    unsubscribe();
    if (disposeInstalled === dispose) disposeInstalled = null;
  };
  disposeInstalled = dispose;
  return dispose;
}
