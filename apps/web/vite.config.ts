import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The Workspace is the Module Federation host: it loads the Vue Insights
 * remote lazily when the user opens the Insights app.
 */
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "workspace",
      remotes: {
        insights: {
          type: "module",
          name: "insights",
          entry: process.env.INSIGHTS_REMOTE_ENTRY ?? "http://localhost:5174/remoteEntry.js",
        },
      },
      shared: {},
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } },
  },
  preview: { host: "0.0.0.0", port: 4173, strictPort: true },
  build: { target: "es2022" },
});
