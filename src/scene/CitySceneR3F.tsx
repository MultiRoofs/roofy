/**
 * React Three Fiber scene for multi-layer city model viewing.
 *
 * Features: multi-select, box select, measure tool, FPS counter,
 * cursor position tracking, per-layer mesh management,
 * @takram/three-atmosphere sky and physically-based sun lighting.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  type Side,
  Vector3,
} from "three";
import { Geodetic, Ellipsoid } from "@takram/three-geospatial";
import {
  Atmosphere,
  Sky,
  SunLight,
  SkyLight,
  Stars,
} from "@takram/three-atmosphere/r3f";
import type { AtmosphereApi } from "@takram/three-atmosphere/r3f";
import { useAtmosphereStore } from "../features/atmosphere/atmosphereStore";
import { useTilesStore } from "../features/tiles/tilesStore";
import {
  PostProcessingEffects,
  LIGHTING_MASK_LAYER,
} from "./PostProcessingEffects";
import { GoogleTilesLayer } from "./GoogleTilesLayer";

import type { BBox3, Vec3 } from "../domain/citymodel/types";
import { buildCityMesh, computeOriginOffset } from "./buildCityMesh";
import type { PickingIndex } from "./buildCityMesh";
import { resolveSelection } from "./resolvePicking";
import { applyHighlight, clearHighlight } from "./highlightMesh";
import { buildRuleColors } from "./applyRuleColors";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useLayerStore } from "../features/layers/layerStore";
import type { Layer } from "../features/layers/layerStore";
import { useSolarStore } from "../features/solar/solarStore";
import {
  useRenderDebugStore,
  type CityMaterialMode,
} from "../features/debug/renderDebugStore";
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
// Build a worldToECEF matrix from lat/lon
// ---------------------------------------------------------------------------

/**
 * Construct a Matrix4 that maps the local Three.js Y-up scene coordinates
 * to ECEF. The city model sits at the origin in Three.js space; this matrix
 * tells the atmosphere shader where on Earth that origin is.
 *
 * Three.js local: X=east, Y=up, Z=south (after CityJSON rotation)
 * ENU at site:    X=east, Y=north, Z=up
 * We need to map: localX→east, localY→up, localZ→-north → south
 *
 * The ENU frame from Ellipsoid gives us [East, North, Up] as basis vectors
 * in ECEF. We rearrange to match Three.js Y-up conventions.
 */
function buildWorldToECEFMatrix(
  latDeg: number,
  lonDeg: number,
  heightM = 0,
): Matrix4 {
  const latRad = (latDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;

  const ecefPos = new Geodetic(lonRad, latRad, heightM).toECEF();

  const east = new Vector3();
  const north = new Vector3();
  const up = new Vector3();
  Ellipsoid.WGS84.getEastNorthUpVectors(ecefPos, east, north, up);

  // Three.js Y-up: localX=east, localY=up, localZ=-north (south)
  // Matrix columns: [what localX maps to, what localY maps to, what localZ maps to]
  const mat = new Matrix4();
  mat.makeBasis(east, up, north.negate());
  mat.setPosition(ecefPos);

  return mat;
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
          camera={{ fov: 60, near: 1, far: 50000, position: [50, 50, 50] }}
          shadows="soft"
          gl={{ antialias: false }}
          onCreated={({ gl, raycaster }) => {
            gl.toneMapping = 0; // NoToneMapping — post-process AGX handles it
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
    const SUN_SHADOW_BIAS = -0.0005;
    const SUN_SHADOW_NORMAL_BIAS = 0.05;
    const { camera } = useThree();
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const cityGroupRef = useRef<Group>(null);
    const layerSceneMapRef = useRef<Map<string, LayerSceneState>>(new Map());
    const atmosphereRef = useRef<AtmosphereApi>(null);
    // Shared origin offset: the first loaded layer's bbox center.
    // All layers use this same offset so adjacent tiles stay aligned.
    const sceneOriginRef = useRef<Vec3 | null>(null);
    const [hasModel, setHasModel] = useState(false);

    // Measure tool state
    const [measurePoints, setMeasurePoints] = useState<Vector3[]>([]);

    const layers = useLayerStore((s) => s.layers);
    const selections = useSelectionStore((s) => s.selections);
    const hovered = useSelectionStore((s) => s.hovered);
    const toolMode = useSelectionStore((s) => s.toolMode);

    // Solar state
    const datetime = useSolarStore((s) => s.datetime);
    const latLon = useSolarStore((s) => s.latLon);

    // Atmosphere settings
    const cloudCoverage = useAtmosphereStore((s) => s.cloudCoverage);
    const lensFlareEnabled = useAtmosphereStore((s) => s.lensFlareEnabled);

    // 3D Tiles
    const tilesEnabled = useTilesStore((s) => s.enabled);
    const postProcessingEnabled = useRenderDebugStore(
      (s) => s.postProcessingEnabled,
    );
    const cloudsEnabled = useRenderDebugStore((s) => s.cloudsEnabled);
    const aerialPerspectiveEnabled = useRenderDebugStore(
      (s) => s.aerialPerspectiveEnabled,
    );
    const sunShadowsEnabled = useRenderDebugStore((s) => s.sunShadowsEnabled);
    const cityShadowsEnabled = useRenderDebugStore((s) => s.cityShadowsEnabled);
    const cityDoubleSided = useRenderDebugStore((s) => s.cityDoubleSided);
    const cityMaterialMode = useRenderDebugStore((s) => s.cityMaterialMode);

    // Adjust camera near/far — near=1 improves depth precision for
    // LightingMask and prevents z-fighting artifacts
    useEffect(() => {
      const cam = camera as PerspectiveCamera;
      cam.near = 1;
      cam.far = tilesEnabled ? 200000 : 50000;
      cam.updateProjectionMatrix();
    }, [tilesEnabled, camera]);

    // Build worldToECEF matrix from site lat/lon
    const worldToECEFMatrix = useMemo(() => {
      if (!latLon) return null;
      return buildWorldToECEFMatrix(latLon.lat, latLon.lon, 0);
    }, [latLon]);

    // Push worldToECEFMatrix into Atmosphere transient states when it changes
    useEffect(() => {
      const api = atmosphereRef.current;
      if (api && worldToECEFMatrix) {
        api.worldToECEFMatrix.copy(worldToECEFMatrix);
      }
    }, [worldToECEFMatrix]);

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

    // Sun/time animation — advance datetime per frame when playing
    const timeAnimating = useSolarStore((s) => s.timeAnimating);
    const timeSpeed = useSolarStore((s) => s.timeSpeed);
    const datetimeRef = useRef(datetime);
    datetimeRef.current = datetime;
    const lastSyncRef = useRef(0);
    useFrame((_, delta) => {
      if (!timeAnimating) return;
      const clampedDelta = Math.min(delta, 0.1); // Cap at 100ms to avoid tab-refocus jumps
      const next = new Date(
        datetimeRef.current.getTime() + clampedDelta * 1000 * timeSpeed,
      );
      datetimeRef.current = next;
      // Update atmosphere imperatively (no React re-render)
      atmosphereRef.current?.updateByDate(next);
      // Throttle store sync to ~10fps for UI readout
      const now = performance.now();
      if (now - lastSyncRef.current > 100) {
        useSolarStore.getState().setDatetime(next);
        lastSyncRef.current = now;
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
          disposeMaterial(state.mesh.material);
          map.delete(id);
        }
      }

      // Reset shared origin when all layers are removed
      if (map.size === 0) {
        sceneOriginRef.current = null;
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
          disposeMaterial(existing.mesh.material);
          map.delete(layer.id);
        }

        if (!map.has(layer.id)) {
          const model = layer.model;
          if (Object.keys(model.objects).length === 0) continue;

          // Use shared scene origin (first layer sets it); all layers
          // share the same offset so adjacent tiles remain aligned.
          if (!sceneOriginRef.current) {
            sceneOriginRef.current = computeOriginOffset(model);
          }
          const originOffset = sceneOriginRef.current;
          const { geometry, pickingIndex, baseColors } = buildCityMesh(
            model,
            layer.id,
            originOffset,
            layer.selectedLod,
          );

          geometry.computeBoundingSphere();

          const mesh = new Mesh(
            geometry,
            createCityMaterial(cityMaterialMode, cityDoubleSided),
          );
          mesh.userData.layerId = layer.id;
          mesh.rotation.x = -Math.PI / 2;
          mesh.castShadow = cityShadowsEnabled;
          mesh.receiveShadow = cityShadowsEnabled;
          mesh.layers.enable(LIGHTING_MASK_LAYER);
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
          fitCamera(
            camera as PerspectiveCamera,
            controlsRef.current,
            bbox,
            sceneOriginRef.current,
          );
      }

      // Clear selection if layer was removed
      const sels = useSelectionStore.getState().selections;
      if (sels.some((s) => !currentIds.has(s.layerId))) {
        useSelectionStore.getState().clear();
      }
    }, [
      layers,
      onTriangleCount,
      camera,
      hasModel,
      cityMaterialMode,
      cityDoubleSided,
      cityShadowsEnabled,
    ]);

    useEffect(() => {
      for (const state of layerSceneMapRef.current.values()) {
        state.mesh.castShadow = cityShadowsEnabled;
        state.mesh.receiveShadow = cityShadowsEnabled;

        const material = state.mesh.material;
        const expectedSide = cityDoubleSided ? DoubleSide : FrontSide;
        const needsModeSwap =
          (cityMaterialMode === "basic" &&
            !(material instanceof MeshBasicMaterial)) ||
          (cityMaterialMode === "standard" &&
            !(material instanceof MeshStandardMaterial));

        if (needsModeSwap) {
          disposeMaterial(material);
          state.mesh.material = createCityMaterial(
            cityMaterialMode,
            cityDoubleSided,
          );
          continue;
        }

        if (material instanceof MeshBasicMaterial) {
          material.side = expectedSide;
          material.needsUpdate = true;
        } else if (material instanceof MeshStandardMaterial) {
          material.side = expectedSide;
          material.needsUpdate = true;
        }
      }
    }, [cityMaterialMode, cityDoubleSided, cityShadowsEnabled]);

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

    // Convert scene point to CRS coordinates
    const sceneToCrs = useCallback(
      (
        point: { x: number; y: number; z: number },
        layerId: string,
      ): readonly [number, number, number] | null => {
        const state = layerSceneMapRef.current.get(layerId);
        if (!state) return null;
        const o = state.originOffset;
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
        if (right - left < 5 || bottom - top < 5) return;

        const rect = container.getBoundingClientRect();
        const cam = camera as PerspectiveCamera;
        const mode = useSelectionStore.getState().mode;
        const selected: Selection[] = [];

        for (const layer of layers) {
          const state = layerSceneMapRef.current.get(layer.id);
          if (!state || !layer.visible) continue;

          for (const [objectId, obj] of Object.entries(layer.model.objects)) {
            if (!obj?.bbox) continue;
            const o = state.originOffset;
            const cx = (obj.bbox[0] + obj.bbox[3]) / 2 - o[0];
            const cy = (obj.bbox[1] + obj.bbox[4]) / 2 - o[1];
            const cz = (obj.bbox[2] + obj.bbox[5]) / 2 - o[2];
            const screenPos = new Vector3(cx, cz, -cy);
            screenPos.project(cam);

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
          fitCamera(
            camera as PerspectiveCamera,
            controlsRef.current,
            bbox,
            sceneOriginRef.current,
          );
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
          sceneOriginRef.current,
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

    const hasAtmosphere = worldToECEFMatrix !== null;

    // Ground Y position: bottom of buildings after origin-offset + Z-up→Y-up rotation
    const groundY = useMemo(() => {
      const bbox = computeUnionBBox(layers);
      if (!bbox) return 0;
      const extentZ = bbox[5] - bbox[2];
      return -extentZ / 2 - 0.01; // slight offset to prevent z-fighting
    }, [layers]);

    return (
      <Atmosphere
        ref={atmosphereRef}
        date={timeAnimating ? undefined : datetime}
        correctAltitude
      >
        {/* Physically-based sky — only when valid ECEF matrix is available */}
        {hasAtmosphere && <Sky />}
        {hasAtmosphere && <Stars />}

        {/* Sun-driven directional light with physically-correct color */}
        {hasAtmosphere && (
          <SunLight
            castShadow={sunShadowsEnabled}
            shadow-bias={SUN_SHADOW_BIAS}
            shadow-normalBias={SUN_SHADOW_NORMAL_BIAS}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
        )}

        {/* Sky irradiance-based ambient light (adapts to time of day) */}
        {hasAtmosphere && <SkyLight />}

        {/* Fallback lighting when atmosphere is not available */}
        {!hasAtmosphere && (
          <>
            <color attach="background" args={["#0a0c12"]} />
            <directionalLight
              position={[50, 100, 50]}
              intensity={0.8}
              castShadow={sunShadowsEnabled}
              shadow-bias={SUN_SHADOW_BIAS}
              shadow-normalBias={SUN_SHADOW_NORMAL_BIAS}
            />
          </>
        )}

        {/* Minimal ambient fill (SkyLight handles main ambient when atmosphere active) */}
        <ambientLight intensity={hasAtmosphere ? 0.05 : 0.6} />

        {/* Google Photorealistic 3D Tiles background */}
        {hasAtmosphere && tilesEnabled && (
          <GoogleTilesLayer worldToECEFMatrix={worldToECEFMatrix!} />
        )}

        {/* City meshes group — picking events */}
        <group
          ref={cityGroupRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />

        {/* Ground plane — receives shadows, positioned at building base */}
        {hasAtmosphere && (
          <mesh
            rotation-x={-Math.PI / 2}
            position-y={groundY}
            receiveShadow
            ref={(m: Mesh | null) => {
              if (m) m.layers.enable(LIGHTING_MASK_LAYER);
            }}
          >
            <planeGeometry args={[10000, 10000]} />
            <meshStandardMaterial color="#5a6b58" />
          </mesh>
        )}

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
          zoomSpeed={1.2}
          panSpeed={1.5}
          minDistance={2}
          zoomToCursor
          enabled={toolMode !== "box-select"}
        />

        {/* Post-processing: clouds, aerial perspective, lens flare, tone mapping, SMAA */}
        <PostProcessingEffects
          hasAtmosphere={hasAtmosphere}
          cloudCoverage={cloudCoverage}
          lensFlareEnabled={lensFlareEnabled}
          postProcessingEnabled={postProcessingEnabled}
          cloudsEnabled={cloudsEnabled}
          aerialPerspectiveEnabled={aerialPerspectiveEnabled}
          atmosphereRef={atmosphereRef}
        />
      </Atmosphere>
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

function createCityMaterial(
  mode: CityMaterialMode,
  doubleSided: boolean,
): MeshStandardMaterial | MeshBasicMaterial {
  const side: Side = doubleSided ? DoubleSide : FrontSide;

  if (mode === "basic") {
    return new MeshBasicMaterial({
      vertexColors: true,
      side,
    });
  }

  return new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side,
  });
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
    return;
  }

  material.dispose();
}

function resolveFromEvent(
  e: PickEvent,
  map: Map<string, LayerSceneState>,
): Selection | null {
  if (!e.face) return null;
  const layerId = e.object.userData.layerId;
  if (!layerId) return null;
  const state = map.get(layerId);
  if (!state) return null;

  const result = resolveSelection(
    e.object.geometry,
    state.pickingIndex,
    e.face.a,
  );
  if (!result) return null;

  const mode = useSelectionStore.getState().mode;
  if (mode === "surface") {
    return {
      kind: "surface",
      layerId: result.layerId,
      objectId: result.objectId,
      surfaceIndex: result.surfaceIndex,
    };
  }
  return { kind: "object", layerId: result.layerId, objectId: result.objectId };
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
  sceneOrigin: Vec3 | null,
): void {
  const o = sceneOrigin ?? [0, 0, 0];
  // bbox center in scene space (Z-up world → Y-up Three.js via mesh rotation)
  const cx = (bbox[0] + bbox[3]) / 2 - o[0];
  const cy = (bbox[1] + bbox[4]) / 2 - o[1];
  const cz = (bbox[2] + bbox[5]) / 2 - o[2];

  const extentX = bbox[3] - bbox[0];
  const extentY = bbox[4] - bbox[1];
  const extentZ = bbox[5] - bbox[2];
  const maxExtent = Math.max(extentX, extentY, extentZ);
  const distance = maxExtent * 1.5;

  // Scene coordinates: X=east, Y=up(Z), Z=-north(-Y) due to mesh rotation
  const targetX = cx;
  const targetY = cz;
  const targetZ = -cy;

  camera.position.set(
    targetX + distance * 0.7,
    targetY + distance * 0.7,
    targetZ + distance * 0.7,
  );
  controls.target.set(targetX, targetY, targetZ);
  controls.update();
}

function truncateId(id: string): string {
  if (id.length <= 24) return id;
  return id.slice(0, 10) + "..." + id.slice(-10);
}
