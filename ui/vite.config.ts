// ui/vite.config.ts — the ONE Node-side file in the workspace (EPIC 026 S2).
//
// This file is the only place `API_KEY` is read: never in `define`, never in
// `import.meta.env`, never in any module that ships to the browser. The dev
// proxy injects `Authorization` server-side, so browser code stays key-free
// (rule R3) and writes still work in the dev loop.
// `vitest/config`'s defineConfig is Vite's plus the `test` block, so the
// workspace keeps ONE config file instead of a second vitest.config.ts.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import type { ClientRequest } from "node:http";

/** The daemon origin the proxy forwards to. Read here, on the Node side only. */
const apiTarget = process.env["KANTHORD_API_TARGET"] ?? "http://127.0.0.1:4100";
const apiKey = process.env["API_KEY"] ?? "";
const authorization =
  apiKey === ""
    ? undefined
    : `Basic ${Buffer.from(`kanthord:${apiKey}`).toString("base64")}`;

/**
 * EPIC 026 decision 4: the proxy must NOT rewrite `Host`.
 *
 * `changeOrigin: false` is Vite's default and is stated explicitly here because
 * it is load-bearing, not incidental. With `Host` left alone it stays
 * `localhost:<vitePort>`, which passes the daemon's Host allowlist
 * (`src/apps/http/app.ts:161`) AND makes the daemon's `serverOrigin`
 * (`app.ts:191`, derived from the Host header) equal the browser's `Origin`,
 * which passes the CSRF gate. `changeOrigin: true` breaks every POST/PATCH/
 * DELETE with `403 origin_not_allowed`.
 */
function daemonProxy(): {
  target: string;
  changeOrigin: false;
  configure: (proxy: {
    on: (event: "proxyReq", cb: (proxyReq: ClientRequest) => void) => void;
  }) => void;
} {
  return {
    target: apiTarget,
    changeOrigin: false,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        if (authorization !== undefined) {
          proxyReq.setHeader("authorization", authorization);
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // R1: relative asset URLs, so the same build works from any origin or a
  // future file-based Electron load. This does NOT solve the API base — that
  // is R3's job (ui/src/lib/runtime.ts).
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The contract with the Proof: the service worker is emitted as /sw.js at
      // the dist ROOT so its scope covers the whole app, and the manifest as
      // /manifest.webmanifest. Both names are route rows in the daemon.
      strategies: "generateSW",
      filename: "sw.js",
      manifestFilename: "manifest.webmanifest",
      // Registration is called from app code (`virtual:pwa-register` in
      // src/main.tsx), not injected as a script tag: an inline registration
      // script would violate the R5 CSP, and a separate registerSW.js file
      // would need a route row of its own.
      injectRegister: null,
      manifest: {
        name: "kanthord",
        short_name: "kanthord",
        description: "Operator console for the kanthord daemon.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        // Inline the workbox runtime into sw.js. Left external, workbox emits a
        // second hashed file at the dist ROOT, which would need a route row of
        // its own — the daemon's matcher has no wildcard, and the epic's row
        // list is exactly /, /assets/:file, /sw.js, /manifest.webmanifest,
        // /icons/:file and /favicon.ico.
        inlineWorkboxRuntime: true,
      },
    }),
    {
      // Dev-only CSP relaxation. `ui/index.html` carries the strict R5 policy
      // that ships in the build; Vite's dev server and React Refresh inject an
      // inline module preamble, which `script-src 'self'` alone would block.
      // The relaxation applies to `vite dev` only — never to the artifact.
      name: "kanthord-dev-csp",
      apply: "serve" as const,
      transformIndexHtml: (html: string) =>
        html.replace(
          "script-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        ),
    },
  ],
  server: {
    // The three daemon surfaces. Everything else is served by Vite itself.
    proxy: {
      "/api": daemonProxy(),
      "/healthz": daemonProxy(),
      "/events": daemonProxy(),
    },
  },
  build: {
    // Vite's default is a single level (dist/assets/<name>-<hash>.js), which is
    // what the daemon's `/assets/:file` row can match — the router supports no
    // wildcard. Stated so a later change to a nested layout fails loudly here.
    assetsDir: "assets",
    sourcemap: command === "serve",
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
