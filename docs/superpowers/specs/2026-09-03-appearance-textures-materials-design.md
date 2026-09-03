# Appearance support: textures and materials — design

Date: 2026-09-03. Branch: `support-texture`.

## Goal

Render CityJSON **appearances** — textures (image + UV coordinates) and
materials (diffuse colour) — for every city-model format the viewer loads:
CityJSON, CityJSONSeq, FlatCityBuf, CityParquet and CityGML. The reference
dataset is `https://cityjson.open3d.city/cityjsonseq/rotterdam/rotterdam.jsonl`
(853 features, one texture theme `rgbTexture`, 148 JPG images under a sibling
`appearances/` folder, every feature textured, no materials).

The UI requirement: a city layer's row in the layer panel, which today shows
the layer name and a LoD selector, ALSO shows an **appearance selector** that
lists the file's texture and material themes by name (plus "None"). Picking a
texture theme draws the textures; picking a material theme draws the material
colours; "None" draws the semantic/rule colours as today.

Texture image paths are relative to the **dataset**, not the app. A
`{"image":"appearances/0320_2_18.jpg"}` in a file loaded from
`https://host/path/rotterdam.jsonl` resolves to
`https://host/path/appearances/0320_2_18.jpg`. A layer loaded from a local
file has no base URL, so relative images are unresolvable; absolute image
URLs still work.

Formats are delivered **one at a time**, CityJSONSeq (Rotterdam) first. The
static CityJSON path shares the parser helpers and comes with it for free.

## Measured facts that shape the design

- The domain `Surface` stores **resolved coordinates** per ring (`rings:
Vec3[][]`), not vertex indices; index lookup happens in `parseHelpers.ts`.
  UVs therefore ride along as resolved `[u, v]` pairs per ring vertex, in
  lock-step with `rings`, resolved from `vertices-texture` at parse time.
- `buildCityMeshArrays` (navara-core) writes a **non-indexed** vertex stream
  (3 vertices per triangle; per-vertex `objectIndex`/`surfaceIndex` carry
  identity), triangulates with three's `ShapeUtils.triangulateShape`, and may
  **reverse the exterior ring** (`orientExteriorRing`) and conditionally
  reverse hole rings. Any UV ring must be reversed by the same decision.
- Both mesh classes in `navara-cityjson` use one
  `MeshBasicMaterial({ vertexColors: true, side: DoubleSide })`; the engine's
  MRT shader patch (`overrideMaterialsForMRT`) rewrites three's shared
  `ShaderLib.basic` and leaves `map`/`USE_MAP` handling intact, so a textured
  basic material feeds the albedo g-buffer exactly like the vertex-colour one.
  three multiplies `map` by the vertex colour when both are present.
- three's `Mesh.raycast` and `WebGLRenderer` both iterate `geometry.groups`
  when `material` is an array, so per-texture groups keep the own-raycast
  picking path working untouched.
- The CityJSON spec does not state the UV origin. three's default
  (`flipY: true`, origin bottom-left) is what the reference viewers use; it is
  the default here and is verified visually on Rotterdam (a facade image must
  not render upside down).
- CityJSONSeq appearance is **feature-local** (each feature carries its own
  `textures`, `materials`, `vertices-texture`; indices are local). FlatCityBuf
  is the same (its JS reader returns a faithful `CityJSONFeature` with
  `appearance`). CityParquet uses dataset-global sidecar ids and inlines UV
  pairs. CityGML uses `app:ParameterizedTexture` targets keyed by polygon/ring
  `gml:id` with one UV pair per `posList` vertex, closing vertex included.
- Rules colour a surface by returning a colour, falling back to the base
  colour where no rule matches (`computeStyleColors`).

## Architecture

### 1. Domain model (`@cityjson/navara-core`, `citymodel/types.ts`)

```ts
export type UV = readonly [number, number];
export type RGB = readonly [number, number, number];

export interface CityMaterial {
  readonly name: string;
  readonly diffuseColor?: RGB; // 0..1 sRGB
  readonly emissiveColor?: RGB;
  readonly specularColor?: RGB;
  readonly ambientIntensity?: number;
  readonly shininess?: number;
  readonly transparency?: number; // 1 = fully transparent (spec)
  readonly isSmooth?: boolean;
}

export type TextureWrapMode = "none" | "wrap" | "mirror" | "clamp" | "border";

export interface CityTexture {
  readonly image: string; // as written in the file (relative or absolute)
  readonly type: "PNG" | "JPG";
  readonly wrapMode?: TextureWrapMode;
  readonly textureType?: "unknown" | "specific" | "typical";
  readonly borderColor?: readonly [number, number, number, number];
}

export interface CityAppearance {
  readonly materials: ReadonlyArray<CityMaterial>;
  readonly textures: ReadonlyArray<CityTexture>;
  /** Theme names discovered on surfaces, sorted, deduplicated. */
  readonly textureThemes: ReadonlyArray<string>;
  readonly materialThemes: ReadonlyArray<string>;
  readonly defaultTextureTheme: string | null;
  readonly defaultMaterialTheme: string | null;
}

export interface SurfaceTexture {
  /** Index into `CityAppearance.textures` (model-wide, deduplicated). */
  readonly textureIndex: number;
  /** One UV array per ring, same length as `Surface.rings[i]`. */
  readonly uvs: ReadonlyArray<ReadonlyArray<UV>>;
}

export interface Surface {
  // ...existing fields...
  /** theme name -> index into `CityAppearance.materials`. */
  readonly material?: Readonly<Record<string, number>>;
  /** theme name -> texture + UVs for this surface. */
  readonly texture?: Readonly<Record<string, SurfaceTexture>>;
}

export interface CityModel {
  // ...existing fields...
  /** Absent/undefined when the source carries no appearance. */
  readonly appearance?: CityAppearance;
}
```

`appearance` is optional on `CityModel` (dozens of test fixtures build the
literal) — absent means "no appearance". Surfaces without a theme entry are
untextured / unmaterialled in that theme.

`AppearanceTheme`, the user's selection, is a core type shared by the plugin
handles and the app:

```ts
export interface AppearanceTheme {
  readonly kind: "texture" | "material";
  readonly name: string;
}
```

### 2. Parsing (`navara-core`, `citymodel/cityjson/appearance.ts` + `parseHelpers.ts`)

An **`AppearanceMerger`** accumulates the model-wide texture and material
tables. Each source unit (the whole static file; each CityJSONSeq feature;
each FlatCityBuf feature; each CityGML appearance) registers its local
appearance and gets back **remap arrays** (local index → model index) plus
its own UV list. Textures dedupe by `JSON.stringify` of the texture object
(Rotterdam: ~10 k local entries → 148 model textures), materials likewise.
`build()` returns a `CityAppearance` or `undefined` when nothing was
registered.

`parseCityObject` gains an optional `AppearanceContext = { uvs, textureRemap,
materialRemap }`. The boundary walkers (`extractSurfacesMulti`, `Solid`,
`MultiSolid`) already index surfaces at each nesting depth; a helper
`surfaceAppearance(geom.material, geom.texture, path, ringLengths, ctx)`
reads the entries at the same path (material values sit two levels shallower
than boundaries, texture values at the same depth) and returns `{ material?,
texture? }` for that surface. Robustness rules:

- `material.<theme>.value` (scalar) applies to every surface of the geometry;
  `values` is walked by path; `null` or out-of-range → no entry.
- texture: the exterior ring's first value is the texture index; `null` or
  missing → untextured. Each ring's UV index list must have exactly
  `ring.length` entries and every index must resolve; otherwise the surface
  is untextured in that theme (never throw on appearance data — geometry
  still renders).
- Theme names are collected into `textureThemes`/`materialThemes` while
  walking, so a theme referenced by no surface never shows up in the UI.

`parseCityJSON` registers `root.appearance` once; `parseCityJSONSeq`
registers each feature's `appearance` (feature-local, per spec). Header-line
appearance is also registered if present (spec-tolerant, costs nothing).

### 3. Mesh arrays (`navara-core`, `geometry/buildCityMeshArrays.ts`)

New trailing parameter `appearance: AppearanceTheme | null = null` and two
optional outputs on `CityMeshArrays`:

```ts
readonly uvs: Float32Array | null;                 // 2 per vertex; texture kind only
readonly textureGroups: ReadonlyArray<TextureGroup> | null; // texture kind only
// TextureGroup = { start: number; count: number; textureIndex: number }  (vertex ranges)
```

- **material theme**: `colors` for a surface with a material entry in that
  theme are the material's `diffuseColor` converted sRGB→linear (existing
  `srgb.ts` helper); other surfaces keep the semantic colour. No other output
  changes, so rules override matched surfaces exactly as today and unmatched
  surfaces show the material colour.
- **texture theme**: surfaces are written **sorted by texture index** (−1 =
  untextured first, stable within a bucket) so each texture is one contiguous
  vertex range → one `TextureGroup`. `uvs` carries the UV per vertex (0,0 for
  untextured vertices). `colors` stays semantic (the fallback if an image
  fails). The sort is only applied under a texture theme, so the untextured
  output stays byte-identical to today (existing tests unchanged).
- `triangulateSurface(rings, bbox, uvRings?)` reverses the exterior UV ring
  whenever it reverses the exterior ring, and reverses a hole's UV ring
  whenever it reverses that hole; returns `uvs` in lock-step with
  `vertices`.

### 4. Mesh classes (`@cityjson/navara-cityjson`)

`AddCityModelOptions` gains:

```ts
readonly appearance?: AppearanceTheme | null;
/** Dataset URL that relative texture paths resolve against; null for local files. */
readonly textureBaseUrl?: string | null;
/** Injected seam; default = three's TextureLoader. Node tests inject a fake. */
readonly textureSource?: TextureSource;
```

`CityModelHandle.setAppearance(theme: AppearanceTheme | null)` rebuilds the
geometry (same path as `setLod`).

`CityModelMesh`:

- `geometryFromMeshArrays` adds a `uv` attribute when `uvs` is present and
  `addGroup` per `textureGroups` entry, materialIndex = position in the
  material array. Material array = `[plain, ...one MeshBasicMaterial per
textured group]`, each `{ vertexColors: true, side: DoubleSide }`; the
  textured ones receive `map` when the image loads (`colorSpace =
SRGBColorSpace`, wrap from `wrapMode`, anisotropy 4), `needsUpdate = true`.
- A per-mesh **texture cache** keyed by model texture index survives LoD
  rebuilds and is disposed on `delete()` or on a change of theme.
- A per-vertex **texture mask** (from `textureGroups`) makes `repaint()`
  write **white** over textured vertices whose image is loaded, so the map
  shows unmodulated; selection/hover overlays still write their colour on
  top, so highlight tints the texture. Vertices whose image is still loading
  or failed keep the semantic (or rule) colour — progressive and honest.
  Consequence: while a texture theme is active, **rule colours are visible
  only on untextured surfaces**; the Rules tab says so in one sentence.
- `ThemeStyleController` applies its tint to every material in the array
  (today it casts to a single `MeshBasicMaterial`).
- `resolveRaycast` is unchanged (three handles groups).
- Texture URL resolution: `new URL(image, textureBaseUrl)`; a relative image
  with no base URL, or an invalid URL, is a failed texture (plain colours,
  one `console.warn` per layer, never an exception).

`CityMeshArraysMesh` (streaming cell mesh) gets the same group/material/mask
machinery through a shared helper module (`texturedMaterials.ts`) — used in
phase 2.

### 5. App

- `Layer` gains `appearanceThemes: ReadonlyArray<AppearanceTheme>` (texture
  themes first, then material themes, computed by `addLayer` from
  `model.appearance`) and `selectedAppearance: AppearanceTheme | null`.
  Default on load: `defaultTextureTheme` → first texture theme →
  `defaultMaterialTheme` → first material theme → null. A textured dataset
  therefore shows its textures immediately.
- `setLayerAppearance(layerId, theme | null)` store action; `AddLayerInput`
  accepts `selectedAppearance` (used by restore).
- `AppearanceSelector` (`ui/sidebar/AppearanceSelector.tsx`), a `<select>`
  styled like `.lod-select`, rendered next to `LodSelector` only when
  `appearanceThemes.length > 0`. Options: "None", then each theme labelled
  `Texture: <name>` / `Material: <name>`. For a file-backed layer with a
  texture theme selected the control's `title` explains that relative image
  paths cannot be resolved from a local file.
- `handleSync.syncLayers`: `LiveLayer.appearance` compared by kind+name;
  pushes `handle.setAppearance`. `NavaraViewport`'s registry `add` passes
  `appearance: layer.selectedAppearance` and `textureBaseUrl` from
  `layer.modelRef` (`url` → the URL; `file` → null).
- Persistence: `LayerSnapshot.appearance?: AppearanceTheme | null` (additive,
  version stays "3"); captured in `App`'s snapshot, restored through
  `LayerOverrides.selectedAppearance` (applied only if the theme exists on
  the reloaded model, like `selectedLod`).
- Attribution: unchanged (textures are the dataset's own content).

### 6. Later formats (each its own plan section)

- **FlatCityBuf** (phase 2): the worker already turns each feature into a
  `CityJSONFeature` and reuses `parseCityObject`/`buildCityMeshArrays`. The
  `open` message carries the selected theme; `setAppearance` becomes a
  worker message that bumps the epoch (like `setRules`). `CellGeometry`
  gains `uvs`, `textureGroups` and a cell-local `textures: CityTexture[]`
  table; the main thread resolves URLs against the `.fcb` URL and shares
  loaded textures across cells via a per-layer cache keyed by resolved URL.
  The ladder message also reports the discovered theme names so the layer
  row can offer them (`appearanceThemes` is learned, like the LoD ladder).
- **CityParquet** (phase 3): project the `material_lod*`/`texture_lod*` JSON
  columns paired with each geometry column; load the `materials.parquet` /
  `textures.parquet` sidecars declared by the manifest (id → row); map
  sidecar ids to model indices through the same `AppearanceMerger`; UV pairs
  are inline. `appearance_defaults` from the footer supplies the defaults.
- **CityGML** (phase 4): parse `app:Appearance` (theme), `app:X3DMaterial`
  (`diffuseColor`, targets) and `app:ParameterizedTexture` (`imageURI`,
  `wrapMode`, `app:target uri`, `app:textureCoordinates ring`), keyed by
  polygon and ring `gml:id`; one UV per `posList` vertex with the closing
  duplicate dropped alongside the closing vertex. Feeds the same domain
  types; the base URL is the `.gml` URL (or the ZIP's URL for archives).

## Error handling

Appearance data never blocks geometry: malformed entries degrade to
"untextured surface", failed images degrade to semantic colours with one
warning per layer, and a local-file layer simply shows colours. A theme that
disappears on restore (different file) falls back to the load default.

## Testing

- navara-core: parser tests on a fixture cut from Rotterdam's first two
  features (texture) plus a hand-written static CityJSON with a material
  theme and a Solid; merger dedupe; `surfaceAppearance` path walking incl.
  `value` scalar, `null`, bad lengths; `buildCityMeshArrays` UV lock-step
  under exterior/hole reversal, group contiguity and sort stability,
  material colours, byte-identical output when no theme is set.
- navara-cityjson: `CityModelMesh` under a fake `TextureSource` — groups and
  materials created, mask painted white on load, restored on failure,
  `setAppearance` rebuild, dispose on delete; theme-style tint across the
  array.
- app: `layerStore` defaults and action; `AppearanceSelector` rendering and
  propagation-stop; `handleSync` push on change only; snapshot capture and
  restore; URL resolution against the model reference.
- Browser smoke (Rotterdam on the dev server): textures visible and upright,
  "None" restores colours, LoD/theme switch, pick still resolves a surface,
  save/restore keeps the theme.
