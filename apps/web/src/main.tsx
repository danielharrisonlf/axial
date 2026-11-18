import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import App from "./App";
import { installWorkspaceStore } from "./data/workspace";
import "./styles/prototype.css";
import "./styles/auth.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
const container = root;

// The comparison is folded at build time (vite.config.ts defines the value): an API build drops
// this branch, so the demo store, its seed and demo-seed.json are not emitted at all.
if (import.meta.env.VITE_WORKSPACE_SOURCE === "demo") {
  void import("./data/demo-store").then(({ createBrowserDemoStore }) => {
    installWorkspaceStore(createBrowserDemoStore());
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
} else {
  void import("./ApiRoot").then(({ ApiRoot }) =>
    createRoot(container).render(
      <StrictMode>
        <ApiRoot />
      </StrictMode>,
    ),
  );
}
