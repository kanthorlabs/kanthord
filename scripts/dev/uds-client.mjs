// Podman dev-sandbox UDS client stand-in — runs INSIDE a second container.
//
// Demonstrates the "develop inside containers" model: server + client share the
// UDS through a named volume (NOT a host bind mount), so UDS works between them.
// This is NOT the real client; it is a stand-in until the client app exists.
//
// Waits for the socket to appear, pings it on an interval, and logs the echo so
// `podman-compose logs client` shows the link working.

import net from "node:net";
import fs from "node:fs";

const SOCK = process.env.SOCK || "/data/sockets/kanthord.sock";

function ping() {
  if (!fs.existsSync(SOCK)) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "waiting_for_socket", sock: SOCK }));
    return;
  }
  const s = net.connect(SOCK, () => s.write("ping-from-client"));
  s.on("data", (d) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: "uds_ok", reply: d.toString().trim() }));
    s.end();
  });
  s.on("error", (e) => console.log(JSON.stringify({ ts: new Date().toISOString(), event: "uds_error", code: e.code })));
}

ping();
const timer = setInterval(ping, 5000);
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
