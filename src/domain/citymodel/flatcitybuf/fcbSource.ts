/**
 * Re-export shim. Opening a .fcb source and the streaming admission gate
 * moved into `@cityjson/navara-flatcitybuf` in Task C5: the FCB worker moved
 * there too, and a worker entry point cannot import from the host app.
 *
 * The admission gate's units check now runs through
 * `@cityjson/navara-core`'s `assertMetricCrs`/`isMetricCrs` — the same
 * implementation the static load path uses (Task B6 carry-forward), so
 * "is this CRS metre-based?" has one answer for the whole system.
 */
export type {
  AdmissionCode,
  AdmissionError,
  FcbHeaderModel,
} from "@cityjson/navara-flatcitybuf";
export {
  checkAdmission,
  headerModel,
  openFcb,
} from "@cityjson/navara-flatcitybuf";
