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
 * The empty state is NOT here: "No layers yet" and the Add layer button are
 * the PANEL's, because neither fits in a rail. An empty workspace's rail
 * reads `0` and expands to the panel that can say the rest.
 */
import { useShellStore } from "./shellStore";
import { LayerKindIcon } from "../layers/LayerRow";
import { layerKindOf } from "../../features/layers/layerPresentation";
import {
  unifiedLayerOrder,
  useActiveLayer,
} from "../../features/workspace/activeLayer";
import { useLayerStore } from "../../features/layers/layerStore";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";

export function LeftRail() {
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  const activeItem = useActiveLayer();

  // Through `unifiedLayerOrder`, like the list itself: the badge counts what
  // the panel would show, not what one store happens to hold.
  const count = unifiedLayerOrder(layers, geoLayers).length;

  return (
    <div className="left-rail">
      <button
        type="button"
        className="left-rail-btn"
        // The same words the header's chevron uses for the same act. The
        // COUNT is deliberately not in the name: a label that changes with
        // every add is a label a screen-reader user cannot learn, and the
        // number is on screen for anyone who can see the rail.
        aria-label="Expand layers panel"
        data-tooltip="Expand layers panel"
        onClick={() => useShellStore.getState().setLeftCollapsed(false)}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          {/* Stacked sheets: the same idea as the header's panel glyph, said
              as layers rather than as a split box. */}
          <path d="M12 3.5 3.5 8l8.5 4.5L20.5 8z" />
          <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
        </svg>
        <span className="left-rail-badge" aria-hidden>
          {count}
        </span>
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
