/**
 * Where the Workspace data comes from, fixed at build time (vite.config.ts defines
 * `import.meta.env.VITE_WORKSPACE_SOURCE`): "api" in production builds, "demo" only for
 * `pnpm dev:web` and the legacy Playwright suite. The demo store and its seed are loaded with a
 * dynamic import behind this constant, so an API build does not ship the fictional data.
 */
export type WorkspaceSource = "api" | "demo";
export const WORKSPACE_SOURCE: WorkspaceSource =
  import.meta.env.VITE_WORKSPACE_SOURCE === "demo" ? "demo" : "api";
export const API_MODE = WORKSPACE_SOURCE === "api";
