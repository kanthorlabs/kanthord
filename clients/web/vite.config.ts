import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const apiProxyTarget = process.env["VITE_API_PROXY_TARGET"];

// Vite config for the kanthord web dashboard. Tailwind v4 via the official
// Vite plugin (CSS-first @theme — no tailwind.config.js). `@` → src alias.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    ...(apiProxyTarget === undefined
      ? {}
      : {
          proxy: {
            "/kanthord.v1.DaemonService": { target: apiProxyTarget },
          },
        }),
  },
});
