/**
 * Hook that wires raycaster-based picking to the selection store.
 *
 * Supports multi-layer picking: raycasts against all layer meshes in
 * the city group and resolves the hit to a layer-aware Selection.
 */

import { useEffect, useRef } from "react";
import { Raycaster, Vector2 } from "three";
import type { PerspectiveCamera, Mesh, BufferGeometry, Group } from "three";
import type { Selection } from "../domain/selection/types";
import type { PickingIndex } from "./buildCityMesh";
import type { LayerSceneState } from "./CityScene";
import { useSelectionStore } from "../features/selection/selectionStore";

export interface PickingRefs {
  readonly cameraRef: React.RefObject<PerspectiveCamera | null>;
  readonly cityGroupRef: React.RefObject<Group | null>;
  readonly layerSceneMapRef: React.RefObject<Map<
    string,
    LayerSceneState
  > | null>;
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

/**
 * Resolve a raycaster intersection to a Selection based on picking mode.
 * Exported for testing.
 */
export function resolveSelection(
  faceVertexIndex: number,
  geometry: BufferGeometry,
  pickingIndex: PickingIndex,
  mode: "object" | "surface",
): Selection | null {
  const objIdxAttr = geometry.getAttribute("objectIndex");
  const surfIdxAttr = geometry.getAttribute("surfaceIndex");
  if (!objIdxAttr || !surfIdxAttr) return null;

  const objectIdx = objIdxAttr.getX(faceVertexIndex);
  const objectId = pickingIndex.objectKeys[objectIdx];
  if (objectId === undefined) return null;

  if (mode === "surface") {
    const surfaceIndex = surfIdxAttr.getX(faceVertexIndex);
    return {
      kind: "surface",
      layerId: pickingIndex.layerId,
      objectId,
      surfaceIndex,
    };
  }

  return { kind: "object", layerId: pickingIndex.layerId, objectId };
}

export function usePickingControls(refs: PickingRefs): void {
  const raycasterRef = useRef(new Raycaster());
  const pointerRef = useRef(new Vector2());

  useEffect(() => {
    const canvas = refs.canvasRef.current;
    if (!canvas) return;

    function pick(event: PointerEvent): Selection | null {
      const camera = refs.cameraRef.current;
      const cityGroup = refs.cityGroupRef.current;
      const layerSceneMap = refs.layerSceneMapRef.current;
      if (!camera || !cityGroup || !layerSceneMap) return null;

      const rect = canvas!.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y =
        -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const intersects = raycasterRef.current.intersectObjects(
        cityGroup.children,
        false,
      );
      const hit = intersects[0];
      if (!hit?.face) return null;

      const hitMesh = hit.object as Mesh;
      const layerId = hitMesh.userData.layerId as string | undefined;
      if (!layerId) return null;

      const layerState = layerSceneMap.get(layerId);
      if (!layerState) return null;

      const mode = useSelectionStore.getState().mode;
      return resolveSelection(
        hit.face.a,
        hitMesh.geometry,
        layerState.pickingIndex,
        mode,
      );
    }

    function onPointerMove(event: PointerEvent) {
      const selection = pick(event);
      useSelectionStore.getState().hover(selection);
    }

    function onPointerUp(event: PointerEvent) {
      const selection = pick(event);
      useSelectionStore.getState().select(selection);
    }

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);

    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
  }, [
    refs.canvasRef,
    refs.cameraRef,
    refs.cityGroupRef,
    refs.layerSceneMapRef,
  ]);
}
