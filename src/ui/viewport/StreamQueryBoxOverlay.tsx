/**
 * The numbers behind the streaming fetch outline.
 *
 * A VIEWPORT overlay rather than a StatusBar field, for three reasons: it is
 * per-LAYER (a workspace can stream several `.fcb` files at once, and one
 * status-bar slot cannot hold N of anything); it is four coordinates plus a
 * CRS and an extent, which would crowd out the cursor readout the status bar
 * exists for; and it belongs next to the thing it describes — the blue
 * rectangle on the ground — so that turning the diagnostic on produces one
 * coherent answer instead of a shape here and its numbers somewhere else.
 * Top-left is the one viewport corner nothing else holds (the align buttons
 * own top-right, the solar scrubber bottom-left, the attribution bottom-right).
 *
 * Renders NOTHING when the diagnostic is off or no layer has queried yet, so
 * it costs an empty render and no chrome in the default workspace.
 */
import type { ReactElement } from "react";
import { useQueryRegionStore } from "../../features/streaming/queryRegionStore";
import { useRenderDebugStore } from "../../features/debug/renderDebugStore";
import { useLayerStore } from "../../features/layers/layerStore";
import { QUERY_BOX_COLOR, queryBoxReadout } from "../../scene/streamQueryBox";

/** `QUERY_BOX_COLOR` as CSS, so the swatch cannot drift from the line the
 *  engine actually draws. */
const SWATCH = `#${QUERY_BOX_COLOR.toString(16).padStart(6, "0")}`;

export function StreamQueryBoxOverlay(): ReactElement | null {
  const enabled = useRenderDebugStore((s) => s.streamQueryBoxEnabled);
  const regions = useQueryRegionStore((s) => s.regions);
  // `QueryRegion.layerId` is the layer STORE's id, which is a UUID — the
  // plugin has no notion of a display name and should not grow one. Resolving
  // it here is what turns the readout's heading from
  // "9fe9cbcd-0bef-411c-…" (browser-verified) into "delft.fcb". Falls back to
  // the id for a region whose layer has already left the store, which is a
  // one-render race rather than a state worth blanking.
  const layers = useLayerStore((s) => s.layers);
  const readouts = Object.values(regions).map(queryBoxReadout);
  const nameOf = (layerId: string): string =>
    layers.find((l) => l.id === layerId)?.name ?? layerId;

  // The toggle is checked as well as the (already toggle-gated) store: the
  // viewport clears the store on its way out, but a render can land between
  // the switch flipping and that cleanup running.
  if (!enabled || readouts.length === 0) return null;

  return (
    <div className="query-box-overlay" data-testid="query-box-overlay">
      <div className="query-box-overlay__title">
        <span
          className="query-box-overlay__swatch"
          style={{ background: SWATCH }}
        />
        Streaming fetch bbox
      </div>
      {readouts.map((r) => (
        <div key={r.layerId} className="query-box-overlay__layer">
          <div className="query-box-overlay__name" title={r.layerId}>
            {nameOf(r.layerId)}
          </div>
          <div className="query-box-overlay__row">
            <span>{r.crs}</span>
            <span>{r.size}</span>
          </div>
          <div className="query-box-overlay__row">
            <span>X</span>
            <span>{r.x}</span>
          </div>
          <div className="query-box-overlay__row">
            <span>Y</span>
            <span>{r.y}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
