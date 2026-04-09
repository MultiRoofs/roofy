/**
 * Draggable gizmo for repositioning the camera's orbit target.
 *
 * Uses drei's TransformControls on a visible sphere mesh. When the
 * gizmo is dragged, the OrbitControls target is synced to the new
 * position. OrbitControls are disabled during drag to prevent conflict.
 */

import { useEffect, useRef } from "react";
import { TransformControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Object3D } from "three";

interface OrbitTargetGizmoProps {
  readonly controlsRef: React.RefObject<OrbitControlsImpl | null>;
}

export function OrbitTargetGizmo({ controlsRef }: OrbitTargetGizmoProps) {
  const dummyRef = useRef<Object3D>(null);

  // Initialize dummy position at current orbit target
  useEffect(() => {
    if (dummyRef.current && controlsRef.current) {
      dummyRef.current.position.copy(controlsRef.current.target);
    }
  }, [controlsRef]);

  return (
    <>
      {/* Visible target indicator */}
      <mesh ref={dummyRef}>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshBasicMaterial color="#e8973f" transparent opacity={0.6} />
      </mesh>

      {/* Transform gizmo */}
      {dummyRef.current && (
        <TransformControls
          object={dummyRef.current}
          mode="translate"
          onMouseDown={() => {
            if (controlsRef.current) controlsRef.current.enabled = false;
          }}
          onMouseUp={() => {
            if (controlsRef.current) controlsRef.current.enabled = true;
          }}
          onChange={() => {
            if (dummyRef.current && controlsRef.current) {
              controlsRef.current.target.copy(dummyRef.current.position);
              controlsRef.current.update();
            }
          }}
        />
      )}
    </>
  );
}
