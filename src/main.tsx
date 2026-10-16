// One self-hosted family for headings, controls and data.
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/500.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import React, { useEffect } from "react";
import { revealAppAfterLaunch } from "./app/launchScreen";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { installPerfProbe } from "./features/debug/perfProbe";

// The performance harness opens the app with `?perf`; it must wrap WebGL
// before the engine creates its context.
if (new URLSearchParams(location.search).has("perf")) installPerfProbe();

function LaunchReady() {
  useEffect(revealAppAfterLaunch, []);
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LaunchReady />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
