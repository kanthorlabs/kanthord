// SU1 probe — timeout → process-group kill of a hung git network op (Linux).
//
// Reproduces the exact concern in git-cli.md "Timeout / Kill": Node's
// child_process `timeout` sends SIGTERM to the DIRECT child only, orphaning
// git's helper subprocess (git-remote-http). We instead spawn the child in its
// own process group (detached:true → setsid) and kill the whole group.
//
// Setup: a local TCP server that accepts the connection but never replies, so
// `git clone http://127.0.0.1:PORT/...` hangs inside git-remote-http (real git
// process tree, no external network, scratch-only per the Epic 011 boundary).
//
// Run inside a Linux box with git + node:
//   node scripts/dev/probes/su1-kill-probe.mjs
// Exit 0 = PASS (group fully reaped, no orphans); non-zero = FAIL.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GRACE_MS = 1500; // SIGTERM → SIGKILL escalation window
const HANG_MS = 2000; // let git reach the helper/read stage before we kill

function psGroup(pgid) {
  // All processes in the given process group, as "pid comm" lines.
  const out = execFileSync("ps", ["-eo", "pid=,pgid=,comm="], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [pid, pg, ...comm] = l.split(/\s+/);
      return { pid: Number(pid), pgid: Number(pg), comm: comm.join(" ") };
    })
    .filter((p) => p.pgid === pgid);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // A silent server: accept, then hold the socket open forever.
  const held = [];
  const server = createServer((sock) => held.push(sock));
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  const repo = mkdtempSync(join(tmpdir(), "su1-"));

  // detached:true → child becomes a process-group leader (pgid === child.pid).
  const child = spawn(
    "git",
    [
      "-c",
      "http.lowSpeedLimit=0",
      "clone",
      `http://127.0.0.1:${port}/x.git`,
      join(repo, "dest"),
    ],
    {
      cwd: repo,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );

  let exited = false;
  let exitSignal = null;
  child.on("exit", (_code, sig) => {
    exited = true;
    exitSignal = sig;
  });

  await sleep(HANG_MS);

  const pgid = child.pid;
  const before = psGroup(pgid);
  console.log(`child pid/pgid = ${pgid}`);
  console.log(
    `group members BEFORE kill (${before.length}):`,
    before.map((p) => `${p.pid}:${p.comm}`).join(", ") || "(none)",
  );

  // The concern is real only if git actually spawned a helper in the group.
  const hasHelper = before.some((p) => /git-remote|git\b/.test(p.comm));
  if (before.length < 2) {
    console.log(
      "NOTE: <2 processes in group — helper may link curl in-process on this git build; group-kill semantics still exercised.",
    );
  }

  // Group SIGTERM (negative pid), escalate to SIGKILL after the grace window.
  let usedGroupKill = true;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch (e) {
    // Fallback contract: if the group signal fails, kill the single pid.
    usedGroupKill = false;
    console.log(`group SIGTERM failed (${e.code}); falling back to single pid`);
    try {
      child.kill("SIGTERM");
    } catch {}
  }

  const deadline = Date.now() + GRACE_MS;
  while (!exited && Date.now() < deadline) await sleep(50);
  if (!exited) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    while (!exited) await sleep(50);
  }

  await sleep(200); // let the kernel reap the group
  const after = psGroup(pgid);
  console.log(
    `group members AFTER kill (${after.length}):`,
    after.map((p) => `${p.pid}:${p.comm}`).join(", ") || "(none)",
  );
  console.log(`child exited via signal = ${exitSignal}`);
  console.log(`used group kill = ${usedGroupKill}`);

  for (const s of held) s.destroy();
  server.close();

  const ok = after.length === 0 && exited;
  console.log(ok ? "\nRESULT: PASS — no orphans" : "\nRESULT: FAIL — orphans remain");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe error:", e);
  process.exit(2);
});
