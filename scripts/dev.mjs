#!/usr/bin/env node
// scripts/dev.mjs — `npm run dev`: the daemon and the Vite dev server together.
//
// EPIC 026 S1. The daemon binds a fixed loopback port; Vite proxies /api,
// /healthz and /events to it and injects `Authorization` server-side, so the
// API key never reaches browser code (decision 4 + R3).
//
// Either child exiting takes the whole run down, so a half-dead dev loop never
// looks healthy.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_PORT = process.env["KANTHORD_DEV_API_PORT"] ?? "4100";
const UI_PORT = process.env["KANTHORD_DEV_UI_PORT"] ?? "5173";

if (!process.env["API_KEY"]) {
  process.stderr.write(
    "error: API_KEY is required — the daemon refuses to start without it.\n",
  );
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: env.cwd,
    stdio: "inherit",
    env: { ...process.env, ...env.vars },
  });
  child.on("exit", (code, signal) => {
    process.stderr.write(
      `\n[dev] ${name} exited (code=${code} signal=${signal})\n`,
    );
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

start(
  "daemon",
  process.execPath,
  [join(ROOT, "src/main.ts"), "serve", "--port", API_PORT],
  {
    cwd: ROOT,
    vars: {},
  },
);

start(
  "vite",
  "npx",
  [
    "--no-install",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    UI_PORT,
    "--strictPort",
  ],
  {
    cwd: join(ROOT, "ui"),
    vars: { KANTHORD_API_TARGET: `http://127.0.0.1:${API_PORT}` },
  },
);

process.stderr.write(
  `[dev] daemon http://127.0.0.1:${API_PORT} · ui http://localhost:${UI_PORT}\n`,
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown(0));
}
