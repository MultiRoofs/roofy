# Phase 2 design: cells, a style texture, picking

How tasks 2.2 to 2.7 of `2026-10-16-review-phases-0-2.md` are built. Task 2.1 is done:
`CityBatch` (`navara-core/src/columnar/`) holds a model's features and its surfaces per LoD, and
reads back exactly on all of Delft.

## What the code depends on today

These are the coupling points, from a survey of every consumer:

- **Per-vertex colours are the style, highlight and texture-mask channel.** The chain is
  `computeStyleColors` → `paintLayers` → `setColors`, and it rewrites and re-uploads the whole
  colour buffer. `maskReadyTextures` whites out vertex ranges.
- **Rules are baked per vertex in the stream worker.** `CellGeometry.baseColors` and
  `ruleColors`, `recolor` → `recolored{ruleColors}`, and the worker's per-cell copies of the index
  and colour arrays all work this way. `assertCellGeometry` and `cellStatsFromGeometry` assume
  per-vertex lengths.
- **Identity is (object index, surface index).** The surface index points into
  `CityObject.surfaces`. Selection, hover, the inspector, the tooltip, multi-surface selection and
  rules (RoofSurface only, with metrics per surface) are all keyed by it, so style needs surface
  granularity.
- **Object indices are stable under hidden types and the attribute filter.** Today those two force
  a geometry rebuild, because an opaque material still occludes and still raycasts.
- **Picking reads `hit.face.a`.** Both mesh classes look up the `objectIndex` and `surfaceIndex`
  attributes there. Edges (`buildCityEdgeSegments`) read the position soup.
- **Height offset edits Float32 positions in place.** Budgets count triangles and the bytes of
  every array.

## Decisions

1. **One draw item, a "cell", for static and streamed layers alike.** A cell is the objects whose
   box centre falls in one grid square of the layer's index space. A static layer is cut into
   cells (target about 250 m) so the frustum culls inside the city. A streamed layer's cells are
   its tiles. Both mesh classes are replaced by one engine-free `CityCellMesh` in
   `navara-cityjson`.

2. **The cell format** is built in navara-core by `bakeCell(batch, rows, options) → CellArrays`.
   It is worker-safe and runs on the main thread for static layers and in the worker for streams.
   - **Slots.** A slot is one drawn surface. Surfaces are ordered by object row, so an object's
     slots are one contiguous range. Per slot, the bake records its row, its ordinal (the index
     into `CityObject.surfaces`, which is what picks and selections already use), its semantic type
     and its base colour (RGBA8, sRGB).
   - **Geometry.** Indexed per surface, so a vertex is never shared across surfaces and
     `face.a → slot` stays exact. Positions are `Int16` normalized, per axis, over the cell's box;
     the mesh's matrix is `frame · T(centre) · S(halfExtent)`. Normals are `Int8` normalized and
     pre-skewed by the half-extent, so three's normal matrix turns them back into true normals
     (`n' = normalize(n ⊙ h)`). Each vertex has a slot attribute, `Uint16` or `Uint32` by count.
     Indices are `Uint16` when the cell has fewer than 65,536 vertices, `Uint32` otherwise.
   - **Unique-vertex projection.** The block's shared pool is placed once: projected through proj4,
     or converted geodetic → ENU for a bucket source. Rings are then triangulated in ENU, where they
     are drawn.
   - **Textures.** Under a texture theme, surfaces are sorted by texture within each object's slot
     range. Groups become INDEX ranges, and UVs are a Float32 attribute only when the theme is
     textured. The "image ready" white-out becomes a flag in the style texture.

3. **The style texture.** Each cell has an RGBA8 `DataTexture`, one texel per slot (width 1024).
   RGB is the slot's colour in sRGB, converted to linear in the shader. A carries flags: hidden,
   selected, hovered, textured-and-ready. The material is a `MeshLambertMaterial` with an
   `onBeforeCompile` patch, set BEFORE the material reaches the CSM registry, so the CSM wrapper
   chains it, with its own `customProgramCacheKey`. The patch does three things:
   - The vertex shader fetches the texel by slot and writes `vColor`. A hidden slot collapses to a
     point outside the clip volume, which removes the triangle from colour, MRT and depth passes.
   - The mesh gets `customDepthMaterial = createShadowDepthMaterial(material)` (Navara exports it
     as YL), so a hidden surface casts no shadow.
   - Selected and hovered surfaces mix towards the highlight colours, which are uniforms.

   This makes restyle a texel write, highlight a flag write, and hidden types and the map filter a
   flag write instead of a rebuild. One texture per cell, not per layer: slot allocation across
   evicted cells is not worth it while draws are one per cell anyway.

4. **Style evaluation over slots, from the batch.** `evaluateSlotColors(batch, slots, rules)` runs
   in navara-core. It gives per-slot RGBA8, and null where no rule matched. It reads:
   - attributes through an inheritance column view (2.2), where the nearest ancestor wins, as in
     `inheritedAttributes`;
   - roof metrics cached once per block in Float64 columns (2.2).

   The stream worker keeps a cell's `CityBatch` instead of its `CityModel`. It answers `recolor`
   with 4 bytes per slot, `surfaces` with `surfaceFromBlock`, and builds the object records from
   the table.

5. **LayerStyle (2.5)** compiles to the same per-slot evaluation. Rules become one preset that
   compiles to a MapLibre `case` expression. The full `@maplibre/maplibre-gl-style-spec`, exact pin,
   is evaluated per slot with feature properties from the table. Snapshot v6 has a v5 migration.
   GeoJSON and 3D Tiles keep the engine evaluator, gated by style version.

6. **Picking (2.6).** The engine hands out pick ids one at a time (`genGlobalBatchId`), so
   per-feature GPU ids for plugin meshes would need an upstream change. Picking stays an own
   raycast, made cheap:
   - a BVH per cell over its triangles, built in the worker for streams and at bake for static
     layers;
   - dequantised from the Int16 positions;
   - hits on hidden slots skipped;
   - the nearest hit across cells, as today.

   CPU positions are kept, quantised, which is 6 bytes per vertex.

7. **Implicit geometry (2.7).** `InstanceTable` rows are drawn with one `InstancedMesh` per
   template per cell. The template is baked once in local coordinates, with one slot per instance
   for style.

## Fable's review, and what changed

The review (2026-10-16) confirmed the shader patch composes with the engine's MRT
`ShaderLib` patch, the CSM wrapper and `createShadowDepthMaterial`, and changed four things:

- **The material is a subclass.** `CityStyleMaterial extends MeshLambertMaterial` carries
  `onBeforeCompile` and a versioned `customProgramCacheKey` on its prototype. The CSM registry
  binds both at registration, and its rollback `delete`s the instance's `onBeforeCompile`
  (it never records an original handler). On a prototype method, the delete falls through to the
  patch instead of erasing it. Uniforms are one `{ value }` object per material, assigned on every
  compile. The style texture is `SRGBColorSpace`, so the GPU decodes the colour and the alpha
  stays linear for the flags.
- **Uniform quantisation, not per-axis with skewed normals.** Un-skewing amplifies Int8 normal
  error by the anisotropy ratio, which is degrees of tilt on a 2 km stream cell. A uniform scale
  over the cell's largest half-extent keeps Int8 normals exact to 0.45°. Quantisation comes after
  indexed Float32 cells are measured, as its own step.
- **The style texture goes on today's format first.** A per-vertex slot attribute from
  `buildCityMeshArrays`, both mesh classes, the worker's `recolor` returning 4 bytes per slot, and
  hover, selection, hidden types and the filter as flags. That is the spike and most of the
  restyle and upload gain, with no format change. Edges must honour hidden slots.
- **A static layer becomes a stream whose source is a resident batch.** It reuses the cell
  controller (`syncCellMeshes`) rather than becoming a third kind of layer. It must keep
  multi-LoD selection, `setModel` (computed columns) and texture themes. Texture themes are
  measured before cells multiply their materials. Picking stays an own raycast pruned by cell
  spheres; a BVH only if the measurement asks for one.

## Order

1. 2.2 columns for style: the inheritance view and the metric cache. Done.
2. 2.4 first: slots on today's arrays, `CityStyleMaterial`, the style texture on the static mesh,
   checked in the browser through the harness. Then the streamed cells, with `recolor` per slot.
   Then hidden types and the filter as flags.
3. 2.3: indexed Float32 cells from `bakeCell`, static layers as resident streams. Then uniform
   quantisation, measured.
4. 2.6: picking on cells, measured. A BVH only if needed.
5. 2.5: LayerStyle.
6. 2.7: instancing.
7. Harness measurements before and after, then a Fable review.
