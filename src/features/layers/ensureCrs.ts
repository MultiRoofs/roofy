/**
 * Pre-flight CRS resolution for a parsed model, BEFORE it lands in the layer
 * store.
 *
 * The sync CRS gate (`resolveMetricEpsg`, called when the engine builds the
 * mesh) can only consult proj4's registry, and the bundled registry knows
 * only the Dutch grids plus proj4's own built-ins — which is why a worldwide
 * catalog's Singapore or Zürich dataset used to fail with "no proj4
 * definition" AFTER the whole file had downloaded, parsed and been added.
 * This helper runs at the one moment the load path is already async: it
 * resolves the model's EPSG code, lets `ensureProjDefAsync` fetch the
 * definition from epsg.io when the fixed list does not know it, and applies
 * the SAME units gate the engine will apply — so a refusal happens here,
 * with the loader's error surface, and the sentence reaches the user.
 *
 * A model with NO parseable reference system is passed through untouched:
 * the engine gate's own `CrsUnresolvedError` names that case precisely, and
 * duplicating its wording here would be a second copy to keep honest.
 *
 * The epsg.io dependency is best-effort by design, like the geoid service:
 * offline, the fixed list still covers what it always covered, and anything
 * beyond it is refused with a sentence that names the code.
 */

import {
  assertMetricCrs,
  ensureProjDefAsync,
  parseEpsgCode,
} from "@cityjson/navara-core";
import type { CityModel } from "../../domain/citymodel/types";

export async function ensureModelCrsLoadable(model: CityModel): Promise<void> {
  const ref = model.metadata?.referenceSystem;
  const epsg = parseEpsgCode(ref);
  if (epsg === null) return;

  const resolved = await ensureProjDefAsync(epsg);
  if (!resolved) {
    throw new Error(
      `Cannot georeference this layer: CRS EPSG:${epsg} has no proj4 definition ` +
        `(and it could not be fetched from epsg.io). The model cannot be placed on the globe.`,
    );
  }
  // Throws NonMetricCrsError with its own sentence — the same gate the
  // engine applies, run early so the refusal costs a check instead of a
  // mesh build.
  assertMetricCrs(epsg);
}
