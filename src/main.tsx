// Brand webfonts, self-hosted (@fontsource): Outfit for display type, IBM Plex
// Sans for the UI, IBM Plex Mono for data and labels. Loaded before the app so
// brand.css's --font-* stacks resolve to real faces, not the system fallbacks.
import "@fontsource-variable/outfit";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
