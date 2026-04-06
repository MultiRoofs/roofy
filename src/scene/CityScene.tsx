/**
 * React component that hosts the Three.js scene.
 *
 * Takes a CityModel and renders it in a 3D viewport with orbit controls.
 * Integrates picking (via usePickingControls) and highlight (via color
 * buffer mutation) for object/surface selection.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  Group,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CityModel } from "../domain/citymodel/types";
import { buildCityMesh, computeOriginOffset } from "./buildCityMesh";
import type { PickingIndex } from "./buildCityMesh";
import { applyHighlight, clearHighlight } from "./highlightMesh";
import { buildRuleColors } from "./applyRuleColors";
import { usePickingControls } from "./usePickingControls";
import { useSelectionStore } from "../features/selection/selectionStore";
import { useRuleStore } from "../features/rules/ruleStore";

export interface CitySceneHandle {
  fitAll: () => void;
}

export interface CitySceneProps {
  readonly model: CityModel | null;
  readonly onTriangleCount: (count: number) => void;
}

export const CityScene = forwardRef<CitySceneHandle, CitySceneProps>(
  function CityScene({ model, onTriangleCount }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const cityGroupRef = useRef<Group | null>(null);
    const animationIdRef = useRef<number>(0);

    // Picking-related refs
    const meshRef = useRef<Mesh | null>(null);
    const pickingIndexRef = useRef<PickingIndex | null>(null);
    const baseColorsRef = useRef<Float32Array | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Rule-based colorization ref
    const ruleColorsRef = useRef<Float32Array | null>(null);

    // Selection state from Zustand (for highlight rendering)
    const selection = useSelectionStore((s) => s.selection);
    const hovered = useSelectionStore((s) => s.hovered);

    // Rule state from Zustand
    const rules = useRuleStore((s) => s.rules);
    const rulesEnabled = useRuleStore((s) => s.enabled);

    // Initialize Three.js scene on mount
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      // Renderer
      const renderer = new WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setClearColor(0x0a0c12);
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;
      canvasRef.current = renderer.domElement;

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
      scene.add(directional);

      // City group (will hold the mesh)
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

      return () => {
        resizeObserver.disconnect();
        cancelAnimationFrame(animationIdRef.current);
        controls.dispose();
        renderer.dispose();
        container.removeChild(renderer.domElement);
      };
    }, []);

    // Update city mesh when model changes
    useEffect(() => {
      const cityGroup = cityGroupRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!cityGroup) return;

      // Clear previous meshes
      while (cityGroup.children.length > 0) {
        const child = cityGroup.children[0]!;
        cityGroup.remove(child);
        if (child instanceof Mesh) {
          child.geometry.dispose();
          if (child.material instanceof MeshStandardMaterial) {
            child.material.dispose();
          }
        }
      }

      // Reset picking and rule refs
      meshRef.current = null;
      pickingIndexRef.current = null;
      baseColorsRef.current = null;
      ruleColorsRef.current = null;

      // Clear selection on model change
      useSelectionStore.getState().clear();

      if (!model || Object.keys(model.objects).length === 0) {
        onTriangleCount(0);
        return;
      }

      const originOffset = computeOriginOffset(model);
      const { geometry, triangleCount, pickingIndex, baseColors } = buildCityMesh(
        model,
        originOffset,
      );

      const material = new MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
      });

      const mesh = new Mesh(geometry, material);
      // CityJSON uses Y for northing and Z for height.
      // Three.js uses Y-up, so we rotate the mesh: swap Y↔Z.
      mesh.rotation.x = -Math.PI / 2;
      cityGroup.add(mesh);

      // Store refs for picking and highlighting
      meshRef.current = mesh;
      pickingIndexRef.current = pickingIndex;
      baseColorsRef.current = baseColors;
      onTriangleCount(triangleCount);

      // Frame the camera on the model
      if (camera && controls && model.bbox) {
        fitCamera(camera, controls, model);
      }
    }, [model, onTriangleCount]);

    // Recompute rule colors when rules or model changes
    useEffect(() => {
      const mesh = meshRef.current;
      const pickingIndex = pickingIndexRef.current;
      const baseColors = baseColorsRef.current;
      if (!mesh || !pickingIndex || !baseColors || !model) {
        ruleColorsRef.current = null;
        return;
      }

      if (rulesEnabled && rules.length > 0) {
        ruleColorsRef.current = buildRuleColors(
          model,
          mesh.geometry,
          pickingIndex,
          rules,
          baseColors,
        );
      } else {
        ruleColorsRef.current = null;
      }

      // Re-apply highlight with the new rule colors
      const { selection: sel, hovered: hov } = useSelectionStore.getState();
      if (!sel && !hov) {
        clearHighlight(mesh.geometry, baseColors, ruleColorsRef.current);
      } else {
        applyHighlight(mesh.geometry, baseColors, sel, hov, pickingIndex, ruleColorsRef.current);
      }
    }, [rules, rulesEnabled, model]);

    // Apply highlight when selection or hover changes
    useEffect(() => {
      const mesh = meshRef.current;
      const pickingIndex = pickingIndexRef.current;
      const baseColors = baseColorsRef.current;
      if (!mesh || !pickingIndex || !baseColors) return;

      if (!selection && !hovered) {
        clearHighlight(mesh.geometry, baseColors, ruleColorsRef.current);
      } else {
        applyHighlight(mesh.geometry, baseColors, selection, hovered, pickingIndex, ruleColorsRef.current);
      }
    }, [selection, hovered]);

    // Wire up picking — pass ref objects so the hook reads .current inside useEffect
    usePickingControls({
      cameraRef,
      meshRef,
      pickingIndexRef,
      canvasRef,
    });

    // Expose fitAll via imperative handle
    const fitAll = useCallback(() => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (camera && controls && model) {
        fitCamera(camera, controls, model);
      }
    }, [model]);

    useImperativeHandle(ref, () => ({ fitAll }), [fitAll]);

    // Tooltip for hovered object
    const hoveredObject = hovered
      ? model?.objects[hovered.objectId]
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

function fitCamera(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  model: CityModel,
): void {
  if (!model.bbox) return;

  const extentX = model.bbox[3] - model.bbox[0];
  const extentY = model.bbox[4] - model.bbox[1];
  const extentZ = model.bbox[5] - model.bbox[2];
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
