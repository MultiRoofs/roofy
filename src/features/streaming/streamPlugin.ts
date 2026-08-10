/**
 * The app's one reference to the live `FlatCityBufPlugin`.
 *
 * The plugin is constructed by the component that owns the engine
 * (`NavaraViewport`, Task C13) and torn down with it, but the code that OPENS
 * a streaming layer is nowhere near that component: a `.fcb` arrives through
 * `useLayerFileLoader` (a drop target, a URL box) or through `App.tsx`'s
 * snapshot restore. Threading a plugin instance from the viewport through the
 * app shell into a file-loading hook would put an engine object in half a
 * dozen signatures that have no other use for one.
 *
 * So the viewport publishes it here on `init()` and clears it on teardown, and
 * the two call sites resolve it at the moment they need it — late, once, and
 * explicitly, rather than capturing it in a closure that could outlive the
 * engine. `openStreamingLayer` itself still takes the plugin as an ARGUMENT
 * (never reading this module), so it stays a pure function that a test can
 * drive with a fake.
 *
 * Deliberately module state rather than React state: the plugin's lifetime is
 * the engine's, not any component's, and nothing re-renders when it changes —
 * a layer cannot be opened before the engine is up in the first place.
 */
import type {
  FcbStreamLayerHandle,
  OpenStreamOptions,
} from "@cityjson/navara-flatcitybuf";

/**
 * The part of `FlatCityBufPlugin` the app actually calls.
 *
 * Structural, not the class: `FlatCityBufPlugin` lives behind the
 * `/plugin` subpath, which imports `@navaramap/*` and therefore cannot be
 * loaded under Node (Global Constraints -> NODE_IMPORT_SAFE = false). Typing
 * against the shape keeps every app-side streaming test engine-free while
 * still accepting the real plugin.
 */
export interface StreamPlugin {
  openStream(opts: OpenStreamOptions): Promise<FcbStreamLayerHandle>;
  /** Tears one layer down: its worker, its cell meshes, its place in the
   *  plugin's settle loop. Unknown ids are ignored. */
  remove(id: string): void;
}

let current: StreamPlugin | null = null;

/** Publish (or, with `null`, retract) the live plugin. Called only by the
 *  component that owns the engine. */
export function setStreamPlugin(plugin: StreamPlugin | null): void {
  current = plugin;
}

/** The live plugin, or `null` when the engine is not up. */
export function getStreamPlugin(): StreamPlugin | null {
  return current;
}

/**
 * The live plugin, or a thrown error naming the real cause.
 *
 * Streaming is the ONE load path that cannot work without the 3D engine — the
 * plugin owns the worker, the cell meshes and the camera-driven commit loop —
 * so a `.fcb` opened before the engine is up has to fail loudly. Both call
 * sites already catch and surface the message (`useLayerFileLoader`'s error
 * state, `App.tsx`'s restore toast), so this reads as a normal load failure
 * rather than a crash.
 */
export function requireStreamPlugin(): StreamPlugin {
  if (!current) {
    throw new Error(
      "The 3D engine is not running yet, so a streaming (.fcb) layer cannot be opened. Wait for the viewer to finish loading and try again.",
    );
  }
  return current;
}
