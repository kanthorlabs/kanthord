import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_PORT = 31415;
const EXIT_WAIT_MS = 15000;
const POLL_MS = 250;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DEV_DAEMON_COMMAND =
  /^(\S*\/)?node\s.*--watch-path=\S+.*\ssrc\/main\.ts\s+serve$/;
const ORPHAN_DAEMON_COMMAND = /^(\S*\/)?node\s(.*\s)?src\/main\.ts\s+serve$/;

export function daemonPort(endpoint) {
  const url = new URL(endpoint);
  if (!LOOPBACK_HOSTS.has(url.hostname))
    throw new Error(
      `endpoint ${endpoint} is not a loopback address. Refuse to stop a daemon`,
    );
  return Number(url.port) || DEFAULT_PORT;
}

function findListeners(port) {
  try {
    return execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      {
        encoding: "utf8",
      },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function psField(field, pid) {
  return execFileSync("ps", ["-ww", "-o", `${field}=`, "-p", String(pid)], {
    encoding: "utf8",
  }).trim();
}

function workingDirectory(pid) {
  try {
    const lines = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      {
        encoding: "utf8",
      },
    ).split("\n");
    return lines.find((line) => line.startsWith("n"))?.slice(1) ?? "";
  } catch {
    return "";
  }
}

export function isOrphanDevDaemon({ command, cwd }) {
  if (!ORPHAN_DAEMON_COMMAND.test(command)) return false;
  if (basename(cwd) !== "engine") return false;
  return existsSync(join(dirname(cwd), "scripts/dev/run.sh"));
}

function devDaemonPids(pid) {
  try {
    const parent = Number(psField("ppid", pid));
    if (!parent) return null;
    if (parent === 1) {
      const orphan = {
        command: psField("command", pid),
        cwd: workingDirectory(pid),
      };
      return isOrphanDevDaemon(orphan) ? [pid] : null;
    }
    return DEV_DAEMON_COMMAND.test(psField("command", parent))
      ? [parent, pid]
      : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function stopDevDaemon(endpoint, label) {
  const port = daemonPort(endpoint);
  const listeners = findListeners(port);
  if (!listeners.length) {
    console.log(`${label}: no daemon on port ${port}`);
    return [];
  }
  const groups = listeners.map(devDaemonPids);
  const foreign = listeners.filter((pid, index) => !groups[index]);
  if (foreign.length)
    throw new Error(
      `port ${port} holds pid ${foreign.join(", ")} that is neither a child of the node --watch of scripts/dev/run.sh nor an orphaned node src/main.ts serve of a kanthord engine directory`,
    );
  const pids = groups.flat();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
    console.log(`${label}: daemon pid ${pid} stopped`);
  }
  const end = Date.now() + EXIT_WAIT_MS;
  let running = pids.filter(alive);
  while (running.length && Date.now() < end) {
    await sleep(POLL_MS);
    running = running.filter(alive);
  }
  if (running.length)
    throw new Error(
      `daemon pid ${running.join(", ")} did not exit in ${EXIT_WAIT_MS} ms`,
    );
  return pids;
}
