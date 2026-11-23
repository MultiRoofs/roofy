# Implicit geometry drawn as instances

## Intent

A file that places one shape many times (CityJSON `geometry-templates`, CityGML
implicit geometry, CityParquet `implicit_geometries`) keeps the shape once. The
viewer copies it into every object at parse time and draws each copy as
ordinary triangles. The goal is to keep the shape once from the reader to the
GPU and to draw it once per placement, so memory and load time follow the
number of placements times a matrix, not times the template.

## Baseline

`scripts/performance/make-template-forest.mjs` writes trees from two templates
(112 and 88 surfaces). `gate-harness.mjs --scenario forest --file <name>`
loads one as a static layer. On 10,000 trees (2.8 MB file, SwiftShader):
40 s to load, 583 MB of main-thread heap, 212 MB uploaded to the GPU, and a
restyle blocks for 2.5 s. `docs/performance/2026-11-23-instanced-templates/`
holds the runs.

## Goals

- An object's template surfaces are not copied: not in `CityObject.surfaces`,
  not in vertex buffers.
- Nothing a user sees changes: per-surface colours, rules, expressions, hiding
  by type and by filter, hover, selection of an object or of one surface, LoD
  selection, shadows, theme edges, picking, the inspector, statistics, roof
  tools and exports give the same answers as with copied surfaces.
- Static layers and streamed cells share one implementation.

## Non-goals

- Fewer triangles per frame. An instanced draw rasterises the same triangles;
  culling by distance or impostors is separate work.
- One style entry per instance. Every placed surface keeps its own slot (see
  "Slots"); a cheaper two-level style is a later decision with a behaviour
  trade-off.
- Instancing textured templates under a texture theme, and mirrored
  placements. Both are drawn baked, as today.

## Approaches

1. **GPU only.** Keep the copied surfaces in the model, recognise them in the
   mesh build and draw them instanced. Smallest change, but the object graph,
   which is the larger share of memory, stays.
2. **End to end, a slot per placed surface (chosen).** The model keeps only
   the reference; readers that need an object's surfaces ask an accessor that
   places them on demand; the mesh build emits instance sets; each placed
   surface still owns a style slot, so styling, hiding and picking are
   unchanged.
3. **End to end, a slot per instance.** As 2, but an instance has one style
   texel and its surfaces take their colour from the template. Memory and
   restyle time then follow the number of instances, but a rule can no longer
   colour one surface of one instance differently from the same surface of
   another, and a single surface of an instance cannot be highlighted alone.

2 is chosen because it changes no behaviour. 3 is put to the maintainer with
the numbers 2 produces.

## Model (`navara-core`)

- `CityObject.surfaces` holds the object's own surfaces only.
  `CityObject.implicitGeometry` and `CityModel.implicitTemplates` are as today.
  `bbox` still includes the placed template and `lod` is still the higher of
  the two, computed without building surfaces.
- `implicitSurfaces.ts` is the one place that places a template:
  - `objectSurfaces(object, templates)`: own surfaces followed by the placed
    template's. Allocates; for readers of one object (inspector, metrics).
  - `objectSurfaceCount`, `objectSurfaceAt(object, templates, index)`: the
    same list by index, placing one surface.
  - `placedBBox(template, ref)`.
    The surface index space is unchanged (own first, then the template's), so a
    stored selection still names the same surface.
- `withImplicitSurfaces` becomes `withImplicitBounds`: it grows bbox and LoD
  and copies nothing.
- LoD selection treats the template's LoD as one of the object's LoDs.
- `cityBatchFromModel` needs no change in kind: its LoD blocks then hold own
  surfaces only and its instance table is the placements.

Every reader of `.surfaces` in the plugins and the app is reviewed: one that
means "all the surfaces of this object" moves to the accessor.

## Mesh arrays (`buildCityMeshArrays`)

`CityMeshArrays` gains `instanced: ReadonlyArray<InstancedTemplate> | null`:

```ts
interface InstancedTemplate {
  readonly templateId: number;
  /** The template, triangulated once, relative to its bbox centre, in the
   *  template's own axes and metres. Shared by reference between the entries
   *  of one build that draw the same template. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  /** Per vertex, its drawn surface's ordinal within the template. */
  readonly vertexSurface: Uint32Array;
  /** Per drawn surface ordinal, the template's surface index. */
  readonly surfaceIndices: Uint32Array;
  readonly triangleCount: number;
  /** Instances of this entry. */
  readonly count: number;
  /** 16 per instance, column-major: centred template vertex to the build's
   *  frame (local ENU metres with a placer, source deltas without). */
  readonly matrices: Float32Array;
  /** Per instance, the slot of its first drawn surface; the slot of a vertex
   *  is `slotBase[i] + vertexSurface[v]`. */
  readonly slotBase: Uint32Array;
}
```

- **Slots.** The slot tables (`slotObjects`, `slotSurfaces`, `slotTextures`,
  `slotColors`) gain one slot per drawn template surface per instance, after
  the ordinary slots. `slotSurfaces` is the index in the object's full surface
  list (own count + template surface index). `slots` (per vertex) covers
  ordinary vertices only. Style, highlight, hide and filter code reads the
  slot tables and needs no change in kind.
- **Matrix.** With a placer, the placement is linearised at the template's
  centre `c`: the columns are `E(T(c + e_k)) - E(T(c))` and the translation is
  `E(T(c))`, where `T` is the placement and `E` the placer. Template vertices
  are stored as `v - c`, so Float32 keeps its precision whatever the
  template's own origin. Over a template 100 m wide the error is under 1 mm.
- **Baked instead** (the placed surfaces are written as ordinary surfaces,
  transiently): a matrix that is not finite or has a determinant that is not
  positive; a placed extent above 1 km; under a texture theme, a template with
  a surface textured in that theme; a template with no drawable surface in the
  selection draws nothing.
- **Filters.** `hiddenTypes`, `visibleObjectIds` and the LoD selection apply
  to an instance as to any object.
- **Cells.** `partitionCells` splits each entry by the grid cell of the
  instance's translation, so there is one entry per template per cell, with
  the template arrays shared by reference.

## Drawing (`navara-cityjson`)

One helper owns the instanced children of a mesh and is used by both mesh
classes (`CityModelMesh`, `CityMeshArraysMesh`):

- One `InstancedMesh` per entry, a child of the root with the root's world
  matrix (as the cell meshes are), the root's city material, the root's depth
  material, `castShadow` and `receiveShadow`, and a computed bounding sphere.
  Entries that share template arrays share `BufferAttribute`s.
- The style patch (`cityStyle.ts`) reads `citySlot + cityInstanceSlot` under
  `USE_INSTANCING`, in the lit and the depth material. `cityInstanceSlot` is
  an integer instanced attribute.
- Raycast: a hit on an instanced child resolves through `instanceId` and
  `vertexSurface` to its slot, then as any other hit (hidden slots skipped,
  nearest across children and cells).
- Theme edges: the template's edge segments drawn once per visible instance.
- `triangleCount` and the drawn-triangle count include the instances.

To verify in a browser, because the engine patches `ShaderLib` and the shadow
pass: instances are lit, cast and receive shadows, write the G-buffer, and
hide.

## Streaming

The worker bakes a cell through the same `buildCityMeshArrays`, so a cell
message carries `instanced`; its buffers join the transfer list, each shared
array once. FlatCityBuf already hands the header's templates to the parser.
The CityParquet stream reads the `implicit_geometries` sidecar once per open
and hands its templates to the decode.

## Tests

- Builder: an instance's matrix places every template vertex within 1 mm of
  the baked position (the baked path is the oracle); slots name the object and
  the full-list surface index; hidden, filtered and LoD-excluded instances are
  absent; mirrored and textured placements are baked.
- Accessor: `objectSurfaces` equals what the parser used to append.
- Mesh: a ray through an instance returns its object and surface; a hidden
  instance is skipped.
- The existing implicit-geometry tests keep their meaning through the
  accessor.
