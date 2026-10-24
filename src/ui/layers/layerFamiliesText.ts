/**
 * The SENTENCES the object-families block renders.
 *
 * A sibling module rather than two more exports from `LayerFamilies.tsx`: a
 * function exported beside a component costs the file fast refresh, and the
 * linter says so (the same reason `tableText.ts` exists beside the table panel).
 */
import { formatCount } from "../table/tableText";
import type {
  FamilyGeometryState,
  LayerFamily,
} from "../../features/layers/familyStore";

/**
 * What a family's row says about its geometry.
 *
 * `rowCount` is the family's own size from the stream header — the objects in
 * the FILE, `null` until the family has been opened once. It is NOT what the
 * camera has delivered, so it is not "loaded": on the real Yokohama package that
 * read "884,106 loaded" beside some 4,500 resident objects. The loaded reading
 * belongs to the status bar ("N of M loaded objects") and to the details note
 * above; this row states what opening the family gives access to.
 *
 * The resident count is deliberately not offered PER FAMILY: the resident model
 * is one set for the layer and its objects carry no family, so any number here
 * would be the whole layer's wearing one family's label.
 */
export function geometryText(
  state: FamilyGeometryState | undefined,
  rowCount: number | null,
): string {
  if (state === "opening") return "Opening…";
  if (state === "failed") return "Failed";
  if (state !== "open") return "Not opened";
  // An OPEN family whose header never stated a count is still open; saying
  // "0 objects" would be a number nobody measured.
  return rowCount === null
    ? "Opened"
    : `Opened · ${formatCount(rowCount)} objects`;
}

/**
 * "Building opened · 3 more families available" — the one line that separates
 * what is rendering from what the package holds.
 *
 * It names the opened families rather than counting them: with Building alone
 * open (the default) "1 of 4 opened" tells the user nothing about WHICH one the
 * scene is showing.
 */
export function openedSummary(
  families: ReadonlyArray<LayerFamily>,
  opened: ReadonlyArray<string>,
): string {
  const openLabels = families
    .filter((family) => opened.includes(family.key))
    .map((family) => family.label);
  const rest = families.length - openLabels.length;
  const head =
    openLabels.length === 0
      ? "Nothing opened"
      : `${openLabels.join(", ")} opened`;
  if (rest === 0) return `${head} · every family in this package`;
  return `${head} · ${String(rest)} more famil${rest === 1 ? "y" : "ies"} available`;
}
