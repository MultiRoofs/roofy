/**
 * React component that hosts the Three.js scene.
 *
 * Takes a CityModel and renders it in a 3D viewport with orbit controls.
 * The component manages the Three.js lifecycle (renderer, scene, camera,
 * animation loop) via refs, keeping React responsible only for the
 * container div and data flow.
 */

import { useEffect, useRef } from "react";
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

export interface CitySceneProps {
  readonly model: CityModel | null;
}

export function CityScene({ model }: CitySceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cityGroupRef = useRef<Group | null>(null);
  const animationIdRef = useRef<number>(0);

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
    renderer.setClearColor(0x1a1a2e);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

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

    // Resize via ResizeObserver — responds to container size changes, not just window
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

    if (!model || Object.keys(model.objects).length === 0) return;

    const originOffset = computeOriginOffset(model);
    const { geometry } = buildCityMesh(model, originOffset);

    const material = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
    });

    const mesh = new Mesh(geometry, material);
    // CityJSON uses Y for northing and Z for height.
    // Three.js uses Y-up, so we rotate the mesh: swap Y↔Z.
    mesh.rotation.x = -Math.PI / 2;
    cityGroup.add(mesh);

    // Frame the camera on the model
    if (camera && controls && model.bbox) {
      const extentX = model.bbox[3] - model.bbox[0];
      const extentY = model.bbox[4] - model.bbox[1];
      const extentZ = model.bbox[5] - model.bbox[2];
      const maxExtent = Math.max(extentX, extentY, extentZ);
      const distance = maxExtent * 1.5;

      camera.position.set(distance * 0.7, distance * 0.7, distance * 0.7);
      controls.target.set(0, extentZ / 2, 0);
      controls.update();
    }
  }, [model]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
    />
  );
}
