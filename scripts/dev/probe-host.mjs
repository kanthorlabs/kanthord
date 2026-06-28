// Podman dev-sandbox probe — runs on the macOS HOST (not in the container).
//
// Connects back to the smoke harness running inside the container to prove
// which boundary crossings actually work from the host:
//   - UDS  via .data/sockets/smoke.sock  (across host -> VM -> container)
//   - TCP  via 127.0.0.1:PORT            (published port)
// Also reads the atomically-written DB file and the auth perms from the host
// side to confirm the mount round-trips correctly.
//
// Exit code is non-zero only if the TCP transport fails (the supported path).
// A UDS failure is reported but NOT fatal — it is the documented known risk.

import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve(".data");
const PORT = Number(process.env.PORT || 7777);
const SOCK = process.env.SOCK || path.join(DATA_DIR, "sockets", "smoke.sock");

function probe(target, label) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve({ label, ok, detail });
    };
    sock.setTimeout(3000);
    sock.on("timeout", () => finish(false, "timeout"));
    sock.on("error", (err) => finish(false, err.code || String(err)));
    sock.on("data", (d) => finish(true, d.toString().trim()));
    sock.connect(target, () => sock.write("ping"));
  });
}

const results = [];

// UDS across the mount (known risk)
results.push(await probe(SOCK, "UDS  (.data/sockets/smoke.sock)"));
// TCP published port (supported fallback)
results.push(await probe({ host: "127.0.0.1", port: PORT }, `TCP  (127.0.0.1:${PORT})`));

// Mount round-trip checks (host side)
let dbDetail = "missing";
try {
  const db = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "database", "smoke.json")));
  dbDetail = `version=${db.version}`;
} catch (e) { dbDetail = String(e.code || e); }

let authDetail = "missing";
try {
  const credFile = path.join(DATA_DIR, "auth", "credential");
  const fileMode = (fs.statSync(credFile).mode & 0o777).toString(8);
  const dirMode = (fs.statSync(path.join(DATA_DIR, "auth")).mode & 0o777).toString(8);
  authDetail = `file=${fileMode} dir=${dirMode}`;
} catch (e) { authDetail = String(e.code || e); }

const pad = (s) => s.padEnd(32);
console.log("\n  Podman dev-sandbox boundary probe (host side)\n");
for (const r of results) {
  console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${pad(r.label)} ${r.detail}`);
}
console.log(`  [READ] ${pad("atomic DB write (host read)")} ${dbDetail}`);
console.log(`  [READ] ${pad("auth perms (host read)")} ${authDetail}`);
console.log("");

const tcp = results.find((r) => r.label.startsWith("TCP"));
process.exit(tcp && tcp.ok ? 0 : 1);
