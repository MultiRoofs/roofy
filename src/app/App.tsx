import { ensureDelftLandUse } from "../features/walkthrough/delftLandUse";
import { Walkthrough } from "../ui/walkthrough/Walkthrough";
import {
  walkthroughStore,
  useWalkthroughStore,
} from "../features/walkthrough/walkthroughStore";
import { useDrawStore } from "../features/drawing/drawStore";
import { DrawOverlay } from "../ui/viewport/DrawOverlay";
import { saveWorkspace } from "../persistence/saveWorkspace";
import {
  captureBasemap,
  restoreBasemap,
} from "../features/basemap/basemapPersistence";
import { WorkspacesPage } from "../ui/workspaces/WorkspacesPage";
import { captureTablePresentation } from "../features/query/tablePresentation";
import { useQueryStore } from "../features/query/queryStore";
import { getActiveTableKey } from "../features/layers/familyStore";
import { type TablePresentation } from "../features/query/tablePresentation";
import {
  normalizeAttributeOrders,
  type AttributeOrders,
} from "../features/attributes/attributeOrder";
import type { AppearanceTheme, CityModelEncoding } from "@cityjson/navara-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./brand.css";
import "./app.css";
import "./workspace.css";
import "./flatControls.css";
import { detectEncoding } from "../domain/citymodel/detectEncoding";
import {
  loadFromUrl,
  fileNameFromUrl,
} from "../domain/citymodel/loadCityModel";
import type {
  CityModelReference,
  GeographicCamera,
  ProjectStateStore,
  RawLayerSnapshot,
  SnapshotSummary,
  StreamSourceSnapshot,
} from "../persistence/types";
import {
  geoLayerSnapshot,
  normalizeGeoLayers,
  normalizeLayers,
  UnsupportedSnapshotVersionError,
} from "../persistence/types";
import { LocalStorageProjectStateStore } from "../persistence/localStorage";
import {
  captureColorBy,
  captureSnapshot,
} from "../persistence/captureSnapshot";
import { restoreSnapshot } from "../persistence/restoreSnapshot";
import { derivedNotSavedNote, snapshotLayers } from "./snapshotLayers";
import { readShareHash, buildShareUrl } from "../persistence/urlShare";
import type { ColorBy } from "../features/rules/colorBy";
import type { ShareableViewState } from "../persistence/urlShare";
import { useDuckDBStatus } from "../insights/useDuckDBStatus";
import { retryEngine } from "../insights/layerTables";
import { browserPlatform } from "../platform/browser";
import type { PlatformServices } from "../platform/types";
import { NavaraViewport } from "../scene/NavaraViewport";
import type { CitySceneHandle } from "../scene/NavaraViewport";
import { useViewModeStore } from "../features/viewMode/viewModeStore";
import { useSceneThemeStore } from "../features/sceneTheme/sceneThemeStore";
import {
  isAutoFitSuppressed,
  suppressAutoFit,
} from "../scene/autoFitSuppression";
import { useSelectionStore } from "../features/selection/selectionStore";
import type { Selection } from "../domain/selection/types";
import { useLayerStore } from "../features/layers/layerStore";
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../features/geoLayers/geoLayerStore";
import { refreshedGeoSelection } from "../features/geoLayers/geoSelectionRefresh";
import { installGeoJsonPreparation } from "../features/geoLayers/geoJsonPreparation";
import { resolveGeoLayerBounds } from "../features/geoLayers/geoLayerBounds";
import { installLayerTableLifecycle } from "../features/layers/layerTableLifecycle";
import {
  installEngineWatcher,
  installStaleWatcher,
  installTargetRemovalWatcher,
} from "../features/processing/runQueue";
import { installMapFilterSync } from "../features/query/mapFilterSync";
import { useLayerFileLoader } from "../features/layers/useLayerFileLoader";
import { ensureModelCrsLoadable } from "../features/layers/ensureCrs";
import {
  addCityLayer,
  modelTableSource,
  urlSourceProvider,
} from "../features/layers/addCityLayer";
import { addCityParquetLayerFromUrl } from "../features/cityparquet/addCityParquetLayer";
import { isCityParquetUrl } from "../features/cityparquet/sourceClassify";
import { useFileDropGuard } from "../features/layers/useFileDropGuard";
import { useEscapeClearsSelection } from "../features/selection/useEscapeClearsSelection";
import {
  useActiveCityLayer,
  useActiveLayer,
  resolveActiveLayer,
  unifiedLayerOrder,
  type ActiveLayer,
} from "../features/workspace/activeLayer";
import {
  activateLayer,
  installWorkspaceInvariants,
} from "../features/workspace/layerCoordination";
import { installRuleDraftInvariants } from "../features/rules/ruleDraftStore";
import { useWorkspaceStore } from "../features/workspace/workspaceStore";
import { useStreamStore } from "../features/streaming/streamStore";
import { useTotalObjectCount } from "../features/streaming/useTotalObjectCount";
import {
  closeAllStreamingLayers,
  openStreamingLayer,
} from "../features/streaming/openStreamingLayer";
import {
  getStreamPlugin,
  requireStreamPlugin,
  type StreamPlugin,
} from "../features/streaming/streamPlugin";
import { useSolarStore } from "../features/solar/solarStore";
import { useSceneSheetStore } from "../features/sceneSheet/sceneSheetStore";
import { DetailsPanel } from "../ui/details/DetailsPanel";
import { WorkspaceHeader } from "../ui/header/WorkspaceHeader";
import { exportScene } from "../features/export/browserSceneExport";
import { LeftPanel } from "../ui/sidebar/LeftPanel";
import { AddLayerDialog } from "../ui/layers/AddLayerDialog";
import { addGeoSourceFromFile } from "../features/geoLayers/addGeoSource";
import {
  detectSourceFromName,
  type DetectedSource,
} from "../features/layers/detectSource";
import type { AddUrlResult } from "../ui/stac/StacBrowser";
import { ShareDialog } from "../ui/ShareDialog";
import { StatusBar } from "../ui/StatusBar";
import { ViewerShell } from "../ui/shell/ViewerShell";
import { installShellListeners, useShellStore } from "../ui/shell/shellStore";
import { LeftRail } from "../ui/shell/LeftRail";
import { installThemeListener } from "../features/theme/themeStore";
import { LegendOverlay } from "../ui/viewport/LegendOverlay";
import { FilterChip } from "../ui/viewport/FilterChip";
import { HoverTooltip } from "../ui/viewport/HoverTooltip";
import { SceneButtons } from "../ui/viewport/SceneButtons";
import { SceneSettingsSheet } from "../ui/viewport/SceneSettingsSheet";
import { SunShadeSheet } from "../ui/viewport/SunShadeSheet";
import { SelectModeControl } from "../ui/viewport/SelectModeControl";
import { AddressSearch } from "../ui/viewport/AddressSearch";
import { ToolsButton } from "../ui/processing/ToolsButton";
import { ProcessingPanel } from "../ui/processing/ProcessingPanel";
import { useProcessingStore } from "../features/processing/processingStore";
import { CameraCluster } from "../ui/viewport/CameraCluster";
import { selectedGeoJsonBounds } from "../features/geoLayers/geoLayerBounds";
import { useGeoFeatureVisibilityStore } from "../features/geoLayers/geoFeatureVisibilityStore";
import type { FlyToTarget } from "../scene/geographicCamera";
import { DataDrawer } from "../ui/drawer/DataDrawer";
import type { Rule } from "../features/rules/types";

/**
 * The loader's encoding override, from what the Add Layer dialog detected.
 *
 * Only a CITY source has one: a geospatial layer never reaches this loading
 * path (the dialog and the landing page write it to `geoLayerStore`
 * themselves), and an unknown format is never added at all.
 */
function cityEncoding(
  detected: DetectedSource | undefined,
): CityModelEncoding | undefined {
  return detected?.kind === "city" ? detected.encoding : undefined;
}

const defaultStore = new LocalStorageProjectStateStore();
const SAMPLE_DATA_URL =
  "https://storage.googleapis.com/cityjson/delft.city.jsonl";

/**
 * How long work that needs the 3D engine — a queued `.fcb` open, a restored
 * camera — waits for the just-mounted viewport to publish its imperative
 * handle.
 *
 * A React commit takes microseconds, so reaching this means the viewer shell
 * never mounted at all. Bounded rather than open-ended because of the Shared
 * Interface Contract's resolve-or-reject rule: the caller gets an error it can
 * show in the load-error slot or a toast, never a promise that silently never
 * settles.
 */
export const ENGINE_BOOT_TIMEOUT_MS = 15_000;

/**
 * What the collapsed-details pill names. One object reads as its id, tail
 * first (a CityJSON id is a long common prefix and a short distinguishing
 * suffix); several read as a count; a picked geo feature has no city-object
 * identity to print.
 */
function selectionTitle(
  selections: ReadonlyArray<Selection>,
  hasGeoSelection: boolean,
): string {
  if (selections.length > 1) return `${selections.length} selected`;
  const one = selections[0];
  if (one !== undefined) {
    return one.objectId.length > 12
      ? `…${one.objectId.slice(-12)}`
      : one.objectId;
  }
  return hasGeoSelection ? "Feature" : "Selection";
}

/** How long an explanatory message stays up. Longer than a status toast: these
 *  are full sentences the user has to read, not a "saved" acknowledgement. */
const EXPLANATION_TOAST_MS = 8000;
const STATUS_TOAST_MS = 3000;

/** How a streaming layer's `.fcb` source was opened, for the save/restore
 *  round-trip (`LayerSnapshot.stream`, `normalizeLayers`' `unavailable`
 *  flag). Only meaningful for `l.isStreaming` layers — see handleSave. */
function streamSourceSnapshot(
  modelRef: CityModelReference,
): StreamSourceSnapshot {
  return modelRef.type === "url"
    ? { kind: "url", url: modelRef.url }
    : { kind: "file", fileName: modelRef.fileName };
}

/** An unavailable-locally-sourced layer restored from a snapshot: a
 *  file-backed layer (streaming or not) whose bytes cannot survive a
 *  reload — no Blob/File is ever persisted. Rendered as a persistent
 *  (not auto-dismissing) prompt, distinct from the transient `toast`, so
 *  the user can re-select the file rather than the layer silently vanishing. */
/** A snapshot's `appearance` field, or `undefined` for anything malformed. */
function readAppearanceTheme(raw: unknown): AppearanceTheme | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "object") return undefined;
  const { kind, name } = raw as { kind?: unknown; name?: unknown };
  return (kind === "texture" || kind === "material") && typeof name === "string"
    ? { kind, name }
    : undefined;
}

interface UnavailableLayer {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  /** The saved layer's settings, carried through so re-selecting a file
   *  restores them instead of silently reverting to defaults — see
   *  handleResolveUnavailableLayer. */
  readonly rules: ReadonlyArray<Rule>;
  readonly colorBy: ColorBy;
  readonly singleColor: string;
  readonly unmatchedColor: string;
  readonly visible: boolean;
  readonly lodMode: "auto" | "manual";
  readonly selectedLod: string | null;
  readonly selectedLods?: readonly string[];
  readonly hiddenTypes: readonly string[];
  readonly attributeOrders?: AttributeOrders;
  readonly tablePresentation?: TablePresentation;
  readonly appearance: AppearanceTheme | null | undefined;
}

interface AppProps {
  readonly persistenceStore?: ProjectStateStore;
  readonly platform?: PlatformServices;
}

export function App({
  persistenceStore = defaultStore,
  platform = browserPlatform,
}: AppProps) {
  const drawActive = useDrawStore((state) => state.active);
  const drawLayerId = useDrawStore((state) => state.layerId);
  const [pathname, setPathname] = useState(window.location.pathname);
  const savedIdRef = useRef<string | null>(null);
  const partialRestoreRef = useRef(false);
  const navigate = (path: string) => {
    window.history.pushState(null, "", path);
    setPathname(path);
  };
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const [savedSnapshots, setSavedSnapshots] = useState<SnapshotSummary[]>([]);
  const [unavailableLayers, setUnavailableLayers] = useState<
    ReadonlyArray<UnavailableLayer>
  >([]);
  const duckdbStatus = useDuckDBStatus();
  const [toast, setToast] = useState<string | null>(null);
  const [viewportAttribution, setViewportAttribution] = useState<
    readonly string[]
  >([]);
  const [addLayerOpen, setAddLayerOpen] = useState(false);
  const tourIndex = useWalkthroughStore((state) => state.index);
  const tourSeen = useWalkthroughStore((state) => state.seen);
  const tourPhase = useWalkthroughStore((state) => state.phase);
  const [restoringWorkspace, setRestoringWorkspace] = useState(false);
  /** The minted share link currently on display, or null. Non-null IS the
   *  dialog's open state: the URL is a snapshot of the view at the moment
   *  Share was clicked, so a new click mints a new one rather than reopening
   *  a stale link. Only reachable from the viewer shell (the toolbar). */
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [fps, setFps] = useState<number | undefined>(undefined);
  const [cursorPosition, setCursorPosition] = useState<
    readonly [number, number, number] | null
  >(null);
  const sceneRef = useRef<CitySceneHandle | null>(null);
  // Retain the viewpoint while a local-only workspace waits for its files.
  const pendingRestoredCameraRef = useRef<GeographicCamera | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  /**
   * A `.fcb` open is in flight and needs the 3D engine, so the viewer shell
   * (and with it `NavaraViewport`, and with that the FlatCityBuf plugin) must
   * be mounted even though no layer exists yet.
   *
   * Without this a `.fcb` could never be the FIRST layer: streaming has no
   * parse step that produces a model, so the layer only appears once the
   * plugin has opened the source — and the plugin only exists once a viewport
   * is mounted, which used to require a layer. The shell already tolerates
   * zero layers (every `activeLayer` read below is optional-chained), so the
   * user watches the globe come up and the buildings stream onto it.
   */
  const [engineBooting, setEngineBooting] = useState(false);
  /** How many `.fcb` opens are currently holding the shell open. A counter,
   *  not a boolean, so two concurrent opens (a restored workspace) cannot have
   *  the first one to finish unmount the engine under the second. */
  const bootHoldsRef = useRef(0);

  // A file dropped anywhere OTHER than a drop zone must do nothing — the
  // browser's default is to navigate to it, which would throw the whole
  // session away. See useFileDropGuard.
  useFileDropGuard();

  // Escape drops the selection. Installed at the top level rather than inside
  // the viewer branch — a hook cannot be conditional — which costs nothing on
  // the landing page, where there is no selection to clear. See the hook for
  // who else listens for Escape and in what order.
  useEscapeClearsSelection();

  /** The dismissal timer of the toast currently on screen, so a NEW message
   *  cannot be wiped by the OLD one's expiry — an 8 s explanation raised one
   *  second after a 3 s status toast used to vanish after two. */
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Show a transient message. One place, so every call site states its
   *  duration in the same terms — {@link STATUS_TOAST_MS} for an
   *  acknowledgement, {@link EXPLANATION_TOAST_MS} for a sentence that has to
   *  be read — and so each message really gets the time it asked for. */
  const showToast = useCallback((message: string, ms: number) => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, ms);
  }, []);

  // A toast raised just before an unmount must not tick on into a component
  // that is gone (the app is unmounted by tests, and by a host that swaps the
  // viewer out).
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // Layer store
  const layers = useLayerStore((s) => s.layers);
  /** The workspace's one active layer, when it is a city model. The shell's
   *  streaming readout and its save label are CITY facts, so a geo layer being
   *  active reads here as "none" rather than as some other layer's. */
  const activeCityLayer = useActiveCityLayer();
  const activeLayer = useActiveLayer();
  const activeCityLayerId = activeCityLayer?.id ?? null;
  /** The user's geospatial overlays. Read HERE, above the branch, because they
   *  are half of what a workspace is (Task 22, M12.2) — the selection panels
   *  below read the same store again for their own reasons. */
  const geoLayers = useGeoLayerStore((s) => s.layers);
  /**
   * Anything at all in the workspace, of EITHER kind.
   *
   * This used to be `layers.length > 0` — city models only — which made a
   * GeoJSON added from the landing page write a row into a store nobody could
   * see: the page stayed on the drop zone, and the overlay only appeared once
   * a city model was opened beside it. A workspace with geospatial content in
   * it is a workspace, and it belongs in the viewer.
   */
  const hasWorkspace = layers.length > 0 || geoLayers.length > 0;
  useEffect(() => {
    const viewport = viewportRef.current;
    const attribution = viewport?.querySelector(".attribution-overlay");
    if (viewport === null || !(attribution instanceof HTMLElement)) return;
    const update = () =>
      viewport.style.setProperty(
        "--attribution-height",
        `${attribution.offsetHeight}px`,
      );
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(attribution);
    return () => {
      observer.disconnect();
      viewport.style.removeProperty("--attribution-height");
    };
  }, [engineBooting, hasWorkspace]);

  /**
   * How many rows the workspace held when the fit effect below last ran, so it
   * can see the 0 → 1 edge rather than a level. Declared up here because
   * `handleRestore` marks it too — a restore's rows are not the first content
   * of a scene.
   */
  const previousWorkspaceSizeRef = useRef(0);

  /**
   * A retained empty viewer is still a new workspace. It must not retain
   * panels that describe the layer which was just removed, whether that was
   * through the header's "New workspace" action or the final row's menu.
   */
  useEffect(() => {
    if (hasWorkspace || engineBooting) return;
    useShellStore.getState().closeDrawer();
    useSceneSheetStore.getState().setSheet(null);
    useSelectionStore.getState().clear();
    activateLayer(null);
  }, [hasWorkspace, engineBooting]);

  // Active layer's streaming state, if any. Selected as individual
  // primitive fields (not the whole `StreamState` object) so this component
  // only re-renders on the fields it actually reads — see streamStore.ts's
  // doc comment on why a commit only ever touches `streams`, never
  // `layers`, and why consumers that DO need to react to one select
  // narrowly rather than subscribing to the whole entry.
  const activeStreamStatus = useStreamStore((s) =>
    activeCityLayerId ? s.streams[activeCityLayerId]?.status : undefined,
  );
  const activeStream = useStreamStore((s) =>
    activeCityLayerId ? s.streams[activeCityLayerId] : undefined,
  );
  const activeStreamMessage = useStreamStore((s) =>
    activeCityLayerId ? s.streams[activeCityLayerId]?.message : undefined,
  );

  /** Static layers' parsed objects PLUS streaming layers' resident features —
   *  a streaming layer's `model.objects` is an empty stub, so summing that
   *  alone reports 0 next to a viewport full of buildings (Task C14). */
  const totalObjects = useTotalObjectCount();

  /**
   * Resolved the moment `NavaraViewport` publishes its imperative handle.
   *
   * A ref cannot be awaited and React does not notify on one, so the callback
   * ref below hands the handle over through this gate: `setEngineBooting(true)`
   * only SCHEDULES the mount, and the `.fcb` open that asked for it is already
   * past its own `await` by the time React commits.
   */
  const sceneGateRef = useRef<{
    readonly promise: Promise<CitySceneHandle>;
    readonly resolve: (handle: CitySceneHandle) => void;
    /** Cancelled on unmount — see the cleanup effect below. */
    readonly cancel: () => void;
  } | null>(null);

  /** One shared gate per boot: concurrent `.fcb` opens — and the camera a
   *  restore or a share link is holding — all wait on the same handle.
   *  Bounded, and generic in its failure message, because the waiters no
   *  longer all have the same reason for waiting; each composes its own
   *  sentence around it. See {@link ENGINE_BOOT_TIMEOUT_MS}. */
  const awaitSceneHandle = useCallback((): Promise<CitySceneHandle> => {
    const existing = sceneGateRef.current;
    if (existing) return existing.promise;
    let settle!: (handle: CitySceneHandle) => void;
    let fail!: (error: unknown) => void;
    const promise = new Promise<CitySceneHandle>((res, rej) => {
      settle = res;
      fail = rej;
    });
    const timer = setTimeout(() => {
      sceneGateRef.current = null;
      fail(new Error("The 3D viewport did not start."));
    }, ENGINE_BOOT_TIMEOUT_MS);
    sceneGateRef.current = {
      promise,
      resolve: (handle) => {
        clearTimeout(timer);
        sceneGateRef.current = null;
        settle(handle);
      },
      cancel: () => {
        clearTimeout(timer);
        sceneGateRef.current = null;
        // Settled, not abandoned: an open still awaiting this must not hang.
        // `withEngineBooting`'s caller catches it into the load-error state,
        // and on unmount nobody is left to see it.
        fail(
          new Error(
            "The viewer was closed before the 3D viewport finished starting.",
          ),
        );
      },
    };
    return promise;
  }, []);

  // Unmount: cancel a pending boot gate, so its 15 s timer cannot outlive the
  // component and reject into a caller that is no longer on screen.
  useEffect(() => () => sceneGateRef.current?.cancel(), []);

  /** `NavaraViewport`'s ref — a CALLBACK ref, because publication is an event
   *  the pending `.fcb` opens above need to observe, not just a slot to read.
   *  Stable identity, so React never detaches/reattaches for it. */
  const attachScene = useCallback((handle: CitySceneHandle | null) => {
    sceneRef.current = handle;
    if (handle) sceneGateRef.current?.resolve(handle);
  }, []);

  /**
   * The live FlatCityBuf plugin for a `.fcb` open.
   *
   * Through the viewport's `getStreamingPlugin()` whenever there IS a viewport:
   * it awaits the engine's `ready` gate, so a stream requested while the engine
   * is still coming up — a restored workspace, a share hash — queues instead of
   * failing, and an engine that never came up rejects rather than hangs.
   *
   * With no viewport yet, a streaming open that went through
   * {@link withEngineBooting} is mounting one right now, so this waits for the
   * handle instead of failing. A caller that did NOT take a boot hold gets the
   * old `requireStreamPlugin()` error immediately, whose message names the real
   * cause — better than a 15 s wait for a viewport nobody asked for.
   *
   * Stable identity: everything it touches is a ref.
   */
  const resolveStreamPlugin = useCallback(async (): Promise<StreamPlugin> => {
    let scene = sceneRef.current;
    if (!scene && bootHoldsRef.current > 0) {
      try {
        scene = await awaitSceneHandle();
      } catch (error) {
        // The gate says only that the viewport never came up — it is shared
        // with the camera restore now, so it cannot know what the wait was
        // for. Name the cost here, where it is known.
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} The streaming layer could not be opened.`,
          { cause: error },
        );
      }
    }
    return scene ? await scene.getStreamingPlugin() : requireStreamPlugin();
  }, [awaitSceneHandle]);

  /**
   * Point the camera at a restored viewpoint, once there is a viewport that
   * can actually take it.
   *
   * Two waits, both load-bearing, and the replacement for the 100 ms
   * `setTimeout` this used to be:
   *
   *   1. the imperative HANDLE — a restore is triggered from the landing page
   *      and a share hash is read on mount, so in both flows `sceneRef` is
   *      still null when the camera is decided. Optional-chaining past it
   *      (`sceneRef.current?.ready`) would `await undefined`, which resolves
   *      immediately and skips the restore in silence.
   *   2. the engine's own `ready` — `setCameraState` on a view that has not
   *      finished `init()` does nothing.
   *
   * Both can fail (a viewport that never mounts, an engine that never starts),
   * and both failures REJECT rather than hang, so the caller can say so. The
   * caller must therefore only call this when a viewport is genuinely
   * expected: a workspace whose layers are all file-backed mounts nothing, and
   * waiting 15 s to announce that would be noise, not news.
   */
  const applyCameraWhenReady = useCallback(
    async (camera: GeographicCamera): Promise<void> => {
      const scene = sceneRef.current ?? (await awaitSceneHandle());
      await scene.ready;
      // No suppression needed around this: `setCameraState` is already
      // bracketed by the streaming plugin's settle suppression inside the
      // viewport, and the engine's `setCamera` emits no camera events of its
      // own (Task C7), so a restored camera cannot masquerade as a gesture.
      scene.setCameraState(camera);
    },
    [awaitSceneHandle],
  );

  /**
   * The scene handle, once ITS engine has come up — or `null` if none did.
   *
   * Not simply `await scene.ready`, and this is the whole of Task 22's live
   * defect. `NavaraViewport`'s lifecycle cleanup SETTLES the ready gate its
   * mount owned — rejecting it, since the engine had not finished starting —
   * and re-arms a fresh one for the mount that follows. StrictMode does
   * exactly that to every newly mounted viewport, immediately. An effect that
   * runs in the very commit that mounts the viewport therefore reads the
   * handle, awaits the gate that is a moment away from being thrown out, and
   * watches its work disappear into a catch: in the browser the viewer came up
   * with the geo row active and the camera never moved.
   *
   * So a rejected gate is read for what it means — "that mount is gone" — and
   * the wait is made again against whichever viewport is mounted NOW, whose
   * `ready` getter answers with the live gate. Bounded at one retry: an engine
   * that genuinely cannot start rejects both times and gives up quietly,
   * rather than spinning against a viewport that will never be ready.
   */
  const awaitSceneReady =
    useCallback(async (): Promise<CitySceneHandle | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const scene = sceneRef.current ?? (await awaitSceneHandle());
        try {
          await scene.ready;
          return scene;
        } catch {
          // No viewport left at all: nothing to wait for a second time.
          if (sceneRef.current === null) return null;
        }
      }
      return null;
    }, [awaitSceneHandle]);

  /**
   * Run an open with the 3D engine held up: the boot hold itself, for a
   * source that is KNOWN to stream. {@link withEngineBooting} takes it for a
   * `.fcb`; a CityParquet source only learns it streams once it has been
   * sized, so the loader takes it at that point (`holdEngine` in
   * `addCityParquetLayer.ts`).
   */
  const holdEngine = useCallback(
    async <T,>(open: () => Promise<T>): Promise<T> => {
      bootHoldsRef.current += 1;
      setEngineBooting(true);
      try {
        return await open();
      } finally {
        bootHoldsRef.current -= 1;
        if (bootHoldsRef.current === 0) setEngineBooting(false);
      }
    },
    [],
  );

  /**
   * Run a layer open with the 3D engine mounted, when the source needs it.
   *
   * `.fcb` only: a stream's layer cannot exist before the engine does, and
   * `.fcb` is the one format that ALWAYS streams. A CityParquet source streams
   * only when large, which is known only after sizing, so it takes
   * {@link holdEngine} itself at that point (`addCityParquetLayer.ts`). Every
   * other encoding parses to a `CityModel` first and mounts the viewport as a
   * consequence, so booting for those would put a globe behind the landing
   * page for no reason.
   *
   * The hold is released in `finally`, which is what returns the user to the
   * landing page when the open FAILS (a 404, a refused CRS) rather than
   * stranding them on an empty globe with no drop zone. On success the new
   * layer keeps the shell mounted on its own.
   */
  const withEngineBooting = useCallback(
    async <T,>(
      source: string,
      open: () => Promise<T>,
      encoding?: CityModelEncoding,
    ): Promise<T> => {
      // The OVERRIDE first, when the caller has one: the Add Layer dialog lets
      // a user correct a `.json` that is really FlatCityBuf, and a boot gate
      // that re-derived the format from the name would leave that add waiting
      // for an engine nobody started.
      if ((encoding ?? detectEncoding(source)) !== "flatcitybuf") {
        return await open();
      }
      return await holdEngine(open);
    },
    [holdEngine],
  );

  // File loading
  const {
    addLayerFromFile,
    addLayerFromFiles,
    addLayerFromUrl,
    loading,
    error: loadError,
    lastError,
    clearError,
    pending,
    failed,
    dismissFailed,
  } = useLayerFileLoader({ resolveStreamPlugin, holdEngine });

  /*
   * A failed load has ONE surface, and since 12.2 it is a ROW.
   *
   * `useLayerFileLoader` books every add: a failure leaves a `failed` entry
   * carrying its own sentence and its own retry, and `LeftPanel` renders it
   * as an error row in the layer list, exactly where the layer would have
   * appeared. That is why there is no toast here any more — this used to
   * raise one inside the viewer, because the Add Layer dialog closed on the
   * way out and took the only other surface with it. Two reports of one
   * failure is its own bug, and the row is the better of the two: it names
   * the source, it does not time out, and it can be retried.
   *
   * The landing page has no list to put a row in, so `loadError` is still
   * rendered inline there as `.error-message` — its one report on that side.
   */

  const selections = useSelectionStore((s) => s.selections);
  const mode = useSelectionStore((s) => s.mode);
  const toolMode = useSelectionStore((s) => s.toolMode);
  const setMode = useSelectionStore((s) => s.setMode);
  const setToolMode = useSelectionStore((s) => s.setToolMode);
  const clearSelection = useSelectionStore((s) => s.clear);
  const geoSelection = useSelectionStore((s) => s.geoSelection);
  const selectGeoFeature = useSelectionStore((s) => s.selectGeoFeature);
  /** Spec §4.2: with the toolbox open the right panel is the toolbox, and the
   *  details become one of its tabs rather than the whole panel. */
  const toolboxOpen = useProcessingStore((s) => s.open);

  // The shell's layout state (what `inspectorOpen`, `leftSidebarCollapsed`,
  // `leftSidebarWidth`, `tableOpen` and `tableHeight` used to be). `App` reads
  // only the two facts its own render forks on: which component the left
  // column gets and whether the drawer is mounted. The details panel's own
  // collapse (`rightCollapsed`) is read and written entirely by `ViewerShell`
  // and `WorkspaceHeader` — closing the panel itself clears the selection
  // instead (see the `right` prop's comment below). The SIZES belong to
  // `ViewerShell` and to the panels that own their own edges — `LeftPanel`
  // writes `leftWidth` itself, which is why there is no `onWidthChange` to
  // thread through any more.
  const leftCollapsed = useShellStore((s) => s.leftCollapsed);
  const drawerOpen = useShellStore((s) => s.drawerOpen);

  // The two effects that used to steer the geo store's own active id from the
  // selection are gone: `installWorkspaceInvariants` holds that rule now (a
  // pick activates the layer it landed on, whichever kind it is), for every
  // way a selection can be made rather than only the ones this shell saw.

  /** The `config` the selected geo layer had when the feature was picked.
   *  Captured rather than derived because the comparison below has to be
   *  against the state at SELECTION time, not the current one. */
  const geoSelectionConfigRef = useRef<unknown>(null);
  useEffect(() => {
    geoSelectionConfigRef.current =
      geoSelection === null
        ? null
        : (useGeoLayerStore
            .getState()
            .layers.find((l) => l.id === geoSelection.geoLayerId)?.config ??
          null);
  }, [geoSelection]);

  /**
   * Drop a geo selection whose subject can no longer be trusted — and REFRESH
   * one whose properties have merely changed.
   *
   * The layer being REMOVED, or its document replaced, still drops it:
   * `geoLayerSync` rebuilds the engine pair on config identity and batch ids
   * are minted globally, so the retained `batchId` would name a different
   * feature entirely. But §7.6's run replaces the config over the SAME
   * document, and §8 says the picked feature then shows its computed values —
   * so the rule is `refreshedGeoSelection`'s, not this effect's.
   */
  useEffect(() => {
    if (geoSelection === null) return;
    const layer = geoLayers.find((l) => l.id === geoSelection.geoLayerId);
    const next = refreshedGeoSelection({
      selection: geoSelection,
      layer,
      previousConfig: geoSelectionConfigRef.current,
    });
    if (next === null) {
      selectGeoFeature(null);
      return;
    }
    if (next === geoSelection) return;
    // A run's results (or its Undo) landed on the picked feature: same feature,
    // new properties, and the ref moves with it so this does not re-fire.
    geoSelectionConfigRef.current = layer?.config ?? null;
    selectGeoFeature(next);
  }, [geoLayers, geoSelection, selectGeoFeature]);

  const geoVisibleIds = useGeoFeatureVisibilityStore((s) => s.visible);
  useEffect(() => {
    if (geoSelection?.stableFeatureId === undefined) return;
    const allowed = geoVisibleIds[geoSelection.geoLayerId];
    if (
      allowed !== null &&
      allowed !== undefined &&
      !allowed.has(geoSelection.stableFeatureId)
    ) {
      selectGeoFeature(null);
      showToast(
        "Selected vector feature is excluded by the filter.",
        EXPLANATION_TOAST_MS,
      );
    }
  }, [geoSelection, geoVisibleIds, selectGeoFeature, showToast]);

  const refreshSnapshots = useCallback(async () => {
    const list = await persistenceStore.list();
    setSavedSnapshots(list);
  }, [persistenceStore]);

  useEffect(() => {
    void refreshSnapshots();
  }, [refreshSnapshots]);

  /**
   * The workspace's coordination rules, installed ONCE.
   *
   * Declared above every effect that can populate a store — the share-hash
   * read, the DuckDB boot's table lifecycle — because effects run in body
   * order: a first layer that landed before this ran would never be activated,
   * and a restored selection would have nothing holding it to its layer.
   */
  useEffect(() => installWorkspaceInvariants(), []);

  /**
   * Drops a layer's unsaved rule-editor draft the moment that layer leaves
   * `useLayerStore` — same installed-once shape as the invariants above.
   * Without it a removed layer's draft would sit in `useRuleDraftStore`
   * forever: unreachable (its `layerId` never renders again), but never
   * freed. See `features/rules/ruleDraftStore.ts`.
   */
  useEffect(() => installRuleDraftInvariants(), []);

  /**
   * Spec §6.1: removing a layer while a run of its own is queued or executing
   * fails that run with "Layer removed" instead of letting it compute against
   * — and write onto — a layer the user has thrown away. Same installed-once
   * shape as the invariants above.
   */
  useEffect(() => installTargetRemovalWatcher(), []);
  /** Spec §6.1: a DuckDB worker that dies fails every run that was counting on
   *  it, and takes every Undo with it. Same single-live-installer shape. */
  useEffect(() => installEngineWatcher(), []);
  useEffect(() => installGeoJsonPreparation(), []);

  useEffect(
    () =>
      installMapFilterSync((count) =>
        showToast(
          `${count} selected ${count === 1 ? "building was" : "buildings were"} excluded by the filter`,
          EXPLANATION_TOAST_MS,
        ),
      ),
    [showToast],
  );

  /**
   * Spec §6.2: a finished run's first line is repeated as a toast, so the
   * acknowledgement reaches a user who has already moved on from the tool
   * form (or closed the toolbox).
   *
   * It keys off `noticeSeq`, not `notice`: two identical runs push the same
   * text, and a plain equality check would silently swallow the second.
   * `subscribe` returns its own unsubscribe, which is the cleanup.
   */
  useEffect(
    () =>
      useProcessingStore.subscribe((s, prev) => {
        if (s.noticeSeq !== prev.noticeSeq && s.notice !== null)
          showToast(s.notice, STATUS_TOAST_MS);
      }),
    [showToast],
  );

  /**
   * The interface appearance, installed ONCE — the same shape as the
   * invariants above, and for the same reason: it is a subscription to
   * something outside React (the OS's colour-scheme query), not per-render
   * state.
   *
   * It stamps `<html data-theme>` immediately and re-stamps whenever the OS
   * flips while the preference is "System". Nothing else may write that
   * attribute.
   */
  useEffect(() => installThemeListener(), []);

  /**
   * Keeps the drawer height and the two side panels inside their own
   * bounds across a window resize — a maximize/restore, a monitor change,
   * DevTools opening — the same shape as the two installs above: a
   * subscription to something outside React, installed once.
   */
  useEffect(() => installShellListeners(), []);

  // Initialize DuckDB-wasm on mount, and subscribe the layer-table registry to
  // the stores. One install, torn down with the app: the subscriptions are
  // module-level machinery, not per-render state.
  useEffect(() => {
    // `retryEngine`, not `initDuckDB`: it awaits the same (memoised) boot and
    // then rebuilds any table that was refused while the engine was still
    // coming up. A layer added during the boot — a restored snapshot, a share
    // link, a quick drop — must not need the user to notice and re-add it.
    //
    // Nothing sets the status here any more: `doInit` publishes `initializing`
    // synchronously on the first call and `ready`/`failed` when it lands, and
    // `useDuckDBStatus` renders each of them. The old optimistic
    // `setDuckdbStatus({ state: "initializing" })` was also WRONG on the Retry
    // path — `initDuckDB` does not re-run a boot that already succeeded, so a
    // Retry aimed at a failed TABLE made a healthy engine read "Loading".
    void retryEngine();
    const stopLifecycle = installLayerTableLifecycle();
    // A rebuilt table has none of a run's computed columns, so the processing
    // panel's result cards have to hear about it (spec §7). Installed next to
    // the lifecycle because it watches the same store.
    const stopStaleWatcher = installStaleWatcher();
    return () => {
      stopLifecycle();
      stopStaleWatcher();
    };
  }, []);

  /**
   * Retry a failed DuckDB init.
   *
   * `retryEngine` awaits `initDuckDB` — which clears its memo on failure, so
   * this really re-runs rather than handing back the rejected-once promise —
   * and then REBUILDS every table that failed only because the engine was not
   * running. A Retry that fixed the status but left every table still reading
   * "The analytics engine is not running" would look like it had done nothing.
   */
  const handleRetryDuckDB = useCallback(() => {
    void retryEngine();
  }, []);

  const handleFile = useCallback(
    async (file: File, override?: DetectedSource) => {
      clearError();
      const encoding = cityEncoding(override);
      await withEngineBooting(
        file.name,
        () => addLayerFromFile(file, encoding ? { encoding } : undefined),
        encoding,
      );
    },
    [addLayerFromFile, clearError, withEngineBooting],
  );

  /**
   * Several picked files as ONE layer — a CityParquet package folder.
   *
   * No `withEngineBooting` hold here: a group is never `.fcb`, and a folder
   * large enough to STREAM takes {@link holdEngine} inside the loader, once
   * it has been sized (`addCityParquetLayer.ts`). Errors land in `loadError`,
   * exactly as for {@link handleFile}.
   */
  const handleFiles = useCallback(
    async (files: File[], override?: DetectedSource) => {
      clearError();
      const encoding = cityEncoding(override);
      await addLayerFromFiles(files, encoding ? { encoding } : undefined);
    },
    [addLayerFromFiles, clearError],
  );

  /**
   * Load a URL, and say whether a layer LANDED.
   *
   * `addLayerFromUrl` reports a failure by resolving `null` (the message goes
   * to `loadError`), so the boolean costs nothing to produce — and the STAC
   * browser cannot be honest without it: it is mounted inside the viewer's Add
   * Layer dialog, where `loadError` is rendered nowhere at all.
   */
  const handleUrl = useCallback(
    async (url: string, override?: DetectedSource): Promise<boolean> => {
      clearError();
      const encoding = cityEncoding(override);
      const layerId = await withEngineBooting(
        url,
        () => addLayerFromUrl(url, encoding ? { encoding } : undefined),
        encoding,
      );
      return layerId !== null;
    },
    [addLayerFromUrl, clearError, withEngineBooting],
  );

  /**
   * Save, answering whether a snapshot was really written.
   *
   * The boolean is not for the caller's convenience: the header's
   * "Saved · just now" note hangs off it, and a note shown on a click that
   * hit the transiently-null camera (or a store that refused) would be a
   * confirmation of something that did not happen.
   */
  const handleSave = useCallback(async (): Promise<boolean> => {
    const cameraState = sceneRef.current?.getCameraState();
    // Null is a REAL state, not a defensive check: the engine's
    // `positionGeographic` throws until its first rendered frame (Task B11a),
    // so saving in the moment after a restore — or right after opening a file
    // — can find no camera to save. Say so instead of writing a snapshot with
    // a made-up viewpoint, and instead of the button doing nothing at all.
    if (!cameraState) {
      showToast(
        "The 3D view is still starting — try saving again in a moment.",
        STATUS_TOAST_MS,
      );
      return false;
    }

    const { datetime, timeZone } = useSolarStore.getState();
    const { layers: allLayers } = useLayerStore.getState();
    const { mode: pickMode } = useSelectionStore.getState();
    const { mode: viewMode } = useViewModeStore.getState();
    const { theme: sceneTheme } = useSceneThemeStore.getState();

    const allGeoLayers = useGeoLayerStore.getState().layers;
    // The WORKSPACE names its own snapshot — it has a name, the user can
    // edit it in the header, and the list of saved workspaces is the one
    // place that name is read back. It used to be the active layer's name,
    // which meant two workspaces built on the same file were indistinguishable
    // in that list and renaming the workspace changed nothing about it.
    const label = useWorkspaceStore.getState().name;
    // §8: a derived layer is omitted from the snapshot ENTIRELY, and the
    // active-layer reference is a per-kind INDEX into the arrays written
    // beside it (see `ProjectSnapshot.activeLayer`) — so the filter and the
    // index are one decision, made in one pure place. `undefined` — nothing
    // active, an id that resolves to neither list, or an active layer that is
    // itself derived — omits the field, and a restore then falls back to the
    // first layer.
    const selection = snapshotLayers({
      layers: allLayers,
      geoLayers: allGeoLayers,
      activeLayerId: useWorkspaceStore.getState().activeLayerId,
    });
    const activeLayerRef = selection.activeLayer;

    const snapshot = captureSnapshot({
      basemap: captureBasemap(),
      label,
      layers: selection.layers.map((l) => ({
        name: l.name,
        modelRef: l.modelRef,
        rules: [...l.rules],
        // The mode and its two colours, with `rulesEnabled` derived from the
        // mode — one place decides what a layer's colouring looks like on disk.
        ...captureColorBy(l),
        visible: l.visible,
        selectedLod: l.selectedLod,
        selectedLods: l.selectedLods,
        lodMode: l.lodMode,
        hiddenTypes: [...l.hiddenTypes],
        attributeOrders: l.attributeOrders,
        tablePresentation: captureTablePresentation(
          useQueryStore.getState().queries[getActiveTableKey(l.id)],
        ),
        appearance: l.selectedAppearance,
        ...(l.isStreaming ? { stream: streamSourceSnapshot(l.modelRef) } : {}),
      })),
      // Stripped of anything that cannot survive a reload — an inline GeoJSON
      // document above all; see `geoLayerSnapshot`.
      geoLayers: selection.geoLayers.map(geoLayerSnapshot),
      camera: cameraState,
      datetime,
      timeZone,
      pickMode,
      viewMode,
      sceneTheme,
      activeLayer: activeLayerRef,
    });

    try {
      savedIdRef.current = await saveWorkspace(
        persistenceStore,
        savedIdRef.current,
        snapshot,
      );
      await refreshSnapshots();
      // Success used to be silent, which is indistinguishable from a button
      // that does nothing. The message also has a fact to teach — saved
      // workspaces are listed on the landing page on the next visit, and
      // nobody discovers that by guessing — so it gets the explanatory
      // duration, not the 3 s status one.
      // §8's extra sentence, appended rather than replacing: the save DID
      // happen, and the note is about what it could not carry.
      const note = derivedNotSavedNote(selection.derivedCount);
      const saved = partialRestoreRef.current
        ? "Loaded layers saved as a new workspace. The original save still contains the layers that could not be restored."
        : "Workspace saved — you'll find it here next time you open Roofy.";
      showToast(
        note === null ? saved : `${saved} ${note}`,
        EXPLANATION_TOAST_MS,
      );
      partialRestoreRef.current = false;
      return true;
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Failed to save workspace.",
        STATUS_TOAST_MS,
      );
      return false;
    }
  }, [persistenceStore, refreshSnapshots, showToast]);

  const handleRestore = useCallback(
    async (id: string) => {
      useDrawStore.getState().finish();
      pendingRestoredCameraRef.current = null;
      setRestoringWorkspace(true);
      setAddLayerOpen(false);
      clearError();
      // A restore adds layers and then applies the camera it saved. The
      // viewport fits to any newly added layer, so without this the fit and
      // the restored camera race, and whenever the fit lands second the saved
      // viewpoint is silently thrown away (Task C26).
      const releaseAutoFit = suppressAutoFit();
      try {
        const snapshot = await persistenceStore.load(id);
        if (!snapshot) {
          showToast("Snapshot not found.", STATUS_TOAST_MS);
          return;
        }

        const { viewState, activeLayer: savedActiveLayer } =
          restoreSnapshot(snapshot);
        pendingRestoredCameraRef.current = viewState.camera;
        // BEFORE the layers and the camera. Entering a mode flies the camera,
        // and the viewport suppresses that flight for a mode that is already
        // set when it mounts — which is exactly this case. Setting it after
        // the restored camera had landed would fly away from it instead.
        useViewModeStore.getState().setViewMode(viewState.viewMode ?? "3d");
        // The theme moves no camera, so it has no ordering constraint of its
        // own — it rides with the mode so both are in place before the layers
        // arrive and come up already themed.
        useSceneThemeStore
          .getState()
          .setSceneTheme(viewState.sceneTheme ?? "photoreal");
        // The snapshot's label IS the workspace's name — that is what it was
        // saved as — so restoring one restores the name the header shows.
        useWorkspaceStore.getState().setName(snapshot.label);
        savedIdRef.current = null;
        partialRestoreRef.current = true;

        // Remove all existing layers — the streaming ones first, so their
        // workers and cell meshes die with them rather than outliving the
        // layer entry that was the only way to reach them.
        closeAllStreamingLayers(getStreamPlugin());
        useLayerStore.getState().removeAllLayers();
        setUnavailableLayers([]);

        // The geospatial layers, which need no engine and no parsing: the
        // viewport's own effect adds a source+layer pair for each one as soon
        // as it is up. A GeoJSON layer that was loaded from a file comes back
        // with an empty config — `normalizeGeoLayers` keeps the row precisely
        // so its name, visibility and opacity are not lost — and the panel
        // offers to re-link it, exactly as the city-model prompt below does.
        useGeoLayerStore.getState().removeAllGeoLayers();
        // Index-ALIGNED with `snapshot.geoLayers`, `null` where a row could
        // not be used: the saved `activeLayer.index` points into the SNAPSHOT,
        // so a dropped row must leave a hole rather than shift its successors.
        // That is also why the entries are normalised ONE at a time —
        // `normalizeGeoLayers` drops what it cannot use, and a batch call
        // would compact the very positions this array exists to preserve.
        const addedGeoIds: (string | null)[] = [];
        for (const raw of snapshot.geoLayers ?? []) {
          const [input] = normalizeGeoLayers([raw]);
          addedGeoIds.push(
            input === undefined
              ? null
              : useGeoLayerStore.getState().addGeoLayer(input),
          );
        }
        const hasGeoLayer = addedGeoIds.some(Boolean);
        // The first-content fit is keyed on the workspace going from empty to
        // one row, and a restore's rows are not "the first content of a scene"
        // — they are a scene the user already framed and saved. The
        // suppression scope below says so too, but it is released in a
        // `finally` that can, for a workspace that awaits nothing, run before
        // React has flushed the effect that reads it. Moving the mark here
        // makes the answer independent of that ordering.
        previousWorkspaceSizeRef.current =
          useLayerStore.getState().layers.length +
          useGeoLayerStore.getState().layers.length;

        // Restore layers from snapshot. A v1 single-model save (`modelRef`
        // at the top level, no `layers`) is not handled here: it is a v1
        // snapshot, and `restoreSnapshot` above already rejected it.
        const snapshotLayers = snapshot.layers ?? [];

        // Defaults the optional per-layer fields and flags a file-backed
        // streaming layer as needing re-selection — see normalizeLayers'
        // own doc comment. Cast at the boundary: `snapshotLayers` is
        // genuinely well-typed (`LayerSnapshot[]`), but `normalizeLayers`
        // accepts a deliberately LOOSE shape so it also copes with a saved
        // document missing optional fields — the same reason its own test
        // file casts its fixtures `as never`.
        const normalized = normalizeLayers({
          layers: snapshotLayers as unknown as RawLayerSnapshot[],
        });

        // Each layer gets its OWN try/catch: one .fcb layer failing
        // admission (checkAdmission — no-extent, non-metric-crs, ...) must
        // not abort every layer listed after it in the same workspace. The
        // share-restore effect below already does this per-item; this loop
        // previously did not, and streaming's admission checks make a
        // single-layer failure meaningfully more likely than before.
        let hasUrlLayer = false;
        let failedCount = 0;
        const newUnavailable: UnavailableLayer[] = [];
        /** The city half of the same aligned mapping as `addedGeoIds`: one
         *  entry per SNAPSHOT layer, `null` for an unavailable placeholder or
         *  a load that failed. The `finally` below is what guarantees the one
         *  entry per iteration, whichever way the body leaves. */
        const addedCityIds: (string | null)[] = [];
        for (const sl of normalized) {
          let addedId: string | null = null;
          try {
            const name = (sl.name as string | undefined) ?? "Untitled layer";
            const modelRef = sl.modelRef as CityModelReference | undefined;
            if (!modelRef) continue; // malformed saved entry — nothing to restore

            const rules = (sl.rules as Rule[] | undefined) ?? [];
            // Already validated and derived by `normalizeLayers`.
            const { colorBy, singleColor, unmatchedColor } = sl;
            const visible = (sl.visible as boolean | undefined) ?? true;
            const lodMode =
              (sl.lodMode as "auto" | "manual" | undefined) ?? "auto";
            const selectedLod = (sl.selectedLod as string | null) ?? null;
            // Already defaulted to [] by `normalizeLayers`.
            const hiddenTypes = sl.hiddenTypes;
            const tablePresentation = sl.tablePresentation;
            const attributeOrders = normalizeAttributeOrders(
              sl.attributeOrders,
            );
            // `undefined` (older snapshot) lets the load default decide.
            const appearance = readAppearanceTheme(sl.appearance);

            if (modelRef.type === "file" || sl.unavailable) {
              const fileName =
                modelRef.type === "file" ? modelRef.fileName : name;
              newUnavailable.push({
                id: crypto.randomUUID(),
                name,
                fileName,
                rules,
                colorBy,
                singleColor,
                unmatchedColor,
                visible,
                lodMode,
                selectedLod,
                selectedLods: sl.selectedLods,
                hiddenTypes,
                attributeOrders,
                tablePresentation,
                appearance,
              });
              continue;
            }

            hasUrlLayer = true;

            let layerId: string;
            if (detectEncoding(modelRef.url) === "flatcitybuf") {
              layerId = await withEngineBooting(modelRef.url, async () =>
                openStreamingLayer({
                  plugin: await resolveStreamPlugin(),
                  source: { url: modelRef.url },
                  name,
                  modelRef,
                  rules,
                  colorBy,
                  singleColor,
                  unmatchedColor,
                  visible,
                  hiddenTypes,
                  attributeOrders,
                  tablePresentation,
                  selectedAppearance: appearance,
                }),
              );
            } else if (isCityParquetUrl(modelRef.url)) {
              // Mirrors `useLayerFileLoader.addLayerFromUrl` — and by
              // `isCityParquetUrl`, not `detectEncoding`, because a saved
              // `gs://` bucket or package directory has no extension. Any
              // throw (including the unlistable-wildcard explanation) is
              // caught by this loop's per-layer `catch` and counted. The
              // static/stream decision re-runs: a large source streams.
              layerId = await addCityParquetLayerFromUrl(
                modelRef.url,
                {
                  name,
                  visible,
                  rules,
                  colorBy,
                  singleColor,
                  unmatchedColor,
                  hiddenTypes,
                  attributeOrders,
                  tablePresentation,
                  selectedAppearance: appearance,
                },
                { resolveStreamPlugin, holdEngine },
              );
            } else {
              const parsed = await loadFromUrl(modelRef.url);
              await ensureModelCrsLoadable(parsed.model);
              layerId = addCityLayer({
                name,
                model: parsed.model,
                modelRef,
                visible,
                rules,
                colorBy,
                singleColor,
                unmatchedColor,
                hiddenTypes,
                attributeOrders,
                tablePresentation,
                selectedAppearance: appearance,
                duckdb: modelTableSource({
                  model: parsed.model,
                  bytes: parsed.bytes,
                  encoding: parsed.encoding,
                  refetch: urlSourceProvider(modelRef.url),
                }),
              });
            }
            if (sl.selectedLods !== undefined) {
              useLayerStore.getState().setLayerLods(layerId, sl.selectedLods);
            } else if (selectedLod !== null) {
              useLayerStore.getState().setLayerLod(layerId, selectedLod);
            }
            if (lodMode === "manual") {
              useLayerStore.getState().setLodMode(layerId, "manual");
            }
            addedId = layerId;
          } catch {
            // Skip this one layer; keep restoring the rest of the workspace.
            failedCount++;
          } finally {
            addedCityIds.push(addedId);
          }
        }
        const complete =
          addedCityIds.length === snapshotLayers.length &&
          addedCityIds.every(Boolean) &&
          addedGeoIds.every(Boolean);
        savedIdRef.current = complete ? id : null;
        partialRestoreRef.current = !complete;
        setUnavailableLayers(newUnavailable);

        // The layer the workspace comes up looking at, and the reason this is
        // explicit rather than left to the invariants: the geo layers went in
        // BEFORE the city loop, so `installWorkspaceInvariants` has already
        // handed the active id to the first geo layer. Resolve the saved
        // per-kind index against the aligned arrays; a slot that is `null`
        // (nothing landed there) or an absent field — a v3 document, or a
        // workspace saved with nothing active — falls back to the first layer
        // that DID land, in unified order (city first, then geo).
        const savedId =
          savedActiveLayer === undefined
            ? null
            : ((savedActiveLayer.kind === "city" ? addedCityIds : addedGeoIds)[
                savedActiveLayer.index
              ] ?? null);
        activateLayer(
          savedId ??
            [...addedCityIds, ...addedGeoIds].find((id) => id !== null) ??
            null,
        );

        // "Drop file(s)" is the prompt for a workspace that restored its rows
        // but has nothing on screen — every city layer file-backed, so the
        // viewer is empty until the user re-links one. A geospatial layer that
        // came back complete IS on screen (`hasGeoLayer`), so asking for a
        // file would be asking for something nothing is waiting on.
        if (
          !hasUrlLayer &&
          !hasGeoLayer &&
          newUnavailable.length === 0 &&
          failedCount === 0
        ) {
          showToast(
            "Workspace restored. Drop file(s) to view the model.",
            STATUS_TOAST_MS,
          );
        } else if (newUnavailable.length > 0 || failedCount > 0) {
          const parts = [
            hasUrlLayer ? "Workspace restored." : null,
            newUnavailable.length > 0
              ? "Some layers need a local file re-selected below."
              : null,
            failedCount > 0
              ? `${failedCount} layer${failedCount === 1 ? "" : "s"} failed to restore.`
              : null,
          ].filter(Boolean);
          showToast(parts.join(" "), STATUS_TOAST_MS);
        }

        // The camera, once there is something to point. A restore runs from
        // the LANDING page, so the viewport does not exist yet and this waits
        // for it — but only when a layer actually landed: a workspace of
        // nothing but unavailable local files mounts no viewport at all, and
        // there is no camera to restore into an empty drop zone.
        //
        // EITHER kind of layer counts (Task 22, M12.2). A geo-only workspace
        // mounts a viewport now, so it has somewhere to put its saved camera —
        // and this await is also what holds the auto-fit suppression open
        // across the render that mounts that viewport, so the first-content fit
        // above sees a suppressed scope and drops its flight rather than
        // replacing the viewpoint the user saved.
        if (
          useLayerStore.getState().layers.length > 0 ||
          useGeoLayerStore.getState().layers.length > 0
        ) {
          try {
            await applyCameraWhenReady(viewState.camera);
            pendingRestoredCameraRef.current = null;
          } catch (e) {
            showToast(
              `Workspace restored, but the 3D view could not start: ${
                e instanceof Error ? e.message : String(e)
              }`,
              EXPLANATION_TOAST_MS,
            );
          }
        }
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : "Failed to restore workspace.",
          // The unsupported-version message is a full sentence explaining that
          // the workspace must be re-saved; 3 s is not long enough to read it.
          e instanceof UnsupportedSnapshotVersionError
            ? EXPLANATION_TOAST_MS
            : STATUS_TOAST_MS,
        );
      } finally {
        setRestoringWorkspace(false);
        releaseAutoFit();
      }
    },
    [
      persistenceStore,
      clearError,
      resolveStreamPlugin,
      holdEngine,
      withEngineBooting,
      applyCameraWhenReady,
      showToast,
    ],
  );

  /** The dialog's clipboard seam. Wrapped in a stable callback rather than
   *  passed as `platform.clipboard.writeText` directly, so the dialog's
   *  auto-copy effect cannot re-fire on an unrelated re-render — and so the
   *  method keeps its `this`. */
  const copyShareText = useCallback(
    (text: string) => platform.clipboard.writeText(text),
    [platform],
  );

  const handleShare = useCallback(() => {
    const cameraState = sceneRef.current?.getCameraState();
    // See handleSave: no camera yet is a real, transient state (Task B11a),
    // and a link with no viewpoint in it is not worth minting silently.
    if (!cameraState) {
      showToast(
        "The 3D view is still starting — try sharing again in a moment.",
        STATUS_TOAST_MS,
      );
      return;
    }

    const { datetime, timeZone } = useSolarStore.getState();
    const { layers: allLayers } = useLayerStore.getState();
    const { mode: pickMode } = useSelectionStore.getState();

    const state: ShareableViewState = {
      basemap: captureBasemap(),
      v: 3,
      // §8's exclusion reaches the SHARE link through the same decision the
      // save uses. The URL filter below does NOT stand in for it: a derived
      // city layer inherits its parent's `modelRef`, so it passes that filter
      // and the link would restore the whole parent under the copy's name
      // (the two filters commute; this one just has to be here). A share hash
      // carries no active reference and no geo layers (`ShareableViewState`
      // is a lightweight subset and stays one), so only `layers` is read.
      layers: snapshotLayers({
        layers: allLayers,
        geoLayers: [],
        activeLayerId: null,
      })
        .layers.filter((l) => l.modelRef.type === "url")
        .map((l) => ({
          name: l.name,
          modelUrl: (l.modelRef as { type: "url"; url: string }).url,
          selectedLods: l.selectedLods,
          rules: [...l.rules],
          // The USER's rules plus the mode; the synthetic catch-alls are
          // rebuilt on the other side, never sent.
          ...captureColorBy(l),
          visible: l.visible,
          attributeOrders: l.attributeOrders,
          tablePresentation: captureTablePresentation(
            useQueryStore.getState().queries[getActiveTableKey(l.id)],
          ),
        })),
      cam: cameraState,
      dt: datetime.toISOString(),
      tz: timeZone,
      pm: pickMode,
    };

    // The link is SHOWN, not just posted to a clipboard the user cannot see:
    // the dialog copies it on mount and reports the result inline, and the
    // field it renders is the fallback when the clipboard refuses. That
    // replaces the pair of toasts this used to raise \u2014 see `ShareDialog`.
    setShareUrl(buildShareUrl(state));
  }, [showToast]);

  // On mount: check URL hash for a share token
  useEffect(() => {
    const hash = location.hash;
    if (!hash) return;

    const result = readShareHash(hash);
    // A link this build cannot read is still a link somebody clicked, so it
    // gets the same treatment an unsupported SNAPSHOT does: an explanation.
    // Silence here reads as a broken viewer (ledger carry-forward, Task C18).
    if (result.kind === "unsupported") {
      history.replaceState(null, "", location.pathname);
      showToast(result.error.message, EXPLANATION_TOAST_MS);
      return;
    }
    if (result.kind !== "ok") return;
    const shared = result.state;

    history.replaceState(null, "", location.pathname);

    // Load shared layers. A pre-v3 link carried its single model at the top
    // level (`modelUrl`); such links no longer decode at all, so there is no
    // legacy shape to fall back to here.
    const layersToLoad = shared.layers ?? [];

    // Same race as `handleRestore`: a share link adds layers and then applies
    // the camera it encoded, and the viewport's fit-on-add would otherwise
    // land second and replace the shared viewpoint (Task C26).
    const releaseAutoFit = suppressAutoFit();

    void (async () => {
      // Per-layer failures are COUNTED, not swallowed: a `.fcb` link whose
      // source 404s, fails admission or times out waiting for the engine used
      // to leave a bare landing page with no explanation at all — and, since
      // no layer landed, no camera and no toast either. One layer failing
      // still must not abort the ones after it, hence a count rather than a
      // rethrow (the restore path above works the same way).
      let failedCount = 0;
      for (const sl of layersToLoad) {
        if (!sl.modelUrl) continue;
        try {
          const name = sl.name ?? fileNameFromUrl(sl.modelUrl);
          const rules = (sl.rules ?? []) as (typeof layers)[number]["rules"];
          // `readShareHash` has already validated the three, and derived a
          // mode for a link minted before they existed.
          const { colorBy, singleColor, unmatchedColor } = sl;
          const visible = sl.visible ?? true;

          if (detectEncoding(sl.modelUrl) === "flatcitybuf") {
            const modelUrl = sl.modelUrl;
            await withEngineBooting(modelUrl, async () =>
              openStreamingLayer({
                plugin: await resolveStreamPlugin(),
                source: { url: modelUrl },
                name,
                modelRef: { type: "url", url: modelUrl },
                rules,
                colorBy,
                singleColor,
                unmatchedColor,
                visible,
                attributeOrders: sl.attributeOrders,
                tablePresentation: sl.tablePresentation,
              }),
            );
          } else if (isCityParquetUrl(sl.modelUrl)) {
            // Same arm as the snapshot restore above and the loader hook: a
            // shared CityParquet link would otherwise hand parquet bytes to
            // `JSON.parse`. Failures are counted by this loop's `catch`. A
            // large source streams, decided afresh for this link.
            await addCityParquetLayerFromUrl(
              sl.modelUrl,
              {
                name,
                selectedLods: sl.selectedLods,
                visible,
                attributeOrders: sl.attributeOrders,
                tablePresentation: sl.tablePresentation,
                rules,
                colorBy,
                singleColor,
                unmatchedColor,
              },
              { resolveStreamPlugin, holdEngine },
            );
          } else {
            const parsed = await loadFromUrl(sl.modelUrl);
            await ensureModelCrsLoadable(parsed.model);
            addCityLayer({
              name,
              model: parsed.model,
              modelRef: { type: "url", url: sl.modelUrl },
              selectedLods: sl.selectedLods,
              visible,
              attributeOrders: sl.attributeOrders,
              tablePresentation: sl.tablePresentation,
              rules,
              colorBy,
              singleColor,
              unmatchedColor,
              duckdb: modelTableSource({
                model: parsed.model,
                bytes: parsed.bytes,
                encoding: parsed.encoding,
                refetch: urlSourceProvider(sl.modelUrl),
              }),
            });
          }
        } catch {
          failedCount++;
        }
      }

      useSelectionStore.setState({
        mode: shared.pm,
        selections: [],
        hovered: null,
      });
      restoreBasemap(shared.basemap);
      const dt = new Date(shared.dt);
      if (!isNaN(dt.getTime())) {
        useSolarStore.getState().setDatetime(dt);
        useSolarStore.getState().setTimeZone(shared.tz);
      }

      // Said BEFORE the camera wait, so the news is on screen while the
      // engine comes up rather than after it. An explanation, not a status:
      // the user clicked a link and got less than it promised.
      if (failedCount > 0) {
        showToast(
          `${failedCount} layer${failedCount === 1 ? "" : "s"} failed to load from the share link.`,
          EXPLANATION_TOAST_MS,
        );
      }

      // The shared viewpoint, once a viewport exists to take it — this effect
      // runs on MOUNT, so there is none yet, and a `.fcb` link is still
      // booting the engine through the hold above. Skipped when nothing
      // loaded (a camera-only link, or a link whose every layer failed):
      // there is no scene to point, and the landing page mounts no viewport
      // to wait for. Partial success still gets its camera — the layers that
      // DID load are what the link was pointing at.
      if (useLayerStore.getState().layers.length === 0) return;
      try {
        await applyCameraWhenReady(shared.cam);
      } catch (e) {
        showToast(
          `Shared view could not be opened: ${
            e instanceof Error ? e.message : String(e)
          }`,
          EXPLANATION_TOAST_MS,
        );
      }
    })().finally(releaseAutoFit);
    // Deps `[]` on purpose: a share hash is read ONCE, on mount. Everything
    // this body needs is a ref or a stable callback, and the wait for the
    // viewport is the boot gate rather than a re-run on some readiness state.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A dropped or browsed file, from the landing page's picker or the Add Layer
   * dialog. The promise is fire-and-forget either way, exactly as it was when
   * these were inline handlers (errors land in `loadError`).
   *
   * DETECTED here, which the landing page's half was missing: the URL field
   * has routed a `.geojson` to the geo store since Task 21, but a `.geojson`
   * DROPPED on the hero went to the city loader and came back as "Invalid
   * CityJSON" — one file, two answers, depending on which door it came
   * through. The dialog's File tab has always made this choice for itself
   * (`AddLayerDialog.addStaged`), so its `override` — always a city format by
   * the time it reaches here — passes through untouched.
   *
   * ONLY GeoJSON: an XYZ template and a 3D Tiles tileset are remote sources
   * the engine walks, not documents this app can read out of a local file, so
   * a file named like one keeps going to the loader and fails there, as today.
   * A refusal (a CityJSON file named `.geojson`, malformed JSON) is raised as
   * a toast — the landing page renders one, and its inline `.error-message`
   * belongs to the loader's own state.
   */
  const handlePickedFile = useCallback(
    (file: File, override?: DetectedSource) => {
      const detected = override ?? detectSourceFromName(file.name);
      if (detected.kind === "geo" && detected.geoKind === "geojson") {
        clearError();
        void addGeoSourceFromFile(file).then((result) => {
          if (!result.ok) showToast(result.error, EXPLANATION_TOAST_MS);
        });
        return;
      }
      void handleFile(file, override);
    },
    [clearError, handleFile, showToast],
  );

  const handlePickedFiles = useCallback(
    (files: File[], override?: DetectedSource) => {
      void handleFiles(files, override);
    },
    [handleFiles],
  );

  /** The catalog's version of the same path: the caller WANTS the outcome —
   *  including the loader's failure sentence, which is why this reads
   *  `lastError()` the moment the add resolves rather than the (async) error
   *  state. */
  const handleAddUrl = useCallback(
    async (url: string, override?: DetectedSource): Promise<AddUrlResult> => {
      const landed = await handleUrl(url, override);
      if (landed) return { ok: true };
      return {
        ok: false,
        message: lastError(url) ?? "Could not load this source.",
      };
    },
    [handleUrl, lastError],
  );

  const handleClose = useCallback(() => {
    useDrawStore.getState().finish();
    pendingRestoredCameraRef.current = null;
    closeAllStreamingLayers(getStreamPlugin());
    useLayerStore.getState().removeAllLayers();
    useShellStore.getState().closeDrawer();
    setFps(undefined);
    setCursorPosition(null);
    setUnavailableLayers([]);
    clearSelection();
    useGeoLayerStore.getState().removeAllGeoLayers();
    // Last, and after both removals: the invariants hand the active id over to
    // whatever survives each one, and nothing survives this.
    activateLayer(null);
    // "New workspace" in the header is this same exit, and a new workspace
    // does not inherit the old one's name.
    useWorkspaceStore.getState().resetName();
    setAddLayerOpen(true);
    savedIdRef.current = null;
    partialRestoreRef.current = false;
    restoreBasemap(undefined);
    useSceneSheetStore.getState().setSheet(null);
  }, [clearSelection]);

  // Re-selecting a file for an "unavailable" (restored-but-file-backed)
  // layer entry: routes through the same handleFile path any drop/browse
  // use — it already dispatches .fcb to streaming vs. plain parsing by
  // extension — then drops the entry once handled, whether it succeeded or
  // not (a failure surfaces through the normal `loadError` state; leaving a
  // permanently-stuck placeholder row would be worse than letting the user
  // retry via the ordinary add-layer controls).
  const handleResolveUnavailableLayer = useCallback(
    (entryId: string, file: File) => {
      const entry = unavailableLayers.find((u) => u.id === entryId);
      setUnavailableLayers((prev) => prev.filter((u) => u.id !== entryId));
      clearError();
      const pendingCamera = pendingRestoredCameraRef.current;
      const releaseAutoFit = pendingCamera ? suppressAutoFit() : () => {};
      void (async () => {
        try {
          const layerId = await withEngineBooting(file.name, () =>
            addLayerFromFile(
              file,
              entry
                ? {
                    rules: entry.rules,
                    colorBy: entry.colorBy,
                    singleColor: entry.singleColor,
                    unmatchedColor: entry.unmatchedColor,
                    visible: entry.visible,
                    lodMode: entry.lodMode,
                    selectedLod: entry.selectedLod,
                    selectedLods: entry.selectedLods,
                    hiddenTypes: entry.hiddenTypes,
                    attributeOrders: entry.attributeOrders,
                    tablePresentation: entry.tablePresentation,
                    selectedAppearance: entry.appearance,
                  }
                : undefined,
            ),
          );
          if (
            layerId &&
            pendingCamera &&
            pendingRestoredCameraRef.current === pendingCamera
          ) {
            await applyCameraWhenReady(pendingCamera);
            pendingRestoredCameraRef.current = null;
          }
        } catch (error) {
          showToast(
            error instanceof Error
              ? error.message
              : "Could not restore the saved view.",
            EXPLANATION_TOAST_MS,
          );
        } finally {
          releaseAutoFit();
        }
      })();
    },
    [
      unavailableLayers,
      addLayerFromFile,
      clearError,
      withEngineBooting,
      applyCameraWhenReady,
      showToast,
    ],
  );

  const handleDismissUnavailableLayer = useCallback((entryId: string) => {
    setUnavailableLayers((prev) => prev.filter((u) => u.id !== entryId));
  }, []);

  /**
   * The unavailable entries as LIST ROWS.
   *
   * Inside the shell they are no longer a banner floating over the map: a
   * layer that is waiting for its file is still one of the workspace's
   * layers, so it takes a row in the list beside the ones that loaded, and
   * re-linking it is a button on that row. The landing page keeps the banner
   * — it has no list to put a row in.
   *
   * Re-linking drops the entry as the add STARTS (`handleResolveUnavailableLayer`
   * removes it before calling `addLayerFromFile`, in the same event as the
   * loader's own `setPending`), so the "Needs re-link" row is replaced by the
   * "Loading…" one rather than sitting beside it.
   */
  const unavailableRows = useMemo(
    () =>
      unavailableLayers.map((entry) => ({
        id: entry.id,
        name: entry.name,
        kind: "unavailable" as const,
        onRelink: (file: File) => handleResolveUnavailableLayer(entry.id, file),
        onDismiss: () => handleDismissUnavailableLayer(entry.id),
      })),
    [
      unavailableLayers,
      handleResolveUnavailableLayer,
      handleDismissUnavailableLayer,
    ],
  );

  /** Zoom to a GEO layer: its extent is the app's to compute (the engine has
   *  no bounds API for these), and may live behind a URL — hence async, with
   *  the failure worded for the user rather than swallowed. */
  const handleFlyToGeoLayer = useCallback(
    (geoLayerId: string) => {
      const layer = useGeoLayerStore
        .getState()
        .layers.find((l) => l.id === geoLayerId);
      if (!layer) return;
      void (async () => {
        try {
          const bounds = await resolveGeoLayerBounds(layer);
          if (bounds) {
            sceneRef.current?.fitBounds(bounds);
            return;
          }
          showToast(
            "Could not determine the layer's extent.",
            EXPLANATION_TOAST_MS,
          );
        } catch {
          showToast(
            "Could not determine the layer's extent — its source did not load.",
            EXPLANATION_TOAST_MS,
          );
        }
      })();
    },
    [showToast],
  );

  const workspaceSize = unifiedLayerOrder(layers, geoLayers).length;

  /**
   * The first content of a SCENE is framed once, whatever its kind.
   *
   * The viewport does this for city models (static rows through
   * `previousLayerCountRef`, streams through the row predicate beside it), and
   * it cannot do it for a geospatial layer: Navara exposes no bounds API for
   * one, so the extent is the app's to compute (`resolveGeoLayerBounds`) —
   * which is also why this is here rather than there. Without it a geo-only
   * workspace opens on a whole-globe camera with the user's data somewhere
   * over the horizon, and the only way to find it is "Zoom to layer".
   *
   * The EDGE, not the level: exactly one row, arriving where there were none.
   * A geo layer added beside anything else does not fit, for the same reason a
   * second city model does not — the camera the user has arranged outranks the
   * new row. When that one row is a CITY layer this stands aside: the viewport
   * frames its own.
   *
   * Suppressed by a restore, like every other automatic fit: a restore is
   * nothing but new layers arriving and it carries its own camera
   * (`autoFitSuppression.ts`, Task C26). The scope is held across the restore's
   * `applyCameraWhenReady`, which is what keeps it open while this effect runs.
   *
   * Cancellation is a re-READ of the store after the waits, not the effect's
   * cleanup: this effect re-runs on every size change, so a cleanup would
   * cancel a legitimate pending fit the moment a second layer landed. What must
   * be dropped is a fit whose LAYER is gone — the user removed it while the
   * engine was still coming up — and the store is the authority on that.
   *
   * Failures are silent, deliberately: nobody asked for this flight. A source
   * that will not load is reported when the user asks for it by hand
   * ({@link handleFlyToGeoLayer}), and an engine that never starts has louder
   * symptoms than a camera that stayed put.
   */
  useEffect(() => {
    const previous = previousWorkspaceSizeRef.current;
    previousWorkspaceSizeRef.current = workspaceSize;
    if (previous !== 0 || workspaceSize !== 1) return;
    const geoLayer = useGeoLayerStore.getState().layers[0];
    if (!geoLayer || useLayerStore.getState().layers.length > 0) return;
    if (isAutoFitSuppressed()) return;
    const geoLayerId = geoLayer.id;
    /** The workspace this fit was computed for must still be the one on
     *  screen: the SAME single geo row, and nothing else. A row removed,
     *  replaced, or joined by another while the engine was coming up is a
     *  different scene, and the camera belongs to whatever framed that one. */
    const stillTheOnlyRow = (): GeoLayer | null => {
      const geo = useGeoLayerStore.getState().layers;
      if (useLayerStore.getState().layers.length > 0) return null;
      if (geo.length !== 1 || geo[0]!.id !== geoLayerId) return null;
      return geo[0]!;
    };
    void (async () => {
      try {
        const scene = await awaitSceneReady();
        if (scene === null) return;
        const layer = stillTheOnlyRow();
        if (layer === null) return;
        const bounds = await resolveGeoLayerBounds(layer);
        // A raster tile template names no extent, and neither does an
        // unlinked GeoJSON row: nothing to frame, so nothing happens.
        if (!bounds) return;
        // Asked again after the fetch, which is a wait of its own.
        if (stillTheOnlyRow() === null) return;
        // Through the handle, which brackets every camera move in the
        // streaming plugin's settle suppression.
        sceneRef.current?.fitBounds(bounds);
      } catch {
        // See the doc comment: an unasked-for fit fails quietly.
      }
    })();
  }, [workspaceSize, awaitSceneReady]);

  /** Zoom to whichever layer the left panel asks about. Stable, and that
   *  matters here: `App` re-renders on every cursor-position update from the
   *  viewport, and an inline arrow would hand `LeftPanel` a new prop — and
   *  every row a new render — on every mouse move over the map. */
  const handleZoomToLayer = useCallback(
    (item: ActiveLayer) => {
      if (item.kind === "city") sceneRef.current?.fitLayer(item.layer.id);
      else handleFlyToGeoLayer(item.layer.id);
    },
    [handleFlyToGeoLayer],
  );

  /** A layer the engine refused (the CRS gate — no reference system, or a
   *  non-metric one). Stable identity on purpose: `NavaraViewport`'s layer-sync
   *  effect lists it as a dependency. */
  const handleFlyToAddress = useCallback((target: FlyToTarget) => {
    sceneRef.current?.flyTo(target);
  }, []);

  const handleFitActiveLayer = useCallback(() => {
    if (activeLayer !== null) handleZoomToLayer(activeLayer);
  }, [activeLayer, handleZoomToLayer]);

  // §6.2's "Zoom to layer" on a New-layer result card. The scene handle lives
  // here and nowhere else, so the toolbox asks through the shell store and this
  // effect consumes the request and clears it — the same shape
  // `ActiveLayerPanel` uses for `requestedSection`. `handleZoomToLayer` takes
  // an `ActiveLayer`, not an id, so the id is resolved against both stores.
  const requestedZoom = useShellStore((s) => s.requestedZoom);
  useEffect(() => {
    if (requestedZoom === null) return;
    const target = resolveActiveLayer(requestedZoom, layers, geoLayers);
    if (target !== null) handleZoomToLayer(target);
    useShellStore.getState().requestZoom(null);
  }, [requestedZoom, layers, geoLayers, handleZoomToLayer]);

  const selectedObjectIds = useMemo(
    () =>
      activeLayer?.kind === "city"
        ? [
            ...new Set(
              selections
                .filter(
                  (selection) => selection.layerId === activeLayer.layer.id,
                )
                .map((selection) => selection.objectId),
            ),
          ]
        : [],
    [activeLayer, selections],
  );
  const selectedGeoBounds = useMemo(
    () =>
      activeLayer?.kind === "geo" &&
      activeLayer.layer.kind === "geojson" &&
      geoSelection?.geoLayerId === activeLayer.layer.id &&
      geoSelection.stableFeatureId !== undefined
        ? selectedGeoJsonBounds(
            activeLayer.layer.config.preparedData,
            new Set([geoSelection.stableFeatureId]),
          )
        : null,
    [activeLayer, geoSelection],
  );
  const handleFitSelection = useCallback(() => {
    if (activeLayer?.kind === "city" && selectedObjectIds.length > 0) {
      sceneRef.current?.fitObjects(activeLayer.layer.id, selectedObjectIds);
      return;
    }
    if (
      activeLayer?.kind === "geo" &&
      activeLayer.layer.kind === "geojson" &&
      geoSelection?.geoLayerId === activeLayer.layer.id &&
      geoSelection.stableFeatureId !== undefined
    ) {
      if (selectedGeoBounds !== null)
        sceneRef.current?.fitBounds(selectedGeoBounds);
    }
  }, [activeLayer, geoSelection, selectedGeoBounds, selectedObjectIds]);

  const handleLayerError = useCallback(
    (layerId: string, message: string) => {
      showToast(`Layer ${layerId}: ${message}`, EXPLANATION_TOAST_MS);
    },
    [showToast],
  );

  const handleLoadSample = useCallback(() => {
    void handleUrl(SAMPLE_DATA_URL).then((id) => {
      if (id) ensureDelftLandUse();
    });
  }, [handleUrl]);

  // Keep the viewport mounted across empty workspaces and workspace management.
  const workspacePage =
    pathname === "/workspaces" ? (
      <WorkspacesPage
        store={persistenceStore}
        onRename={(id, name) => {
          if (savedIdRef.current === id)
            useWorkspaceStore.getState().setName(name);
        }}
        onBack={() => {
          navigate("/");
          void refreshSnapshots();
        }}
        onOpen={(id) => {
          navigate("/");
          void handleRestore(id);
        }}
      />
    ) : null;
  const hasUrlLayers = layers.some((l) => l.modelRef.type === "url");

  /* The right column follows the SELECTION: there is no inspector toggle
       any more, and the `right` prop below is null exactly when both
       `selections` and `geoSelection` are empty. The header's chevron
       (`rightCollapsed`) still collapses the panel without touching what is
       selected — the pill on the map's edge brings it back — but the
       panel's OWN close button clears the selection outright, same as
       Escape (`useEscapeClearsSelection`): two different affordances for two
       different intents, "hide this" versus "I'm done with this".

       With the toolbox open the panel is the toolbox and this node becomes its
       Details TAB (spec §4.2), which is why the title and the "is anything
       selected" answer are named once here and handed to both. */
  const hasSelection = selections.length > 0 || geoSelection !== null;
  const detailsNode = hasSelection ? (
    <DetailsPanel onClose={clearSelection} />
  ) : null;
  const detailsTitle = selectionTitle(selections, geoSelection !== null);

  return (
    <>
      {workspacePage}
      <div
        className={
          workspacePage ? "viewer-route viewer-route-inactive" : "viewer-route"
        }
        inert={workspacePage ? true : undefined}
        aria-hidden={workspacePage ? true : undefined}
      >
        <ViewerShell
          header={
            <WorkspaceHeader
              onExportScene={(format) =>
                exportScene(format, () => {
                  const scene = sceneRef.current;
                  if (!scene)
                    return Promise.reject(
                      new Error("The scene is not ready to capture."),
                    );
                  return scene.captureImage(viewportAttribution);
                })
              }
              onSave={handleSave}
              onShare={handleShare}
              canShare={hasUrlLayers}
              /* "New workspace" is what "Close file" was: it empties the
                 workspace (and resets its name) and hands the user back to
                 the landing page. */
              onNewWorkspace={handleClose}
              onOpenWorkspace={(id) => void handleRestore(id)}
              snapshots={savedSnapshots}
            />
          }
          /* The rail is not a collapsed panel: it is a different component
             for a 40px column (the shell already narrows the track), which
             is why the choice is made here rather than inside the panel. */
          left={
            leftCollapsed ? (
              /* The same three row sources the panel gets: the rail's badge
                 counts what the list WOULD show, not what the stores hold. */
              <LeftRail
                extraRows={unavailableRows}
                pending={pending}
                failed={failed}
                failedCount={failed.length}
              />
            ) : (
              <LeftPanel
                onLoadSample={
                  tourPhase === "active" &&
                  tourIndex === 0 &&
                  !layers.some(
                    (layer) =>
                      layer.modelRef.type === "url" &&
                      layer.modelRef.url === SAMPLE_DATA_URL,
                  )
                    ? handleLoadSample
                    : undefined
                }
                onRequestAdd={() => setAddLayerOpen(true)}
                addDialogOpen={addLayerOpen}
                onAddFile={handlePickedFile}
                onAddFiles={handlePickedFiles}
                onAddUrl={handleAddUrl}
                loading={loading}
                /* The one thing only `App` can answer: a city layer is flown
                   to through the scene handle, a geospatial one through an
                   extent this app computes for itself. */
                onZoomToLayer={handleZoomToLayer}
                extraRows={unavailableRows}
                pending={pending}
                failed={failed}
                dismissFailed={dismissFailed}
              />
            )
          }
          map={
            <div className="viewport" ref={viewportRef}>
              {addLayerOpen && pathname !== "/workspaces" && (
                <AddLayerDialog
                  onClose={() => setAddLayerOpen(false)}
                  onAddFile={handlePickedFile}
                  onAddFiles={handlePickedFiles}
                  onAddUrl={handleAddUrl}
                  loading={loading}
                />
              )}
              {loadError && !hasWorkspace && failed.length === 0 && (
                <p className="empty-workspace-error error-message" role="alert">
                  {loadError}
                </p>
              )}
              {!hasWorkspace &&
                !tourSeen &&
                !loading &&
                !restoringWorkspace &&
                (tourPhase === "idle" || tourPhase === "welcome") && (
                  <section
                    className="empty-workspace-start"
                    aria-label="Get started"
                  >
                    <button
                      type="button"
                      className="empty-workspace-close"
                      aria-label="Close welcome"
                      onClick={() => walkthroughStore.getState().dismiss()}
                    >
                      ×
                    </button>
                    <h2>Explore Delft</h2>
                    <p>
                      Try the example city model to explore roofs, attributes
                      and analysis.
                    </p>
                    <button
                      type="button"
                      className="empty-workspace-load"
                      onClick={handleLoadSample}
                    >
                      Load Delft sample
                    </button>
                    {tourPhase === "idle" && (
                      <button
                        type="button"
                        onClick={() => walkthroughStore.getState().start()}
                      >
                        Start walkthrough
                      </button>
                    )}
                  </section>
                )}
              <NavaraViewport
                ref={attachScene}
                onTriangleCount={() => {}}
                onFps={setFps}
                onCursorPosition={setCursorPosition}
                onLayerError={handleLayerError}
                onAttributionChange={setViewportAttribution}
              />
              <CameraCluster
                onZoomIn={() => sceneRef.current?.zoomIn()}
                onZoomOut={() => sceneRef.current?.zoomOut()}
                onResetNorth={() => sceneRef.current?.resetNorth()}
                onFit={handleFitActiveLayer}
                fitDisabled={activeLayer === null}
                fitTitle={
                  activeLayer === null
                    ? "Choose a layer to fit"
                    : "Fit active layer"
                }
                onFitSelection={handleFitSelection}
                selectionPresent={
                  selectedObjectIds.length > 0 || geoSelection !== null
                }
                selectionDisabled={
                  selectedObjectIds.length === 0 && selectedGeoBounds === null
                }
                selectionTitle={
                  geoSelection !== null
                    ? selectedGeoBounds === null
                      ? "Selected geo feature has no coordinates"
                      : "Zoom to selected geo feature"
                    : "Zoom to selection"
                }
              />
              {drawActive && <DrawOverlay scene={sceneRef} />}
              <LegendOverlay />
              <FilterChip />
              <HoverTooltip />
            </div>
          }
          toolbar={
            <div
              className="map-tool-header"
              role="toolbar"
              aria-label="Map tools"
            >
              <div className="map-tool-header__editing">
                <SelectModeControl
                  mode={mode}
                  toolMode={toolMode}
                  cityActive={activeCityLayer !== null}
                  onSetMode={setMode}
                  onSetToolMode={setToolMode}
                  drawActive={drawActive}
                  canDraw={
                    activeLayer?.layer.id === drawLayerId &&
                    activeLayer?.kind === "geo"
                  }
                  onDraw={() => useDrawStore.getState().start()}
                  onPick={() => useDrawStore.getState().stop()}
                />
                <ToolsButton />
                <AddressSearch onFlyTo={handleFlyToAddress} />
              </div>
              <SceneButtons
                renderSun={(onClose) => <SunShadeSheet onClose={onClose} />}
                renderSettings={(onClose) => (
                  <SceneSettingsSheet onClose={onClose} />
                )}
              />
            </div>
          }
          canOpenTable={
            activeLayer?.kind === "city" ||
            (activeLayer?.kind === "geo" &&
              activeLayer.layer.kind === "geojson")
          }
          drawer={
            drawerOpen ? (
              <DataDrawer
                duckdbStatus={duckdbStatus}
                onRetryDuckDB={handleRetryDuckDB}
              />
            ) : null
          }
          right={
            toolboxOpen ? (
              <ProcessingPanel
                details={detailsNode}
                detailsTitle={detailsTitle}
              />
            ) : (
              detailsNode
            )
          }
          rightTitle={detailsTitle}
          rightMode={toolboxOpen ? "tools" : "details"}
          hasSelection={hasSelection}
          attributionLines={viewportAttribution}
          status={
            <StatusBar
              objectCount={totalObjects.loaded}
              totalObjectCount={totalObjects.total}
              fps={fps}
              cursorPosition={cursorPosition}
              streamStatus={
                activeCityLayer?.isStreaming
                  ? (activeStreamStatus ?? "idle")
                  : null
              }
              streamMessage={
                activeCityLayer?.isStreaming
                  ? (activeStreamMessage ?? null)
                  : null
              }
              residentCellCount={
                activeCityLayer?.isStreaming
                  ? activeStream?.handle.getResidentModel().cellCount
                  : undefined
              }
            />
          }
        />

        {/* Keyed on the URL so a second Share click while the dialog is open
            remounts it — the auto-copy effect must run again for the NEW
            link, not leave the old one on screen reporting an old result. */}
        {shareUrl !== null && (
          <ShareDialog
            key={shareUrl}
            url={shareUrl}
            onClose={() => setShareUrl(null)}
            copyToClipboard={copyShareText}
          />
        )}

        {!workspacePage && (
          <Walkthrough
            externalLoadControl
            onLoadSample={handleLoadSample}
            loading={loading}
            loadError={loadError}
          />
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}
