/**
 * Re-export shim. `WorkerClient` and the FCB worker it spawns moved into
 * `@cityjson/navara-flatcitybuf` in Task C5 — the worker's imports must all
 * resolve inside the plugin package, since a worker entry point cannot reach
 * back into the host application.
 *
 * Kept so `openStreamingLayer.ts`, `useTileStreaming.ts`, `streamStore.ts` and
 * the inspector keep importing it from one place while the rest of the
 * streaming feature migrates.
 */
export { WorkerClient } from "@cityjson/navara-flatcitybuf";
