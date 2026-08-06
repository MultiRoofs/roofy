/**
 * The catalog browser's mini-map: one rectangle per item, hover- and
 * selection-linked to the list beside it.
 *
 * IMPERATIVE, like the rest of this app's map code. maplibre is driven from
 * `useEffect`s against a ref, never from a JSX scene graph — the same taste
 * `NavaraViewport` follows, and the only way to keep a WebGL map's lifetime
 * (one `new Map`, one `remove`) honest under StrictMode's double-mount.
 *
 * THIS COMPONENT HAS NO UNIT TEST, deliberately: maplibre needs a real WebGL
 * context, which jsdom does not have. Everything worth asserting therefore
 * lives in `features/stac/stacGeo.ts`, which is pure and fully tested; what is
 * left here is wiring. Task 9's browser smoke covers the wiring, and the panel
 * tests around it mock this module wholesale.
 *
 * WHY NOT the app's own globe. This is a 200-pixel inset for choosing a file:
 * a second Navara viewport is impossible anyway (the engine's tile worker pool
 * is a module-level singleton — one viewport per page), and a raster mini-map
 * costs a fraction of the frame budget the real viewport is already spending.
 */

import { useEffect, useRef, type ReactElement } from "react";
// maplibre-gl 6 has NO default export; the Map class is a named export
// (exported twice, as `Map` and `MapLibreMap` — the latter to avoid shadowing
// the global `Map` at every use site, which is why it is the one used here).
import {
  GeoJSONSource,
  MapLibreMap,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  combinedBounds,
  extentToBounds,
  footprintFeatureCollection,
} from "../../features/stac/stacGeo";
import type { StacItemRecord } from "../../features/stac/stacTypes";

export interface StacItemMapProps {
  readonly items: readonly StacItemRecord[];
  readonly selectedId: string | null;
  readonly hoveredId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onHover: (id: string | null) => void;
  /** Fallback fit when no item has a valid bbox (the collection extent). */
  readonly fallbackExtent: readonly [number, number, number, number] | null;
  /** The map's bounds after every move, and once after the initial fit, so the
   *  list can show only what is on screen. */
  readonly onViewBounds?: (b: [[number, number], [number, number]]) => void;
}

const SOURCE_ID = "footprints";
const FILL_LAYER_ID = "footprints-fill";
const LINE_LAYER_ID = "footprints-line";

/** The catalogue's own accent orange (see `basemaps.ts` for the CARTO tiles
 *  this is drawn over) — legible on both the light and the dark sheet. */
const FOOTPRINT_COLOR = "#e8973f";

/** CARTO, exactly as `src/scene/basemaps.ts` uses it — same service, same
 *  tile scheme, and the same credit line, which is a licence obligation and
 *  not a nicety. Rendered by maplibre's own attribution control here, because
 *  this map is not the one `AttributionOverlay` sits on top of. */
const CARTO_ATTRIBUTION = "© CARTO © OpenStreetMap contributors";

function basemapStyle(dark: boolean): StyleSpecification {
  const sheet = dark ? "dark_all" : "light_all";
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [`https://basemaps.cartocdn.com/${sheet}/{z}/{x}/{y}.png`],
        tileSize: 256,
        attribution: CARTO_ATTRIBUTION,
      },
    },
    layers: [{ id: "carto", type: "raster", source: "carto" }],
  };
}

function boundsPair(map: MapLibreMap): [[number, number], [number, number]] {
  const b = map.getBounds();
  return [
    [b.getWest(), b.getSouth()],
    [b.getEast(), b.getNorth()],
  ];
}

export function StacItemMap(props: StacItemMapProps): ReactElement {
  const {
    items,
    selectedId,
    hoveredId,
    onSelect,
    onHover,
    fallbackExtent,
    onViewBounds,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  /** The `load` gate. Every data effect must no-op until this flips: the items
   *  effect routinely runs before the style has finished loading, and
   *  `getSource` returns undefined until it has. */
  const loadedRef = useRef(false);

  // Latest props, read by handlers and by the `load` callback. The map effect
  // must run ONCE (a re-created WebGL map on every prop change would be both
  // a flicker and a leak), so nothing it closes over may be a stale value.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const fallbackRef = useRef(fallbackExtent);
  fallbackRef.current = fallbackExtent;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hoveredRef = useRef(hoveredId);
  hoveredRef.current = hoveredId;
  const callbacksRef = useRef({ onSelect, onHover, onViewBounds });
  callbacksRef.current = { onSelect, onHover, onViewBounds };

  // ---- map lifetime: mount once, remove on unmount -------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        // Read ONCE, at mount: re-styling a live map to follow a theme toggle
        // would tear down and refetch every tile, and this map is opened from
        // a dialog that the user closes long before they visit the theme
        // switch.
        style: basemapStyle(document.documentElement.dataset.theme !== "light"),
        center: [5, 52],
        zoom: 1,
        attributionControl: { compact: true },
      });
    } catch {
      // jsdom, a blocked WebGL context, a driver that gave up: the dialog is
      // still perfectly usable as a list, so fail silently rather than take
      // the whole panel down with an error boundary.
      return;
    }
    mapRef.current = map;

    const emitBounds = (): void => {
      if (mapRef.current !== map) return;
      callbacksRef.current.onViewBounds?.(boundsPair(map));
    };

    map.on("load", () => {
      if (mapRef.current !== map) return;
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: footprintFeatureCollection(itemsRef.current),
        // Without this the features have no id and feature-state — the whole
        // hover/selection paint below — silently does nothing.
        promoteId: "itemId",
      });
      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": FOOTPRINT_COLOR,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.45,
            ["boolean", ["feature-state", "hover"], false],
            0.45,
            0.15,
          ],
        },
      });
      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": FOOTPRINT_COLOR,
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            2,
            1,
          ],
        },
      });

      const bounds =
        combinedBounds(itemsRef.current) ?? extentToBounds(fallbackRef.current);
      // `fitBounds(null)` throws, so no bounds means leaving the default world
      // view — an empty collection shows the globe, not an exception.
      if (bounds) {
        map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
      }

      loadedRef.current = true;
      applyFeatureStates(map, selectedRef.current, hoveredRef.current);
      // Once after the fit, whether or not there was anything to fit to: the
      // list's viewport filter needs a value from the start.
      emitBounds();
    });

    map.on("moveend", emitBounds);

    const onMove = (e: MapLayerMouseEvent): void => {
      if (mapRef.current !== map) return;
      const id = e.features?.[0]?.id;
      map.getCanvas().style.cursor = id == null ? "" : "pointer";
      callbacksRef.current.onHover(id == null ? null : String(id));
    };
    const onLeave = (): void => {
      if (mapRef.current !== map) return;
      map.getCanvas().style.cursor = "";
      callbacksRef.current.onHover(null);
    };
    const onClick = (e: MapLayerMouseEvent): void => {
      if (mapRef.current !== map) return;
      const id = e.features?.[0]?.id;
      if (id != null) callbacksRef.current.onSelect(String(id));
    };
    map.on("mousemove", FILL_LAYER_ID, onMove);
    map.on("mouseleave", FILL_LAYER_ID, onLeave);
    map.on("click", FILL_LAYER_ID, onClick);

    return () => {
      mapRef.current = null;
      loadedRef.current = false;
      map.remove();
    };
  }, []);

  // ---- data: setData on every items change, and NEVER a refit ---------------
  // The parent recomputes its filtered `items` array on hover, so refitting on
  // array identity would snap the camera back under the user's cursor and make
  // panning impossible. The refit lives in the effect below, keyed on the
  // collection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(SOURCE_ID);
    // `instanceof`, not a `type` check: `getSource` is typed as the whole
    // Source union, which has no discriminant narrow enough to reach
    // `setData`. Single maplibre copy, so the identity check is sound.
    if (!(source instanceof GeoJSONSource)) return;
    // `void`: maplibre 6's `setData` returns a promise that resolves once the
    // worker has re-indexed. Nothing here waits on that — the next repaint
    // shows the new rectangles — and awaiting it inside an effect would only
    // create a rejection nobody can act on if the map is removed meanwhile.
    void source.setData(footprintFeatureCollection(items));
  }, [items]);

  // ---- refit: only when the item set's collection changes -------------------
  const collectionId = items[0]?.collectionId ?? null;
  useEffect(() => {
    const map = mapRef.current;
    // Not loaded yet means the `load` handler has not run — and it does the
    // first fit itself, so there is nothing to do here.
    if (!map || !loadedRef.current) return;
    const bounds =
      combinedBounds(itemsRef.current) ?? extentToBounds(fallbackRef.current);
    if (bounds)
      map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
    // `itemsRef`/`fallbackRef` are read on purpose: this effect fires on the
    // COLLECTION, never on the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId]);

  // ---- hover / selection paint ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyFeatureStates(map, selectedId, hoveredId);
  }, [selectedId, hoveredId]);

  return (
    <div
      className="stac-item-map"
      data-testid="stac-item-map"
      ref={containerRef}
    />
  );
}

/** Clear the whole source's state, then re-set the two features that have any.
 *  Cheaper than tracking the previous ids, and it cannot drift out of sync
 *  when a `setData` replaces the features underneath. */
function applyFeatureStates(
  map: MapLibreMap,
  selectedId: string | null,
  hoveredId: string | null,
): void {
  map.removeFeatureState({ source: SOURCE_ID });
  if (selectedId != null) {
    map.setFeatureState(
      { source: SOURCE_ID, id: selectedId },
      { selected: true },
    );
  }
  if (hoveredId != null) {
    map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: true });
  }
}
