/**
 * React component that hosts the Three.js scene.
 *
 * Reads layers from useLayerStore and renders each as a separate mesh
 * in a shared Group. Supports multi-layer picking, per-layer rule
 * colorization, and per-layer highlight.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Scene,
  WebGLRenderer,
  Group,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BBox3 } from "../domain/citymodel/types";
import { buildCityMesh, computeOriginOffset } from "./buildCityMesh";
import type { PickingIndex } from "./buildCityMesh";
import { applyHighlight, clearHighlight } from "./highlightMesh";
import { buildRuleColors } from "./applyRuleColors";
import { usePickingControls } from "./usePickingControls";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useLayerStore } from "../features/layers/layerStore";
import type { Layer } from "../features/layers/layerStore";
import { useSolarStore } from "../features/solar/solarStore";
import type { Rule } from "../features/rules/types";

/** Per-layer GPU state tracked in a ref map. */
export interface LayerSceneState {
  mesh: Mesh;
  pickingIndex: PickingIndex;
  baseColors: Float32Array;
  selectedLod: string | null;
  ruleColors: Float32Array | null;
}

export interface CitySceneHandle {
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

export interface CitySceneProps {
  readonly onTriangleCount: (count: number) => void;
}

export const CityScene = forwardRef<CitySceneHandle, CitySceneProps>(
  function CityScene({ onTriangleCount }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const cityGroupRef = useRef<Group | null>(null);
    const animationIdRef = useRef<number>(0);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Per-layer scene state
    const layerSceneMapRef = useRef<Map<string, LayerSceneState>>(new Map());

    // Directional light ref (for sun position updates)
    const dirLightRef = useRef<DirectionalLight | null>(null);

    // Selection state from Zustand (for highlight rendering)
    const selection = useSelectionStore((s) => s.selection);
    const hovered = useSelectionStore((s) => s.hovered);

    // Layer state from Zustand
    const layers = useLayerStore((s) => s.layers);

    // Solar state from Zustand
    const sunPosition = useSolarStore((s) => s.sunPosition);

    // Initialize Three.js scene on mount
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      // Check WebGL availability
      const testCanvas = document.createElement("canvas");
      const gl =
        testCanvas.getContext("webgl2") ?? testCanvas.getContext("webgl");
      if (!gl) {
        container.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:0.9rem;text-align:center;padding:2rem;">' +
          "WebGL is not available. Please enable hardware acceleration in your browser settings." +
          "</div>";
        return;
      }

      // Renderer
      const renderer = new WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setClearColor(readCssColor("--bg-viewport", "#0a0c12"));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFSoftShadowMap;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;
      canvasRef.current = renderer.domElement;

      // Observe theme changes to update clear color
      const themeObserver = new MutationObserver(() => {
        renderer.setClearColor(readCssColor("--bg-viewport", "#0a0c12"));
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });

      // Scene
      const scene = new Scene();
      sceneRef.current = scene;

      // Camera
      const camera = new PerspectiveCamera(60, width / height, 0.1, 10000);
      camera.position.set(50, 50, 50);
      camera.lookAt(0, 0, 0);
      cameraRef.current = camera;

      // Controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controlsRef.current = controls;

      // Lighting
      const ambient = new AmbientLight(0xffffff, 0.6);
      scene.add(ambient);

      const directional = new DirectionalLight(0xffffff, 0.8);
      directional.position.set(50, 100, 50);
      directional.castShadow = true;
      directional.shadow.mapSize.set(1024, 1024);
      directional.shadow.camera.near = 0.5;
      directional.shadow.camera.far = 2000;
      scene.add(directional);
      dirLightRef.current = directional;

      // City group (will hold per-layer meshes)
      const cityGroup = new Group();
      scene.add(cityGroup);
      cityGroupRef.current = cityGroup;

      // Animation loop
      function animate() {
        animationIdRef.current = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();

      // Resize via ResizeObserver
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width: w, height: h } = entry.contentRect;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      resizeObserver.observe(container);

      const layerSceneMap = layerSceneMapRef.current;
      return () => {
        themeObserver.disconnect();
        resizeObserver.disconnect();
        cancelAnimationFrame(animationIdRef.current);
        controls.dispose();
        // Dispose all per-layer GPU resources
        for (const state of layerSceneMap.values()) {
          state.mesh.geometry.dispose();
          if (state.mesh.material instanceof MeshStandardMaterial) {
            state.mesh.material.dispose();
          }
        }
        layerSceneMap.clear();
        renderer.dispose();
        container.removeChild(renderer.domElement);
      };
    }, []);

    // Manage per-layer meshes: add/remove/visibility
    useEffect(() => {
      const cityGroup = cityGroupRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
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

        // Dispose old mesh if LoD changed
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

          // Configure shadow camera and solar from the first non-empty layer
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

          needsFit = !lodChanged; // Only fit camera on new layers, not LoD changes
        }
      }

      // Update visibility for existing layers
      for (const layer of layers) {
        const state = map.get(layer.id);
        if (state) {
          state.mesh.visible = layer.visible;
        }
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

      // Frame camera on model when first layer(s) added
      if (needsFit && camera && controls) {
        const bbox = computeUnionBBox(layers);
        if (bbox) fitCamera(camera, controls, bbox);
      }

      // Clear selection if selected layer was removed
      const sel = useSelectionStore.getState().selection;
      if (sel && !currentIds.has(sel.layerId)) {
        useSelectionStore.getState().clear();
      }
    }, [layers, onTriangleCount]);

    // Recompute rule colors per layer when rules change
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

      // Re-apply highlight with new rule colors
      reapplyHighlight(map, layers);
    }, [layers]);

    // Update directional light position when sun position changes
    useEffect(() => {
      const light = dirLightRef.current;
      if (!light || !sunPosition) return;

      const [dx, dy, dz] = sunPosition.direction;
      const map = layerSceneMapRef.current;
      let dist = 500;
      for (const state of map.values()) {
        const r = state.mesh.geometry.boundingSphere?.radius;
        if (r && r > dist) dist = r;
      }
      const lightDist = Math.max(dist * 2, 100);

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

    // Apply highlight when selection or hover changes
    useEffect(() => {
      reapplyHighlight(layerSceneMapRef.current, layers);
    }, [selection, hovered, layers]);

    // Wire up multi-layer picking
    usePickingControls({
      cameraRef,
      cityGroupRef,
      layerSceneMapRef,
      canvasRef,
    });

    // Expose fitAll via imperative handle
    const fitAll = useCallback(() => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (camera && controls) {
        const bbox = computeUnionBBox(layers);
        if (bbox) fitCamera(camera, controls, bbox);
      }
    }, [layers]);

    const getCameraState = useCallback(() => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) return null;
      return {
        position: [
          camera.position.x,
          camera.position.y,
          camera.position.z,
        ] as const,
        target: [
          controls.target.x,
          controls.target.y,
          controls.target.z,
        ] as const,
      };
    }, []);

    const setCameraState = useCallback(
      (
        position: readonly [number, number, number],
        target: readonly [number, number, number],
      ) => {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls) return;
        camera.position.set(position[0], position[1], position[2]);
        controls.target.set(target[0], target[1], target[2]);
        controls.update();
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({ fitAll, getCameraState, setCameraState }),
      [fitAll, getCameraState, setCameraState],
    );

    // Tooltip for hovered object
    const hoveredLayer = hovered
      ? layers.find((l) => l.id === hovered.layerId)
      : undefined;
    const hoveredObject = hoveredLayer
      ? hoveredLayer.model.objects[hovered!.objectId]
      : undefined;

    return (
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "relative" }}
      >
        {hoveredObject && (
          <div className="pick-tooltip">
            <span className="obj-type">{hoveredObject.objectType}</span>
            <span className="obj-id">{truncateId(hovered!.objectId)}</span>
          </div>
        )}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  controls: OrbitControls,
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

function readCssColor(varName: string, fallback: string): Color {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return new Color(raw || fallback);
}
