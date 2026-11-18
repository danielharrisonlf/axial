import { federation } from "@module-federation/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

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

// Security headers checked by Lighthouse "Best practices" (trust and safety).
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function securityHeadersPlugin(): Plugin {
  // Returns nothing on purpose: a function returned from these hooks would run
  // as a post-middleware hook.
  const apply = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((_request, response, next) => {
      for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
      next();
    });
  };
  return { name: "axial:security-headers", configureServer: apply, configurePreviewServer: apply };
}

/**
 * Data source fixed at build time: "api" for builds (production), "demo" for the dev server
 * (`pnpm dev:web`, the legacy Playwright suite). VITE_WORKSPACE_SOURCE overrides either way,
 * e.g. `VITE_WORKSPACE_SOURCE=api pnpm dev:web` against a local stack.
 */
function workspaceSource(command: "build" | "serve"): "api" | "demo" {
  const value = process.env.VITE_WORKSPACE_SOURCE ?? (command === "serve" ? "demo" : "api");
  if (value !== "api" && value !== "demo")
    throw new Error(`VITE_WORKSPACE_SOURCE must be "api" or "demo", got "${value}"`);
  return value;
}
// Gateway behind the same-origin proxy when VITE_API_BASE_URL is empty (dev server and preview).
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig(({ command }) => ({
  define: {
    "import.meta.env.VITE_WORKSPACE_SOURCE": JSON.stringify(workspaceSource(command)),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(process.env.VITE_API_BASE_URL ?? ""),
  },
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
    securityHeadersPlugin(),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // the Origin header is kept, so ms-identity recognizes the Workspace and sets the session cookie
    proxy: {
      "/api": { target: apiProxyTarget },
      "/mcp": { target: apiProxyTarget },
      "/ws": { target: apiProxyTarget, ws: true },
    },
  },
  preview: { host: "0.0.0.0", port: 4173, strictPort: true },
  build: { target: "es2022" },
}));
