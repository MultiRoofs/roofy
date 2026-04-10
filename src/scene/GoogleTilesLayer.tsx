/**
 * Google Photorealistic 3D Tiles background layer.
 *
 * Renders 3D tiles in local-origin space by applying the inverse of
 * worldToECEFMatrix to the tiles group. Tiles use MeshBasicMaterial
 * (baked lighting) to avoid double-lighting with the scene's SunLight.
 *
 * Must be placed inside <Atmosphere> for correct context propagation.
 */

import { useCallback, useMemo } from "react";
import { Mesh, MeshBasicMaterial, Vector3, Quaternion, Matrix4 } from "three";
import type { Object3D } from "three";
import {
  TilesRenderer,
  TilesPlugin,
  TilesAttributionOverlay,
} from "3d-tiles-renderer/r3f";
import {
  GoogleCloudAuthPlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
} from "3d-tiles-renderer/plugins";
import { TileCreasedNormalsPlugin } from "./TileCreasedNormalsPlugin";

// Read at module init — Vite replaces at build time
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
let warnedOnce = false;
export const TILE_CREASE_ANGLE = Math.PI / 6;

// Scratch objects for matrix decomposition (avoid allocation per render)
const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();

interface GoogleTilesLayerProps {
  readonly worldToECEFMatrix: Matrix4;
}

interface TilesPluginSpec {
  readonly plugin: unknown;
  readonly args?: object;
}

export function getGoogleTilesPluginSpecs(apiKey: string): TilesPluginSpec[] {
  return [
    {
      plugin: GoogleCloudAuthPlugin,
      args: { apiToken: apiKey },
    },
    { plugin: GLTFExtensionsPlugin },
    { plugin: TileCompressionPlugin },
    { plugin: UpdateOnChangePlugin },
    { plugin: TilesFadePlugin },
    {
      plugin: TileCreasedNormalsPlugin,
      args: { creaseAngle: TILE_CREASE_ANGLE },
    },
  ];
}

export function GoogleTilesLayer({ worldToECEFMatrix }: GoogleTilesLayerProps) {
  // Decompose inverse(worldToECEFMatrix) into position/quaternion/scale
  // so R3F can apply them to the tiles group via the `group` prop
  const groupProps = useMemo(() => {
    const inverse = worldToECEFMatrix.clone().invert();
    inverse.decompose(_pos, _quat, _scale);
    return {
      position: _pos.clone(),
      quaternion: _quat.clone(),
      scale: _scale.clone(),
    };
  }, [worldToECEFMatrix]);

  // Swap loaded tile materials to MeshBasicMaterial (baked lighting)
  const handleLoadModel = useCallback(({ scene }: { scene: Object3D }) => {
    scene.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      child.material = materials.map((m) => {
        if (m instanceof MeshBasicMaterial) return m;
        const basic = new MeshBasicMaterial({
          map: m.map ?? undefined,
          side: m.side,
          transparent: m.transparent,
          opacity: m.opacity,
          alphaTest: m.alphaTest,
        });
        m.dispose();
        return basic;
      });
      // Flatten single-element array
      if (Array.isArray(child.material) && child.material.length === 1) {
        child.material = child.material[0]!;
      }
    });
  }, []);

  // Clean up custom materials when tiles unload
  const handleDisposeModel = useCallback(({ scene }: { scene: Object3D }) => {
    scene.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const m of materials) {
        m.dispose();
      }
    });
  }, []);

  if (!API_KEY) {
    if (import.meta.env.DEV && !warnedOnce) {
      warnedOnce = true;
      console.warn(
        "[GoogleTilesLayer] VITE_GOOGLE_MAPS_API_KEY not set. Tiles disabled.",
      );
    }
    return null;
  }

  const pluginSpecs = getGoogleTilesPluginSpecs(API_KEY);

  return (
    <TilesRenderer
      onLoadModel={handleLoadModel}
      onDisposeModel={handleDisposeModel}
      group={groupProps as never}
    >
      {pluginSpecs.map((spec) => (
        <TilesPlugin
          key={String((spec.plugin as { name?: string }).name ?? "plugin")}
          plugin={spec.plugin as never}
          args={spec.args as never}
        />
      ))}
      <TilesAttributionOverlay />
    </TilesRenderer>
  );
}
