import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const remoteEntry = process.env.INSIGHTS_REMOTE_ENTRY ?? "http://localhost:5174/remoteEntry.js";

/**
 * Module Federation adds a `<link rel="modulepreload">` for every remote to the
 * host HTML. That defeats the lazy mount: the Insights bundle would download on
 * the first paint of any Workspace page. Remotes are cross-origin by design, so
 * strip only those preloads and keep the host's own modulepreloads.
 */
function lazyRemotePreload(): Plugin {
  const origin = new URL(remoteEntry).origin;
  return {
    name: "axial:lazy-remote-preload",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(new RegExp(`<link rel="modulepreload"[^>]*href="${origin}[^"]*"[^>]*>`, "g"), "");
    },
    generateBundle(_options, bundle) {
      const pattern = new RegExp(`<link rel="modulepreload"[^>]*href="${origin}[^"]*"[^>]*>`, "g");
      for (const asset of Object.values(bundle)) {
        if (asset.type === "asset" && asset.fileName.endsWith(".html"))
          asset.source = String(asset.source).replace(pattern, "");
      }
    },
  };
}

/**
 * Fontsource ships `font-display: swap`, which lets the browser repaint text
 * with the web font after first paint. On throttled mobile that repaint becomes
 * the LCP entry (3s+). `optional` keeps the fallback for the first visit and
 * uses the cached font afterwards, removing the late LCP update.
 */
function optionalFontDisplay(): Plugin {
  return {
    name: "axial:optional-font-display",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("@fontsource") && id.endsWith(".css"))
        return code.replaceAll("font-display: swap", "font-display: optional");
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    optionalFontDisplay(),
    federation({
      name: "workspace",
      remotes: {
        insights: { type: "module", name: "insights", entry: remoteEntry },
      },
      shared: {},
    }),
    lazyRemotePreload(),
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
