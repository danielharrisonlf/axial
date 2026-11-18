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
  // CSS keeps light-dark() and @scope as written: lowering light-dark() makes the
  // theme depend on --lightningcss-* variables declared next to color-scheme,
  // which only exist in the host's stylesheet. Same floor as DESIGN.md §2.
  build: { target: "es2022", cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5"] },
});
