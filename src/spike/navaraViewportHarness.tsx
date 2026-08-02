/**
 * Task B11a browser harness — TEMPORARY, deleted in Task C21 together with the
 * B1 spike page.
 *
 * `NavaraViewport` is not reachable from the app UI yet (Task B11b is what
 * swaps `App.tsx` off `CityScene`), but the gate for B11a is a real browser
 * render of the globe with the REAL engine. This page mounts the component on
 * its own, under `<StrictMode>` so the double-mount path is exercised where it
 * actually matters, and publishes two probe objects the CDP driver reads:
 *
 *  - `__navaraHarness`        — the current mount's status (per mount);
 *  - `__navaraHarnessControl` — `remount()`, which proves a disposed engine
 *    can be brought back up (the worker pool is a module-level singleton).
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { NavaraViewport, type CitySceneHandle } from "../scene/NavaraViewport";
import "../app/app.css";

interface HarnessProbe {
  mount: number;
  ready: "pending" | "resolved" | "rejected";
  error: string | null;
  fps: number | null;
  cameraState: unknown;
  align: (direction: "top" | "front") => void;
  read: () => unknown;
  set: (state: {
    lng: number;
    lat: number;
    height: number;
    heading: number;
    pitch: number;
    roll: number;
  }) => void;
}

const G = globalThis as unknown as {
  __navaraHarness?: HarnessProbe;
  __navaraHarnessControl?: { remount: () => void; mounts: number };
};

function Harness() {
  const [mounted, setMounted] = useState(true);
  const [mount, setMount] = useState(1);
  const [status, setStatus] = useState("booting");
  const handleRef = useRef<CitySceneHandle | null>(null);

  useEffect(() => {
    G.__navaraHarnessControl = {
      mounts: mount,
      remount: () => {
        setMounted(false);
        setStatus("remounting");
        setTimeout(() => {
          setMount((n) => n + 1);
          setMounted(true);
        }, 100);
      },
    };
  }, [mount]);

  const attach = useCallback(
    (handle: CitySceneHandle | null) => {
      handleRef.current = handle;
      if (!handle) return;
      const probe: HarnessProbe = {
        mount,
        ready: "pending",
        error: null,
        fps: null,
        cameraState: null,
        align: (direction) => handle.alignView(direction),
        read: () => handle.getCameraState(),
        set: (state) => handle.setCameraState(state),
      };
      G.__navaraHarness = probe;
      handle.ready.then(
        () => {
          probe.ready = "resolved";
          probe.cameraState = handle.getCameraState();
          setStatus("ready");
        },
        (error: unknown) => {
          probe.ready = "rejected";
          probe.error = error instanceof Error ? error.message : String(error);
          setStatus("failed");
        },
      );
    },
    [mount],
  );

  return (
    <>
      {mounted && (
        <NavaraViewport
          key={mount}
          ref={attach}
          onTriangleCount={() => undefined}
          onFps={(fps) => {
            const probe = G.__navaraHarness;
            if (probe) probe.fps = fps;
          }}
        />
      )}
      <div
        data-testid="harness-status"
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          zIndex: 30,
          color: "#9fe",
          font: "12px monospace",
        }}
      >
        {status} (mount {mount})
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
