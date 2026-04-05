/**
 * Hook that wires raycaster-based picking to the selection store.
 *
 * Attaches pointermove and click listeners to the renderer's canvas.
 * On hit, reads the objectIndex/surfaceIndex buffer attributes and
 * dispatches to the Zustand store.
 */

import { useEffect, useRef } from "react";
import { Raycaster, Vector2 } from "three";
import type { PerspectiveCamera, Mesh, BufferGeometry } from "three";
import type { Selection } from "../domain/selection/types";
import type { PickingIndex } from "./buildCityMesh";
import { useSelectionStore } from "../features/selection/selectionStore";

export interface PickingRefs {
  readonly cameraRef: React.RefObject<PerspectiveCamera | null>;
  readonly meshRef: React.RefObject<Mesh | null>;
  readonly pickingIndexRef: React.RefObject<PickingIndex | null>;
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
    return { kind: "surface", objectId, surfaceIndex };
  }

  return { kind: "object", objectId };
}

export function usePickingControls(refs: PickingRefs): void {
  const raycasterRef = useRef(new Raycaster());
  const pointerRef = useRef(new Vector2());

  // Note: this effect reads canvasRef.current at setup time. It works because
  // CityScene's init useEffect (which sets canvasRef) runs before this hook's
  // effect due to React's call-order guarantee within a single component.
  useEffect(() => {
    const canvas = refs.canvasRef.current;
    if (!canvas) return;

    function pick(event: PointerEvent): Selection | null {
      const camera = refs.cameraRef.current;
      const mesh = refs.meshRef.current;
      const pickingIndex = refs.pickingIndexRef.current;
      if (!camera || !mesh || !pickingIndex) return null;

      const rect = canvas!.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const intersects = raycasterRef.current.intersectObject(mesh);
      const hit = intersects[0];
      if (!hit?.face) return null;

      const mode = useSelectionStore.getState().mode;
      return resolveSelection(
        hit.face.a,
        mesh.geometry,
        pickingIndex,
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
  }, [refs.canvasRef, refs.cameraRef, refs.meshRef, refs.pickingIndexRef]);
}
