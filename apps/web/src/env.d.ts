/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "api" (production) or "demo" (`pnpm dev:web`, legacy e2e); defined by vite.config.ts. */
  readonly VITE_WORKSPACE_SOURCE?: string;
  /** Public origin of the API gateway, e.g. https://api.kairos.noxlabs.tech. Empty: same origin (dev proxy). */
  readonly VITE_API_BASE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
