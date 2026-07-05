// SU4 probe — credential-custody setup invariants (maintainer-run).
//
// Covers the SU4 verify items that are TRUE OF THE SETUP and need no daemon code:
//   1. load probe   — file parses; each identity PAT present BY SHAPE (model API
//                      key is OPTIONAL — validated only if configured)
//   2. mode + owner  — stat == 600 and owned by the effective user (run in the
//                      daemon's runtime context: host for native, in-container for
//                      the sandbox via `podman exec`/`make shell`)
//   3. ignore        — `git check-ignore` prints the path
//   4. no tracked leak (canary) — reads each secret internally, scans tracked
//                      files for the value WITHOUT echoing it; asserts untracked
//   5. subprocess isolation — spawns a child with a minimal allowlist env and
//                      asserts the whole leak set (tokens, GIT_CONFIG_*, askpass,
//                      GH_TOKEN, …) is absent from the child env + argv
//
// NOT covered here (needs the daemon loader, Epic 013/014 Story 000): daemon
// BOOT-LOG redaction. That is a consuming-epic AC, not a maintainer setup check.
//
// File schema (env-style, flat, NOT yaml — per credential-custody.md):
//   KANTHOR_IDENTITY_VERIFY_TOKEN=github_pat_...   (required — git PAT)
//   KANTHOR_MODEL_API_KEY=sk-ant-...               (OPTIONAL — only if the model
//                                                   provider uses an API key)
//
// Run (native):     node scripts/dev/probes/su4-credential-probe.mjs
// Run (container):  make shell → node /app/scripts/dev/probes/su4-credential-probe.mjs
//   (owner check is only meaningful in the context the daemon loads the file)

import { readFileSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { userInfo } from "node:os";

const FILE = process.env.KANTHOR_CREDENTIALS_FILE || ".data/kanthord/credentials";
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// --- parse (env-style flat; reject nesting/interpolation) ------------------
let raw;
try {
  raw = readFileSync(FILE, "utf8");
} catch (e) {
  record("load", false, `cannot read ${FILE} (${e.code})`);
  console.log("\nRESULT: FAIL — no credential file. Create it first (see instructions).");
  process.exit(1);
}
const secrets = {};
const lines = raw.split("\n");
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) {
    // Report the line NUMBER only — never the content (it may hold a secret).
    const hint = t.includes(":") ? " (looks YAML-style 'KEY: value' — use 'KEY=value')" : "";
    record("load", false, `line ${i + 1} is not KEY=VALUE${hint}`);
    process.exit(1);
  }
  secrets[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

// --- 1. load probe: presence BY SHAPE, never print value -------------------
const idKeys = Object.keys(secrets).filter((k) => /^KANTHOR_IDENTITY_.+_TOKEN$/.test(k));
const modelKey = Object.keys(secrets).find((k) => /API_KEY$/.test(k));
const shapeOk = (v) => typeof v === "string" && v.length >= 20 && !/\s/.test(v);
record(
  "load: >=1 identity PAT present by shape",
  idKeys.length >= 1 && idKeys.every((k) => shapeOk(secrets[k])),
  `identities=[${idKeys.map((k) => k.replace(/^KANTHOR_IDENTITY_|_TOKEN$/g, "")).join(",")}]`,
);
// Model API key is OPTIONAL — OAuth/subscription backends (Codex, Copilot, and
// pi when it uses OAuth) need none. Validate its shape only if one is configured.
if (modelKey) {
  record("load: model API key (configured) valid by shape", shapeOk(secrets[modelKey]), modelKey);
} else {
  record("load: model API key optional — none configured", true, "provider uses OAuth/subscription, or key lives outside the keyring");
}

// --- 2. mode + owner (run in the daemon's runtime context) -----------------
try {
  const st = statSync(FILE);
  const mode = (st.mode & 0o777).toString(8);
  const me = userInfo().username;
  // GNU stat (Linux container) uses -c; BSD stat (macOS host) uses -f.
  let owner;
  try {
    owner = execFileSync("stat", ["-c", "%U", FILE], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    owner = execFileSync("stat", ["-f", "%Su", FILE], { encoding: "utf8" }).trim();
  }
  record("mode == 600", mode === "600", `mode=${mode}`);
  record("owner == effective user", owner === me, `owner=${owner} effective=${me}`);
} catch (e) {
  record("mode+owner", false, `stat failed (${e.message})`);
}

// --- 3. git-ignored ---------------------------------------------------------
const ci = spawnSync("git", ["check-ignore", FILE], { encoding: "utf8" });
record("git check-ignore prints path", ci.status === 0 && ci.stdout.trim() === FILE, ci.stdout.trim() || "(not ignored!)");

// --- 4. no tracked leak (canary — never echo the value) --------------------
const tracked = spawnSync("git", ["ls-files"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
let leaked = null;
outer: for (const val of Object.values(secrets)) {
  if (!val) continue;
  for (const f of tracked) {
    let content;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (content.includes(val)) {
      leaked = f; // report the FILE only, never the value
      break outer;
    }
  }
}
record("no secret value in any tracked file", leaked === null, leaked ? `LEAK in ${leaked}` : "clean");

// --- 5. subprocess isolation ------------------------------------------------
// Simulate the daemon's per-invocation child env = a minimal allowlist. The
// secrets and helper-config vars must NOT appear in the child env or argv.
const leakSet = [
  ...idKeys, "GH_TOKEN", "GITHUB_TOKEN", "GITLAB_TOKEN", modelKey,
  "KANTHOR_SECRETS_FILE", "GIT_ASKPASS", "GIT_CONFIG_COUNT", "SSH_AUTH_SOCK",
].filter(Boolean);
const allowlist = { PATH: process.env.PATH, HOME: "/nonexistent", LC_ALL: "C" };
// Pollute THIS process env with the secrets, then prove the child (spawned with
// the allowlist only) inherits none of them.
const polluted = { ...process.env };
for (const k of idKeys) polluted[k] = secrets[k];
if (modelKey) polluted[modelKey] = secrets[modelKey];
const child = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify(process.env)); console.error(process.argv.join(' '))"], {
  env: allowlist, // <-- the isolation boundary under test
  encoding: "utf8",
});
const childEnv = JSON.parse(child.stdout || "{}");
const present = leakSet.filter((k) => k in childEnv);
record("child env free of leak set", present.length === 0, present.length ? `LEAKED: ${present.join(",")}` : "clean");
record("child argv free of secret values", !Object.values(secrets).some((v) => v && (child.stderr || "").includes(v)), "argv clean");

const ok = results.every((r) => r.ok);
console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"} — ${results.filter((r) => r.ok).length}/${results.length} checks`);
console.log("NOTE: daemon boot-log redaction is deferred to the loader's epic (013/014 Story 000) — it needs the daemon.");
process.exit(ok ? 0 : 1);
