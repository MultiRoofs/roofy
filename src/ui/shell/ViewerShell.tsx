/**
 * The viewer's layout: a three-row, three-column grid whose middle row is
 * `left | map column | right`, with the data drawer stacked UNDER the map
 * inside the middle column — never across the whole width. That is the
 * laptop rule from the design spec: opening the table never buries the layer
 * list or the details panel.
 *
 * The component owns no layout state of its own. Every size comes from
 * `shellStore` and reaches the grid as an inline custom property on the shell
 * element, so the CSS holds the shape and the store holds the numbers.
 *
 * Two widths are answers to a question the store cannot see on its own:
 * `--right-w` is `0` when there is no `right` to show (no selection) as well
 * as when the panel is collapsed, and a collapsed panel WITH something to
 * show leaves a pill on the map's right edge — collapsing the details panel
 * is not clearing the selection.
 */

import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useShellStore } from "./shellStore";
import { ResizeHandle } from "./ResizeHandle";

/** The collapsed left panel's rail — a width, not a component, until the
 *  `LeftRail` lands. */
const LEFT_RAIL_WIDTH = "40px";

export interface ViewerShellProps {
  readonly header: ReactNode;
  /** Full-height left panel (or rail when collapsed — the caller passes
   *  `LeftRail`). */
  readonly left: ReactNode;
  /** The viewport and its overlays. */
  readonly map: ReactNode;
  /** `null` = closed; rendered under the map only. */
  readonly drawer: ReactNode | null;
  /** `null` = no selection → column width 0. */
  readonly right: ReactNode | null;
  /** What the collapsed-details pill names — "Building …25028". */
  readonly rightTitle: string;
  readonly status: ReactNode;
}

export function ViewerShell({
  header,
  left,
  map,
  drawer,
  right,
  rightTitle,
  status,
}: ViewerShellProps): ReactElement {
  const leftCollapsed = useShellStore((s) => s.leftCollapsed);
  const leftWidth = useShellStore((s) => s.leftWidth);
  const rightWidth = useShellStore((s) => s.rightWidth);
  const rightCollapsed = useShellStore((s) => s.rightCollapsed);
  const drawerHeight = useShellStore((s) => s.drawerHeight);
  const drawerExpanded = useShellStore((s) => s.drawerExpanded);

  const rightOpen = right !== null && !rightCollapsed;

  const classes = [
    "viewer-shell",
    leftCollapsed && "left-collapsed",
    rightCollapsed && "right-collapsed",
    drawerExpanded && "drawer-expanded",
  ]
    .filter(Boolean)
    .join(" ");

  const sizes = {
    "--left-w": leftCollapsed ? LEFT_RAIL_WIDTH : `${leftWidth}px`,
    "--right-w": rightOpen ? `${rightWidth}px` : "0",
    "--drawer-h": drawer === null ? "0" : `${drawerHeight}px`,
  } as CSSProperties;

  return (
    <div className={classes} style={sizes}>
      <div className="shell-header">{header}</div>

      <div className="shell-left">{left}</div>

      <div className="map-column">
        <div className="map-area">
          {map}
          {right !== null && rightCollapsed && (
            <button
              type="button"
              className="details-pill"
              onClick={() => useShellStore.getState().setRightCollapsed(false)}
            >
              Details · {rightTitle}
            </button>
          )}
        </div>
        {drawer !== null && <div className="drawer-area">{drawer}</div>}
      </div>

      {rightOpen && (
        <div className="shell-right">
          {/* The panel's own edge, so the handle sits between the map and the
              details rather than inside either. */}
          <ResizeHandle
            axis="x"
            label="Resize details panel"
            onDelta={(dx) =>
              useShellStore
                .getState()
                .setRightWidth(useShellStore.getState().rightWidth - dx)
            }
          />
          {right}
        </div>
      )}

      <div className="shell-status">{status}</div>
    </div>
  );
}
