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

import { useEffect, useRef, useState, type ReactElement } from "react";
// maplibre-gl 6 has NO default export; the Map class is a named export
// (exported twice, as `Map` and `MapLibreMap` — the latter to avoid shadowing
// the global `Map` at every use site, which is why it is the one used here).
import {
  GeoJSONSource,
  GPUInitializationError,
  MapLibreMap,
  setWorkerUrl,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// maplibre 6 locates its worker as `new URL("./maplibre-gl-worker.mjs",
// import.meta.url)` — a DYNAMIC pattern no bundler rewrites. Vite's dep
// optimizer rebases `import.meta.url` into `.vite/deps/`, where that file does
// not exist, so the worker fetch 404s, the GeoJSON source never indexes, and
// the map renders its basemap with NO footprints and `loaded()` stuck false —
// with nothing but a one-line "Failed to fetch" warning to show for it. A
// production build breaks the same way for the same reason (the asset is
// never emitted). `?url` makes Vite itself serve/emit the real file, and
// `setWorkerUrl` is maplibre's supported override for exactly this.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(maplibreWorkerUrl);
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

/** The brand lime (`--brand-primary`), read the same way `basemapStyle` reads
 *  the sheet: once, at mount. Lime-500 sits on CARTO's dark sheet; on the light
 *  one it is the darker lime-700 the light theme uses for every tint, since
 *  lime-500 on a near-white map does not hold contrast. */
function footprintColor(): string {
  return document.documentElement.dataset.theme !== "light"
    ? "#a7e32b"
    : "#7cb518";
}

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

/**
 * Whether the map actually got a GPU.
 *
 * maplibre 6 does NOT throw when it cannot create a WebGL2 context — the most
 * likely failure here, a browser refusing a SECOND context beside the Navara
 * globe. `_setupPainter` calls `getContext("webgl2")`, and on null it fires an
 * `ErrorEvent(GPUInitializationError)` and returns; the constructor then does
 * `if (!this.painter) return`, handing back a half-built Map. `load` never
 * fires, so every effect below stays gated off forever and the panel is a dead
 * empty box. Worse, that ErrorEvent is fired DURING construction — before the
 * caller can possibly have attached `map.on("error")` — so the listener alone
 * cannot see it. This synchronous check is what does.
 *
 * `painter` is declared non-optional on the Map type but is genuinely
 * `undefined` in that state, hence the widening.
 */
function hasPainter(map: MapLibreMap): boolean {
  return (map as unknown as { painter?: unknown }).painter != null;
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

  /** The last collection the camera was fitted to. See the refit effect. */
  const lastFitRef = useRef<string | null>(null);
  /** The map could not be created, or lost its GPU. Renders a placeholder. */
  const [failed, setFailed] = useState(false);

  // Latest props, read by handlers and by the `load` callback. The map effect
  // must run ONCE (a re-created WebGL map on every prop change would be both
  // a flicker and a leak), so nothing it closes over may be a stale value.
  const itemsRef = useRef(items);
  const fallbackRef = useRef(fallbackExtent);
  const selectedRef = useRef(selectedId);
  const hoveredRef = useRef(hoveredId);
  const callbacksRef = useRef({ onSelect, onHover, onViewBounds });

  // The `useRef` calls above seed these from the FIRST render; every later
  // render updates them HERE and not in the render body, because React 19
  // treats a render-phase ref write as unsupported (a discarded render still
  // mutates the ref). Declared FIRST on purpose: effects run in declaration
  // order, so the refit effect below always sees this commit's values.
  useEffect(() => {
    itemsRef.current = items;
    fallbackRef.current = fallbackExtent;
    selectedRef.current = selectedId;
    hoveredRef.current = hoveredId;
    callbacksRef.current = { onSelect, onHover, onViewBounds };
  });

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
    } catch (err) {
      // A SYNCHRONOUS throw only — jsdom with no canvas, a container the
      // constructor chokes on. The far likelier WebGL failure does not come
      // through here at all; see `hasPainter`.
      console.warn("[StacItemMap] map could not be created", err);
      setFailed(true);
      return;
    }

    if (!hasPainter(map)) {
      // NO `map.remove()`: it starts with `this.painter.destroy()` and would
      // throw on exactly this map. The half-built instance is dropped instead,
      // and React takes its injected DOM with the container div when the
      // placeholder renders in its place.
      console.warn("[StacItemMap] no WebGL context; showing a placeholder");
      setFailed(true);
      return;
    }

    mapRef.current = map;

    let warnedOnce = false;
    map.on("error", (e) => {
      if (mapRef.current !== map) return;
      // Only a GPU failure is fatal. A 404 on one CARTO tile also arrives as
      // `error`, and blanking a working map over a missing tile would be a
      // worse bug than the one this guards against.
      if (e.error instanceof GPUInitializationError) {
        mapRef.current = null;
        loadedRef.current = false;
        setFailed(true);
        return;
      }
      if (!warnedOnce) {
        warnedOnce = true;
        console.warn("[StacItemMap] map error", e.error);
      }
    });

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
          "fill-color": footprintColor(),
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
          "line-color": footprintColor(),
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            2,
            1,
          ],
        },
      });

      loadedRef.current = true;
      applyFeatureStates(map, selectedRef.current, hoveredRef.current);

      const bounds =
        combinedBounds(itemsRef.current) ?? extentToBounds(fallbackRef.current);
      if (bounds) {
        // `duration: 0` finishes SYNCHRONOUSLY (`_ease` runs `frame(1);
        // finish()` when the duration is zero) and `finish` fires `moveend`,
        // which is already wired to `emitBounds`. So the fit emits the initial
        // bounds exactly once, and emitting again here would double it.
        map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
        // Only a real fit records the collection, so the refit effect does not
        // re-fit the collection this one just handled.
        lastFitRef.current = itemsRef.current[0]?.collectionId ?? null;
      } else {
        // `fitBounds(null)` throws, so no bounds means leaving the default
        // world view — an empty collection shows the globe, not an exception.
        // No camera move happened, so nothing fired `moveend`: this is the one
        // case that has to emit by hand, because the list's viewport filter
        // needs a value from the start either way.
        emitBounds();
      }
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
      // Guarded for the same reason as above: `remove()` dereferences the
      // painter, so a map that lost its GPU after construction must not be
      // removed — only dropped.
      if (hasPainter(map)) map.remove();
    };
  }, []);

  // ---- data: setData on every items change, and NEVER a refit ---------------
  // As shipped, `StacBrowser` hands this component the store's UNFILTERED item
  // array, whose identity only changes when the collection's entry does — so
  // this effect is cheap in practice. Refitting here anyway would be wrong for
  // any caller that is less careful: a parent that passed a hover- or
  // filter-derived array would get a camera that snapped back on every
  // mousemove. The refit therefore lives in the effect below, keyed on the
  // collection rather than on this array's identity.
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

  // ---- refit: only when the item set's collection actually changes ----------
  // `items[0]?.collectionId` is the collection, but it is NOT enough on its
  // own as an effect key, because it OSCILLATES: any empty → non-empty
  // transition reads as null → "cityjson-nl" and would refit though the
  // collection never changed. The current parent passes the store's unfiltered
  // array, which still empties whenever a collection's entry is refetched or
  // replaced — and a parent that passed a filtered array (typing a no-match
  // filter, then deleting one character) would snap the camera out from under
  // the user. So nulls are ignored outright and the last fitted collection is
  // remembered.
  const collectionId = items[0]?.collectionId ?? null;
  useEffect(() => {
    const map = mapRef.current;
    // Not loaded yet means the `load` handler has not run — and it does the
    // first fit itself, so there is nothing to do here.
    if (!map || !loadedRef.current) return;
    if (!collectionId || collectionId === lastFitRef.current) return;
    const bounds =
      combinedBounds(itemsRef.current) ?? extentToBounds(fallbackRef.current);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });
    lastFitRef.current = collectionId;
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

  // A VISIBLE placeholder, not an empty box: the failure mode this guards
  // against (a browser refusing a second WebGL context beside the Navara
  // globe) is invisible otherwise, and a blank rectangle reads as "the
  // catalog has no footprints" rather than "the map did not start". The list
  // beside it stays fully usable, so this is a degrade, not an error.
  if (failed) {
    return (
      <div
        className="stac-item-map stac-item-map--failed"
        data-testid="stac-item-map"
        data-failed="true"
        role="status"
      >
        Map unavailable
      </div>
    );
  }

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
