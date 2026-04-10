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

import { useEffect, useRef, useState } from "react";
import { Matrix3, Vector2, Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Clouds } from "@takram/three-clouds/r3f";
import { AerialPerspective } from "@takram/three-atmosphere/r3f";
import type { AtmosphereApi } from "@takram/three-atmosphere/r3f";
import { LensFlareEffect } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Color } from "three";

// Fixed cloud animation velocities (no UI control)
const WEATHER_VELOCITY = new Vector2(0.0002, 0.0001);
const SHAPE_VELOCITY = new Vector3(0.00005, 0, 0.00003);

const LENS_FLARE_OPTS: ConstructorParameters<typeof LensFlareEffect>[0] = {
  blendFunction: BlendFunction.NORMAL,
  enabled: true,
  glareSize: 0.2,
  lensPosition: new Vector3(-25, 6, -60),
  screenRes: new Vector2(0, 0),
  starPoints: 6,
  flareSize: 0.01,
  flareSpeed: 0.01,
  flareShape: 0.01,
  animated: true,
  anamorphic: false,
  colorGain: new Color(20, 20, 20),
  lensDirtTexture: null,
  haloScale: 0.5,
  secondaryGhosts: true,
  aditionalStreaks: true,
  ghostScale: 0.0,
  opacity: 1.0,
  starBurst: false,
};

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
  const scene = useThree((s) => s.scene);
  const raycaster = useThree((s) => s.raycaster);
  const viewport = useThree((s) => s.viewport);

  // Manual LensFlareEffect to avoid wrapEffect's JSON.stringify crash
  // (the LensFlare R3F wrapper serializes Three.js objects causing circular ref error)
  const [lensFlareEffect] = useState(
    () => new LensFlareEffect(LENS_FLARE_OPTS),
  );
  const lensFlareRef = useRef(lensFlareEffect);

  // Scratch objects for ECEF→world transform
  const ecefToWorldRotRef = useRef(new Matrix3());
  const projectedPosRef = useRef(new Vector3());
  const raycasterPosRef = useRef(new Vector2());

  // Update lens flare position and occlusion each frame
  useFrame((_, delta) => {
    const api = atmosphereRef.current;
    const effect = lensFlareRef.current;
    if (!api || !effect || !lensFlareEnabled) return;

    // Transform sun direction from ECEF to world space
    ecefToWorldRotRef.current.setFromMatrix4(api.worldToECEFMatrix).transpose();
    const sunWorldDir = new Vector3()
      .copy(api.sunDirection)
      .applyMatrix3(ecefToWorldRotRef.current)
      .normalize();

    // Project sun to screen space
    const sunPos = sunWorldDir.clone().multiplyScalar(camera.far * 0.9);
    projectedPosRef.current.copy(sunPos).project(camera);
    if (projectedPosRef.current.z > 1) return; // behind camera

    // Update lens position uniform
    const uLensPos = effect.uniforms.get("lensPosition");
    if (uLensPos) {
      uLensPos.value.x = projectedPosRef.current.x;
      uLensPos.value.y = projectedPosRef.current.y;
    }

    // Occlusion check
    raycasterPosRef.current.set(
      projectedPosRef.current.x,
      projectedPosRef.current.y,
    );
    raycaster.setFromCamera(raycasterPosRef.current, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    const occluded =
      intersects.length > 0 &&
      intersects[0]!.object instanceof Object &&
      intersects[0]!.object.userData?.lensflare !== "no-occlusion";

    const uOpacity = effect.uniforms.get("opacity");
    if (uOpacity) {
      const target = occluded ? 0 : 1;
      // Simple lerp toward target
      uOpacity.value += (target - uOpacity.value) * Math.min(delta * 14, 1);
    }
  });

  // Update screen resolution when viewport changes
  useEffect(() => {
    const effect = lensFlareRef.current;
    if (!effect) return;
    const screenRes = effect.uniforms.get("screenRes");
    if (screenRes) {
      screenRes.value.x = viewport.width;
      screenRes.value.y = viewport.height;
    }
  }, [viewport.width, viewport.height]);

  // Toggle enabled state on the effect
  useEffect(() => {
    const effect = lensFlareRef.current;
    if (!effect) return;
    const uEnabled = effect.uniforms.get("enabled");
    if (uEnabled) uEnabled.value = lensFlareEnabled;
  }, [lensFlareEnabled]);

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
      <primitive object={lensFlareEffect} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <SMAA />
    </EffectComposer>
  );
}
