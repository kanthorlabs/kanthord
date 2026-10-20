import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const OWNER_LABEL = "io.kanthord.owner";
const RUNTIMES = ["podman", "docker"];
const GONE_WAIT_MS = 20000;
const POLL_MS = 500;

export function containerRuntime(env = process.env, exec = execFileSync) {
  if (env.CONTAINER_ENGINE) return env.CONTAINER_ENGINE;
  for (const runtime of RUNTIMES) {
    try {
      exec(runtime, ["--version"], { stdio: "ignore" });
      return runtime;
    } catch {}
  }
  throw new Error("neither podman nor docker is installed");
}

export function ownedContainers(runtime, exec = execFileSync) {
  return String(
    exec(
      runtime,
      [
        "ps",
        "--all",
        "--filter",
        `label=${OWNER_LABEL}`,
        "--format",
        "{{.Names}}",
      ],
      { encoding: "utf8" },
    ),
  )
    .split("\n")
    .filter(Boolean);
}

export async function requireNoOwnedContainers(
  runtime,
  { exec = execFileSync, waitMs = GONE_WAIT_MS, pause = sleep } = {},
) {
  let names = ownedContainers(runtime, exec);
  for (let waited = 0; names.length && waited < waitMs; waited += POLL_MS) {
    await pause(POLL_MS);
    names = ownedContainers(runtime, exec);
  }
  if (names.length)
    throw new Error(
      `${names.length} container(s) with the label ${OWNER_LABEL} remain after ${waitMs} ms: ${names.join(", ")}`,
    );
}
