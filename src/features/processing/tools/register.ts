/**
 * Every tool module, imported for its `registerExecutor` side effect.
 *
 * `runQueue.ts` imports this file and nothing here imports the queue's runtime,
 * so the registration order is a single, readable list rather than whatever the
 * module graph happens to pull in first. A tool that is in the catalogue but not
 * here is `implemented: false` in `toolRegistry.ts`, and a run for it fails with
 * "Not available yet" instead of hanging.
 */
import "./heightFromExtent";
