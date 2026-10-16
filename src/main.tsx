// One self-hosted family for headings, controls and data.
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/500.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/700.css";
import React, { useEffect } from "react";
import { revealAppAfterLaunch } from "./app/launchScreen";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { installPerfProbe } from "./features/debug/perfProbe";
import { appPreferences } from "./persistence/storage/appStorage";

// The performance harness opens the app with `?perf`; it must wrap WebGL
// before the engine creates its context.
if (new URLSearchParams(location.search).has("perf")) installPerfProbe();

function LaunchReady() {
  useEffect(revealAppAfterLaunch, []);
  return null;
}

// The stores read their preferences synchronously when their modules load,
// so the preferences are read from storage before the app is imported. A
// storage that cannot be read, or does not answer within a moment (a remote
// backend on a slow network), leaves the defaults for this session rather
// than hold back the first paint.
const PREFERENCE_WAIT_MS = 1500;
await Promise.race([
  appPreferences
    .hydrate()
    .catch((error: unknown) =>
      console.warn("Preferences could not be read.", error),
    ),
  new Promise((resolve) => setTimeout(resolve, PREFERENCE_WAIT_MS)),
]);
const { App } = await import("./app/App");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LaunchReady />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
