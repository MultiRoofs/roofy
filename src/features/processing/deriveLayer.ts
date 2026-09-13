/**
 * A derived layer's NAME (spec §6, OUTPUT).
 *
 * The name rules live in their own module — the one a later task then extends
 * with the functions that BUILD a derived layer — because three callers need
 * the same answer at three different times and only one of them is a run: the
 * FORM prefills the Name field and validates what the user typed, `submitRun`
 * freezes it (§6.1's frozen parameters include "the destination and new-layer
 * name"), and the PUBLICATION re-checks it, because "a queued run or a rename
 * in between can take it" (§6). A second copy of the comparison rule is how Run
 * and publication come to disagree about what is unique.
 *
 * Everything here is pure: no store, no DuckDB, no React.
 */
import type { GeoLayer } from "../geoLayers/geoLayerStore";
import type { Layer } from "../layers/layerStore";
import type { ToolId } from "./types";

/**
 * Why §6's New-layer destination is refused on a streaming target
 * (**[adapted copy A2]**, Decisions recorded item 1).
 *
 * THREE places say it and all three import this: the radio's `title` and the
 * note under it, the form's `runReason` (a draft that already chose "new"
 * survives a retarget onto a streaming layer, and the disabled radio does not
 * unchoose it), and `execute`'s head pre-flight. `ToolView.tsx` would be the
 * obvious home and is the wrong one — `runQueue.ts` may not import a UI module,
 * and a second copy of a sentence is a second sentence.
 */
export const STREAMING_NO_NEW_LAYER =
  "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.";

/**
 * Spec §6's prefilled name for a tool: "<target> · <tool noun>".
 *
 * The seven the spec spells out are "Delft · solids", "Delft · roof metrics",
 * "Delft · validation", "Delft · extent", "Delft + Zones", "Zones · buildings"
 * and "Delft · nearest Roads" — so two of them name the SOURCE layer as well,
 * which is why this takes three arguments and not two. `sourceName` is null
 * whenever the form has no source yet (the select is empty, or the tool has no
 * `sourceKind`); those two names then drop the source segment rather than
 * printing a placeholder, because Run is refused for the missing source anyway
 * and a name the user can read is worth more than one they have to decode.
 *
 * Exhaustive over `ToolId` with no `default`: a tool added without a noun is a
 * compile error here, which is where it should be.
 */
export function derivedLayerName(
  targetName: string,
  toolId: ToolId,
  sourceName: string | null,
): string {
  switch (toolId) {
    case "roof-metrics":
      return `${targetName} · roof metrics`;
    case "measure-solids":
      return `${targetName} · solids`;
    case "validate-solids":
      return `${targetName} · validation`;
    case "height-from-extent":
      return `${targetName} · extent`;
    case "aggregate-per-area":
      // The TARGET is the vector layer here (§7.6's reversed direction), so
      // this reads "Zones · buildings" and not "Delft · …".
      return `${targetName} · buildings`;
    case "join-by-location":
      return sourceName === null ? targetName : `${targetName} + ${sourceName}`;
    case "distance-to-nearest":
      return sourceName === null
        ? `${targetName} · nearest`
        : `${targetName} · nearest ${sourceName}`;
  }
}

/**
 * §6's comparison rule, in one place: "unique among all layers of the
 * workspace, compared trimmed and case-insensitively".
 *
 * An EMPTY name is never "taken", whatever the layer list holds: the form has
 * two different messages for an empty name and a duplicate one, and folding
 * them together would report the wrong cause for a cleared field.
 */
const fold = (name: string): string => name.trim().toLowerCase();

export function nameTaken(
  name: string,
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): boolean {
  const wanted = fold(name);
  if (wanted === "") return false;
  return (
    layers.some((l) => fold(l.name) === wanted) ||
    geoLayers.some((l) => fold(l.name) === wanted)
  );
}

/**
 * §6's publication rule: "a conflict then gets ' (2)' appended and the result
 * card says so, rather than failing a finished run" (and §10 scenario 12).
 *
 * The suffix counts UP past names that are themselves taken, so publishing
 * twice gives " (2)" and " (3)" rather than two layers called " (2)". The loop
 * has no bound because the candidate set is infinite and the layer list is
 * finite — it cannot run more times than there are layers plus one.
 *
 * A name that is FREE is returned exactly as it was given, untrimmed: the form
 * prints what the user typed and `submitRun` freezes the same string.
 */
export function disambiguate(
  name: string,
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): { readonly name: string; readonly renamed: boolean } {
  if (!nameTaken(name, layers, geoLayers)) return { name, renamed: false };
  // Trimmed before the suffix: "Zones · buildings  (2)" would be the one name
  // the user did not ask for.
  const base = name.trim();
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!nameTaken(candidate, layers, geoLayers)) {
      return { name: candidate, renamed: true };
    }
  }
}
