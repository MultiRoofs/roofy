/**
 * Post-processing effects for the city scene.
 *
 * Renders EffectComposer with volumetric clouds, aerial perspective,
 * lens flare, AGX tone mapping, and SMAA anti-aliasing.
 * Only mounts when atmosphere is active (valid CRS/lat-lon available).
 *
 * Must be placed inside <Atmosphere> for context propagation.
 *
 * Lighting mode: light-source (SunLight + MeshStandardMaterial).
 * AerialPerspective runs without sunLight/skyLight props to avoid
 * double-lighting. May add LightingMask for mixed lighting later.
 */

import { useRef } from "react";
import { Matrix3, Vector2, Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Clouds } from "@takram/three-clouds/r3f";
import { AerialPerspective } from "@takram/three-atmosphere/r3f";
import type { AtmosphereApi } from "@takram/three-atmosphere/r3f";
import { LensFlare } from "@react-three/postprocessing";

// Fixed cloud animation velocities (no UI control)
const WEATHER_VELOCITY = new Vector2(0.0002, 0.0001);
const SHAPE_VELOCITY = new Vector3(0.00005, 0, 0.00003);

interface PostProcessingEffectsProps {
  readonly hasAtmosphere: boolean;
  readonly cloudCoverage: number;
  readonly lensFlareEnabled: boolean;
  readonly atmosphereRef: React.RefObject<AtmosphereApi | null>;
}

export function PostProcessingEffects({
  hasAtmosphere,
  cloudCoverage,
  lensFlareEnabled,
  atmosphereRef,
}: PostProcessingEffectsProps) {
  const camera = useThree((s) => s.camera);

  // Stable objects for per-frame lens flare position update
  const sunWorldPosRef = useRef(new Vector3());
  const ecefToWorldRotRef = useRef(new Matrix3());

  // Update sun position for lens flare each frame (ECEF → world space)
  useFrame(() => {
    const api = atmosphereRef.current;
    if (!api) return;
    // Extract rotation from worldToECEFMatrix and transpose to get ECEF→world
    ecefToWorldRotRef.current.setFromMatrix4(api.worldToECEFMatrix).transpose();
    // Transform sun direction from ECEF to world space
    sunWorldPosRef.current
      .copy(api.sunDirection)
      .applyMatrix3(ecefToWorldRotRef.current)
      .normalize()
      .multiplyScalar(camera.far * 0.9);
  });

  if (!hasAtmosphere) return null;

  return (
    <EffectComposer multisampling={0} enableNormalPass>
      <Clouds
        qualityPreset="medium"
        coverage={cloudCoverage}
        localWeatherVelocity={WEATHER_VELOCITY}
        shapeVelocity={SHAPE_VELOCITY}
      />
      <AerialPerspective />
      <LensFlare
        lensPosition={sunWorldPosRef.current}
        enabled={lensFlareEnabled}
      />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <SMAA />
    </EffectComposer>
  );
}
