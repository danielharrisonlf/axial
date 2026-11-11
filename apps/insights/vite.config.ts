import { federation } from "@module-federation/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/**
 * Insights is a Vue 3 microfrontend exposed through Module Federation. The
 * Workspace (React) mounts it lazily, so the delivery UI and the analytics UI
 * can ship and scale independently.
 */
export default defineConfig({
  plugins: [
    vue(),
    federation({
      name: "insights",
      filename: "remoteEntry.js",
      exposes: { "./mount": "./src/mount.ts" },
      shared: {},
    }),
  ],
  server: { host: "0.0.0.0", port: 5174, strictPort: true, cors: true },
  preview: { host: "0.0.0.0", port: 4174, strictPort: true },
  build: { target: "es2022" },
});
