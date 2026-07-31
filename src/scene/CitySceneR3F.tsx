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
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
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
import {
  sourceToScene,
  sceneToSource,
} from "../features/streaming/sceneTransform";
import { cellCentre, meshOffset } from "../features/streaming/tileGrid";
import type { CellKey, Grid } from "../features/streaming/tileGrid";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useLayerStore } from "../features/layers/layerStore";
import type { Layer } from "../features/layers/layerStore";
import { useSolarStore } from "../features/solar/solarStore";
import { useStreamStore } from "../features/streaming/streamStore";
import type { CellEntry } from "../features/streaming/streamStore";
import { getResidentModel } from "../features/streaming/residentModel";
import {
  useTileStreaming,
  groundYFromBBox,
} from "../features/streaming/useTileStreaming";
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

/**
 * Per-cell GPU state for a streaming layer's resident tiles, tracked in
 * `LayerSceneState.cells`. Each cell is its own mesh with its own picking
 * index and color buffers — a streaming layer never has one merged mesh.
 */
export interface CellSceneState {
  mesh: Mesh;
  pickingIndex: PickingIndex;
  baseColors: Float32Array;
  ruleColors: Float32Array | null;
  /** Reference identity of the `CellEntry` this mesh was built from — how
   *  `syncStreamingCells` tells "this key is still resident, nothing to do"
   *  apart from "this key is resident but its CONTENTS changed" (a level/LoD
   *  swap or a settle-driven refetch landing new data under the SAME key).
   *  `CellCache.set()` always installs a freshly-built `CellEntry` object
   *  (never mutates one in place), so a `!==` comparison against the cache's
   *  current value for this key is a cheap, exact "did this change" check —
   *  see the doc comment on `syncStreamingCells` for why a plain
   *  `state.cells.has(key)` check used to miss this entirely (B1, 2026-07-28
   *  final review). */
  sourceEntry: CellEntry;
}

/**
 * Per-layer GPU state tracked in a ref map.
 *
 * `mesh`/`pickingIndex`/`baseColors` are non-null for a plain (fully
 * resident) layer and null for a streaming layer, which instead populates
 * `cells` — one entry per resident tile, keyed by `CellKey` ("level/col/row").
 *
 * This is intentionally a TWO-LEVEL map (`layerId -> LayerSceneState ->
 * cells: Map<CellKey, CellSceneState>`), not a flat `${layerId}:${cellKey}`
 * compound key: every existing call site keys off `layerId` alone (the
 * cleanup loop, visibility, triangle count, rule colors, cursor conversion,
 * box select, picking), and a compound key would make every one of those
 * `Map.get(layer.id)` calls miss.
 */
export interface LayerSceneState {
  mesh: Mesh | null;
  pickingIndex: PickingIndex | null;
  baseColors: Float32Array | null;
  ruleColors: Float32Array | null;
  selectedLod: string | null;
  originOffset: Vec3;
  cells: Map<CellKey, CellSceneState>;
}

/** Which layer (and, for a streaming cell mesh, which cell) a picked
 *  Object3D belongs to — resolved from `userData`, set when the mesh is
 *  created (see the layer/cell mesh-build sites below). */
export interface MeshOwner {
  readonly layerId: string;
  readonly cellKey: string | undefined;
}

/**
 * Resolves the owning layer (and cell, if any) of a picked/hovered mesh
 * from its `userData`. Every layer mesh AND every cell mesh carries
 * `userData.layerId`; only cell meshes additionally carry `userData.cellKey`.
 * Returns null for a mesh with no `layerId` (e.g. the ground plane or a
 * measure-tool marker, which are never pickable owners).
 */
export function resolveMeshOwner(obj: Object3D): MeshOwner | null {
  const layerId: string | undefined = obj.userData.layerId;
  if (!layerId) return null;
  const cellKey: string | undefined = obj.userData.cellKey;
  return { layerId, cellKey };
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

      // Remove meshes for deleted layers, AND tear down a streaming layer's
      // worker/StreamState — see teardownRemovedLayer's own doc comment.
      for (const id of map.keys()) {
        if (!currentIds.has(id)) {
          teardownRemovedLayer(cityGroup, map.get(id)!, id);
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
          disposeLayerState(cityGroup, existing);
          map.delete(layer.id);
        }

        if (!map.has(layer.id)) {
          const model = layer.model;

          if (layer.isStreaming) {
            // A streaming layer's `model` is a stub — bbox from the file
            // header, `objects` always empty by design (see
            // streamStore.ts's doc comment) — so there is no mesh to build
            // yet. The shell entry (mesh: null, cells: empty) still needs
            // to exist so: (a) the streaming-cell sync effect below has
            // somewhere to attach cell meshes as they arrive, and (b) this
            // layer participates in shared-origin / fit / solar-init
            // exactly like a static layer, using the SAME `bbox` field.
            if (!sceneOriginRef.current) {
              sceneOriginRef.current = computeOriginOffset(model);
            }
            map.set(layer.id, {
              mesh: null,
              pickingIndex: null,
              baseColors: null,
              ruleColors: null,
              selectedLod: layer.selectedLod,
              originOffset: sceneOriginRef.current,
              cells: new Map(),
            });

            if (needsSolarInit && model.bbox) {
              useSolarStore
                .getState()
                .initFromModel(model.metadata.referenceSystem, model.bbox);
              needsSolarInit = false;
              setHasModel(true);
            }

            needsFit = true;
            continue;
          }

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
            cells: new Map(),
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

      // Update visibility — the layer mesh AND every cell mesh follow the
      // layer's visibility flag.
      applyVisibility(map, layers);

      // Update triangle count — layer mesh triangles plus every cell's.
      onTriangleCount(computeTriangleCount(map, layers));

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

    // Sync streaming cells: builds/evicts cell meshes from useStreamStore's
    // per-layer cache as commits land (useTileStreaming, mounted below,
    // drives those commits). This is the producer Task 13's two-level scene
    // map was built to hold but never had — without it, streaming data
    // reaches `useStreamStore` but nothing ever appears on screen. A
    // narrowly-scoped selector (one string, one number per streaming layer's
    // `version`) keeps this effect from re-running on unrelated store
    // notifications, matching this file's other narrow-selector effects.
    const streamVersionKey = useStreamStore((s) => {
      let key = "";
      for (const layer of layers) {
        if (!layer.isStreaming) continue;
        key += `${layer.id}:${s.streams[layer.id]?.version ?? 0};`;
      }
      return key;
    });

    useEffect(() => {
      const cityGroup = cityGroupRef.current;
      if (!cityGroup) return;
      const map = layerSceneMapRef.current;

      const staleKeys = syncStreamingCells(cityGroup, map, layers, {
        materialMode: cityMaterialMode,
        doubleSided: cityDoubleSided,
        shadows: cityShadowsEnabled,
      });

      // New cell meshes start painted with base colors only (see
      // buildCellMesh) — reapplyHighlight is what layers in ruleColors (the
      // worker already computed them at fetch time) and any active
      // selection/hover, exactly mirroring how a freshly-built static layer
      // mesh gets its first real paint from the separate rule-colors/
      // highlight effects below rather than from mesh construction itself.
      reapplyHighlight(map, layers);
      onTriangleCount(computeTriangleCount(map, layers));

      // A cell just installed above may carry colors baked from rules the
      // user has since changed (an in-flight fetch dispatched before the
      // edit, landing after it) — this effect's OTHER dependency, `layers`,
      // does not re-run on its own just because a fetch landed, so nothing
      // else will ever revisit it. Recolor exactly those flagged cells now,
      // with the layer's CURRENT rules (B2, 2026-07-28 final review).
      if (staleKeys.size > 0) {
        void recolorStreamingCells(map, layers, staleKeys).then(() => {
          reapplyHighlight(map, layers);
        });
      }
    }, [
      layers,
      streamVersionKey,
      onTriangleCount,
      cityMaterialMode,
      cityDoubleSided,
      cityShadowsEnabled,
    ]);

    useEffect(() => {
      for (const state of layerSceneMapRef.current.values()) {
        const cellMeshes = Array.from(state.cells.values(), (c) => c.mesh);
        const meshes = state.mesh ? [state.mesh, ...cellMeshes] : cellMeshes;

        for (const mesh of meshes) {
          mesh.castShadow = cityShadowsEnabled;
          mesh.receiveShadow = cityShadowsEnabled;

          const material = mesh.material;
          const expectedSide = cityDoubleSided ? DoubleSide : FrontSide;
          const needsModeSwap =
            (cityMaterialMode === "basic" &&
              !(material instanceof MeshBasicMaterial)) ||
            (cityMaterialMode === "standard" &&
              !(material instanceof MeshStandardMaterial));

          if (needsModeSwap) {
            disposeMaterial(material);
            mesh.material = createCityMaterial(
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
      }
    }, [cityMaterialMode, cityDoubleSided, cityShadowsEnabled]);

    // Rule colors — applied to the layer mesh (static layers) synchronously
    // via `updateRuleColors`, and to every resident streaming cell mesh via
    // an async worker `recolor` round trip (`recolorStreamingCells` — see
    // its doc comment for why streaming needs a separate path).
    // `reapplyHighlight` runs once immediately (paints the static-layer
    // result right away) and again once the recolor round trip resolves (so
    // the streaming result reaches the GPU "color" attribute too, once it's
    // actually available).
    useEffect(() => {
      updateRuleColors(layerSceneMapRef.current, layers);
      reapplyHighlight(layerSceneMapRef.current, layers);
      void recolorStreamingCells(layerSceneMapRef.current, layers).then(() => {
        reapplyHighlight(layerSceneMapRef.current, layers);
      });
    }, [layers]);

    // Highlight on selection/hover change
    useEffect(() => {
      reapplyHighlight(layerSceneMapRef.current, layers);
    }, [selections, hovered, layers]);

    // Convert a scene-space point (e.g. a raycast hit) back to source-CRS
    // coordinates, via the shared sceneTransform module. `cellKey` selects
    // the owning cell's mesh-position offset for a streaming layer;
    // undefined means the static layer mesh, whose offset is always
    // [0, 0, 0] (it is never translated, only rotated).
    const sceneToCrs = useCallback(
      (
        point: { x: number; y: number; z: number },
        layerId: string,
        cellKey: string | undefined,
      ): Vec3 | null =>
        sceneToCrsImpl(layerSceneMapRef.current, layerId, cellKey, point),
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
            const owner = resolveMeshOwner(e.object as unknown as Object3D);
            if (owner) {
              const crs = sceneToCrs(e.point, owner.layerId, owner.cellKey);
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
        const selected = computeBoxSelection(
          layers,
          layerSceneMapRef.current,
          cam,
          rect.width,
          rect.height,
          { left, top, right, bottom },
          mode,
        );

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

    // Ground Y position: bottom of buildings after origin-offset + Z-up→Y-up
    // rotation. `groundYFromBBox` (useTileStreaming.ts) is the SAME formula,
    // exported specifically so the streaming driver's footprint math agrees
    // with where this scene actually renders "the ground" — see the mount
    // below.
    const groundY = useMemo(
      () => groundYFromBBox(computeUnionBBox(layers)),
      [layers],
    );

    // Mount the viewport-streaming driver: turns OrbitControls' `change`
    // event into footprint → probe → level → fetch/evict commits for every
    // streaming layer (useTileStreaming.ts). Passed the SAME shared
    // `sceneOriginRef`/`groundY` this component uses for its own meshes and
    // ground plane, so a streaming layer's footprint (computed in source
    // CRS) and its cell meshes (positioned via `meshOffset` in
    // `syncStreamingCells`/`buildCellMesh` above) agree on where things are.
    // Without this mount, nothing ever drives a streaming layer's fetches —
    // the hook is otherwise fully inert (see useTileStreaming.ts's own doc
    // comment before this task).
    useTileStreaming(sceneOriginRef, groundY);

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
  object: {
    userData: { layerId?: string; cellKey?: string };
    geometry: BufferGeometry;
  };
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

/**
 * Disposes a layer's GPU state: the layer mesh (if any) and every cell
 * mesh, removing each from `cityGroup` first. `state.cells` is cleared
 * afterwards so a stale entry can't be read post-dispose.
 */
export function disposeLayerState(
  cityGroup: Group,
  state: LayerSceneState,
): void {
  if (state.mesh) {
    cityGroup.remove(state.mesh);
    state.mesh.geometry.dispose();
    disposeMaterial(state.mesh.material);
  }
  for (const cell of state.cells.values()) {
    cityGroup.remove(cell.mesh);
    cell.mesh.geometry.dispose();
    disposeMaterial(cell.mesh.material);
  }
  state.cells.clear();
}

/**
 * Full teardown for a layer that just disappeared from `layers` (removed by
 * the user, or replaced by a workspace restore that calls
 * `removeAllLayers()`): disposes its GPU state (`disposeLayerState`) AND, if
 * it was streaming, tears down what `useStreamStore` doesn't clean up on its
 * own — nothing else in the app does this on layer removal (`removeLayer` in
 * `layerStore.ts` only ever touches the `layers` array).
 *
 * `client.terminate()` (workerClient.ts) rejects any promise still in
 * flight rather than leaving it hanging (a `commitStreamingLayer` racing
 * this removal gets a real rejection, caught there), and releases the
 * worker thread — with it, whatever the thread holds: an open `FcbReader`,
 * a cloned `Blob`, its own per-cell cache. `unregister()` then drops the
 * main-thread `StreamState` so nothing can resurrect a status entry for a
 * layer that no longer exists (see `commitStreamingLayer`'s catch guard).
 * A no-op for a non-streaming layer (no stream was ever registered).
 */
export function teardownRemovedLayer(
  cityGroup: Group,
  state: LayerSceneState,
  layerId: string,
): void {
  disposeLayerState(cityGroup, state);
  const stream = useStreamStore.getState().get(layerId);
  if (stream) {
    stream.client.terminate();
    useStreamStore.getState().unregister(layerId);
  }
}

/**
 * Builds a `CellSceneState` (mesh + picking index + color snapshot) from a
 * `CellEntry` (the worker's already-decoded, already-triangulated payload —
 * see `streamStore.ts`/`workerProtocol.ts`), mirroring `buildCityMesh`'s
 * wrapper but for one streaming cell instead of a whole layer's merged mesh:
 *
 * - `geometry`'s "color" attribute starts from `baseColors` — the same
 *   choice `buildCityMesh` makes for a fresh static layer mesh; ruleColors
 *   (if any) get layered in by `reapplyHighlight`, called once by the
 *   streaming-cell sync effect right after this returns, not baked in here.
 * - `baseColors` on the returned `CellSceneState` is a COPY
 *   (`Float32Array.from`), never the live GPU buffer — `applyHighlight`/
 *   `clearHighlight` mutate the GPU buffer in place and need this as the
 *   untouched restore baseline, same contract as the static layer path.
 * - The mesh's position is `meshOffset(cellCentre(grid, key, 0), sceneOrigin)`
 *   — exactly the contract `sceneToCrsImpl`/`computeBoxSelection` already
 *   document and depend on for a cell mesh's offset, and exactly what the
 *   worker used as ITS OWN per-cell origin when writing `entry.geometry`'s
 *   vertex positions (`fcb.worker.ts`'s `cellCentre(grid, key, 0)` call) —
 *   so the mesh position here must use the SAME z=0 convention, not the
 *   cell's actual elevation, to line up with those already-baked vertices.
 */
export function buildCellMesh(
  layerId: string,
  key: CellKey,
  entry: CellEntry,
  grid: Grid,
  sceneOrigin: Vec3,
  materialMode: CityMaterialMode,
  doubleSided: boolean,
): CellSceneState {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(entry.geometry.positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(entry.geometry.normals, 3),
  );
  geometry.setAttribute(
    "color",
    new BufferAttribute(entry.geometry.baseColors, 3),
  );
  geometry.setAttribute(
    "objectIndex",
    new BufferAttribute(entry.geometry.objectIndices, 1),
  );
  geometry.setAttribute(
    "surfaceIndex",
    new BufferAttribute(entry.geometry.surfaceIndices, 1),
  );
  geometry.computeBoundingSphere();

  const mesh = new Mesh(
    geometry,
    createCityMaterial(materialMode, doubleSided),
  );
  mesh.userData.layerId = layerId;
  mesh.userData.cellKey = key;
  mesh.rotation.x = -Math.PI / 2;
  mesh.layers.enable(LIGHTING_MASK_LAYER);
  const [ox, oy, oz] = meshOffset(cellCentre(grid, key, 0), sceneOrigin);
  mesh.position.set(ox, oy, oz);

  return {
    mesh,
    pickingIndex: { layerId, objectKeys: entry.geometry.objectKeys },
    baseColors: Float32Array.from(entry.geometry.baseColors),
    ruleColors: entry.geometry.ruleColors,
    sourceEntry: entry,
  };
}

/**
 * Mirrors every streaming layer's `useStreamStore` cache into GPU cell
 * meshes: builds a mesh for every newly-resident cell (`buildCellMesh`) and
 * disposes+removes the mesh for every cell the cache no longer holds (a
 * `commitStreamingLayer` eviction, `commitNormal`/`commitSwap` in
 * `useTileStreaming.ts`). Skips non-streaming layers entirely and any
 * streaming layer without a scene-map shell yet (the mesh-management effect
 * above creates that shell synchronously when the layer is added — this
 * only reads it, never creates it, keeping "who owns LayerSceneState
 * creation" a single-effect responsibility).
 *
 * Also rebuilds a cell whose cache ENTRY changed under an UNCHANGED key —
 * e.g. a level/LoD swap (`commitSwap`) or an ordinary settle
 * (`commitNormal`) re-fetching a key that was already resident, landing new
 * geometry/objects for it without the key itself ever leaving `cacheKeys`.
 * A plain `state.cells.has(key)` skip (this function's original shape) can
 * never see that: the OLD mesh, OLD pickingIndex, and OLD baseColors would
 * silently persist forever under a key the cache had already moved on from
 * — the reviewer's temporary regression test for this failed against that
 * shape (B1, 2026-07-28 final review). `CellSceneState.sourceEntry` (the
 * reference identity of the `CellEntry` a mesh was last built from) is what
 * makes "did this key's contents change" a cheap `!==`, since
 * `CellCache.set()` always installs a fresh object rather than mutating one
 * in place.
 *
 * Returns, per layer id, the keys of every cell just (re)built here whose
 * `sourceEntry.builtWithRules*` no longer matches the layer's CURRENT rules
 * — i.e. a fetch that was in flight when the user edited a rule and landed
 * carrying colors baked from the OLD ones. `recolorStreamingCells`'s own
 * "rules changed" effect only ever recolors cells that were ALREADY
 * resident when it ran; a cell installed here, later, would otherwise never
 * be revisited and would show stale colors indefinitely (B2, 2026-07-28
 * final review). The caller is expected to fire a targeted recolor for
 * exactly these keys.
 */
export function syncStreamingCells(
  cityGroup: Group,
  map: Map<string, LayerSceneState>,
  layers: ReadonlyArray<Layer>,
  options: {
    readonly materialMode: CityMaterialMode;
    readonly doubleSided: boolean;
    readonly shadows: boolean;
  },
): Map<string, CellKey[]> {
  const staleKeysByLayer = new Map<string, CellKey[]>();

  for (const layer of layers) {
    if (!layer.isStreaming) continue;
    const state = map.get(layer.id);
    if (!state) continue;
    const stream = useStreamStore.getState().get(layer.id);
    if (!stream) continue;

    const cacheKeys = new Set(stream.cache.keys());

    // Deleting the CURRENT key from a Map mid-iteration is well-defined
    // (the key was already visited, so it isn't revisited or skipped) — no
    // defensive array copy needed before iterating.
    for (const [key, cell] of state.cells) {
      if (cacheKeys.has(key)) continue;
      cityGroup.remove(cell.mesh);
      cell.mesh.geometry.dispose();
      disposeMaterial(cell.mesh.material);
      state.cells.delete(key);
    }

    for (const key of cacheKeys) {
      const entry = stream.cache.get(key);
      if (!entry) continue; // evicted between keys() and get() — next sync picks it up if re-fetched
      const existing = state.cells.get(key);
      if (existing && existing.sourceEntry === entry) continue; // unchanged
      if (existing) {
        cityGroup.remove(existing.mesh);
        existing.mesh.geometry.dispose();
        disposeMaterial(existing.mesh.material);
      }
      const cellState = buildCellMesh(
        layer.id,
        key,
        entry,
        stream.grid,
        state.originOffset,
        options.materialMode,
        options.doubleSided,
      );
      cellState.mesh.visible = layer.visible;
      cellState.mesh.castShadow = options.shadows;
      cellState.mesh.receiveShadow = options.shadows;
      cityGroup.add(cellState.mesh);
      state.cells.set(key, cellState);

      if (rulesStale(entry, layer)) {
        const stale = staleKeysByLayer.get(layer.id) ?? [];
        stale.push(key);
        staleKeysByLayer.set(layer.id, stale);
      }
    }
  }

  return staleKeysByLayer;
}

/** Whether `entry.geometry.ruleColors` was baked from rules other than the
 *  layer's CURRENT ones. Disabled-vs-disabled never differs regardless of
 *  rule content (colors don't depend on it), so rule-array comparison only
 *  runs when both are enabled. Rule arrays are small (typically a handful
 *  of entries) and edited far less often than cells are installed, so a
 *  `JSON.stringify` comparison is cheap here and — unlike a reference-
 *  identity check — doesn't depend on every rule-editing call site
 *  replacing the array wholesale. */
function rulesStale(entry: CellEntry, layer: Layer): boolean {
  if (entry.builtWithRulesEnabled !== layer.rulesEnabled) return true;
  if (!layer.rulesEnabled) return false;
  return JSON.stringify(entry.builtWithRules) !== JSON.stringify(layer.rules);
}

/** Sets `mesh.visible` on the layer mesh (if any) and every cell mesh to
 *  match each layer's `visible` flag. */
export function applyVisibility(
  map: Map<string, LayerSceneState>,
  layers: ReadonlyArray<Layer>,
): void {
  for (const layer of layers) {
    const state = map.get(layer.id);
    if (!state) continue;
    if (state.mesh) state.mesh.visible = layer.visible;
    for (const cell of state.cells.values()) cell.mesh.visible = layer.visible;
  }
}

/** Sums triangle counts across every VISIBLE layer's mesh plus all of its
 *  cell meshes (an invisible layer contributes nothing, same as before). */
export function computeTriangleCount(
  map: Map<string, LayerSceneState>,
  layers: ReadonlyArray<Layer>,
): number {
  let total = 0;
  for (const layer of layers) {
    const state = map.get(layer.id);
    if (!state || !layer.visible) continue;
    if (state.mesh) {
      const posAttr = state.mesh.geometry.getAttribute("position");
      if (posAttr) total += posAttr.count / 3;
    }
    for (const cell of state.cells.values()) {
      const posAttr = cell.mesh.geometry.getAttribute("position");
      if (posAttr) total += posAttr.count / 3;
    }
  }
  return total;
}

/**
 * Rebuilds `ruleColors` for the layer mesh (if any) and every cell mesh,
 * from each layer's active rules. A streaming layer has no layer mesh, so
 * only its cells would be (re)colorized here; a static layer has no cells,
 * so only the layer mesh is.
 *
 * A streaming layer's cells are skipped entirely here — NOT a "nothing to
 * do" no-op, but a deliberate guard against a real bug: `buildRuleColors`
 * looks objects up by id in `layer.model.objects`, which is intentionally
 * always `{}` for a streaming layer (`streamStore.ts`'s doc comment). Every
 * lookup would silently return "no match", so `hasRules ? buildRuleColors(
 * ...) : null` would evaluate to `null` for EVERY resident cell on every
 * unrelated `layers` change (e.g. toggling a different layer's visibility)
 * — overwriting the correct `ruleColors` the WORKER already computed at
 * fetch time (`fcb.worker.ts`'s `fetch` handler bakes `msg.rules`/
 * `msg.rulesEnabled` into each cell as it's built) with a wrong, empty
 * result. Recoloring an already-resident streaming cell after a rule EDIT
 * goes through `recolorStreamingCells` below instead — a `{type:"recolor"}`
 * round trip through the worker, which has the real (non-stub) model to
 * look objects up against.
 */
export function updateRuleColors(
  map: Map<string, LayerSceneState>,
  layers: ReadonlyArray<Layer>,
): void {
  for (const layer of layers) {
    const state = map.get(layer.id);
    if (!state) continue;
    const hasRules = layer.rulesEnabled && layer.rules.length > 0;

    if (state.mesh && state.pickingIndex && state.baseColors) {
      state.ruleColors = hasRules
        ? buildRuleColors(
            layer.model,
            state.mesh.geometry,
            state.pickingIndex,
            layer.rules as Rule[],
            state.baseColors,
          )
        : null;
    }

    if (layer.isStreaming) continue;

    for (const cell of state.cells.values()) {
      cell.ruleColors = hasRules
        ? buildRuleColors(
            layer.model,
            cell.mesh.geometry,
            cell.pickingIndex,
            layer.rules as Rule[],
            cell.baseColors,
          )
        : null;
    }
  }
}

/**
 * The streaming counterpart to `updateRuleColors` above: sends the worker a
 * `{type:"recolor"}` request for every currently-resident cell of every
 * streaming layer, carrying the layer's CURRENT `rules`/`rulesEnabled`, and
 * writes each returned `ruleColors` onto that cell's `CellSceneState`.
 *
 * This is Task 11's `recolor` request — implemented and mutation-tested in
 * `fcb.worker.ts` from the start, but never sent by anything until now: with
 * `updateRuleColors` deliberately skipping streaming cells (see its own doc
 * comment) and nothing else calling `recolor` either, editing, disabling, or
 * enabling a rule left every resident streaming cell showing whatever
 * colors it happened to be fetched with, indefinitely (B2, 2026-07-28 final
 * review).
 *
 * Async (a real worker round trip, unlike `updateRuleColors`'s synchronous
 * local computation) — the caller is expected to re-run `reapplyHighlight`
 * once this resolves, the same way the streaming-cell sync effect already
 * does after `syncStreamingCells`, so the new colors actually reach the
 * mesh's GPU "color" attribute (this function only updates
 * `CellSceneState.ruleColors`, never touches geometry directly).
 *
 * `onlyKeys`, when given, restricts each layer's request to that layer's
 * entry in the map instead of every currently-resident cell — used by the
 * streaming-cell sync effect to recolor JUST the cells `syncStreamingCells`
 * flagged as built from stale rules, without re-requesting every other
 * already-correct cell on every cache commit (B2, 2026-07-28 final review).
 * Omitted (the "rules changed" effect's own call), every resident cell of
 * every streaming layer is targeted, as before.
 */
export async function recolorStreamingCells(
  map: Map<string, LayerSceneState>,
  layers: ReadonlyArray<Layer>,
  onlyKeys?: ReadonlyMap<string, ReadonlyArray<CellKey>>,
): Promise<void> {
  await Promise.all(
    layers
      .filter((layer) => layer.isStreaming)
      .map(async (layer) => {
        const state = map.get(layer.id);
        const stream = useStreamStore.getState().get(layer.id);
        if (!state || !stream) return;
        const keyFilter = onlyKeys?.get(layer.id);
        if (onlyKeys && (!keyFilter || keyFilter.length === 0)) return; // nothing flagged stale for this layer
        // Snapshot the CellSceneState OBJECTS this request is for, not just
        // their keys. A level/LoD swap (`commitSwap`, useTileStreaming.ts)
        // can replace the entry at the SAME key with a differently-sized
        // mesh — driven purely by camera movement, entirely independent of
        // this recolor round trip — while this request is still in flight.
        // Applying a response computed for the OLD geometry onto the NEW
        // one would misapply colors at best; at worst, highlightMesh.ts's
        // `colorArray.set(ruleColors ?? baseColors)` THROWS a RangeError
        // when the response is longer than the new mesh's own color
        // buffer, which (called synchronously from the rule-colors and
        // highlight effects below) would crash the whole app, not just the
        // viewport. The snapshot lets the response handler detect "this key
        // was rebuilt since I asked" via object identity and discard rather
        // than misapply — the same technique `syncStreamingCells` uses
        // (`CellSceneState.sourceEntry`) for the equivalent problem on the
        // sync path.
        const targets = new Map(
          keyFilter
            ? keyFilter.flatMap((key) => {
                const cell = state.cells.get(key);
                return cell ? [[key, cell] as const] : [];
              })
            : state.cells,
        );
        if (targets.size === 0) return;
        try {
          await stream.client.sendStreaming(
            {
              type: "recolor",
              cells: [...targets.keys()],
              rules: layer.rules,
              rulesEnabled: layer.rulesEnabled,
            },
            (msg) => {
              if (msg.type !== "recolored") return;
              const target = targets.get(msg.key);
              const current = state.cells.get(msg.key);
              // `target` missing means it was already gone from `targets`
              // (can't happen — targets is exactly this cell's key set —
              // kept as a defensive pair with the identity check below,
              // which is the one that actually matters: `current` missing
              // means the cell was evicted since the snapshot (the same
              // race fcb.worker.ts's own recolor handler documents and
              // skips rather than errors on); `current !== target` means it
              // was REBUILT under the same key (a swap) — either way, this
              // response is for geometry that no longer exists.
              if (target && current === target) {
                current.ruleColors = msg.ruleColors;
              }
            },
          );
        } catch {
          // Layer removed / worker terminated mid-request
          // (`WorkerClient.terminate()` rejects every in-flight
          // send/sendStreaming call) — nothing left to recolor.
        }
      }),
  );
}

/**
 * Resolves a picked/hovered mesh to a `Selection`, consulting the owning
 * cell's `pickingIndex` for a streaming layer (via `resolveMeshOwner`) or
 * the layer mesh's `pickingIndex` for a static layer.
 */
export function resolveFromEvent(
  e: PickEvent,
  map: Map<string, LayerSceneState>,
): Selection | null {
  if (!e.face) return null;
  const owner = resolveMeshOwner(e.object as unknown as Object3D);
  if (!owner) return null;
  const state = map.get(owner.layerId);
  if (!state) return null;

  const pickingIndex =
    owner.cellKey !== undefined
      ? state.cells.get(owner.cellKey)?.pickingIndex
      : state.pickingIndex;
  if (!pickingIndex) return null;

  const result = resolveSelection(e.object.geometry, pickingIndex, e.face.a);
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

/**
 * Converts a scene-space point back to source-CRS coordinates via
 * `sceneToSource`. `cellKey` (when set) selects the owning cell, whose
 * mesh position IS the offset `sceneToSource` needs — a cell mesh is
 * positioned at `meshOffset(cellCentre(...), sceneOrigin)` (rotated delta),
 * exactly the `offset` parameter `sceneToSource` expects. A static layer's
 * mesh is never translated, so its offset is always [0, 0, 0].
 */
export function sceneToCrsImpl(
  map: Map<string, LayerSceneState>,
  layerId: string,
  cellKey: string | undefined,
  point: { x: number; y: number; z: number },
): Vec3 | null {
  const state = map.get(layerId);
  if (!state) return null;

  let offset: Vec3 = [0, 0, 0];
  if (cellKey !== undefined) {
    const cell = state.cells.get(cellKey);
    if (!cell) return null;
    offset = [cell.mesh.position.x, cell.mesh.position.y, cell.mesh.position.z];
  }

  return sceneToSource([point.x, point.y, point.z], state.originOffset, offset);
}

/**
 * Box-select candidate for one object: its id and bbox, normalized from
 * either a static `CityObject` or a streaming layer's `ResidentObjectRecord`
 * (see `boxSelectCandidates` below).
 */
interface BoxSelectCandidate {
  readonly id: string;
  readonly bbox: BBox3 | null;
}

/**
 * Box-select DECISION (Task 17): for a streaming layer, `layer.model.objects`
 * is intentionally always empty (streamStore.ts's doc comment), so walking
 * it — the ONLY thing this function did before — silently selects nothing
 * for every streaming layer, with no visible sign anything is wrong. Task
 * 13 built the per-object cell-offset lookup below for exactly this case but
 * left it with nothing to iterate, calling it out explicitly as a real,
 * unresolved plan gap (`layer.model.objects` empty by design, `CellSceneState`
 * carries no per-object bboxes) rather than a silent limitation.
 *
 * Resolution chosen here: wire it through, not just surface the limitation
 * in the UI. `ResidentObjectRecord` (`workerProtocol.ts`) already carries a
 * `bbox` per object, and `getResidentModel` (Task 15, `residentModel.ts`)
 * already merges every resident cell's objects into one flat, MEMOIZED view
 * — recomputed only when the stream's `version` changes, so calling it here
 * (from a box-select drag, not a render) is cheap. This makes box-select
 * work over whatever is CURRENTLY RESIDENT for a streaming layer — matching
 * what static box-select has always meant (only what's loaded is
 * selectable) rather than requiring a synchronous full-file fetch just to
 * support a drag-select. A UI-only "unsupported" message was the fallback
 * considered and rejected: the offset-lookup plumbing already existed
 * specifically to make this work once records were available, and
 * `ResidentObjectRecord.bbox` is exactly that missing data — leaving it
 * unwired would mean two pieces built for each other, neither used.
 */
function boxSelectCandidates(layer: Layer): BoxSelectCandidate[] {
  if (layer.isStreaming) {
    const version = useStreamStore.getState().streams[layer.id]?.version ?? 0;
    const resident = getResidentModel(layer.id, version);
    return Object.entries(resident.objects).map(([id, record]) => ({
      id,
      bbox: record.bbox,
    }));
  }
  return Object.entries(layer.model.objects).map(([id, obj]) => ({
    id,
    bbox: obj?.bbox ?? null,
  }));
}

/**
 * Projects each layer's object bboxes to screen space and returns the
 * `Selection`s whose center falls inside the drag rectangle.
 *
 * Walks each layer's cells first to build an objectId -> cell-mesh-offset
 * lookup (from each cell's `pickingIndex.objectKeys`), so an object that
 * lives in a streaming cell projects from where it actually renders (the
 * cell mesh's position) rather than the shared origin. An object with no
 * cell entry uses [0, 0, 0] — the static layer mesh's offset.
 */
export function computeBoxSelection(
  layers: ReadonlyArray<Layer>,
  map: Map<string, LayerSceneState>,
  camera: PerspectiveCamera,
  rectWidth: number,
  rectHeight: number,
  box: { left: number; top: number; right: number; bottom: number },
  mode: "object" | "surface",
): Selection[] {
  const selected: Selection[] = [];

  for (const layer of layers) {
    const state = map.get(layer.id);
    if (!state || !layer.visible) continue;

    const cellOffsetByObject = new Map<string, Vec3>();
    for (const cell of state.cells.values()) {
      const offset: Vec3 = [
        cell.mesh.position.x,
        cell.mesh.position.y,
        cell.mesh.position.z,
      ];
      for (const id of cell.pickingIndex.objectKeys) {
        cellOffsetByObject.set(id, offset);
      }
    }

    for (const { id: objectId, bbox } of boxSelectCandidates(layer)) {
      if (!bbox) continue;
      const center: Vec3 = [
        (bbox[0] + bbox[3]) / 2,
        (bbox[1] + bbox[4]) / 2,
        (bbox[2] + bbox[5]) / 2,
      ];
      const offset = cellOffsetByObject.get(objectId) ?? [0, 0, 0];
      const scenePos = sourceToScene(center, state.originOffset, offset);
      const screenPos = new Vector3(scenePos[0], scenePos[1], scenePos[2]);
      screenPos.project(camera);

      const px = ((screenPos.x + 1) / 2) * rectWidth;
      const py = ((-screenPos.y + 1) / 2) * rectHeight;

      if (
        px >= box.left &&
        px <= box.right &&
        py >= box.top &&
        py <= box.bottom &&
        mode === "object"
      ) {
        selected.push({ kind: "object", layerId: layer.id, objectId });
      }
    }
  }

  return selected;
}

export function reapplyHighlight(
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

    if (state.mesh && state.pickingIndex && state.baseColors) {
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

    for (const cell of state.cells.values()) {
      if (isTarget) {
        applyHighlight(
          cell.mesh.geometry,
          cell.baseColors,
          layerSelections,
          hov?.layerId === layer.id ? hov : null,
          cell.pickingIndex,
          cell.ruleColors,
        );
      } else {
        clearHighlight(cell.mesh.geometry, cell.baseColors, cell.ruleColors);
      }
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
