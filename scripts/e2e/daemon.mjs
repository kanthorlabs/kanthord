import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_PORT = 31415;
const EXIT_WAIT_MS = 15000;
const POLL_MS = 250;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DEV_DAEMON_COMMAND =
  /^(\S*\/)?node\s.*--watch-path=\S+.*\ssrc\/main\.ts\s+serve$/;

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

function devDaemonParent(pid) {
  try {
    const parent = Number(psField("ppid", pid));
    if (!parent || parent === 1) return null;
    return DEV_DAEMON_COMMAND.test(psField("command", parent)) ? parent : null;
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
  const foreign = listeners.filter((pid) => !devDaemonParent(pid));
  if (foreign.length)
    throw new Error(
      `port ${port} holds pid ${foreign.join(", ")} that is not a child of the node --watch of scripts/dev/run.sh`,
    );
  const pids = listeners.flatMap((pid) => [devDaemonParent(pid), pid]);
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
