// Podman dev-sandbox smoke harness — runs INSIDE the container.
//
// This is NOT Core. It is a stand-in that exercises the four boundary risks
// the milestone (.agent/.../02-development-setup.md) says we must verify early,
// using only what real Core will do at the .data/ boundary:
//   1. UDS server in .data/sockets/        (transport over the VM mount)
//   2. atomic temp-then-rename DB write     (N1 single-writer / crash safety)
//   3. auth file 0600 / auth dir 0700       (B4 perms check)
//   4. TCP server on 0.0.0.0:PORT           (HTTP/Connect fallback transport)
//
// When real Core (kanthord) exists, replace this entrypoint with it; the run
// flags (mount, userns, published port) stay the same.

import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/data";
const PORT = Number(process.env.PORT || 7777);
const SOCK = process.env.SOCK || path.join(DATA_DIR, "sockets", "smoke.sock");

const dirs = ["sockets", "database", "logs", "auth", "cache"];
for (const d of dirs) fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });

function log(event, extra = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...extra });
  fs.appendFileSync(path.join(DATA_DIR, "logs", "smoke.jsonl"), line + "\n");
  console.log(line);
}

// --- Risk 2: atomic write-temp-then-rename to the file DB on the mount -------
function atomicWrite(file, contents) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file); // rename is atomic on a single filesystem
}
try {
  const dbFile = path.join(DATA_DIR, "database", "smoke.json");
  atomicWrite(dbFile, JSON.stringify({ version: 1, writtenAt: Date.now() }));
  log("atomic_write_ok", { file: dbFile });
} catch (err) {
  log("atomic_write_fail", { error: String(err) });
}

// --- Risk 3: auth perms (file 0600, dir 0700), set from inside container -----
try {
  const authDir = path.join(DATA_DIR, "auth");
  fs.chmodSync(authDir, 0o700);
  const credFile = path.join(authDir, "credential");
  atomicWrite(credFile, "sha256$devsalt$devhash\n");
  fs.chmodSync(credFile, 0o600);
  const m = (p) => (fs.statSync(p).mode & 0o777).toString(8);
  log("auth_perms_set", { dir: m(authDir), file: m(credFile), uid: process.getuid?.() });
} catch (err) {
  log("auth_perms_fail", { error: String(err) });
}

// --- Risk 1: UDS server in .data/sockets/ ------------------------------------
try {
  if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK);
} catch {}
const uds = net.createServer((c) => c.on("data", (d) => c.write(`uds-echo:${d}`)));
uds.on("error", (err) => log("uds_error", { error: String(err) }));
uds.listen(SOCK, () => {
  try {
    fs.chmodSync(SOCK, 0o600);
  } catch {}
  log("uds_listening", { sock: SOCK });
});

// --- Risk 4: TCP server (HTTP/Connect fallback transport) --------------------
const tcp = net.createServer((c) => c.on("data", (d) => c.write(`tcp-echo:${d}`)));
tcp.on("error", (err) => log("tcp_error", { error: String(err) }));
tcp.listen(PORT, "0.0.0.0", () => log("tcp_listening", { port: PORT }));

log("smoke_ready", { dataDir: DATA_DIR, platform: process.platform, arch: process.arch });

process.on("SIGTERM", () => {
  log("shutdown");
  process.exit(0);
});
