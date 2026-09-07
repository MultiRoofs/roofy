/**
 * The left panel, collapsed: a 40 px rail.
 *
 * Collapsing used to mean an EMPTY column — the shell reserved the width and
 * nothing was drawn in it — so a closed panel told the user neither how big
 * their workspace was nor which layer every other panel was describing, and
 * the only way back was the chevron up in the header.
 *
 * Two facts fit in 40 px, and they are the two that matter while the list is
 * hidden: HOW MANY layers there are (the badge on the button that brings the
 * panel back) and WHICH ONE is active (its kind icon, the same glyph the row
 * wears — `LayerKindIcon` is exported from `LayerRow` precisely so the rail
 * and the row cannot disagree).
 *
 * The count is what the PANEL would list, which is more than the stores hold:
 * an add in flight, an add that failed and a layer waiting for its file are
 * all rows behind the rail, so they arrive here as the same three props
 * `LeftPanel` takes. A badge reading `1` over a list of four is worse than no
 * badge at all.
 *
 * The empty state is NOT here: "No layers yet" and the Add layer button are
 * the PANEL's, because neither fits in a rail. An empty workspace's rail
 * reads `0` and expands to the panel that can say the rest.
 */
import { useId } from "react";
import { useShellStore } from "./shellStore";
import { LayerKindIcon } from "../layers/LayerRow";
import { layerKindOf } from "../../features/layers/layerPresentation";
import {
  unifiedLayerOrder,
  useActiveLayer,
} from "../../features/workspace/activeLayer";
import { useLayerStore } from "../../features/layers/layerStore";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import type { UnavailableRow } from "../layers/LayerList";
import type {
  FailedAdd,
  PendingAdd,
} from "../../features/layers/useLayerFileLoader";

export interface LeftRailProps {
  /** The same three the panel takes, for the same reason — see the module
   *  comment. All optional: a rail with none of them still counts the
   *  stores. */
  readonly extraRows?: ReadonlyArray<UnavailableRow>;
  readonly pending?: ReadonlyArray<PendingAdd>;
  readonly failed?: ReadonlyArray<FailedAdd>;
  /** `useLayerFileLoader().failed.length` — separate from `failed` above
   *  (which the rail already counts INTO the badge) because a failure is not
   *  merely one more row: it is the one state on this button that deserves
   *  its own glyph, so a user staring at a closed rail still learns that
   *  something needs attention. */
  readonly failedCount?: number;
}

const NO_ROWS: ReadonlyArray<never> = [];

export function LeftRail({
  extraRows = NO_ROWS,
  pending = NO_ROWS,
  failed = NO_ROWS,
  failedCount = 0,
}: LeftRailProps = {}) {
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  const activeItem = useActiveLayer();
  const countId = useId();
  const failedId = useId();
  const hasFailed = failedCount > 0;

  // Through `unifiedLayerOrder`, like the list itself: the badge counts what
  // the panel would show, not what one store happens to hold.
  const count =
    unifiedLayerOrder(layers, geoLayers).length +
    extraRows.length +
    pending.length +
    failed.length;

  return (
    <div className="left-rail">
      <button
        type="button"
        className="left-rail-btn"
        // NOT the header chevron's "Expand layers panel": both controls
        // stay, and two of them answering to one name is one control the
        // user cannot aim at. The COUNT is deliberately not in the name
        // either — a name that changes with every add is a name a
        // screen-reader user cannot learn — so it is the DESCRIPTION below.
        aria-label="Show layers panel"
        // The dot below sits INSIDE this button rather than beside it (the
        // rail is 40px wide; there is no "beside"), so it cannot carry its
        // own `data-tooltip` — hovering a child hovers the parent too, and
        // both bubbles would fire over the same corner. The button's own
        // tooltip says both sentences instead, when there is a dot to
        // explain.
        data-tooltip={
          hasFailed
            ? `Show layers panel · ${failedCount} failed add${failedCount === 1 ? "" : "s"}`
            : "Show layers panel"
        }
        // `aria-describedby` takes a SPACE-SEPARATED id list — appending
        // `failedId` rather than replacing `countId` keeps both sentences
        // reachable, exactly as the visible dot sits beside the badge
        // rather than covering it.
        aria-describedby={hasFailed ? `${countId} ${failedId}` : countId}
        onClick={() => useShellStore.getState().setLeftCollapsed(false)}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          {/* Stacked sheets: the same idea as the header's panel glyph, said
              as layers rather than as a split box. */}
          <path d="M12 3.5 3.5 8l8.5 4.5L20.5 8z" />
          <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
        </svg>
        <span className="left-rail-badge">{count}</span>
        {/* The badge is a glyph; this is the sentence behind it. */}
        <span className="left-rail-count" id={countId}>
          {count} layer{count === 1 ? "" : "s"}
        </span>
        {hasFailed && (
          <>
            {/* Decorative only — no `data-tooltip` of its own (see the
                comment on the button above); the sentence a screen reader
                gets is the visually-hidden span below, on the same idiom as
                the count above. */}
            <span className="left-rail-dot" aria-hidden />
            <span className="left-rail-count" id={failedId}>
              {failedCount} failed add{failedCount === 1 ? "" : "s"}
            </span>
          </>
        )}
      </button>

      {activeItem !== null && (
        // `title` rather than a label: the icon is a reminder of what the
        // panel behind the rail is describing, and the panel itself is one
        // click away for anyone who needs it read out.
        <span className="left-rail-kind" title={activeItem.layer.name}>
          <LayerKindIcon kind={layerKindOf(activeItem)} />
        </span>
      )}
    </div>
  );
}
