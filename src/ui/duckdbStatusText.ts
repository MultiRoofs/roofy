/**
 * The words the status bar says about the analytics engine.
 *
 * Split out of `StatusBar.tsx` because they are pure functions of a status
 * object and a file that exports a component must export only components
 * (`react/only-export-components`) — a lint rule that exists so a fast-refresh
 * boundary stays a component boundary.
 */

import type { DuckDBStatus } from "../insights/duckdb";

export function duckdbDotClass(status: DuckDBStatus): string {
  if (status.state === "ready") {
    return status.extensions.cityjson.state === "loaded"
      ? "dot-ready"
      : "dot-partial";
  }
  if (status.state === "initializing") return "dot-loading";
  return "dot-failed";
}

/** Exported for its unit test — the four words are the whole of what the user
 *  sees about the analytics engine. */
export function duckdbLabel(status: DuckDBStatus): string {
  if (status.state === "ready") {
    return status.extensions.cityjson.state === "loaded" ? "Ready" : "No ext";
  }
  if (status.state === "initializing") return "Loading";
  return "Failed";
}

/**
 * What the status pill's `title` says.
 *
 * It names `PRAGMA platform` and lists `duckdb_extensions()` because BOTH
 * decide which artefacts this session actually got: `wasm_eh` and `wasm_mvp`
 * are served different builds, and the community slot for a DuckDB version can
 * be REBUILT under us (the duckdb-wasm pin is what pins the extension build).
 * A schema drift ("id is suddenly missing") has to be diagnosable from the UI,
 * not only from a console nobody opens.
 */
export function duckdbTooltip(status: DuckDBStatus): string {
  if (status.state === "uninitialized") {
    return "The analytics engine has not started.";
  }
  if (status.state === "initializing") {
    return "The analytics engine is starting…";
  }
  if (status.state === "failed") {
    return `The analytics engine failed to start: ${status.error}`;
  }
  const listed =
    status.loadedExtensions.length === 0
      ? "no extensions loaded"
      : status.loadedExtensions
          .map((e) => (e.version === "" ? e.name : `${e.name} ${e.version}`))
          .join(", ");
  const cityjson = status.extensions.cityjson;
  const prefix =
    cityjson.state === "failed"
      ? `cityjson did not load: ${cityjson.error}. `
      : "";
  const platform = status.platform === null ? "unknown" : status.platform;
  return `${prefix}Platform ${platform}. Loaded extensions: ${listed}`;
}
