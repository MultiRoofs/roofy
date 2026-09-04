/**
 * The `feature_id` the DuckDB cityjson reader would have produced, computed
 * app-side for the layers that have no reader (CityGML, CityParquet, a
 * streaming layer's resident records).
 *
 * The reader's own definition: `id` is the CityObject's id and `feature_id`
 * names the ROOT object of the feature — a BuildingPart carries its Building's
 * id. Everything downstream depends on the two paths agreeing: the filter's
 * feature expansion, the export scope predicate and the map-filter id set are
 * all written once, against one vocabulary.
 *
 * Pure. Cycle-safe, because a malformed file may say A is a child of B and B
 * of A, and a viewer of third-party data must not hang on it.
 */

export type ParentsIndex = ReadonlyMap<string, ReadonlyArray<string>>;

/** The parent lookup for a model's (or a resident set's) objects. */
export function parentsIndexOf(
  objects: Readonly<
    Record<string, { readonly parents?: ReadonlyArray<string> } | undefined>
  >,
): ParentsIndex {
  const index = new Map<string, ReadonlyArray<string>>();
  for (const [id, obj] of Object.entries(objects)) {
    if (obj) index.set(id, obj.parents ?? []);
  }
  return index;
}

/**
 * The id of `id`'s root ancestor — itself when it has no parents.
 *
 * The FIRST parent is followed: CityJSON allows several, but a second parent
 * is a cross-reference rather than containment, and a feature has one root by
 * definition. A parent the index never saw is the answer (it is as far up as
 * this model goes); a cycle stops at the id that would repeat.
 *
 * So for a PARTIAL extract — a streaming layer's resident cells, a tiled
 * CityParquet package — the root returned may name an object that is not in
 * the table at all. That is correct rather than a gap: the feature-scoped
 * predicates compare `feature_id` to `feature_id`, so both sides of the `IN`
 * are computed the same way and an absent root simply matches the rows that
 * do declare it.
 */
export function rootFeatureId(id: string, parents: ParentsIndex): string {
  const seen = new Set<string>([id]);
  let current = id;
  for (;;) {
    const parent = parents.get(current)?.[0];
    if (parent === undefined || seen.has(parent)) return current;
    seen.add(parent);
    current = parent;
    if (!parents.has(current)) return current;
  }
}
