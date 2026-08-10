# Why the scene is too bright and white — diagnosis (2026-08-04)

Reported: "scene looks too bright and white, doesn't need to be this complicated", with
Navara's own `/sky/sun-time` example as the reference look:
<https://navara-preview.reearth.workers.dev/sky/sun-time>.

All evidence below was gathered live with agent-browser against `npm run dev`
(delft.city.jsonl sample loaded, Front-aligned view) and against the reference demo.
Screenshots referenced by name lived in the session scratchpad; the observations are
restated fully enough that re-shooting them is easy.

## Root cause

**The app mixes Navara's two mutually exclusive lighting calibrations, and no single
`toneMappingExposure` can serve both.**

Navara has two ways to shade the world:

1. **Scene-lights path** — `SunLightDesc` (default **intensity 1**, verified in the
   `@navaramap/three-default-descs` 0.0.5 bundle: `{ distance: 300, color: 0xffffff,
applyColor: false, intensity: 1, castShadow: true, ... }`) plus `skyLightProbe`,
   lighting lit materials (our city meshes are `MeshStandardMaterial` with vertex
   colours — `navara-cityjson/src/cityModelMesh.ts`). A white roof facing the sun
   receives ≈ 1× albedo. **This path is calibrated for exposure ≈ 1.**
2. **Physical-atmosphere path** — the precomputed-scattering sky, aerial perspective and
   tone mapping work in radiance-scale units (AP defaults carry `albedoScale: 2/π`).
   **This path is calibrated for exposure ≈ 10** (Navara's samples set 10–60). The
   reference example lights the _ground itself_ through this path:
   `scene.aerialPerspective.update({ aerialPerspective: { irradiance: true } })`, which
   re-shades the g-buffer **albedo** with the atmosphere's sun+sky irradiance
   (`rawEffect.sunLight = rawEffect.skyLight = true`). The AP default is
   `irradiance: false` — we never turn it on.

Our app runs the scene-lights path (sun intensity 1 + sky probe + an app-added ambient
0.6) **and** exposure 10 (`DEFAULT_EXPOSURE`, adopted from Navara's getting-started to
fix the earlier "scene too dark" complaint). Everything lit or unlit-textured is
therefore pushed ~10× past display range and clips to white. The sky alone is correct at
10 — which is exactly the seesaw we measured:

| Exposure     | City mesh (delft)                | OSM basemap         | Sky/atmosphere |
| ------------ | -------------------------------- | ------------------- | -------------- |
| 1            | correct rich colours (red roofs) | correct map colours | dim, dusk-grey |
| 3            | washed                           | washed              | —              |
| 10 (default) | **near-white**                   | **blown to white**  | correct        |

(Top-down and Front-view screenshots; at 10 with basemap "None" the city model is a
plain white strip against the dark globe — unmistakably the mesh itself, not haze.)

## What the reference actually does (`/sky/sun-time` source, read from the deployed bundle)

```ts
const view = new ThreeView({ animation: true }); // no shadow: true
const scene = defaultPlugin.addDefaultPhotorealScene();
scene.aerialPerspective.update({ aerialPerspective: { irradiance: true } });
view.toneMappingExposure = 10;
// Google 3D tiles with model: { maxSse: 40, normals: true }
// NO ambient light, NO clouds effect, NO raster basemap
scene.stars.update({ stars: { intensity: night ? 40 : 1 } }); // only night tweak
```

The tiles are unlit albedo; the AP pass in irradiance mode lights them from the physical
atmosphere; exposure 10 then lands correctly. Other examples on the same site follow the
same pattern (the NYC time-of-day one adds `sun: true, sky: true` to the AP update,
deletes the sky mesh, and swings exposure 20–60 per time of day).

## Contributing factors (each verified by toggling one variable)

- **OSM as default basemap**: near-white cartographic tiles, rendered essentially unlit
  → at exposure 10 the whole ground plane is white. Switching to Esri World Imagery
  (darker albedo) restored a natural-looking ground with everything else unchanged.
- **App-added ambient light 0.6** (`DEFAULT_AMBIENT_INTENSITY`): adds a flat 0.6× albedo
  of energy on top of sun + sky probe. The reference adds no ambient at all.
- **Clouds effect at coverage 0.3**: large grey-white cloud masses over most of the sky.
  Two bugs found here:
  - `setCloudsEnabled(false)` (Advanced Settings toggle → `handle.delete()`) does
    **not** remove the clouds from the frame. Turning the aerial-perspective pass off,
    or the master post-processing switch off, _does_ remove them — i.e. the clouds
    composite through the AP pass and deleting the clouds handle alone is ineffective
    (likely a Navara 0.0.5 bug; needs a minimal repro before reporting upstream).
  - Because of that, the coverage slider and toggle in Advanced Settings are currently
    misleading.
- **AP inscatter haze** whitens the mid/far ground at the default 14:00 sun — legitimate
  atmospheric perspective, but it stacks on top of the exposure blow-out.

## Recommended fix direction (for the implementation pass)

Follow the reference's model instead of fighting it — this also _simplifies_ the scene,
which is what the user asked for:

1. **Adopt the irradiance lighting path**: after `addDefaultPhotorealScene()`, set
   `scene.aerialPerspective.update({ aerialPerspective: { irradiance: true } })`.
2. **Make the city mesh contribute albedo, not lit colour**: switch
   `MeshStandardMaterial` → an unlit material (`MeshBasicMaterial`, keep
   `vertexColors: true`) in `navara-cityjson`/`navara-flatcitybuf` mesh construction, so
   the AP pass shades it exactly like the reference shades Google tiles. AP's
   `useNormalBuffer: true` default needs the mesh normals in the g-buffer — our
   geometry already carries normals, and Google tiles already request
   `model: { normals: true }` (`src/scene/googleTiles.ts`), so the plumbing matches.
   Verify highlight/selection tinting still reads correctly on the new material.
3. **Delete the app-added ambient light** (store field, slider, and viewport effect) —
   it belongs to the lights-path calibration. Keep `DEFAULT_EXPOSURE = 10`.
4. **Default the basemap to Esri World Imagery** (or "None" when Google tiles are on);
   keep OSM as an option but expect it to read bright — it is white paper in sunlight
   under this calibration. Re-evaluate after (1)–(3): the AP pass shades the globe too
   (the engine keeps a `globeNormalTexture`), so the basemap may become acceptable.
5. **Clouds**: default the pass off (or coverage well below 0.3) to match the reference
   look, and fix/replace the broken disable path — until the handle-delete bug is
   understood, drive it through the AP/post-processing visibility that demonstrably
   works, and re-check the coverage slider.
6. After the switch, re-tune only against the reference at the same sun time
   (14:00 vs the demo's slider) rather than against memory of the old scene.

Milestone-8 note: the exposure-10 comment block in `renderDebugStore.ts` and
`NavaraViewport.tsx` ("THE fix for 'the scene is far darker'") describes the _previous_
symptom; this document supersedes its rationale — exposure 10 is right, the lighting
model underneath it was wrong.

## Repro/verification recipe

1. `npm run dev`, load the Delft sample, press the `F` (Front) align button.
2. `window.__multiroofRenderDebug.getState().setExposure(1)` → buildings/basemap
   normalise, sky goes dark. Back to 10 → sky right, everything else white.
3. Reference for comparison: open the demo URL above, scrub the time slider to ~12h.
4. Clouds bug: `setCloudsEnabled(false)` (no visual change) vs
   `setPostProcessingEnabled(false)` (clouds vanish).

## Implementation outcome (same day) — and one correction to step 1

Steps 1–5 were implemented. Everything above held up **except the assumption in
step 2 that "the plumbing matches" for the aerial-perspective pass's normal
source**. It does not, in Navara 0.0.5:

- Turning irradiance on with the pass's default `useNormalBuffer: true`
  rendered the **entire frame black** — city, globe and imagery alike, at every
  camera angle and every exposure.
- Cause, measured directly with
  `renderer.readRenderTargetPixels(mrt.gbufferRenderTarget, …, textureIndex 1)`:
  with a **raster basemap** on the globe, every texel of the MRT normal
  attachment reads back as half-float **NaN** (`0x7e00`) across the whole
  frame. Navara's `packNormalToVec2` divides by `abs(x)+abs(y)+abs(z)`, so a
  zero normal anywhere in the globe pass yields NaN, and that pass paints it
  over the shared attachment. NaN normals make `GetSunAndSkyIrradiance` NaN.
- With the basemap set to "None" the attachment reads `(0,0,0)` instead, which
  the pass's own `degenerate` test treats as "no normal" and skips lighting
  for — so the irradiance path never engaged there either.
- `reconstructNormal: true` (depth-derivative normals) lights the scene
  correctly, confirming depth/`positionECEF` are fine — but it is not reachable
  through `AerialPerspectiveUpdate`; the effect hardcodes its own options.
- `shadow: false` on the `ThreeView` (the one other difference from the
  reference example) makes no difference; it is not the cause.

So the shipped call is
`update({ aerialPerspective: { irradiance: true, useNormalBuffer: false } })`.
The shader then lights every fragment by the **ellipsoid normal**
(`normalize(positionECEF)`, straight up). That is stable and correctly exposed,
at the cost of no per-face shading from the atmosphere: a north wall receives
the same irradiance as a south roof. Two upstream bugs to report, with the
`useNormalBuffer` line as the one-line revert once the first is fixed:

1. the globe/raster pass writing NaN into the MRT normal attachment;
2. `EffectDesc.onDestroy()` never disposing its pass, which is what made the
   clouds toggle inert (see `disposeCloudsPass` in `NavaraViewport.tsx`).

Browser-verified after the change (Delft sample, Esri imagery, exposure 10):
daytime-blue sky, satellite ground with natural greens and no blow-out,
distinct salmon/red roofs, and a clouds toggle that adds and removes clouds.
