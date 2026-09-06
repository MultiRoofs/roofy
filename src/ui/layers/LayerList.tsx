/**
 * The workspace's layers, as ONE list.
 *
 * The incumbent `LayerPanel` splits them into "3D City Models" and
 * "Geospatial Layers" — two headings answering a question nobody asks (which
 * Zustand store is this in?) and forcing two different row designs on things
 * the user thinks of identically: stuff that is drawn, in an order, some of it
 * on. Here every layer is a `LayerRow` in {@link unifiedLayerOrder}, and the
 * difference between a CityJSON model, a FlatCityBuf stream and an XYZ
 * basemap is said in the row's own words — its type icon and its state line.
 *
 * This module is the ONLY store reader in the trio: `LayerRow` and
 * `LayerRowMenu` take props. What it does with the stores is narrow and
 * deliberate:
 *
 *  - it SOURCES each row's `LayerStateInput` (a static city's root counts, a
 *    stream's resident count and status, a vector's inline feature count) and
 *    hands `layerStateLine` the answer;
 *  - it OWNS the three writes a row can make — activate, toggle visible,
 *    rename — and the two-step remove a streaming layer needs;
 *  - it renders the rows that have no store entry at all: `extraRows` (a
 *    snapshot-restored layer whose local file is gone), `pending` (an add
 *    still parsing) and `failed` (an add that did not land).
 *
 * The per-row store reads live in {@link StoreLayerRow}, one mounted
 * component per row, because a `useStreamStore` call inside `rows.map()`
 * would change the number of hooks whenever a layer is added — the same
 * reason `LayerPanel` has a `LayerObjectCount` component.
 */
import { useMemo } from "react";
import {
  resolveActiveLayer,
  unifiedLayerOrder,
  type ActiveLayer,
} from "../../features/workspace/activeLayer";
import { activateLayer } from "../../features/workspace/layerCoordination";
import { useWorkspaceStore } from "../../features/workspace/workspaceStore";
import { useLayerStore } from "../../features/layers/layerStore";
import {
  countRootObjects,
  layerKindOf,
  layerStateLine,
  type LayerStateInput,
} from "../../features/layers/layerPresentation";
import {
  isGeoLayerUnavailable,
  useGeoLayerStore,
  type GeoJsonLayerConfig,
} from "../../features/geoLayers/geoLayerStore";
import { useStreamStore } from "../../features/streaming/streamStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import { closeStreamingLayer } from "../../features/streaming/openStreamingLayer";
import { getStreamPlugin } from "../../features/streaming/streamPlugin";
import type {
  FailedAdd,
  PendingAdd,
} from "../../features/layers/useLayerFileLoader";
import { LayerRow, PlaceholderRow } from "./LayerRow";

/**
 * A city layer that a restored snapshot could not rebuild, because its source
 * was a local file the browser is not allowed to re-open on its own.
 *
 * It is NOT in the layer store — there is no model to put there — so `App`
 * keeps the list and hands it here. The row it gets is the same size and
 * shape as a real one on purpose: the layer is still part of the workspace,
 * it just cannot be drawn until its file comes back.
 */
export interface UnavailableRow {
  readonly id: string;
  readonly name: string;
  readonly kind: "unavailable";
  /** Properties rather than methods: they are passed straight to the row as
   *  callbacks, which `typescript-eslint(unbound-method)` refuses for a
   *  method reference. */
  readonly onRelink: (file: File) => void;
  readonly onDismiss: () => void;
}

export interface LayerListProps {
  readonly onZoomToLayer: (item: ActiveLayer) => void;
  readonly onOpenTable: (layerId: string) => void;
  /** Snapshot-restored layers awaiting a file. Task 19 wires `App`'s. */
  readonly extraRows?: ReadonlyArray<UnavailableRow>;
  /** `useLayerFileLoader().pending` — adds still in flight. */
  readonly pending?: ReadonlyArray<PendingAdd>;
  /** `useLayerFileLoader().failed` — adds that did not land. */
  readonly failed?: ReadonlyArray<FailedAdd>;
  /** `useLayerFileLoader().dismissFailed`. REQUIRED, unlike the arrays above:
   *  a failed row that cannot be dismissed is a row the user can only stare
   *  at, so a caller that renders `failed` must also be able to clear it. */
  readonly dismissFailed: (id: string) => void;
}

const NO_ROWS: ReadonlyArray<never> = [];

export function LayerList({
  onZoomToLayer,
  onOpenTable,
  extraRows = NO_ROWS,
  pending = NO_ROWS,
  failed = NO_ROWS,
  dismissFailed,
}: LayerListProps) {
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  const activeLayerId = useWorkspaceStore((s) => s.activeLayerId);

  // Through `unifiedLayerOrder` rather than a second `[...city, ...geo]` here:
  // rule 4 of the workspace invariants ("who takes over when a layer is
  // removed") walks that same order, and a list that disagreed with it would
  // hand over to a row other than the one below the one that went.
  const items = unifiedLayerOrder(layers, geoLayers)
    .map((id) => resolveActiveLayer(id, layers, geoLayers))
    .filter((item): item is ActiveLayer => item !== null);

  return (
    <div className="layer-list" role="list" aria-label="Layers">
      {items.map((item) => (
        <StoreLayerRow
          key={item.layer.id}
          item={item}
          active={item.layer.id === activeLayerId}
          onZoomToLayer={onZoomToLayer}
          onOpenTable={onOpenTable}
        />
      ))}

      {extraRows.map((row) => (
        <PlaceholderRow
          key={row.id}
          kind="unavailable"
          name={row.name}
          onRelink={row.onRelink}
          onDismiss={row.onDismiss}
        />
      ))}

      {pending.map((add) => (
        <PlaceholderRow key={add.id} kind="loading" name={add.name} />
      ))}

      {failed.map((add) => (
        <PlaceholderRow
          key={add.id}
          kind="error"
          name={add.name}
          message={add.message}
          onRetry={add.retry}
          onDismiss={() => dismissFailed(add.id)}
        />
      ))}
    </div>
  );
}

/**
 * One store row: everything the row needs that only a store knows.
 *
 * Its own component so the streaming subscriptions below are legal — see this
 * module's doc comment — and so a commit on ONE stream re-renders only its own
 * row: each field is selected on its own (`version`, `status`, `message`)
 * rather than the whole `streams` record, which changes identity on every
 * commit of every layer.
 */
function StoreLayerRow({
  item,
  active,
  onZoomToLayer,
  onOpenTable,
}: {
  readonly item: ActiveLayer;
  readonly active: boolean;
  readonly onZoomToLayer: (item: ActiveLayer) => void;
  readonly onOpenTable: (layerId: string) => void;
}) {
  const id = item.layer.id;
  const kind = layerKindOf(item);

  const updateLayer = useLayerStore((s) => s.updateLayer);
  const removeLayer = useLayerStore((s) => s.removeLayer);
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);
  const removeGeoLayer = useGeoLayerStore((s) => s.removeGeoLayer);

  const streamVersion = useStreamStore((s) => s.streams[id]?.version);
  const streamStatus = useStreamStore((s) => s.streams[id]?.status);
  const streamMessage = useStreamStore((s) => s.streams[id]?.message);

  // A STATIC city layer only. Not a correctness guard on the state line —
  // the streaming branch below never reads `counts` — but a PERFORMANCE one:
  // `countRootObjects` walks every object in the model, and a streaming
  // layer's `model.objects` is a stub that is never populated (see
  // residentModel.ts), so the walk would be wasted. Memoised on the model
  // reference for the static case, where the walk is real.
  const model =
    item.kind === "city" && !item.layer.isStreaming ? item.layer.model : null;
  const counts = useMemo(
    () => (model === null ? undefined : countRootObjects(model)),
    [model],
  );

  let input: LayerStateInput;
  if (kind === "streaming") {
    const resident = getResidentModel(id, streamVersion ?? 0);
    input = {
      kind,
      residentCount: resident.featureCount,
      streamStatus,
      // The precedence contract in layerPresentation.ts: `error` wins for
      // every kind, and a caller holding a stream's message must copy it
      // here — the status alone would only produce "Streaming error".
      error: streamStatus === "error" ? (streamMessage ?? null) : null,
    };
  } else if (kind === "city") {
    input = {
      kind,
      counts,
      lod: item.kind === "city" ? item.layer.selectedLod : null,
    };
  } else if (kind === "vector") {
    const geo = item.kind === "geo" ? item.layer : null;
    input = {
      kind,
      featureCount:
        geo?.kind === "geojson" ? inlineFeatureCount(geo.config) : undefined,
      // The same bargain a file-backed city model gets: the document was too
      // big for localStorage, so the row kept the name and asks for the file.
      unavailable: geo !== null && isGeoLayerUnavailable(geo),
    };
  } else {
    input = { kind };
  }

  return (
    <LayerRow
      item={item}
      active={active}
      kind={kind}
      stateLine={layerStateLine(input)}
      filterChip={null}
      onActivate={() => activateLayer(id)}
      onToggleVisible={() => {
        if (item.kind === "city")
          updateLayer(id, { visible: !item.layer.visible });
        else updateGeoLayer(id, { visible: !item.layer.visible });
      }}
      onRename={(name) => {
        if (item.kind === "city") updateLayer(id, { name });
        else updateGeoLayer(id, { name });
      }}
      onZoom={canZoom(item) ? () => onZoomToLayer(item) : null}
      // City kinds only: a geospatial layer has no attribute table behind it.
      onOpenTable={item.kind === "city" ? () => onOpenTable(id) : null}
      onRemove={() => {
        if (item.kind === "geo") {
          removeGeoLayer(id);
          return;
        }
        // Before the store entry goes: the stream is only reachable BY layer
        // id, so dropping the layer first would strand the worker and its cell
        // meshes for the lifetime of the tab. A no-op for a static layer.
        closeStreamingLayer(getStreamPlugin(), id);
        removeLayer(id);
      }}
    />
  );
}

/**
 * Whether the app can compute an extent to fly to.
 *
 * Inherited verbatim from `GeoLayerRow`, which hid its zoom button for the
 * same two cases: an XYZ template names no extent at all, and an UNLINKED
 * layer (restored from a snapshot, no data and no url) has nothing to walk
 * until its file comes back. A menu item that could only ever toast teaches
 * users to ignore the whole menu. Every city layer has a model or a header,
 * so all of them can be flown to.
 */
function canZoom(item: ActiveLayer): boolean {
  if (item.kind === "city") return true;
  if (item.layer.kind === "raster-xyz") return false;
  return !isGeoLayerUnavailable(item.layer);
}

/**
 * How many features an inline GeoJSON document holds, or `undefined` when the
 * layer's data is not inline (a URL the engine fetches for itself) — which is
 * not the same as "none", and `layerStateLine` says "GeoJSON" for it rather
 * than claiming a count it does not have.
 *
 * Defensive about the shape because nothing else in the app inspects a
 * `GeoJsonLayerConfig.data`: it is `unknown`, validated once at the door by
 * `parseGeoJsonText` and handed to the engine as-is. A bare `Feature` (legal
 * GeoJSON, and what a one-shape file parses to) has no `features` array, and
 * reads here as "no count", not as "0 features".
 */
function inlineFeatureCount(config: GeoJsonLayerConfig): number | undefined {
  const data: unknown = config.data;
  if (data === null || typeof data !== "object") return undefined;
  const features = (data as { features?: unknown }).features;
  return Array.isArray(features) ? features.length : undefined;
}
