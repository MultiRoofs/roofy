/**
 * The ONE React door to the DuckDB engine's status.
 *
 * `duckdb.ts` owns the value and publishes every transition; this hook decides
 * when a component re-renders and reads the value fresh. It deliberately holds
 * NO copy — a component with `useState<DuckDBStatus>` is a second writer, which
 * is the thing the hard rule in CLAUDE.md forbids.
 *
 * The snapshot is the VERSION COUNTER, not the status. `useSyncExternalStore`
 * compares snapshots with `Object.is` on every render; the real
 * `getDuckDBStatus()` would pass that test on its own (it returns the module's
 * stored object, unchanged between transitions), but 24 of the app's test mock
 * factories return a fresh literal per call and React would reject those as
 * uncached snapshots and loop. A number cannot be spelled that way by accident,
 * and the value is one plain read away.
 */
import { useSyncExternalStore } from "react";
import {
  getDuckDBStatus,
  getDuckDBStatusVersion,
  subscribeDuckDBStatus,
  type DuckDBStatus,
} from "./duckdb";

export function useDuckDBStatus(): DuckDBStatus {
  useSyncExternalStore(
    subscribeDuckDBStatus,
    getDuckDBStatusVersion,
    getDuckDBStatusVersion,
  );
  return getDuckDBStatus();
}
