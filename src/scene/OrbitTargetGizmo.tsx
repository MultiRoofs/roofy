/**
 * Draggable gizmo for repositioning the camera's orbit target.
 *
 * Uses drei's TransformControls on a visible sphere mesh. When the
 * gizmo is dragged, the OrbitControls target is synced to the new
 * position. OrbitControls are disabled during drag to prevent conflict.
 */

import { useEffect, useRef, useState } from "react";
import { TransformControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Mesh } from "three";

interface OrbitTargetGizmoProps {
  readonly controlsRef: React.RefObject<OrbitControlsImpl | null>;
}

export function OrbitTargetGizmo({ controlsRef }: OrbitTargetGizmoProps) {
  const meshRef = useRef<Mesh>(null);
  const [ready, setReady] = useState(false);

  // Initialize position at current orbit target once the mesh is mounted
  useEffect(() => {
    if (meshRef.current && controlsRef.current) {
      meshRef.current.position.copy(controlsRef.current.target);
      setReady(true);
    }
  }, [controlsRef]);

  return (
    <>
      {/* Visible target indicator */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshBasicMaterial color="#e8973f" transparent opacity={0.6} />
      </mesh>

      {/* Transform gizmo — only mount after mesh is committed */}
      {ready && meshRef.current && (
        <TransformControls
          object={meshRef.current}
          mode="translate"
          onMouseDown={() => {
            if (controlsRef.current) controlsRef.current.enabled = false;
          }}
          onMouseUp={() => {
            if (controlsRef.current) controlsRef.current.enabled = true;
          }}
          onChange={() => {
            if (meshRef.current && controlsRef.current) {
              controlsRef.current.target.copy(meshRef.current.position);
              controlsRef.current.update();
            }
          }}
        />
      )}
    </>
  );
}
