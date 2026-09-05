# Appearance (textures + materials) — implementation plan

Spec: `docs/superpowers/specs/2026-09-03-appearance-textures-materials-design.md`.
Submodule-first commits (plugin packages), then the app with the gitlink bump.
Every task: tests first, `pnpm typecheck` / `npx tsc -b --noEmit`, vitest green.

## Phase 1 — CityJSONSeq + CityJSON (Rotterdam end to end)

1. **Core types + merger** (`navara-core/src/citymodel/types.ts`,
   `citymodel/cityjson/appearance.ts`): `CityMaterial`, `CityTexture`,
   `CityAppearance`, `SurfaceTexture`, `AppearanceTheme`; `AppearanceMerger`
   (register local appearance → remaps + uvs; dedupe; `build()`);
   `normalizeRawAppearance` (tolerant reader of the wire object). Tests.
2. **Surface appearance walker** (`parseHelpers.ts`): `surfaceAppearance`
   for Multi/Composite/Solid/MultiSolid depths, `value` scalar, nulls,
   length mismatches; `parseCityObject(..., ctx?)` fills `Surface.material`
   / `Surface.texture`; theme discovery. Tests with a Rotterdam-derived
   fixture (`fixtures/rotterdam-two-textured.city.jsonl`) and a hand-written
   material fixture with a Solid.
3. **Parsers**: `parseCityJSON` (root appearance), `parseCityJSONSeq`
   (per-feature + header). Model gets `appearance`. Tests.
4. **Mesh arrays** (`buildCityMeshArrays.ts`): `appearance` param, `uvs`,
   `textureGroups`, texture-sorted write, UV reversal lock-step, material
   diffuse colours. Existing tests untouched; new tests.
5. **Mesh classes** (`navara-cityjson`): `texturedMaterials.ts` (material
   array, group wiring, mask, texture cache with injected `TextureSource`,
   URL resolution), `cityMeshGeometry.ts` (uv attr + groups),
   `CityModelMesh.setAppearance`, theme-style tint across materials,
   `AddCityModelOptions` + `CityModelHandle` additions, registry pass-through.
   Tests with a fake texture source.
6. **App**: `Layer.appearanceThemes` / `selectedAppearance`, default choice,
   `setLayerAppearance`, `AppearanceSelector`, `LayerPanel` wiring,
   `handleSync` push, `NavaraViewport` registry `add` (theme + base URL),
   persistence field + capture + restore, Rules-tab sentence. Tests.
7. **Browser smoke** on Rotterdam (dev server port 5199): textures upright,
   None/texture toggle, LoD switch, pick, save/restore. Fix what it finds.
8. Docs: CLAUDE.md architecture bullet; commit + push submodule, bump
   gitlink, commit app.

## Phase 2 — FlatCityBuf streaming

9. Worker protocol: `open` carries `appearance`; `setAppearance` message;
   `CellGeometry` + `uvs`/`textureGroups`/`textures`; ladder reports themes.
10. `CityMeshArraysMesh` uses `texturedMaterials.ts`; per-layer texture cache
    keyed by resolved URL; `FcbStreamLayerHandle.setAppearance`.
11. App: streaming layers offer learned themes; sync; smoke on a textured
    `.fcb` (convert Rotterdam with the fcb CLI if none is public).

## Phase 3 — CityParquet

12. Reader: project `material_lod*`/`texture_lod*` JSON columns; sidecar
    loading (`materials.parquet`, `textures.parquet`); id→index through the
    merger; `appearance_defaults`. Tests on a small generated package.

## Phase 4 — CityGML

13. Parser: `app:Appearance`/`X3DMaterial`/`ParameterizedTexture` → domain;
    ring-id keyed UVs; base URL for `.gml` and ZIP archives. Tests.
