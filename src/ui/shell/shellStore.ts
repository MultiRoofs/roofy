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
