/**
 * The shell's left column: the workspace's layers, and the configuration of
 * the ONE that is active, in a single full-height panel.
 *
 * It replaces `LeftSidebar` (a resizable box around a pane) and `LayerPanel`
 * (two titled sections, a dense row each). The shape is the milestone's whole
 * argument in one component:
 *
 *  - a LIST that says what each layer is, in the top region;
 *  - a hairline;
 *  - the ACTIVE layer's own panel below it, in its own scroll container, so
 *    the list never has to be scrolled past to reach the form that describes
 *    the row highlighted in it.
 *
 * What it OWNS, and what it takes from `App`:
 *
 *  - it owns the Add layer dialog (the sidebar used to host it) and the
 *    right-edge `ResizeHandle` that writes `shellStore.leftWidth`. The shell
 *    renders the DETAILS panel's handle and only that one; this edge belongs
 *    to the panel because the panel is what the drag resizes;
 *  - it owns "Open table": activate the layer, open the drawer. That used to
 *    be a `tableOpen`/`onToggleTable` pair threaded from `App` through two
 *    components to reach a row;
 *  - it takes ZOOM from `App` (a city layer and a geo layer are flown to by
 *    different code paths, and only `App` holds the scene handle), and the
 *    three row-kinds the layer stores know nothing about — the re-link rows,
 *    the adds in flight and the adds that failed.
 *
 * The empty state lives here rather than in `LayerList`: "no layers" is a
 * fact about the whole panel (nothing to list AND nothing in flight), and the
 * answer to it is the Add layer button, which is the panel's.
 */
import { useMemo, useState } from "react";
import { ResizeHandle } from "../shell/ResizeHandle";
import { useShellStore } from "../shell/shellStore";
import { AddLayerDialog } from "../layers/AddLayerDialog";
import { ActiveLayerPanel } from "../layers/ActiveLayerPanel";
import { LayerList, type UnavailableRow } from "../layers/LayerList";
import type { AddUrlResult } from "../stac/StacBrowser";
import type { DetectedSource } from "../../features/layers/detectSource";
import type {
  FailedAdd,
  PendingAdd,
} from "../../features/layers/useLayerFileLoader";
import {
  unifiedLayerOrder,
  useActiveLayer,
  type ActiveLayer,
} from "../../features/workspace/activeLayer";
import { activateLayer } from "../../features/workspace/layerCoordination";
import { useLayerStore } from "../../features/layers/layerStore";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";

export interface LeftPanelProps {
  /** The file and the format the user confirmed it is — see
   *  {@link AddLayerDialog}; the second argument is the loader's encoding
   *  override, and it is threaded rather than re-derived so what the user saw
   *  named is what is parsed. */
  readonly onAddFile: (file: File, override?: DetectedSource) => void;
  /** Several picked files as ONE layer — see {@link AddLayerDialog}. */
  readonly onAddFiles: (files: File[], override?: DetectedSource) => void;
  /** Resolves `{ok: true}` once a layer has landed — see {@link AddLayerDialog}. */
  readonly onAddUrl: (
    url: string,
    override?: DetectedSource,
  ) => Promise<AddUrlResult>;
  readonly loading: boolean;
  /** The whole item, not an id: only `App` can tell a city `fitLayer` from a
   *  geo bounds walk, and both the list's rows and the active layer's panel
   *  ask the same question. */
  readonly onZoomToLayer: (item: ActiveLayer) => void;
  /** Snapshot-restored layers whose local file is gone. */
  readonly extraRows?: ReadonlyArray<UnavailableRow>;
  /** `useLayerFileLoader().pending` — adds still in flight. */
  readonly pending?: ReadonlyArray<PendingAdd>;
  /** `useLayerFileLoader().failed` — adds that did not land. */
  readonly failed?: ReadonlyArray<FailedAdd>;
  readonly dismissFailed: (id: string) => void;
}

const NO_ROWS: ReadonlyArray<never> = [];

export function LeftPanel({
  onAddFile,
  onAddFiles,
  onAddUrl,
  loading,
  onZoomToLayer,
  extraRows = NO_ROWS,
  pending = NO_ROWS,
  failed = NO_ROWS,
  dismissFailed,
}: LeftPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  const activeItem = useActiveLayer();

  const layerCount = unifiedLayerOrder(layers, geoLayers).length;
  // "Nothing to show", not "no layers in the store": an add that is still
  // parsing, a failed one and a row waiting for its file are all things the
  // user put here, and telling them "No layers yet" over the top of their own
  // loading row would be a lie.
  const empty =
    layerCount === 0 &&
    extraRows.length === 0 &&
    pending.length === 0 &&
    failed.length === 0;

  // Identity-stable so a re-render of the panel does not re-render every row:
  // `ResizeHandle` and `LayerList` both take callbacks, and `leftWidth` is
  // read from the store at pointerdown rather than subscribed to — a panel
  // that re-rendered on every pixel of its own drag would re-render the list
  // with it.
  const handlers = useMemo(() => {
    let dragOrigin = 0;
    return {
      onStart: () => {
        dragOrigin = useShellStore.getState().leftWidth;
      },
      // The handle is on the panel's RIGHT edge: dragging right (a positive
      // delta) widens it — the mirror of the details panel's left-edge one.
      onDelta: (dx: number) =>
        useShellStore.getState().setLeftWidth(dragOrigin + dx),
      onOpenTable: (layerId: string) => {
        activateLayer(layerId);
        useShellStore.getState().openDrawer();
      },
    };
  }, []);

  return (
    <aside className="left-panel" aria-label="Layers panel">
      <div className="left-panel-head">
        <span className="left-panel-title">LAYERS</span>
        <button
          type="button"
          className="left-panel-add"
          aria-haspopup="dialog"
          aria-expanded={addOpen}
          onClick={() => setAddOpen(true)}
        >
          + Add layer
        </button>
      </div>

      <div className="left-panel-list">
        {empty ? (
          <p className="left-panel-empty">No layers yet</p>
        ) : (
          <LayerList
            onZoomToLayer={onZoomToLayer}
            onOpenTable={handlers.onOpenTable}
            extraRows={extraRows}
            pending={pending}
            failed={failed}
            dismissFailed={dismissFailed}
          />
        )}
      </div>

      {/* The hairline belongs to the region below it, so an empty workspace
          (or a selection-less one, where `ActiveLayerPanel` renders nothing)
          does not show a rule under nothing. */}
      {activeItem !== null && (
        <div className="left-panel-active">
          <ActiveLayerPanel onZoomToLayer={onZoomToLayer} />
        </div>
      )}

      <ResizeHandle
        axis="x"
        label="Resize layers panel"
        onStart={handlers.onStart}
        onDelta={handlers.onDelta}
      />

      {addOpen && (
        <AddLayerDialog
          onClose={() => setAddOpen(false)}
          onAddFile={onAddFile}
          onAddFiles={onAddFiles}
          onAddUrl={onAddUrl}
          loading={loading}
        />
      )}
    </aside>
  );
}
