/**
 * Collapsible, resizable left sidebar for layer management.
 *
 * Hosts the LayerPanel and provides a drag handle on its right edge
 * for resizing between 180px and 480px.
 */

import { useCallback, useEffect, useRef } from "react";
import { LayerPanel } from "../layers/LayerPanel";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

interface LeftSidebarProps {
  readonly width: number;
  readonly onWidthChange: (width: number) => void;
  readonly collapsed: boolean;
  readonly onAddFile: (file: File) => void;
  readonly onAddUrl: (url: string) => void;
  readonly loading: boolean;
  readonly onFlyToLayer?: (layerId: string) => void;
}

export function LeftSidebar({
  width,
  onWidthChange,
  collapsed,
  onAddFile,
  onAddUrl,
  loading,
  onFlyToLayer,
}: LeftSidebarProps) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Clean up orphaned window listeners on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = width;

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const delta = ev.clientX - startXRef.current;
        const next = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startWidthRef.current + delta),
        );
        onWidthChange(next);
      };

      const onUp = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        cleanupRef.current = null;
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);

      // Store cleanup in case component unmounts during drag
      cleanupRef.current = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
    },
    [width, onWidthChange],
  );

  if (collapsed) return null;

  return (
    <aside className="left-sidebar" style={{ width }}>
      <div className="left-sidebar-content">
        <LayerPanel
          onAddFile={onAddFile}
          onAddUrl={onAddUrl}
          loading={loading}
          onFlyToLayer={onFlyToLayer}
        />
      </div>
      <div className="left-sidebar-handle" onPointerDown={handlePointerDown} />
    </aside>
  );
}
