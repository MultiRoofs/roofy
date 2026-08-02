/**
 * Navara viewport: owns the `ThreeView` lifecycle and exposes the imperative
 * {@link CitySceneHandle} `App.tsx` drives the camera through.
 *
 * Replacement for `CitySceneR3F.tsx` (spec 4.1). No React Three Fiber: Navara
 * is imperative, so the whole engine lives behind refs and focused effects, and
 * React only owns the DOM around it.
 *
 * SCOPE (Tasks B11b + B14 + B15): engine lifecycle, the photorealistic globe,
 * the static layer store -> `CityModelHandle` mirror (`handleSync.ts`)
 * including per-layer rule styling, fit/align against the live handles'
 * geodetic bounds, the triangle readout, the init-failure panel, and the
 * interaction hub — pointer events -> pick intents -> `selectionStore`,
 * selection/hover -> `setHighlight`, and the source-CRS cursor readout.
 *
 * This file is the ENGINE SEAM for interaction, and holds only that: which
 * engine event carries what, and how a screen point becomes an ECEF ray. Every
 * decision it feeds is pure and tested elsewhere — `pickEventHandlers.ts`
 * (nearest-hit routing, tool gating, drag suppression, intents),
 * `handleSync.ts` (the handle registries) and `cursorCrsReadout.ts` (geodetic
 * -> source CRS, throttling).
 *
 * STILL DARK, by design: streaming cells (M7.5). `streamsRef` is already
 * threaded through every interaction path, so Task C13 only has to fill it.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ThreeView, {
  getPickRay,
  radianToDegree,
  vector3ToGeodetic,
} from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Vector2 } from "three";
// The engine-bound subpath, NOT the package barrel: the barrel must stay
// importable from Node (Global Constraints -> NODE_IMPORT_SAFE = false).
import { CityJSONPlugin } from "@cityjson/navara-cityjson/plugin";
import type {
  CityModelHandle,
  EcefRay,
  ScreenPoint,
} from "@cityjson/navara-cityjson";
import { useLayerStore } from "../features/layers/layerStore";
import { useSelectionStore } from "../features/selection/selectionStore";
import {
  allInteractionHandles,
  interactionHandles,
  layerHeightOffset,
  syncHighlight,
  syncLayers,
  syncStyles,
  totalTriangles,
  type HighlightMemo,
  type InteractionHandle,
  type LiveLayer,
} from "./handleSync";
import {
  acceptsPointer,
  applyPickIntent,
  canvasPointOf,
  createClickGate,
  narrowToMode,
  pickIntentFor,
  resolveNearestHit,
  sameSelection,
} from "./pickEventHandlers";
import {
  createThrottle,
  crsFromGeodetic,
  epsgForLayer,
} from "./cursorCrsReadout";
import {
  createNavaraSession,
  NavaraSessionDisposedError,
  type NavaraSession,
} from "./navaraSession";
import {
  alignCameraForBounds,
  cameraForBounds,
  unionGeodeticBounds,
  type GeographicCameraState,
} from "./geographicCamera";
import { ViewAlignButtons, type ViewDirection } from "./ViewAlignButtons";

export interface CitySceneHandle {
  fitAll: () => void;
  fitLayer: (layerId: string) => void;
  alignView: (direction: ViewDirection) => void;
  getCameraState: () => GeographicCameraState | null;
  setCameraState: (state: GeographicCameraState) => void;
  /** Resolves once the engine is live (`view.init()` + plugins registered);
   *  REJECTS with the init error if it never came up. App.tsx awaits this
   *  inside try/catch instead of a 100 ms setTimeout — see Task C20. */
  readonly ready: Promise<void>;
}

export interface NavaraViewportProps {
  readonly onTriangleCount: (count: number) => void;
  readonly onFps?: (fps: number) => void;
  readonly onCursorPosition?: (
    pos: readonly [number, number, number] | null,
  ) => void;
  readonly onLayerError?: (layerId: string, message: string) => void;
}

type ViewInstance = InstanceType<typeof ThreeView>;

interface ReadyGate {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Serialises engine lifetimes across mounts. BROWSER-VERIFIED requirement, not
 * a precaution: `@navaramap/three` keeps its tile worker pool in a MODULE-LEVEL
 * singleton, so a second `view.init()` that starts before the first view's
 * `dispose()` has run `terminateWorkerPool()` throws "Worker pool has already
 * been initialized." and both views come up dead. React StrictMode's
 * mount/unmount/mount does exactly that.
 *
 * Every mount therefore queues behind this promise: it constructs nothing
 * until the previous view is gone, and a mount cancelled before its turn (the
 * StrictMode first pass) never constructs a view at all — so StrictMode boots
 * the engine exactly once instead of twice.
 *
 * Corollary: at most ONE `NavaraViewport` may be mounted at a time. That is an
 * engine constraint, not a design choice — {@link mountedViewports} enforces
 * it loudly in development.
 */
let engineSlot: Promise<unknown> = Promise.resolve();

/**
 * How many `NavaraViewport`s are mounted right now. StrictMode never pushes
 * this past 1 (its first pass is cleaned up before the second mounts), so
 * anything above 1 is a genuine second instance — which cannot come up until
 * the first unmounts, because of the worker-pool singleton above.
 */
let mountedViewports = 0;

function createReadyGate(): ReadyGate {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nobody may ever await it (the component can unmount first), so make sure a
  // rejection is never reported as unhandled.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export const NavaraViewport = forwardRef<CitySceneHandle, NavaraViewportProps>(
  function NavaraViewport(props, ref) {
    const { onFps, onTriangleCount, onLayerError, onCursorPosition } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<ViewInstance | null>(null);
    const cityPluginRef = useRef<CityJSONPlugin | null>(null);
    /** The live static handles, keyed by layer id. A ref, not state: the
     *  engine owns the meshes, and re-rendering on a handle change would only
     *  invalidate the imperative callbacks below. */
    const liveRef = useRef(new Map<string, LiveLayer>());
    /** Streaming layer handles, keyed by layer id. Empty until Task C13 opens a
     *  FlatCityBuf layer; every interaction path already reads it, so C13 adds
     *  no branch here. */
    const streamsRef = useRef(new Map<string, InteractionHandle>());
    const [engineReady, setEngineReady] = useState(false);
    const [initError, setInitError] = useState<string | null>(null);
    /** Bumped by the sync effect when a layer was newly added, which is the
     *  only thing that triggers an automatic fit. */
    const [fitToken, setFitToken] = useState(0);
    const layers = useLayerStore((s) => s.layers);

    // CitySceneHandle.ready — created eagerly so a consumer can await it before
    // the mount effect has run. Resolve-or-reject, never a hang: see the Shared
    // Interface Contract.
    const readyRef = useRef<ReadyGate | null>(null);
    readyRef.current ??= createReadyGate();
    const readyGate = readyRef.current;

    // --- Engine lifecycle (StrictMode-safe, see navaraSession.ts) ---
    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        // Unreachable in practice — the div below is rendered unconditionally,
        // so React has attached the ref by the time this effect runs — but an
        // early `return` here would leave `ready` pending FOREVER, which is
        // the same hang class as the plugin-constructor escape fixed in B11a.
        // Resolve-or-reject, never a hang (Shared Interface Contract).
        const error = new Error(
          "NavaraViewport: the canvas container never mounted, so the engine cannot start.",
        );
        setInitError(error.message);
        readyGate.reject(error);
        return;
      }

      mountedViewports += 1;
      if (import.meta.env.DEV && mountedViewports > 1) {
        console.warn(
          `NavaraViewport: ${mountedViewports} instances are mounted at once. ` +
            "Navara's tile worker pool is a process-wide singleton, so only " +
            "one view can be live: the extra instances stay blank until the " +
            "first one unmounts. Render exactly one NavaraViewport.",
        );
      }

      let cancelled = false;
      let session: NavaraSession<ViewInstance> | null = null;

      // ONE try/catch around the WHOLE queued body. Everything that can throw
      // lives inside it — a rejected predecessor, a plugin constructor on an
      // unsupported browser, `createView`, `init()`, an `afterInit` hook — so
      // there is no escape that leaves `ready` pending. Resolve-or-reject,
      // never a hang (Shared Interface Contract → CitySceneHandle.ready).
      const started = (async () => {
        try {
          // Our turn only comes once any previous view has been disposed. If
          // this mount was already torn down by then (StrictMode's first
          // pass), build nothing at all.
          await engineSlot;
          if (cancelled) return;

          // Constructed here so this component keeps typed refs; the session
          // only needs them in registration order (Task B8). Task C13 appends
          // the FlatCityBuf plugin to this same array.
          const defaultPlugin = new DefaultPlugin();
          const cityPlugin = new CityJSONPlugin();

          session = createNavaraSession({
            // Task B1 finding 3: `Options` has NO `useNormal`. `shadow` is
            // init-time-only, and `picking` defaults to true but is spelled
            // out because the app depends on it. `animation` keeps the render
            // loop running every frame, which is what the FPS readout below
            // measures.
            createView: () =>
              new ThreeView({
                container,
                shadow: true,
                picking: true,
                animation: true,
              }),
            plugins: [
              {
                key: "default",
                instance: defaultPlugin,
                // Must run after `view.init()` — hence an afterInit hook
                // rather than a call next to the constructor.
                afterInit: () => void defaultPlugin.addDefaultPhotorealScene(),
              },
              { key: "cityjson", instance: cityPlugin },
            ],
          });

          const result = await session.ready;
          if (cancelled) return;

          viewRef.current = result.view;
          cityPluginRef.current = cityPlugin;
          setInitError(null);
          setEngineReady(true);
          readyGate.resolve();
        } catch (error) {
          // Torn down mid-init, or disposed before it went live: not a failure
          // anyone needs to see, and the cleanup below still disposes.
          if (cancelled || error instanceof NavaraSessionDisposedError) return;
          setInitError(error instanceof Error ? error.message : String(error));
          readyGate.reject(error);
        }
      })();

      engineSlot = started;

      return () => {
        cancelled = true;
        mountedViewports -= 1;
        setEngineReady(false);
        viewRef.current = null;
        cityPluginRef.current = null;
        // The handles die with the view; dropping them here means the next
        // mount re-adds every layer from the store instead of trusting stale
        // entries whose meshes have been disposed.
        liveRef.current.clear();
        // `started` settles only after `session.ready` has, so by the time
        // this runs the session disposes synchronously — which is what lets
        // the next mount initialise a fresh worker pool. If `dispose()` itself
        // throws, the next mount's `await engineSlot` re-raises it into that
        // mount's catch: reported in its error panel, never a silent hang.
        engineSlot = started.then(() => session?.dispose());
      };
    }, [readyGate]);

    // --- FPS readout from the render loop ---
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view || !onFps) return;
      let frames = 0;
      let last = performance.now();
      const onPostRender = () => {
        frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          onFps(Math.round((frames * 1000) / (now - last)));
          frames = 0;
          last = now;
        }
      };
      view.on("postRender", onPostRender);
      return () => view.off("postRender", onPostRender);
    }, [engineReady, onFps]);

    // --- camera helpers ---
    // Bounds come from the live handles, so a fit frames the model where it is
    // actually PLACED (the geoid offset is baked into `getBoundsGeodetic`).
    // With nothing registered the union is empty and a fit is a no-op rather
    // than a jump to a NaN camera. Deps stay `[]` on purpose: `liveRef` is a
    // ref, so `fitAll`'s identity is stable and the fit-once effect below
    // cannot be re-triggered by an unrelated store update.
    // Streaming cells join this union in M7.5.
    const boundsOf = useCallback((ids?: readonly string[]) => {
      const handles: CityModelHandle[] = [];
      for (const [id, entry] of liveRef.current) {
        if (ids && !ids.includes(id)) continue;
        handles.push(entry.handle);
      }
      return unionGeodeticBounds(handles.map((h) => h.getBoundsGeodetic()));
    }, []);

    const fitAll = useCallback(() => {
      const view = viewRef.current;
      const bounds = boundsOf();
      if (!view || !bounds) return;
      view.flyTo(cameraForBounds(bounds));
    }, [boundsOf]);

    const fitLayer = useCallback(
      (layerId: string) => {
        const view = viewRef.current;
        const bounds = boundsOf([layerId]);
        if (!view || !bounds) return;
        view.flyTo(cameraForBounds(bounds));
      },
      [boundsOf],
    );

    const alignView = useCallback(
      (direction: ViewDirection) => {
        const view = viewRef.current;
        const bounds = boundsOf();
        if (!view || !bounds) return;
        // Instant, not animated: `setCamera` emits no camera events, so an
        // alignment cannot be mistaken for a user gesture (Task C7).
        view.setCamera(alignCameraForBounds(bounds, direction));
      },
      [boundsOf],
    );

    // --- layer store -> engine handles ---
    // The reconciliation itself lives in `handleSync.ts` (pure, unit-tested);
    // this effect only supplies the registry binding and reports the results.
    // Streaming layers are skipped by `syncLayers` — @cityjson/navara-flatcitybuf
    // creates and owns their meshes from M7.5 on.
    useEffect(() => {
      const plugin = cityPluginRef.current;
      if (!engineReady || !plugin) return;
      const before = liveRef.current.size;
      syncLayers(
        {
          get: (id) => plugin.getHandle(id),
          add: (layer) =>
            plugin.addCityModel(layer.model, {
              id: layer.id,
              crs: layer.model.metadata.referenceSystem,
              lod: layer.selectedLod,
            }),
        },
        layers,
        liveRef.current,
        (layerId, error) =>
          onLayerError?.(
            layerId,
            error instanceof Error ? error.message : String(error),
          ),
      );
      // Rule colors, after the handles exist so a newly added layer is styled
      // on the same pass it appears (Task B14). Memoised inside — a rule edit
      // repaints only the layer whose rules changed.
      syncStyles(layers, liveRef.current);
      onTriangleCount(
        totalTriangles(layers, liveRef.current, streamsRef.current),
      );
      // Only a NEW layer earns a camera move: a visibility toggle, a LoD
      // change or a rule edit must not yank the camera out from under the user.
      if (liveRef.current.size > before) setFitToken((t) => t + 1);
    }, [engineReady, layers, onTriangleCount, onLayerError]);

    // Fit once whenever a layer is newly added. Separate from the sync effect
    // so the fit runs after the handles exist and `boundsOf` can see them.
    useEffect(() => {
      if (fitToken === 0) return;
      fitAll();
    }, [fitToken, fitAll]);

    // --- selection / hover -> handle.setHighlight ---
    // Subscribed as state (not read from `getState()`) because a selection made
    // anywhere else in the app — the inspector, a share link restore, box
    // select — has to repaint too, not just one made by a click in here.
    const selections = useSelectionStore((s) => s.selections);
    const hovered = useSelectionStore((s) => s.hovered);
    /** What each live handle was last told. Keyed by handle identity, so a
     *  deleted layer's entry disappears with it and a re-added layer's fresh
     *  handle is always pushed to. */
    const highlightMemoRef = useRef<HighlightMemo>(new WeakMap());
    useEffect(() => {
      if (!engineReady) return;
      syncHighlight(
        // ALL handles, hidden layers included: highlight outlives a visibility
        // toggle, and each handle filters the array by its own layerId.
        allInteractionHandles(layers, liveRef.current, streamsRef.current),
        selections,
        hovered,
        // Hovering a building in one layer must not repaint the others:
        // `setHighlight` recolors the whole layer, and this effect runs on
        // every hover step.
        highlightMemoRef.current,
      );
    }, [engineReady, layers, selections, hovered]);

    // --- engine pointer events -> pick intents + the cursor readout ---
    useEffect(() => {
      const view = viewRef.current;
      if (!engineReady || !view) return;

      // ONE registry for interaction. In Part B it only ever holds static
      // handles; Task C13 fills `streamsRef` and this same closure then picks
      // and highlights streamed cells with no further change here. Rebuilt per
      // event rather than captured: `liveRef` mutates in place, and a captured
      // array would go stale the moment a layer is added.
      const handles = () =>
        interactionHandles(layers, liveRef.current, streamsRef.current);

      /**
       * Screen point -> ECEF ray.
       *
       * `getPickRay` is a free function taking a `{width, height, pixelRatio}`
       * window-like and the raw three camera (Task B1 finding 5). It measures
       * from the CANVAS' top-left, which is why every caller below goes through
       * `canvasPointOf` rather than the event's `clientX`/`clientY`.
       */
      const rayAt = (point: ScreenPoint): EcefRay | null => {
        const size = view.screenSize;
        return getPickRay(
          { width: size.x, height: size.y, pixelRatio: view.pixelRatio },
          view.camera.raw,
          new Vector2(point.x, point.y),
        );
      };

      const pickAt = (point: ScreenPoint) => {
        const ray = rayAt(point);
        return ray ? resolveNearestHit(handles(), ray) : null;
      };

      // ~15 Hz, the old app's inline `performance.now()` gate. Hover is NOT
      // throttled — it is what makes the highlight follow the pointer — but the
      // readout costs a depth read plus a proj4 transform, and the status bar
      // cannot show more than this anyway.
      const throttleCursor = createThrottle(66);
      const clickGate = createClickGate();

      const reportCursor = (point: ScreenPoint, hitLayerId?: string) => {
        if (!onCursorPosition) return;
        throttleCursor(() => {
          const ecef = view.pickDepthPosition(point.x, point.y);
          if (!ecef) {
            // Nothing rendered under the cursor at all (the sky). Not a
            // ground-plane fallback: the engine's depth read already answers
            // with the globe surface wherever the terrain is drawn.
            onCursorPosition(null);
            return;
          }
          // No hit means the cursor is on the terrain rather than a model; the
          // readout then speaks the first layer's CRS, which is the only CRS
          // the user has asked to see.
          const layerId = hitLayerId ?? layers[0]?.id;
          const layer = layers.find((l) => l.id === layerId);
          const epsg = epsgForLayer(layer?.model.metadata.referenceSystem);
          if (epsg === null) {
            onCursorPosition(null);
            return;
          }
          const lle = vector3ToGeodetic(ecef);
          onCursorPosition(
            crsFromGeodetic(
              // RADIANS in, degrees out. Evidence, not assumption: the B1 spike
              // placed its probe mesh with the exact inverse of this call —
              // `geodeticToVector3({ lng: degreeToRadian(site.lng), lat:
              // degreeToRadian(site.lat), height })` (`src/spike/
              // navaraMrtSpike.ts`) — and the mesh rendered at the right place
              // on the globe in the browser. The engine's `LatLngHeight` is
              // degrees elsewhere in its own API (`flyTo`,
              // `camera.positionGeographic`), so this must stay explicit.
              radianToDegree(lle.lng),
              radianToDegree(lle.lat),
              // ELLIPSOIDAL -> ORTHOMETRIC. The layer sits `heightOffset`
              // metres up because its geodetic heights were raised by the geoid
              // undulation (Global Constraints -> Vertical datum); subtracting
              // it again yields the z the source file actually contains.
              lle.height -
                layerHeightOffset(layerId, liveRef.current, streamsRef.current),
              epsg,
            ),
          );
        });
      };

      /**
       * The last mousemove the ENGINE reported, by object identity.
       *
       * `convertMouseEventToMapEvent` `Object.assign`s `{ map }` onto the very
       * DOM event it received and returns `null` when the screen ray misses the
       * ellipsoid — so the object the engine emits IS the object our own DOM
       * listener sees afterwards (the engine binds to the canvas, we bind to its
       * parent, so bubbling puts the engine first). Comparing them is therefore
       * an exact "did the engine handle this move?" test.
       */
      let lastEngineMove: unknown = null;

      /** Nothing is under the cursor: drop the hover and the readout. */
      const clearCursorState = () => {
        const store = useSelectionStore.getState();
        if (store.hovered !== null) store.hover(null);
        onCursorPosition?.(null);
      };

      const onMouseDown = (e: MouseEvent) => clickGate.down(canvasPointOf(e));

      const onMouseMove = (e: MouseEvent) => {
        lastEngineMove = e;
        const point = canvasPointOf(e);
        clickGate.move(point);
        const store = useSelectionStore.getState();
        // Gate on the tool BEFORE resolving: a measure-mode move must not cost
        // a raycast across every layer.
        if (!acceptsPointer(store.toolMode, "move")) {
          reportCursor(point);
          return;
        }
        const hit = narrowToMode(pickAt(point), store.mode);
        // Every resolved pick is a fresh object, so pushing it unconditionally
        // would change `hovered` on every mousemove and repaint every layer's
        // vertex colors at pointer rate.
        if (!sameSelection(store.hovered, hit)) {
          applyPickIntent(
            pickIntentFor({ type: "move", shiftKey: false }, hit),
            store,
          );
        }
        reportCursor(point, hit?.layerId);
      };

      const onClick = (e: MouseEvent) => {
        const store = useSelectionStore.getState();
        if (!acceptsPointer(store.toolMode, "click")) return;
        // The engine's `click` is the raw DOM click and fires at the end of a
        // camera orbit too; without this, every gesture would clear the
        // selection on mouseup.
        if (!clickGate.isClean()) return;
        const hit = narrowToMode(pickAt(canvasPointOf(e)), store.mode);
        applyPickIntent(
          pickIntentFor({ type: "click", shiftKey: e.shiftKey === true }, hit),
          store,
        );
      };

      /**
       * SKY DETECTOR, and the reason the two listeners below exist at all.
       *
       * The engine emits NO pointer event — not `mousemove`, not even
       * `mouseleave` — when the screen ray misses the ellipsoid, because
       * `convertMouseEventToMapEvent` returns null and the emit is skipped.
       * Relying on engine events alone therefore freezes the hover highlight
       * and the status bar at their last on-globe values the moment the cursor
       * moves onto the sky, and leaves them frozen if the pointer exits the
       * canvas across a sky pixel.
       *
       * The DOM always fires, so the container listens too: a move the engine
       * did NOT claim is a move over the sky.
       */
      const onDomMouseMove = (e: MouseEvent) => {
        // Feed the drag gate from here as well: a gesture that starts or moves
        // over the sky is invisible to the engine, and a stale gate would let
        // the click that ends it commit a selection.
        clickGate.move(canvasPointOf(e));
        if (lastEngineMove === e) return;
        clearCursorState();
      };
      const onDomMouseDown = (e: MouseEvent) =>
        clickGate.down(canvasPointOf(e));
      // Leaving the canvas: unconditional, and the one case the engine's own
      // `mouseleave` cannot be trusted for.
      const onDomMouseLeave = () => clearCursorState();

      // No `view.on("pick", ...)`: PICK_PATH is "own-raycast" (Task B1).
      // `PickableMeshWrapper` allocates ONE batch id per mesh, so an engine
      // pick could only ever name a layer, and it would fire alongside `click`
      // — committing a second, coarser selection over the right one.
      // `handleSync.resolvePickedFeature` stands ready for the day that
      // changes.
      view.on("mousedown", onMouseDown);
      view.on("mousemove", onMouseMove);
      view.on("click", onClick);

      const host = containerRef.current;
      host?.addEventListener("mousemove", onDomMouseMove);
      host?.addEventListener("mousedown", onDomMouseDown);
      host?.addEventListener("mouseleave", onDomMouseLeave);

      return () => {
        view.off("mousedown", onMouseDown);
        view.off("mousemove", onMouseMove);
        view.off("click", onClick);
        host?.removeEventListener("mousemove", onDomMouseMove);
        host?.removeEventListener("mousedown", onDomMouseDown);
        host?.removeEventListener("mouseleave", onDomMouseLeave);
      };
    }, [engineReady, layers, onCursorPosition]);

    const getCameraState = useCallback((): GeographicCameraState | null => {
      const view = viewRef.current;
      if (!view) return null;
      try {
        const { lng, lat, height } = view.camera.positionGeographic;
        const { heading, pitch, roll } = view.camera.orientation;
        if (
          heading === undefined ||
          pitch === undefined ||
          roll === undefined
        ) {
          return null;
        }
        return { lng, lat, height, heading, pitch, roll };
      } catch {
        // BROWSER-VERIFIED, not defensive padding: `positionGeographic`
        // throws a bare "Invariant failed" until the engine has wired the
        // camera to its Rust core, which happens on the first rendered frame —
        // AFTER `view.init()` resolves. A snapshot taken in that window (C20's
        // autosave, a share-link capture) must report "no camera yet", not
        // take the caller down.
        return null;
      }
    }, []);

    const setCameraState = useCallback((state: GeographicCameraState) => {
      viewRef.current?.setCamera(state);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        fitAll,
        fitLayer,
        alignView,
        getCameraState,
        setCameraState,
        ready: readyGate.promise,
      }),
      [
        fitAll,
        fitLayer,
        alignView,
        getCameraState,
        setCameraState,
        readyGate.promise,
      ],
    );

    return (
      <div className="navara-viewport">
        {/* The engine appends its canvas here. Kept childless so React never
            has to reconcile around a DOM node it does not own. */}
        <div className="navara-viewport__canvas" ref={containerRef} />
        {initError !== null && (
          <div className="navara-viewport__error" role="alert">
            The 3D engine failed to start: {initError}
          </div>
        )}
        <ViewAlignButtons onAlign={alignView} />
      </div>
    );
  },
);
