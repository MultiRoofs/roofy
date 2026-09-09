import { useQueryStore } from "../../features/query/queryStore";
import { useWorkspaceStore } from "../../features/workspace/workspaceStore";
/**
 * Session-only UI state for the app shell: the left layer panel, the right
 * details panel, the bottom data drawer, and which sections of the active
 * layer's panel are open. Never persisted — the layout resets to the
 * viewport-derived defaults on reload.
 *
 * `requestSection` is the one way another part of the UI (the legend, "Edit
 * in table") asks the shell to open and scroll to a specific layer's
 * section: it activates the layer (via `layerCoordination`, so rule 1 still
 * applies), opens the left panel, opens the section, and records the
 * request for `ActiveLayerPanel` to consume and clear.
 *
 * Import direction: this module imports `layerCoordination`, which imports
 * `workspaceStore` — never the reverse, and nothing under `features/` may
 * import this module.
 */
import { create } from "zustand";
import { activateLayer } from "../../features/workspace/layerCoordination";

export type PanelSection = "style" | "filter" | "details";

/** A layer with no entry in `openSections` behaves as if it had this. */
export const DEFAULT_OPEN_SECTIONS: ReadonlyArray<PanelSection> = ["style"];

export const SHELL_LIMITS = {
  leftMin: 240,
  leftMax: 420,
  rightMin: 280,
  rightMax: 480,
  drawerMin: 160,
  drawerMax: 800,
} as const;

export interface ShellState {
  readonly leftCollapsed: boolean;
  readonly leftWidth: number;
  readonly rightWidth: number;
  /** Collapsing the details panel is NOT clearing the selection — the
   *  selection persists, only its panel is hidden. */
  readonly rightCollapsed: boolean;
  readonly drawerOpen: boolean;
  /** Signals an explicit request to show the Records filter builder. */
  readonly filterRequest: number;
  readonly drawerHeight: number;
  readonly drawerExpanded: boolean;
  /** Per layer: which sections of that layer's panel are open. A layer
   *  with no entry here defaults to `["style"]`. */
  readonly openSections: Readonly<Record<string, ReadonlyArray<PanelSection>>>;
  /** Set by `requestSection`; consumed (and cleared) by `ActiveLayerPanel`
   *  once it has opened and scrolled to the section. */
  readonly requestedSection: { layerId: string; section: PanelSection } | null;
}

export interface ShellActions {
  setLeftCollapsed(v: boolean): void;
  toggleLeftCollapsed(): void;
  setLeftWidth(px: number): void;
  setRightWidth(px: number): void;
  setRightCollapsed(v: boolean): void;
  toggleRightCollapsed(): void;
  openDrawer(): void;
  openFilter(): void;
  closeDrawer(): void;
  toggleDrawer(): void;
  setDrawerHeight(px: number): void;
  setDrawerExpanded(v: boolean): void;
  toggleSection(layerId: string, section: PanelSection): void;
  /** Activates the layer, opens the left panel and the section, and stores
   *  the request. */
  requestSection(layerId: string, section: PanelSection): void;
  /** Clears the stored request only — it does not undo the activation or
   *  close the section that a prior call opened. */
  requestSection(layerId: null): void;
}

export type ShellStore = ShellState & ShellActions;

function clamp(px: number, min: number, max: number): number {
  return Math.min(Math.max(px, min), max);
}

/**
 * `clampDrawerHeight(px, innerHeight)` = min(max(px, 160), min(800,
 * innerHeight - 200)). Pure, so the component and the store agree on the
 * ceiling without either owning the other's viewport read.
 */
export function clampDrawerHeight(px: number, innerHeight: number): number {
  return Math.min(
    Math.max(px, SHELL_LIMITS.drawerMin),
    Math.min(SHELL_LIMITS.drawerMax, innerHeight - 200),
  );
}

/**
 * Pure defaults derived from the viewport: left 300 / right 340 (272 / 320
 * below 1360px wide), drawer 280 (220 below 800px tall). Everything else is
 * at its documented default regardless of viewport.
 */
export function defaultShellState(
  innerWidth: number,
  innerHeight: number,
): ShellState {
  const narrow = innerWidth < 1360;
  const short = innerHeight < 800;
  return {
    leftCollapsed: false,
    leftWidth: narrow ? 272 : 300,
    rightWidth: narrow ? 320 : 340,
    rightCollapsed: false,
    drawerOpen: false,
    drawerHeight: short ? 220 : 280,
    drawerExpanded: false,
    filterRequest: 0,
    openSections: {},
    requestedSection: null,
  };
}

function initialShellState(): ShellState {
  if (typeof window === "undefined") return defaultShellState(1440, 900);
  return defaultShellState(window.innerWidth, window.innerHeight);
}

export const useShellStore = create<ShellStore>((set, get) => ({
  ...initialShellState(),

  setLeftCollapsed: (v) => set({ leftCollapsed: v }),
  toggleLeftCollapsed: () =>
    set((state) => ({ leftCollapsed: !state.leftCollapsed })),

  setLeftWidth: (px) =>
    set({ leftWidth: clamp(px, SHELL_LIMITS.leftMin, SHELL_LIMITS.leftMax) }),
  setRightWidth: (px) =>
    set({
      rightWidth: clamp(px, SHELL_LIMITS.rightMin, SHELL_LIMITS.rightMax),
    }),

  setRightCollapsed: (v) => set({ rightCollapsed: v }),
  toggleRightCollapsed: () =>
    set((state) => ({ rightCollapsed: !state.rightCollapsed })),

  openDrawer: () => set({ drawerOpen: true }),
  openFilter: () => {
    const layerId = useWorkspaceStore.getState().activeLayerId;
    if (layerId !== null)
      useQueryStore.getState().setDrawerTab(layerId, "records");
    set((state) => ({
      drawerOpen: true,
      filterRequest: state.filterRequest + 1,
    }));
  },
  closeDrawer: () => set({ drawerOpen: false }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),

  setDrawerHeight: (px) => {
    const innerHeight =
      typeof window === "undefined" ? 900 : window.innerHeight;
    set({ drawerHeight: clampDrawerHeight(px, innerHeight) });
  },
  setDrawerExpanded: (v) => set({ drawerExpanded: v }),

  toggleSection: (layerId, section) =>
    set((state) => {
      const current = state.openSections[layerId] ?? DEFAULT_OPEN_SECTIONS;
      const next = current.includes(section)
        ? current.filter((s) => s !== section)
        : [...current, section];
      return { openSections: { ...state.openSections, [layerId]: next } };
    }),

  requestSection(layerId: string | null, section?: PanelSection) {
    if (layerId === null) {
      set({ requestedSection: null });
      return;
    }
    activateLayer(layerId);
    const current = get().openSections[layerId] ?? DEFAULT_OPEN_SECTIONS;
    const openSections = current.includes(section!)
      ? current
      : [...current, section!];
    set((state) => ({
      leftCollapsed: false,
      openSections: { ...state.openSections, [layerId]: openSections },
      requestedSection: { layerId, section: section! },
    }));
  },
}));

/** One listener installed at a time, same shape as `installThemeListener`:
 *  a second call tears down the first rather than stacking two. */
let disposeInstalled: (() => void) | null = null;

/**
 * Keep the drawer, left panel and right panel inside their own bounds
 * whenever the window is resized.
 *
 * A resize alone never runs `setDrawerHeight` / `setLeftWidth` /
 * `setRightWidth` — nothing calls them — so a drawer opened tall on a big
 * monitor, or a width the user dragged to an edge, would sit there
 * unclamped after the window shrank (a maximize/restore, a monitor change, a
 * DevTools panel opening). This is the one subscription that re-applies the
 * SAME ceilings those setters already enforce on every drag, on the event
 * that is not a drag.
 *
 * `leftWidth`/`rightWidth` are clamped against the fixed `SHELL_LIMITS`
 * (they do not depend on the viewport, unlike the drawer's ceiling) — so a
 * resize cannot itself make them invalid, but the listener still corrects
 * whatever got there another way, and does so opportunistically rather than
 * only guarding the one field the viewport actually affects.
 *
 * Writes only the fields that actually changed value, in ONE `set` call —
 * not three — so a resize that leaves every dimension in range produces no
 * store update at all.
 */
export function installShellListeners(): () => void {
  disposeInstalled?.();

  const handleResize = (): void => {
    const innerHeight =
      typeof window === "undefined" ? 900 : window.innerHeight;
    const state = useShellStore.getState();
    // A locally MUTABLE shape, not `Partial<ShellState>`: every field on
    // `ShellState` is declared `readonly` (so nothing outside a store action
    // can mutate it in place), and that modifier survives `Partial<>`. This
    // object is still assignable to it when handed to `setState` below —
    // only building it in place needs the readonly stripped.
    const patch: { -readonly [K in keyof ShellState]?: ShellState[K] } = {};

    const drawerHeight = clampDrawerHeight(state.drawerHeight, innerHeight);
    if (drawerHeight !== state.drawerHeight) patch.drawerHeight = drawerHeight;

    const leftWidth = clamp(
      state.leftWidth,
      SHELL_LIMITS.leftMin,
      SHELL_LIMITS.leftMax,
    );
    if (leftWidth !== state.leftWidth) patch.leftWidth = leftWidth;

    const rightWidth = clamp(
      state.rightWidth,
      SHELL_LIMITS.rightMin,
      SHELL_LIMITS.rightMax,
    );
    if (rightWidth !== state.rightWidth) patch.rightWidth = rightWidth;

    if (Object.keys(patch).length > 0) useShellStore.setState(patch);
  };

  window.addEventListener("resize", handleResize);

  const dispose = (): void => {
    window.removeEventListener("resize", handleResize);
    if (disposeInstalled === dispose) disposeInstalled = null;
  };
  disposeInstalled = dispose;
  return dispose;
}
