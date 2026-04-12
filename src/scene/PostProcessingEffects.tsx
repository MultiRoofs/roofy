/**
 * Post-processing effects for the city scene.
 *
 * Renders EffectComposer with volumetric clouds, aerial perspective,
 * lens flare, AGX tone mapping, and SMAA anti-aliasing.
 * Only mounts when atmosphere is active (valid CRS/lat-lon available).
 *
 * Must be placed inside <Atmosphere> for context propagation.
 *
 * Lighting mode: mixed. Google tiles stay effectively unlit/baked while
 * AerialPerspective applies Takram's post-process sun/sky lighting model
 * to match the reference scenes more closely.
 */

import { useEffect, useRef, useState } from "react";
import { Matrix3, Vector2, Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import {
  ToneMappingMode,
  VignetteTechnique,
  type EffectComposer as EffectComposerImpl,
} from "postprocessing";
import { Clouds } from "@takram/three-clouds/r3f";
import { AerialPerspective, LightingMask } from "@takram/three-atmosphere/r3f";
import type { AtmosphereApi } from "@takram/three-atmosphere/r3f";
import { LensFlareEffect } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Color } from "three";
import {
  SceneEffectComposer,
  syncEffectComposerCameraSettings,
} from "./SceneEffectComposer";

const TILE_ALBEDO_SCALE = 2 / Math.PI;

/**
 * Three.js layer used by LightingMask to distinguish light-source lit objects
 * (citymodel meshes, ground plane) from post-process lit objects (Google tiles).
 * Objects on this layer keep their MeshStandardMaterial lighting from SunLight/SkyLight;
 * objects NOT on this layer get post-process lighting from AerialPerspective.
 */
export const LIGHTING_MASK_LAYER = 10;

// Fixed cloud animation velocities (no UI control)
const WEATHER_VELOCITY = new Vector2(0.0002, 0.0001);
const SHAPE_VELOCITY = new Vector3(0.00005, 0, 0.00003);

const LENS_FLARE_OPTS: ConstructorParameters<typeof LensFlareEffect>[0] = {
  blendFunction: BlendFunction.SCREEN,
  enabled: true,
  glareSize: 0.15,
  lensPosition: new Vector3(-25, 6, -60),
  screenRes: new Vector2(0, 0),
  starPoints: 6,
  flareSize: 0.01,
  flareSpeed: 0.01,
  flareShape: 0.01,
  animated: true,
  anamorphic: false,
  colorGain: new Color(2, 2, 2),
  lensDirtTexture: null,
  haloScale: 0.3,
  secondaryGhosts: true,
  aditionalStreaks: true,
  ghostScale: 0.1,
  opacity: 0.8,
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
  const size = useThree((s) => s.size);

  // Manual LensFlareEffect to avoid wrapEffect's JSON.stringify crash
  // (the LensFlare R3F wrapper serializes Three.js objects causing circular ref error)
  const [lensFlareEffect] = useState(
    () => new LensFlareEffect(LENS_FLARE_OPTS),
  );
  const lensFlareRef = useRef(lensFlareEffect);
  const composerRef = useRef<EffectComposerImpl | null>(null);

  // Scratch objects for ECEF→world transform
  const ecefToWorldRotRef = useRef(new Matrix3());
  const projectedPosRef = useRef(new Vector3());
  const raycasterPosRef = useRef(new Vector2());

  // Update lens flare position and occlusion each frame
  useFrame((_, delta) => {
    syncEffectComposerCameraSettings(composerRef.current, camera);

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

    // Occlusion check — only against shadow-casting meshes (skip Sky, Stars, atmosphere)
    raycasterPosRef.current.set(
      projectedPosRef.current.x,
      projectedPosRef.current.y,
    );
    raycaster.setFromCamera(raycasterPosRef.current, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    const occluded = intersects.some(
      (hit) => hit.object.castShadow || hit.object.receiveShadow,
    );

    const uOpacity = effect.uniforms.get("opacity");
    if (uOpacity) {
      const target = occluded ? 0 : 1;
      // Simple lerp toward target
      uOpacity.value += (target - uOpacity.value) * Math.min(delta * 14, 1);
    }
  });

  // LensFlareEffect expects actual canvas pixel dimensions, not world-space viewport units.
  useEffect(() => {
    const effect = lensFlareRef.current;
    if (!effect) return;
    const screenRes = effect.uniforms.get("screenRes");
    if (screenRes) {
      screenRes.value.x = size.width;
      screenRes.value.y = size.height;
    }
  }, [size.width, size.height]);

  // Toggle enabled state on the effect
  useEffect(() => {
    const effect = lensFlareRef.current;
    if (!effect) return;
    const uEnabled = effect.uniforms.get("enabled");
    if (uEnabled) uEnabled.value = lensFlareEnabled;
  }, [lensFlareEnabled]);

  if (!hasAtmosphere) return null;

  return (
    <SceneEffectComposer ref={composerRef} multisampling={0} enableNormalPass>
      <Clouds
        qualityPreset="medium"
        coverage={cloudCoverage}
        localWeatherVelocity={WEATHER_VELOCITY}
        shapeVelocity={SHAPE_VELOCITY}
      />
      <LightingMask selectionLayer={LIGHTING_MASK_LAYER} />
      <AerialPerspective
        sky
        sunLight
        skyLight
        correctGeometricError
        albedoScale={TILE_ALBEDO_SCALE}
      />
      <primitive object={lensFlareEffect} />
      <ToneMapping mode={ToneMappingMode.AGX} exposure={4} />
      <Vignette
        technique={VignetteTechnique.DEFAULT}
        darkness={0.3}
        offset={0.5}
      />
      <SMAA />
    </SceneEffectComposer>
  );
}
