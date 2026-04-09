/**
 * React Three Fiber scene for multi-layer city model viewing.
 *
 * Features: multi-select, box select, measure tool, FPS counter,
 * cursor position tracking, per-layer mesh management, solar lighting.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
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
import type { BBox3, Vec3 } from "../domain/citymodel/types";
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
import { ViewAlignButtons } from "./ViewAlignButtons";
import type { ViewDirection } from "./ViewAlignButtons";

// Re-export for consumers
export type { CitySceneHandle, CitySceneProps };

/** Per-layer GPU state tracked in a ref map. */
export interface LayerSceneState {
  mesh: Mesh;
  pickingIndex: PickingIndex;
  baseColors: Float32Array;
  selectedLod: string | null;
  ruleColors: Float32Array | null;
  originOffset: Vec3;
}

interface CitySceneHandle {
  fitAll: () => void;
  fitLayer: (layerId: string) => void;
  alignView: (direction: ViewDirection) => void;
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
  readonly onFps?: (fps: number) => void;
  readonly onCursorPosition?: (
    pos: readonly [number, number, number] | null,
  ) => void;
}

// ---------------------------------------------------------------------------
// Outer wrapper — renders Canvas + overlays
// ---------------------------------------------------------------------------

export const CityScene = forwardRef<CitySceneHandle, CitySceneProps>(
  function CityScene({ onTriangleCount, onFps, onCursorPosition }, ref) {
    const innerRef = useRef<CitySceneHandle>(null);
    const layers = useLayerStore((s) => s.layers);
    const hovered = useSelectionStore((s) => s.hovered);
    const toolMode = useSelectionStore((s) => s.toolMode);

    const hoveredLayer = hovered
      ? layers.find((l) => l.id === hovered.layerId)
      : undefined;
    const hoveredObject =
      hoveredLayer && hovered
        ? hoveredLayer.model.objects[hovered.objectId]
        : undefined;

    useImperativeHandle(ref, () => ({
      fitAll: () => innerRef.current?.fitAll(),
      fitLayer: (id: string) => innerRef.current?.fitLayer(id),
      alignView: (dir: ViewDirection) => innerRef.current?.alignView(dir),
      getCameraState: () => innerRef.current?.getCameraState() ?? null,
      setCameraState: (pos, tgt) => innerRef.current?.setCameraState(pos, tgt),
    }));

    const handleAlign = useCallback((dir: ViewDirection) => {
      innerRef.current?.alignView(dir);
    }, []);

    // Box select drag state
    const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(
      null,
    );
    const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleBoxMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (toolMode !== "box-select") return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setBoxStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        setBoxEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      },
      [toolMode],
    );

    const handleBoxMouseMove = useCallback(
      (e: React.MouseEvent) => {
        if (!boxStart || toolMode !== "box-select") return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setBoxEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      },
      [boxStart, toolMode],
    );

    const handleBoxMouseUp = useCallback(() => {
      if (!boxStart || !boxEnd || toolMode !== "box-select") {
        setBoxStart(null);
        setBoxEnd(null);
        return;
      }
      // Box select is handled inside CitySceneInner via a custom event
      const detail = {
        left: Math.min(boxStart.x, boxEnd.x),
        top: Math.min(boxStart.y, boxEnd.y),
        right: Math.max(boxStart.x, boxEnd.x),
        bottom: Math.max(boxStart.y, boxEnd.y),
      };
      containerRef.current?.dispatchEvent(
        new CustomEvent("boxselect", { detail }),
      );
      setBoxStart(null);
      setBoxEnd(null);
    }, [boxStart, boxEnd, toolMode]);

    const boxRect =
      boxStart && boxEnd
        ? {
            left: Math.min(boxStart.x, boxEnd.x),
            top: Math.min(boxStart.y, boxEnd.y),
            width: Math.abs(boxEnd.x - boxStart.x),
            height: Math.abs(boxEnd.y - boxStart.y),
          }
        : null;

    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "relative" }}
        onMouseDown={handleBoxMouseDown}
        onMouseMove={handleBoxMouseMove}
        onMouseUp={handleBoxMouseUp}
      >
        <Canvas
          camera={{ fov: 60, near: 0.1, far: 50000, position: [50, 50, 50] }}
          shadows="soft"
          gl={{ antialias: true }}
          onCreated={({ gl, raycaster }) => {
            gl.setClearColor(readCssColor("--bg-viewport", "#0a0c12"));
            raycaster.firstHitOnly = true;
          }}
        >
          <CitySceneInner
            ref={innerRef}
            onTriangleCount={onTriangleCount}
            onFps={onFps}
            onCursorPosition={onCursorPosition}
            containerEl={containerRef}
          />
        </Canvas>
        <ViewAlignButtons onAlign={handleAlign} />
        {hoveredObject && hovered && (
          <div className="pick-tooltip">
            <span className="obj-type">{hoveredObject.objectType}</span>
            <span className="obj-id">{truncateId(hovered.objectId)}</span>
          </div>
        )}
        {boxRect && (
          <div
            className="box-select-rect"
            style={{
              left: boxRect.left,
              top: boxRect.top,
              width: boxRect.width,
              height: boxRect.height,
            }}
          />
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
  readonly onFps?: (fps: number) => void;
  readonly onCursorPosition?: (
    pos: readonly [number, number, number] | null,
  ) => void;
  readonly containerEl: React.RefObject<HTMLDivElement | null>;
}

const CitySceneInner = forwardRef<CitySceneHandle, InnerProps>(
  function CitySceneInner(
    { onTriangleCount, onFps, onCursorPosition, containerEl },
    ref,
  ) {
    const { camera, gl } = useThree();
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const cityGroupRef = useRef<Group>(null);
    const dirLightRef = useRef<DirectionalLight>(null);
    const layerSceneMapRef = useRef<Map<string, LayerSceneState>>(new Map());
    const [hasModel, setHasModel] = useState(false);

    // Measure tool state
    const [measurePoints, setMeasurePoints] = useState<Vector3[]>([]);

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
    const selections = useSelectionStore((s) => s.selections);
    const hovered = useSelectionStore((s) => s.hovered);
    const toolMode = useSelectionStore((s) => s.toolMode);

    // Solar state
    const sunPosition = useSolarStore((s) => s.sunPosition);

    // FPS counter
    const fpsFrameCount = useRef(0);
    const fpsLastTime = useRef(performance.now());
    useFrame(() => {
      fpsFrameCount.current++;
      const now = performance.now();
      if (now - fpsLastTime.current >= 1000) {
        onFps?.(
          Math.round(
            (fpsFrameCount.current * 1000) / (now - fpsLastTime.current),
          ),
        );
        fpsFrameCount.current = 0;
        fpsLastTime.current = now;
      }
    });

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
      let needsSolarInit = !hasModel && map.size === 0;
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

          // Always compute bounding sphere (needed for raycasting)
          geometry.computeBoundingSphere();

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
            originOffset,
          });

          if (needsSolarInit) {
            useSolarStore
              .getState()
              .initFromModel(model.metadata.referenceSystem, model.bbox);
            needsSolarInit = false;
            setHasModel(true);
          }

          needsFit = needsFit || !lodChanged;
        }
      }

      // Configure shadow camera from union bbox
      const light = dirLightRef.current;
      if (light) {
        const bbox = computeUnionBBox(layers);
        if (bbox) configureShadowCamera(light, bbox);
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
      const sels = useSelectionStore.getState().selections;
      if (sels.some((s) => !currentIds.has(s.layerId))) {
        useSelectionStore.getState().clear();
      }
    }, [layers, onTriangleCount, camera, hasModel]);

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
    }, [selections, hovered, layers]);

    // Sun position -> directional light
    useEffect(() => {
      const light = dirLightRef.current;
      if (!light || !sunPosition) return;

      let dist = 500;
      for (const state of layerSceneMapRef.current.values()) {
        const r = state.mesh.geometry.boundingSphere?.radius;
        if (r && r > dist) dist = r;
      }
      const lightDist = Math.max(dist * 2, 100);

      const [dx, dy, dz] = sunPosition.direction;
      if (sunPosition.altitudeDeg > 0) {
        light.position.set(dx * lightDist, dy * lightDist, dz * lightDist);
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
    }, [sunPosition]);

    // Convert scene point to CRS coordinates
    const sceneToCrs = useCallback(
      (
        point: { x: number; y: number; z: number },
        layerId: string,
      ): readonly [number, number, number] | null => {
        const state = layerSceneMapRef.current.get(layerId);
        if (!state) return null;
        const o = state.originOffset;
        // Undo mesh rotation (rotation.x = -PI/2):
        // Three.js [x, y, z] -> CityJSON [x, -z, y]
        // Then add back origin offset
        return [point.x + o[0], -point.z + o[1], point.y + o[2]];
      },
      [],
    );

    // Cursor position tracking (throttled)
    const cursorThrottleRef = useRef(0);
    const handlePointerMove = useCallback(
      (e: PickEvent) => {
        e.stopPropagation();

        const mode = useSelectionStore.getState().toolMode;

        if (mode === "select" || mode === "box-select") {
          const sel = resolveFromEvent(e, layerSceneMapRef.current);
          useSelectionStore.getState().hover(sel);
        }

        // Throttled cursor position update (~15fps)
        if (onCursorPosition && e.point) {
          const now = performance.now();
          if (now - cursorThrottleRef.current > 66) {
            cursorThrottleRef.current = now;
            const layerId = e.object.userData.layerId;
            if (layerId) {
              const crs = sceneToCrs(e.point, layerId);
              onCursorPosition(crs);
            }
          }
        }
      },
      [onCursorPosition, sceneToCrs],
    );

    const handlePointerUp = useCallback((e: PickEvent) => {
      e.stopPropagation();
      const store = useSelectionStore.getState();
      const currentToolMode = store.toolMode;

      if (currentToolMode === "measure") {
        if (e.point) {
          const pt = new Vector3(e.point.x, e.point.y, e.point.z);
          setMeasurePoints((prev) => {
            if (prev.length >= 2) return [pt]; // Reset after 2
            return [...prev, pt];
          });
        }
        return;
      }

      if (currentToolMode === "box-select") return; // Handled by overlay

      const sel = resolveFromEvent(e, layerSceneMapRef.current);
      const shiftKey = !!(e as PickEventWithMeta).nativeEvent?.shiftKey;

      if (shiftKey && sel) {
        store.toggleSelect(sel);
      } else {
        store.select(sel);
      }
    }, []);

    const handlePointerLeave = useCallback(() => {
      useSelectionStore.getState().hover(null);
      onCursorPosition?.(null);
    }, [onCursorPosition]);

    // Box select event from overlay
    useEffect(() => {
      const container = containerEl.current;
      if (!container) return;

      const handleBoxSelect = (e: Event) => {
        const { left, top, right, bottom } = (e as CustomEvent).detail;
        if (right - left < 5 || bottom - top < 5) return; // Too small

        const rect = container.getBoundingClientRect();
        const cam = camera as PerspectiveCamera;
        const mode = useSelectionStore.getState().mode;
        const selected: Selection[] = [];

        for (const layer of layers) {
          const state = layerSceneMapRef.current.get(layer.id);
          if (!state || !layer.visible) continue;

          for (const [objectId, obj] of Object.entries(layer.model.objects)) {
            if (!obj?.bbox) continue;
            // Compute bbox center in scene space
            const o = state.originOffset;
            const cx = (obj.bbox[0] + obj.bbox[3]) / 2 - o[0];
            const cy = (obj.bbox[1] + obj.bbox[4]) / 2 - o[1];
            const cz = (obj.bbox[2] + obj.bbox[5]) / 2 - o[2];
            // Apply mesh rotation (CityJSON Z-up -> Three.js Y-up)
            const screenPos = new Vector3(cx, cz, -cy);
            screenPos.project(cam);

            // Convert NDC to pixel coords
            const px = ((screenPos.x + 1) / 2) * rect.width;
            const py = ((-screenPos.y + 1) / 2) * rect.height;

            if (px >= left && px <= right && py >= top && py <= bottom) {
              if (mode === "object") {
                selected.push({ kind: "object", layerId: layer.id, objectId });
              }
            }
          }
        }

        if (selected.length > 0) {
          // Only select within one layer (first layer with hits)
          const firstLayerId = selected[0]!.layerId;
          useSelectionStore
            .getState()
            .selectMany(selected.filter((s) => s.layerId === firstLayerId));
        } else {
          useSelectionStore.getState().select(null);
        }
      };

      container.addEventListener("boxselect", handleBoxSelect);
      return () => container.removeEventListener("boxselect", handleBoxSelect);
    }, [camera, layers, containerEl]);

    // Clear measure when tool mode changes
    useEffect(() => {
      if (toolMode !== "measure") setMeasurePoints([]);
    }, [toolMode]);

    // Imperative handle
    const fitAll = useCallback(() => {
      if (controlsRef.current) {
        const bbox = computeUnionBBox(layers);
        if (bbox)
          fitCamera(camera as PerspectiveCamera, controlsRef.current, bbox);
      }
    }, [layers, camera]);

    const fitLayer = useCallback(
      (layerId: string) => {
        const layer = layers.find((l) => l.id === layerId);
        if (!layer || !layer.model.bbox || !controlsRef.current) return;
        fitCamera(
          camera as PerspectiveCamera,
          controlsRef.current,
          layer.model.bbox,
        );
      },
      [layers, camera],
    );

    const alignView = useCallback(
      (direction: ViewDirection) => {
        if (!controlsRef.current) return;
        const target = controlsRef.current.target.clone();
        const bbox = computeUnionBBox(layers);
        const dist = bbox
          ? Math.max(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]) *
            1.5
          : 100;

        const offsets: Record<ViewDirection, [number, number, number]> = {
          top: [0, dist, 0],
          bottom: [0, -dist, 0],
          front: [0, 0, dist],
          back: [0, 0, -dist],
          right: [dist, 0, 0],
          left: [-dist, 0, 0],
        };

        const [ox, oy, oz] = offsets[direction];
        camera.position.set(target.x + ox, target.y + oy, target.z + oz);
        camera.lookAt(target);
        controlsRef.current.update();
      },
      [layers, camera],
    );

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
      () => ({ fitAll, fitLayer, alignView, getCameraState, setCameraState }),
      [fitAll, fitLayer, alignView, getCameraState, setCameraState],
    );

    // Compute measure distance
    const measureDistance =
      measurePoints.length === 2
        ? measurePoints[0]!.distanceTo(measurePoints[1]!)
        : null;
    const measureMidpoint =
      measurePoints.length === 2
        ? new Vector3()
            .addVectors(measurePoints[0]!, measurePoints[1]!)
            .multiplyScalar(0.5)
        : null;

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

        {/* City meshes group — picking events */}
        <group
          ref={cityGroupRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />

        {/* Measure tool visualization */}
        {measurePoints.length >= 1 && (
          <mesh position={measurePoints[0]!}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial color={0x00aaff} />
          </mesh>
        )}
        {measurePoints.length === 2 && (
          <>
            <mesh position={measurePoints[1]!}>
              <sphereGeometry args={[0.3, 16, 16]} />
              <meshBasicMaterial color={0x00aaff} />
            </mesh>
            <Line
              points={[measurePoints[0]!, measurePoints[1]!]}
              color={0x00aaff}
              lineWidth={2}
            />
            {measureMidpoint && measureDistance !== null && (
              <Html position={measureMidpoint} center>
                <div className="measure-label">
                  {measureDistance.toFixed(2)} m
                </div>
              </Html>
            )}
          </>
        )}

        {/* Controls — disabled during box select */}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.1}
          enabled={toolMode !== "box-select"}
        />
      </>
    );
  },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PickEvent = {
  stopPropagation: () => void;
  face: { a: number } | null;
  point: { x: number; y: number; z: number };
  object: { userData: { layerId?: string }; geometry: BufferGeometry };
};

type PickEventWithMeta = PickEvent & {
  nativeEvent?: { shiftKey?: boolean };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveFromEvent(
  e: PickEvent,
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
  const { selections, hovered: hov } = useSelectionStore.getState();

  for (const layer of layers) {
    const state = map.get(layer.id);
    if (!state) continue;

    const layerSelections = selections.filter((s) => s.layerId === layer.id);
    const isTarget =
      layerSelections.length > 0 || (hov && hov.layerId === layer.id);

    if (isTarget) {
      applyHighlight(
        state.mesh.geometry,
        state.baseColors,
        layerSelections,
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
