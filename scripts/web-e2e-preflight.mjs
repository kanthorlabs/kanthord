// web-e2e-preflight — maintainer-owned E2E environment for the web variant.
//
// Serves the built dashboard bundle over TLS (the SU5 cert) on loopback so
// Playwright exercises the real browser-over-TLS path — the same transport the
// daemon uses on the VPN interface. Prints WEB_E2E_BASE_URL for the runner.
//
// Its failure is an ENVIRONMENT failure, never a story failure (PROFILE web
// pre-flight rule). Once Epic 026 lands handlers, this is where the daemon is
// booted on golden fixtures behind the same TLS origin (same-origin serving, no
// CORS). For the SU7 bootstrap it serves the static bundle + SPA fallback.
//
//   node scripts/web-e2e-preflight.mjs [--port 4443]
// Stays alive until SIGINT/SIGTERM.

import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = process.env.WEB_DIST_DIR || join(ROOT, "clients", "web", "dist");
const TLS_DIR = process.env.KANTHOR_TLS_DIR || join(ROOT, ".data", "kanthord", "tls");
const PORT = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : process.env.WEB_E2E_PORT || 4443);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" };

function loadTls() {
  try {
    return { cert: readFileSync(join(TLS_DIR, "cert.pem")), key: readFileSync(join(TLS_DIR, "key.pem")) };
  } catch (e) {
    console.error(`PREFLIGHT ENV FAILURE: cannot read TLS material in ${TLS_DIR} (${e.code}). Generate it (Epic 020 SU5) before web E2E.`);
    process.exit(2);
  }
}

async function serveFile(res, absPath, fallbackIndex) {
  try {
    const data = await readFile(absPath);
    res.writeHead(200, { "content-type": MIME[extname(absPath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    if (fallbackIndex) { await serveFile(res, join(DIST, "index.html")); return; }
    res.writeHead(404); res.end("not found");
  }
}

const server = createServer(loadTls(), async (req, res) => {
  // Confine to DIST; SPA fallback to index.html for client routes.
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const abs = join(DIST, rel === "/" ? "index.html" : rel);
  if (!abs.startsWith(DIST)) { res.writeHead(403); res.end("forbidden"); return; }
  await serveFile(res, abs, extname(abs) === "" || extname(abs) === ".html");
});

server.on("error", (e) => { console.error("PREFLIGHT ENV FAILURE:", e.message); process.exit(2); });
server.listen(PORT, "127.0.0.1", () => {
  const url = `https://127.0.0.1:${PORT}`;
  console.log(`WEB_E2E_BASE_URL=${url}`);
  console.log(`serving ${DIST} over TLS (SU5 cert). Ctrl-C to stop.`);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
