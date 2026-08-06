/**
 * Attributes as the user should SEE them: the object's own, plus whatever it
 * inherits from its parents.
 *
 * This exists because of how CityJSON really splits a building up, and the
 * Delft reference dataset is the perfect example: every `Building` carries all
 * 30-odd 3D BAG attributes (`b3_dak_type`, `b3_h_dak_50p`, construction year,
 * …) and holds NO geometry, while every `BuildingPart` carries the geometry
 * and NO attributes at all — measured on the shipped sample: 66 Buildings, 66
 * with attributes; 66 BuildingParts, 0 with attributes.
 *
 * Picking is geometric, so a click always lands on the BuildingPart. Reading
 * attributes off the picked object alone therefore showed "No attributes" for
 * every building in the dataset — the bug this module fixes.
 *
 * The inheritance is presentation-only and deliberately NOT baked into the
 * parsed model: the source data genuinely does not put those values on the
 * part, and rules, DuckDB and the table all read the real thing. Callers get
 * `inheritedFrom` so the UI can say where a value came from rather than
 * implying the part owns it.
 */

/**
 * The minimum an object must expose to take part in inheritance.
 *
 * Structural rather than `CityObject` so the STREAMING path works too: a
 * FlatCityBuf `ResidentObjectRecord` carries the same id/attributes/parents
 * and splits Building from BuildingPart exactly the same way, so it would
 * otherwise show the identical "No attributes".
 */
export interface AttributeCarrier {
  readonly id: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly parents: ReadonlyArray<string>;
}

export interface ResolvedAttributes {
  /** Own attributes, plus any inherited key the object does not define itself. */
  readonly attributes: Readonly<Record<string, unknown>>;
  /** The ancestor that supplied the inherited keys, or `null` when nothing was
   *  inherited (the object had them all, or has no parent that has any). */
  readonly inheritedFrom: string | null;
}

/**
 * Resolve one object's visible attributes against the model it belongs to.
 *
 * The object's OWN entries always win — inheritance fills gaps, it never
 * overrides. Ancestors are walked nearest-first and the walk is cycle-safe: a
 * malformed file whose parents point at each other must not hang the UI.
 */
export function resolveInheritedAttributes(
  objects: Readonly<Record<string, AttributeCarrier>>,
  object: AttributeCarrier,
): ResolvedAttributes {
  const merged: Record<string, unknown> = { ...object.attributes };
  let inheritedFrom: string | null = null;

  const seen = new Set<string>([object.id]);
  // Breadth-first over ancestors so the NEAREST parent wins a contested key,
  // which is what "inherit" means for a two-level Building/BuildingPart split
  // and stays sane for deeper trees.
  let frontier: readonly string[] = object.parents;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const parentId of frontier) {
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      const parent = objects[parentId];
      if (!parent) continue;
      for (const [key, value] of Object.entries(parent.attributes)) {
        if (key in merged) continue;
        merged[key] = value;
        inheritedFrom ??= parent.id;
      }
      next.push(...parent.parents);
    }
    frontier = next;
  }

  return { attributes: merged, inheritedFrom };
}
