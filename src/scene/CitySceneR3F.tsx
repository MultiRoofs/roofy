/**
 * React Three Fiber version of CityScene.
 *
 * Renders multi-layer city models using R3F declarative components.
 * Integrates drei Sky for atmosphere and sun visualization.
 * Preserves the CitySceneHandle contract for App.tsx compatibility.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Sky } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  BufferGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import type { BBox3 } from "../domain/citymodel/types";
import { buildCityMesh, computeOriginOffset } from "./buildCityMesh";
import type { PickingIndex } from "./buildCityMesh";
import { applyHighlight, clearHighlight } from "./highlightMesh";
import { buildRuleColors } from "./applyRuleColors";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useLayerStore } from "../features/layers/layerStore";
import type { Layer } from "../features/layers/layerStore";
import { useSolarStore } from "../features/solar/solarStore";
import type { Selection } from "../domain/selection/types";
import type { Rule } from "../features/rules/types";
import { OrbitTargetGizmo } from "./OrbitTargetGizmo";

// Re-export for consumers
export type { CitySceneHandle, CitySceneProps };

/** Per-layer GPU state tracked in a ref map. */
export interface LayerSceneState {
  mesh: Mesh;
  pickingIndex: PickingIndex;
  baseColors: Float32Array;
  selectedLod: string | null;
  ruleColors: Float32Array | null;
}

interface CitySceneHandle {
  fitAll: () => void;
  getCameraState: () => {
    position: readonly [number, number, number];
    target: readonly [number, number, number];
  } | null;
  setCameraState: (
    position: readonly [number, number, number],
    target: readonly [number, number, number],
  ) => void;
}

interface CitySceneProps {
  readonly onTriangleCount: (count: number) => void;
  readonly showOrbitGizmo?: boolean;
}

// ---------------------------------------------------------------------------
// Outer wrapper — renders Canvas + overlay tooltip
// ---------------------------------------------------------------------------

export const CityScene = forwardRef<CitySceneHandle, CitySceneProps>(
  function CityScene({ onTriangleCount, showOrbitGizmo }, ref) {
    const layers = useLayerStore((s) => s.layers);
    const hovered = useSelectionStore((s) => s.hovered);

    const hoveredLayer = hovered
      ? layers.find((l) => l.id === hovered.layerId)
      : undefined;
    const hoveredObject =
      hoveredLayer && hovered
        ? hoveredLayer.model.objects[hovered.objectId]
        : undefined;

    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <Canvas
          camera={{ fov: 60, near: 0.1, far: 10000, position: [50, 50, 50] }}
          shadows="soft"
          gl={{ antialias: true }}
          onCreated={({ gl, raycaster }) => {
            gl.setClearColor(readCssColor("--bg-viewport", "#0a0c12"));
            raycaster.firstHitOnly = true;
            raycaster.params.Line = { threshold: 0.1 };
          }}
        >
          <CitySceneInner
            ref={ref}
            onTriangleCount={onTriangleCount}
            showOrbitGizmo={showOrbitGizmo}
          />
        </Canvas>
        {hoveredObject && hovered && (
          <div className="pick-tooltip">
            <span className="obj-type">{hoveredObject.objectType}</span>
            <span className="obj-id">{truncateId(hovered.objectId)}</span>
          </div>
        )}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Inner scene — runs inside Canvas, has access to useThree
// ---------------------------------------------------------------------------

interface InnerProps {
  readonly onTriangleCount: (count: number) => void;
  readonly showOrbitGizmo?: boolean;
}

const CitySceneInner = forwardRef<CitySceneHandle, InnerProps>(
  function CitySceneInner({ onTriangleCount, showOrbitGizmo }, ref) {
    const { camera, gl } = useThree();
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const cityGroupRef = useRef<Group>(null);
    const dirLightRef = useRef<DirectionalLight>(null);
    const layerSceneMapRef = useRef<Map<string, LayerSceneState>>(new Map());

    // Theme-aware clear color with proper cleanup
    useEffect(() => {
      const updateClearColor = () => {
        gl.setClearColor(readCssColor("--bg-viewport", "#0a0c12"));
      };
      updateClearColor();
      const obs = new MutationObserver(updateClearColor);
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      return () => obs.disconnect();
    }, [gl]);

    const layers = useLayerStore((s) => s.layers);
    const selection = useSelectionStore((s) => s.selection);
    const hovered = useSelectionStore((s) => s.hovered);
    const sunPosition = useSolarStore((s) => s.sunPosition);

    // Manage per-layer meshes: add/remove/visibility/LoD rebuild
    useEffect(() => {
      const cityGroup = cityGroupRef.current;
      if (!cityGroup) return;

      const map = layerSceneMapRef.current;
      const currentIds = new Set(layers.map((l) => l.id));

      // Remove meshes for deleted layers
      for (const id of map.keys()) {
        if (!currentIds.has(id)) {
          const state = map.get(id)!;
          cityGroup.remove(state.mesh);
          state.mesh.geometry.dispose();
          if (state.mesh.material instanceof MeshStandardMaterial) {
            state.mesh.material.dispose();
          }
          map.delete(id);
        }
      }

      // Add or rebuild meshes for new layers or LoD changes
      let needsFit = false;
      const hadLayersBefore = map.size > 0;
      let solarInitialized = false;
      for (const layer of layers) {
        const existing = map.get(layer.id);
        const lodChanged =
          existing !== undefined && existing.selectedLod !== layer.selectedLod;

        if (lodChanged && existing) {
          cityGroup.remove(existing.mesh);
          existing.mesh.geometry.dispose();
          if (existing.mesh.material instanceof MeshStandardMaterial) {
            existing.mesh.material.dispose();
          }
          map.delete(layer.id);
        }

        if (!map.has(layer.id)) {
          const model = layer.model;
          if (Object.keys(model.objects).length === 0) continue;

          const originOffset = computeOriginOffset(model);
          const { geometry, pickingIndex, baseColors } = buildCityMesh(
            model,
            layer.id,
            originOffset,
            layer.selectedLod,
          );

          const material = new MeshStandardMaterial({
            vertexColors: true,
            flatShading: true,
          });

          const mesh = new Mesh(geometry, material);
          mesh.userData.layerId = layer.id;
          mesh.rotation.x = -Math.PI / 2;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.visible = layer.visible;
          cityGroup.add(mesh);

          map.set(layer.id, {
            mesh,
            pickingIndex,
            baseColors,
            ruleColors: null,
            selectedLod: layer.selectedLod,
          });

          if (!hadLayersBefore && !solarInitialized) {
            if (model.bbox && dirLightRef.current) {
              configureShadowCamera(dirLightRef.current, model.bbox);
              geometry.computeBoundingSphere();
            }
            useSolarStore
              .getState()
              .initFromModel(model.metadata.referenceSystem, model.bbox);
            solarInitialized = true;
          }

          needsFit = !lodChanged;
        }
      }

      // Update visibility
      for (const layer of layers) {
        const state = map.get(layer.id);
        if (state) state.mesh.visible = layer.visible;
      }

      // Update triangle count
      let totalTriangles = 0;
      for (const layer of layers) {
        const state = map.get(layer.id);
        if (state && layer.visible) {
          const posAttr = state.mesh.geometry.getAttribute("position");
          if (posAttr) totalTriangles += posAttr.count / 3;
        }
      }
      onTriangleCount(totalTriangles);

      // Fit camera on first load
      if (needsFit && controlsRef.current) {
        const bbox = computeUnionBBox(layers);
        if (bbox)
          fitCamera(camera as PerspectiveCamera, controlsRef.current, bbox);
      }

      // Clear selection if layer was removed
      const sel = useSelectionStore.getState().selection;
      if (sel && !currentIds.has(sel.layerId)) {
        useSelectionStore.getState().clear();
      }
    }, [layers, onTriangleCount, camera]);

    // Rule colors
    useEffect(() => {
      const map = layerSceneMapRef.current;
      for (const layer of layers) {
        const state = map.get(layer.id);
        if (!state) continue;
        if (layer.rulesEnabled && layer.rules.length > 0) {
          state.ruleColors = buildRuleColors(
            layer.model,
            state.mesh.geometry,
            state.pickingIndex,
            layer.rules as Rule[],
            state.baseColors,
          );
        } else {
          state.ruleColors = null;
        }
      }
      reapplyHighlight(map, layers);
    }, [layers]);

    // Highlight on selection/hover change
    useEffect(() => {
      reapplyHighlight(layerSceneMapRef.current, layers);
    }, [selection, hovered, layers]);

    // Sun position → directional light + sky sun direction
    const sunDir = useMemo(() => {
      if (!sunPosition) return new Vector3(0, 1, 0);
      return new Vector3(...sunPosition.direction);
    }, [sunPosition]);

    useEffect(() => {
      const light = dirLightRef.current;
      if (!light || !sunPosition) return;

      let dist = 500;
      for (const state of layerSceneMapRef.current.values()) {
        const r = state.mesh.geometry.boundingSphere?.radius;
        if (r && r > dist) dist = r;
      }
      const lightDist = Math.max(dist * 2, 100);

      if (sunPosition.altitudeDeg > 0) {
        light.position.copy(sunDir.clone().multiplyScalar(lightDist));
        light.intensity = 0.8;
        light.castShadow = true;
        light.shadow.camera.near = lightDist * 0.1;
        light.shadow.camera.far = lightDist * 3;
      } else {
        light.position.set(0, 10, 0);
        light.intensity = 0.1;
        light.castShadow = false;
      }
      light.shadow.camera.updateProjectionMatrix();
    }, [sunPosition, sunDir]);

    // Picking via R3F pointer events on the city group
    const handlePointerMove = useCallback(
      (e: {
        stopPropagation: () => void;
        face: { a: number } | null;
        object: { userData: { layerId?: string }; geometry: BufferGeometry };
      }) => {
        e.stopPropagation();
        const sel = resolveFromEvent(e, layerSceneMapRef.current);
        useSelectionStore.getState().hover(sel);
      },
      [],
    );

    const handlePointerUp = useCallback(
      (e: {
        stopPropagation: () => void;
        face: { a: number } | null;
        object: { userData: { layerId?: string }; geometry: BufferGeometry };
      }) => {
        e.stopPropagation();
        const sel = resolveFromEvent(e, layerSceneMapRef.current);
        useSelectionStore.getState().select(sel);
      },
      [],
    );

    // Clear hover when pointer leaves city group
    const handlePointerLeave = useCallback(() => {
      useSelectionStore.getState().hover(null);
    }, []);

    // Imperative handle
    const fitAll = useCallback(() => {
      if (controlsRef.current) {
        const bbox = computeUnionBBox(layers);
        if (bbox)
          fitCamera(camera as PerspectiveCamera, controlsRef.current, bbox);
      }
    }, [layers, camera]);

    const getCameraState = useCallback(() => {
      if (!controlsRef.current) return null;
      return {
        position: [
          camera.position.x,
          camera.position.y,
          camera.position.z,
        ] as const,
        target: [
          controlsRef.current.target.x,
          controlsRef.current.target.y,
          controlsRef.current.target.z,
        ] as const,
      };
    }, [camera]);

    const setCameraState = useCallback(
      (
        position: readonly [number, number, number],
        target: readonly [number, number, number],
      ) => {
        if (!controlsRef.current) return;
        camera.position.set(position[0], position[1], position[2]);
        controlsRef.current.target.set(target[0], target[1], target[2]);
        controlsRef.current.update();
      },
      [camera],
    );

    useImperativeHandle(
      ref,
      () => ({ fitAll, getCameraState, setCameraState }),
      [fitAll, getCameraState, setCameraState],
    );

    // Sky sun position (scaled far away for visual effect)
    const skySunPosition = useMemo(
      () => sunDir.clone().multiplyScalar(450000),
      [sunDir],
    );

    return (
      <>
        {/* Lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight
          ref={dirLightRef}
          position={[50, 100, 50]}
          intensity={0.8}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={0.5}
          shadow-camera-far={2000}
        />

        {/* Sky */}
        <Sky
          sunPosition={skySunPosition}
          distance={450000}
          turbidity={8}
          rayleigh={2}
          mieCoefficient={0.005}
          mieDirectionalG={0.8}
        />

        {/* City meshes group — picking events */}
        <group
          ref={cityGroupRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />

        {/* Controls */}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.1}
        />

        {/* Orbit target gizmo */}
        {showOrbitGizmo && <OrbitTargetGizmo controlsRef={controlsRef} />}
      </>
    );
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveFromEvent(
  e: {
    face: { a: number } | null;
    object: { userData: { layerId?: string }; geometry: BufferGeometry };
  },
  map: Map<string, LayerSceneState>,
): Selection | null {
  if (!e.face) return null;
  const layerId = e.object.userData.layerId;
  if (!layerId) return null;
  const state = map.get(layerId);
  if (!state) return null;

  const mode = useSelectionStore.getState().mode;
  const faceVertexIndex = e.face.a;

  const objIdxAttr = e.object.geometry.getAttribute("objectIndex");
  const surfIdxAttr = e.object.geometry.getAttribute("surfaceIndex");
  if (!objIdxAttr || !surfIdxAttr) return null;

  const objectIdx = objIdxAttr.getX(faceVertexIndex);
  const objectId = state.pickingIndex.objectKeys[objectIdx];
  if (objectId === undefined) return null;

  if (mode === "surface") {
    const surfaceIndex = surfIdxAttr.getX(faceVertexIndex);
    return { kind: "surface", layerId, objectId, surfaceIndex };
  }
  return { kind: "object", layerId, objectId };
}

function reapplyHighlight(
  map: Map<string, LayerSceneState>,
  layers: ReadonlyArray<Layer>,
): void {
  const { selection: sel, hovered: hov } = useSelectionStore.getState();

  for (const layer of layers) {
    const state = map.get(layer.id);
    if (!state) continue;

    const isTarget =
      (sel && sel.layerId === layer.id) || (hov && hov.layerId === layer.id);

    if (isTarget) {
      applyHighlight(
        state.mesh.geometry,
        state.baseColors,
        sel?.layerId === layer.id ? sel : null,
        hov?.layerId === layer.id ? hov : null,
        state.pickingIndex,
        state.ruleColors,
      );
    } else {
      clearHighlight(state.mesh.geometry, state.baseColors, state.ruleColors);
    }
  }
}

function configureShadowCamera(light: DirectionalLight, bbox: BBox3): void {
  const extentX = bbox[3] - bbox[0];
  const extentY = bbox[4] - bbox[1];
  const extentZ = bbox[5] - bbox[2];
  const halfSize = Math.max(extentX, extentY, extentZ) * 0.7;
  light.shadow.camera.left = -halfSize;
  light.shadow.camera.right = halfSize;
  light.shadow.camera.top = halfSize;
  light.shadow.camera.bottom = -halfSize;
  light.shadow.camera.updateProjectionMatrix();
}

function computeUnionBBox(layers: ReadonlyArray<Layer>): BBox3 | null {
  let result: [number, number, number, number, number, number] | null = null;
  for (const layer of layers) {
    if (!layer.visible || !layer.model.bbox) continue;
    const b = layer.model.bbox;
    if (!result) {
      result = [b[0], b[1], b[2], b[3], b[4], b[5]];
    } else {
      result[0] = Math.min(result[0], b[0]);
      result[1] = Math.min(result[1], b[1]);
      result[2] = Math.min(result[2], b[2]);
      result[3] = Math.max(result[3], b[3]);
      result[4] = Math.max(result[4], b[4]);
      result[5] = Math.max(result[5], b[5]);
    }
  }
  return result;
}

function fitCamera(
  camera: PerspectiveCamera,
  controls: OrbitControlsImpl,
  bbox: BBox3,
): void {
  const extentX = bbox[3] - bbox[0];
  const extentY = bbox[4] - bbox[1];
  const extentZ = bbox[5] - bbox[2];
  const maxExtent = Math.max(extentX, extentY, extentZ);
  const distance = maxExtent * 1.5;
  camera.position.set(distance * 0.7, distance * 0.7, distance * 0.7);
  controls.target.set(0, extentZ / 2, 0);
  controls.update();
}

function truncateId(id: string): string {
  if (id.length <= 24) return id;
  return id.slice(0, 10) + "..." + id.slice(-10);
}

function readCssColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return raw || fallback;
}
