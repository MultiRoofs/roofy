/**
 * Post-processing effects for the city scene.
 *
 * Renders EffectComposer with volumetric clouds, aerial perspective,
 * and SMAA anti-aliasing. Only mounts when atmosphere is active
 * (valid CRS/lat-lon available).
 *
 * Must be placed inside <Atmosphere> for context propagation.
 *
 * Lighting mode: light-source (SunLight + MeshStandardMaterial).
 * AerialPerspective runs without sunLight/skyLight props to avoid
 * double-lighting. May add LightingMask for mixed lighting later.
 */

import { EffectComposer, SMAA } from "@react-three/postprocessing";
import { Clouds } from "@takram/three-clouds/r3f";
import { AerialPerspective } from "@takram/three-atmosphere/r3f";

interface PostProcessingEffectsProps {
  readonly hasAtmosphere: boolean;
  readonly cloudCoverage: number;
}

export function PostProcessingEffects({
  hasAtmosphere,
  cloudCoverage,
}: PostProcessingEffectsProps) {
  if (!hasAtmosphere) return null;

  return (
    <EffectComposer multisampling={0} enableNormalPass>
      <Clouds qualityPreset="medium" coverage={cloudCoverage} />
      <AerialPerspective />
      <SMAA />
    </EffectComposer>
  );
}
