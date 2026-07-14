// su5-tls-vpn-probe — Epic 020 SU5: TLS material + VPN-interface bind policy.
//
// Proves (a) the SU5 cert+key load into a real TLS server and complete a
// handshake, and (b) the bind-policy the daemon's Story-003 auth server will
// enforce: never 0.0.0.0/::; loopback only in dev mode; production binds a
// resolved VPN-interface address. The bind helpers here are a SPIKE demo of the
// approach — Story 003 owns the production config seam.
//
// Scratch-only. Exit 0 = PASS, non-zero = FAIL, 2 = probe error.
//   node scripts/dev/probes/su5-tls-vpn-probe.mjs

import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tls from "node:tls";
import net from "node:net";

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const TLS_DIR =
  process.env.KANTHOR_TLS_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".data", "kanthord", "tls");

// --- bind policy (SPIKE demo of the Story-003 rule) ------------------------

class BindPolicyError extends Error {
  constructor(msg) { super(msg); this.name = "BindPolicyError"; this.code = "forbidden-bind"; }
}

const FORBIDDEN = new Set(["0.0.0.0", "::", "::0", ""]);
const isLoopback = (a) => a === "127.0.0.1" || a === "::1" || a?.startsWith("127.");

/**
 * Resolve the address the daemon should bind for a named host interface (e.g.
 * a VPN tunnel "utun3"/"wg0"/"tailscale0"). Config names the interface; we read
 * its live address from os.networkInterfaces(). Absent interface ⇒ typed error.
 */
function resolveInterfaceAddress(ifaceName, family = "IPv4") {
  const entry = networkInterfaces()[ifaceName];
  if (!entry) throw new BindPolicyError(`interface "${ifaceName}" not found on host`);
  const addr = entry.find((a) => a.family === family);
  if (!addr) throw new BindPolicyError(`interface "${ifaceName}" has no ${family} address`);
  return addr.address;
}

/**
 * Gate an address against the PRD §9 rule. mode: "prod" | "dev".
 *  - 0.0.0.0/:: (and any all-interfaces bind) ⇒ always rejected.
 *  - loopback ⇒ allowed only in dev mode (explicit flag), never in prod.
 *  - anything else ⇒ a specific interface address (prod VPN bind) ⇒ allowed.
 */
function assertBindAllowed(addr, mode) {
  if (FORBIDDEN.has(addr)) {
    throw new BindPolicyError(`refusing to bind "${addr}" — never 0.0.0.0/:: (PRD §9, bind the VPN interface)`);
  }
  if (isLoopback(addr) && mode !== "dev") {
    throw new BindPolicyError(`refusing loopback bind "${addr}" in ${mode} mode — dev-only (explicit flag)`);
  }
  return addr;
}

// --- checks ----------------------------------------------------------------

function tlsRoundTrip(cert, key) {
  return new Promise((resolve, reject) => {
    const server = tls.createServer({ cert, key }, (socket) => {
      socket.on("data", () => socket.write("pong"));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const socket = tls.connect(
        { host: "127.0.0.1", port, rejectUnauthorized: false },
        () => {
          const cn = socket.getPeerCertificate()?.subject?.CN;
          socket.write("ping");
          socket.on("data", (d) => {
            socket.end();
            server.close(() => resolve({ ok: d.toString() === "pong", cn, authorized: socket.authorized }));
          });
        },
      );
      socket.on("error", (e) => { server.close(); reject(e); });
    });
  });
}

function plaintextRefused(cert, key) {
  // A plain TCP (non-TLS) client must NOT complete a TLS handshake.
  return new Promise((resolve) => {
    const server = tls.createServer({ cert, key }, () => {});
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const raw = net.connect(port, "127.0.0.1", () => raw.write("GET / HTTP/1.1\r\n\r\n"));
      let handshook = false;
      raw.on("data", () => { handshook = true; });
      raw.on("close", () => { server.close(() => resolve(!handshook)); });
      raw.on("error", () => { server.close(() => resolve(true)); });
      setTimeout(() => { raw.destroy(); }, 500);
    });
  });
}

async function main() {
  const cert = readFileSync(join(TLS_DIR, "cert.pem"));
  const key = readFileSync(join(TLS_DIR, "key.pem"));

  // 1. TLS material loads + completes a handshake.
  const rt = await tlsRoundTrip(cert, key);
  record("TLS round-trip with SU5 cert+key", rt.ok, `peer CN=${rt.cn}, app-echo=${rt.ok}`);

  // 2. Plaintext request does not complete a TLS handshake.
  const refused = await plaintextRefused(cert, key);
  record("plaintext request refused (no TLS handshake)", refused, "");

  // 3. Interface-address resolution works against a live host interface.
  const ifaces = Object.keys(networkInterfaces());
  const vpnLike = ifaces.find((n) => /^(utun|wg|tun|tap|tailscale|ipsec|ppp)/i.test(n));
  let resolvedDetail, resolvedOk;
  try {
    const target = vpnLike || ifaces.find((n) => n !== "lo0" && n !== "lo") || ifaces[0];
    const family = networkInterfaces()[target]?.[0]?.family || "IPv4";
    const addr = resolveInterfaceAddress(target, family);
    resolvedOk = typeof addr === "string" && addr.length > 0;
    resolvedDetail = `iface="${target}"${vpnLike ? " (VPN-like)" : ""} → ${addr}; VPN ifaces seen: [${ifaces.filter((n) => /^(utun|wg|tun|tap|tailscale|ipsec|ppp)/i.test(n)).join(",") || "none on this host"}]`;
  } catch (e) {
    resolvedOk = false; resolvedDetail = e.message;
  }
  record("VPN-interface address resolution (os.networkInterfaces)", resolvedOk, resolvedDetail);

  // 4. Guard rejects 0.0.0.0 and :: in BOTH modes.
  let guardAllBad = true, guardDetail = "";
  for (const mode of ["prod", "dev"]) {
    for (const bad of ["0.0.0.0", "::"]) {
      try { assertBindAllowed(bad, mode); guardAllBad = false; guardDetail += ` ${mode}/${bad} WRONGLY ALLOWED;`; }
      catch (e) { if (e.code !== "forbidden-bind") { guardAllBad = false; guardDetail += ` ${mode}/${bad} wrong-error;`; } }
    }
  }
  record("bind guard rejects 0.0.0.0 + :: in prod AND dev", guardAllBad, guardDetail || "typed BindPolicyError for all");

  // 5. Loopback: rejected in prod, allowed in dev.
  let loProd = false, loDev = false;
  try { assertBindAllowed("127.0.0.1", "prod"); } catch (e) { loProd = e.code === "forbidden-bind"; }
  try { loDev = assertBindAllowed("127.0.0.1", "dev") === "127.0.0.1"; } catch { loDev = false; }
  record("loopback rejected in prod, allowed in dev (explicit flag)", loProd && loDev, `prod-rejected=${loProd}, dev-allowed=${loDev}`);

  // 6. A specific (non-loopback) interface address is allowed in prod.
  let vpnAllowed = false;
  try { vpnAllowed = assertBindAllowed("10.8.0.2", "prod") === "10.8.0.2"; } catch { vpnAllowed = false; }
  record("resolved VPN-interface address allowed in prod", vpnAllowed, "e.g. 10.8.0.2");

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass === results.length ? "PASS" : "FAIL"} — ${pass}/${results.length}  (platform=${process.platform}/${process.arch})`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error("PROBE ERROR:", e?.stack || e); process.exit(2); });
