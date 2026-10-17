# Phase 2 remainder: style expressions, implicit geometry, quantisation

Tasks 2.5 (layer styles), 2.7 (implicit geometry) and the quantisation half of
2.3 in `2026-10-16-review-phases-0-2.md`. The cells, the style texture and
picking are in `2026-10-16-phase-2-design.md`. Fable reviewed this design
before it was built; its changes are folded in below.

## Style expressions (task 2.5)

### What an expression is

A layer can be coloured by one MapLibre style-spec `color` expression,
evaluated per surface. `@maplibre/maplibre-gl-style-spec` is an exact
dependency of `navara-core` (`26.4.1`, the version `maplibre-gl` already
brings). `compileStyleExpression(expression)` in
`navara-core/src/styling/layerStyle.ts` returns either a
`SurfaceStyleEvaluator` or the spec's own error messages. The evaluator has
the rule evaluator's signature, so `CityModelMesh.setStyle`, the stream
worker's colour pass and `buildSlotStyleColors` take either.

A surface's properties, in increasing precedence:

1. the object's attributes, with its ancestors';
2. the surface's own attributes;
3. the roof metrics `areaSqM`, `inclinationDeg`, `azimuthDeg`, `elevationM`,
   computed only when the expression reads one, once per surface;
4. the reserved `$surface` (semantic type), `$type` (object type), `$id`
   (object id, also `["id"]`) and `$base` (the colour the surface has
   unstyled).

The properties are a prototype chain, so a slot copies nothing per object:
the surface's attributes and the reserved names on the instance, the metric
getters on its prototype, the object's attributes below that. Laziness comes
from the getters, not from scanning the expression, so a computed property
name (`["get", ["concat", …]]`) needs no fallback.

### Keeping the base colour

The result keeps the surface's base colour when it is the `$base` Color
instance itself, null, fully transparent, or an evaluation error. A colour
derived from `$base` (`["interpolate", …, ["to-color", ["get", "$base"]], …]`)
is a new colour. A literal `null` branch does not compile in the spec, so
`["get", "$base"]` is the way an expression says "leave this one".

### Rules and the other modes

The rule evaluator stays the fast path for the surface, rules and single
modes: on Delft it is two to three times faster than the expression
evaluator for the same colours. `rulesToStyleExpression(rules)` compiles a
rule list to the expression that colours exactly as `compileRuleEvaluator`
does (enabled rules, first match wins, roofs only; `=` strict, the order
operators true only for numbers). A parity test runs every preset and the
odd cases on both fixtures; on the Delft tile all 68,721 slots agree.

### In the app

- `colorBy` gains `"expression"`, and a layer carries
  `styleExpression: ReadonlyArray<unknown> | string | null`.
  `effectiveExpression(layer)` is the stored expression in that mode and null
  otherwise; `effectiveRules` is empty in that mode.
- Choosing "Expression" with none stored seeds the editor with
  `seedStyleExpression(layer)`: the rules the current mode paints, as an
  expression, or a starter that shades roofs by pitch when nothing is
  painted.
- `StyleExpressionEditor` is one JSON text area. An edit applies only once it
  parses and compiles, after a 400 ms pause; until then the layer keeps the
  last expression that worked and the reason shows under the editor.
- The legend shows one "Expression" row, its swatch the literal colours the
  expression names (a gradient for several).
- Static layers: `handleSync` memoises on rules, enabled flag and expression
  and calls `setStyle`. Streams: `setRules(rules, enabled, expression)` and
  `openStream({ expression })`; the worker compiles once per expression,
  keyed by its JSON.

### Persistence

No schema bump. `styleExpression` is an additive optional field in the
snapshot (v5) and the share link (v3), written only when present, and kept
whatever the mode, so switching away and back loses nothing. A document that
names `"expression"` without an expression restores as the mode its rules
imply.

### Not style targets

- GeoJSON layers keep their own colour-by-attribute style.
- User 3D Tiles and Google photoreal: no per-feature properties reach the
  app, so the only possible style is a constant tint, which the scene theme
  already owns.

## Implicit geometry (task 2.7)

`geometry-templates` parse into `CityModel.implicitTemplates` (template
vertices are real coordinates, not transformed). An object's
`GeometryInstance` becomes `implicitGeometry { templateId, referencePoint,
transformationMatrix }`. `placeImplicitSurfaces` (`citymodel/implicitSurfaces.ts`)
places the template's surfaces at `M · v + p` and appends them to the
object's `surfaces`; the object's bbox includes them.

The surfaces are baked, not instanced: every reader of `surfaces` (drawing,
picking, hiding, highlighting, styling, statistics, LoD selection, cells)
handles a tree like any other object, at the cost of one copy of the
template per instance. Instancing is a memory optimisation that pays at
city scale (100k trees), not at the scale of the datasets in use.

Where it applies: CityJSON and CityJSONSeq (static), CityParquet static
packages through their `implicit_geometries` sidecar, and FlatCityBuf
streams, whose header carries the templates (parsed once per open). The
CityParquet stream path does not load the sidecar.

## Quantisation (task 2.3 remainder): deferred

Delft static is 354,522 vertices and 653,331 `Uint32` indices: 12 B position,
12 B normal and 4 B slot per vertex is 9.9 MB, the index 2.6 MB, 12.5 MB in
all. `Int16` positions and `Int8` normals would bring it to about 7.6 MB.

It waits because:

- Navara owns each top-level mesh's `matrixWorld` (the ENU placement), so the
  dequantising matrix can sit only on child meshes, and the static root could
  no longer draw cell 0.
- The edge builder and `raisePositionsInEnu` read `Float32` positions, and
  both mesh classes change.
- Per-cell `Uint16` indices need per-cell buffers (WebGL2 has no base
  vertex).
- No frame-time effect is measurable on a SwiftShader host.

It belongs with the batch that merges static layers into streams (the
deferred handle merge), which reshapes these meshes anyway; the stream
residency budget is where the saving counts.
