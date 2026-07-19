/**
 * EPIC 007.1 Part A — deterministic end-to-end smoke.
 *
 * Mirrors the Proof block in .agent/plan/epics/007.1-e2e-hardening.md (Part A).
 * No model, no network — pure CLI + real git in temp dirs.
 *
 * RED today: C1 `import graph --bind` not wired in router.ts (--bind is not in
 * the parse config and findResourcesByName / getResource are not injected).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildDeps } from "../../composition.ts";
import { dispatch } from "./router.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function gitSync(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function gitSHA(cwd: string, ref: string): string {
  return execFileSync("git", ["-C", cwd, "rev-parse", ref], {
    encoding: "utf8",
  }).trim();
}

test("EPIC 007.1 Part A: resource safety + import context + local landing + diagnostics export", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "kanthord-007.1-"));
  try {
    const dbPath = join(tmp, "kanthord.db");
    const deps = buildDeps(dbPath);

    // ---- db migrate ----
    const migrate = await dispatch(["db", "migrate"], deps);
    assert.equal(migrate.exitCode, 0, "db migrate exits 0");

    // ---- create project ----
    const rProj = await dispatch(["create", "project", "--name", "demo"], deps);
    assert.equal(rProj.exitCode, 0, "create project exits 0");
    const PROJECT = rProj.stdout[0]!;
    assert.match(PROJECT, ULID_RE, "create project returns a ULID");

    // ========== D4: secret input off argv ==========

    // D4(a): --value must be rejected (flag removed)
    const rBadCred = await dispatch(
      [
        "create",
        "credential",
        "--project",
        PROJECT,
        "--name",
        "k1",
        "--provider",
        "anthropic",
        "--value",
        "sk-plaintext",
      ],
      deps,
    );
    assert.equal(
      rBadCred.exitCode,
      1,
      `D4: --value must exit 1 (flag removed); got: ${JSON.stringify(rBadCred.stderr)}`,
    );

    // D4(b): --value-file <path> works
    const secretFile = join(tmp, "secret.txt");
    writeFileSync(secretFile, "sk-from-file\n");
    const rCred = await dispatch(
      [
        "create",
        "credential",
        "--project",
        PROJECT,
        "--name",
        "k1",
        "--provider",
        "anthropic",
        "--value-file",
        secretFile,
      ],
      deps,
    );
    assert.equal(
      rCred.exitCode,
      0,
      `D4: --value-file exits 0; stderr: ${JSON.stringify(rCred.stderr)}`,
    );
    const CRED = rCred.stdout[0]!;
    assert.match(CRED, ULID_RE, "D4: --value-file returns a ULID");

    // ========== D6: credential value structurally absent from serialization ==========

    const rGetCred = await dispatch(
      ["get", "resource", "--id", CRED, "--json"],
      deps,
    );
    assert.equal(
      rGetCred.exitCode,
      0,
      `D6: get resource exits 0; stderr: ${JSON.stringify(rGetCred.stderr)}`,
    );
    const credJson = rGetCred.stdout.join("");
    assert.ok(
      !credJson.includes("sk-from-file"),
      `D6: credential value 'sk-from-file' must not appear in resource JSON; got: ${credJson.slice(0, 200)}`,
    );

    // ========== D3: ModelCatalog validation at create AND update ==========

    // D3(a): unknown (provider, model) pair rejected at create
    const rBadAip = await dispatch(
      [
        "create",
        "ai-provider",
        "--project",
        PROJECT,
        "--name",
        "bad",
        "--provider",
        "openai-codex",
        "--model",
        "no-such-model-xyz",
        "--effort",
        "medium",
      ],
      deps,
    );
    assert.equal(
      rBadAip.exitCode,
      1,
      `D3: unknown model must exit 1; got exitCode: ${rBadAip.exitCode}`,
    );
    assert.ok(
      rBadAip.stderr.some((l) => /get models/i.test(l)),
      `D3: stderr must mention 'get models' for unknown model; got: ${JSON.stringify(rBadAip.stderr)}`,
    );

    // D3(b): known (provider, model) pair succeeds
    const rAip = await dispatch(
      [
        "create",
        "ai-provider",
        "--project",
        PROJECT,
        "--name",
        "gpt",
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-terra",
        "--effort",
        "medium",
      ],
      deps,
    );
    assert.equal(
      rAip.exitCode,
      0,
      `D3: valid model exits 0; stderr: ${JSON.stringify(rAip.stderr)}`,
    );
    const AIP = rAip.stdout[0]!;
    assert.match(AIP, ULID_RE, "D3: create ai-provider returns a ULID");

    // ========== D1: typed update commands ==========

    // D1(a): update ai-provider --model with valid pair succeeds
    const rUpd = await dispatch(
      ["update", "ai-provider", "--id", AIP, "--model", "gpt-5.6-sol"],
      deps,
    );
    assert.equal(
      rUpd.exitCode,
      0,
      `D1: update ai-provider --model valid exits 0; stderr: ${JSON.stringify(rUpd.stderr)}`,
    );

    // D1(b): update ai-provider --model with invalid pair rejected
    const rBadUpd = await dispatch(
      ["update", "ai-provider", "--id", AIP, "--model", "no-such-model-xyz"],
      deps,
    );
    assert.equal(
      rBadUpd.exitCode,
      1,
      "D1: update ai-provider invalid model exits 1",
    );

    // Confirm model was updated to gpt-5.6-sol (D1 state check)
    const rGetAip = await dispatch(
      ["get", "resource", "--id", AIP, "--json"],
      deps,
    );
    assert.equal(rGetAip.exitCode, 0, "D1: get resource for AIP exits 0");
    const aipJson = rGetAip.stdout.join("");
    assert.ok(
      aipJson.includes("gpt-5.6-sol"),
      `D1: updated model 'gpt-5.6-sol' must appear in resource JSON; got: ${aipJson.slice(0, 200)}`,
    );

    // ========== D2: repository transport identity ==========

    // D2(a): embedded userinfo in remoteUrl rejected
    const rBadRepo = await dispatch(
      [
        "create",
        "repository",
        "--project",
        PROJECT,
        "--name",
        "home",
        "--remote-url",
        "https://x-access-token:sk@github.com/o/r.git",
        "--branch",
        "main",
      ],
      deps,
    );
    assert.equal(
      rBadRepo.exitCode,
      1,
      `D2: embedded userinfo must exit 1; stderr: ${JSON.stringify(rBadRepo.stderr)}`,
    );

    // D2(b): create a real local git repo and repository resource with --path
    const homeDir = join(tmp, "home-repo");
    mkdirSync(homeDir);
    execFileSync("git", ["init", "-q", "-b", "main", homeDir], {
      stdio: "ignore",
    });
    gitSync(
      homeDir,
      "-c",
      "user.email=a@b.c",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    );

    const rRepo = await dispatch(
      [
        "create",
        "repository",
        "--project",
        PROJECT,
        "--name",
        "home",
        "--remote-url",
        `file://${homeDir}`,
        "--branch",
        "main",
        "--path",
        homeDir, // explicit path so resolveHomeDir returns homeDir
      ],
      deps,
    );
    assert.equal(
      rRepo.exitCode,
      0,
      `D2: clean remote-url exits 0; stderr: ${JSON.stringify(rRepo.stderr)}`,
    );
    const REPO = rRepo.stdout[0]!;
    assert.match(REPO, ULID_RE, "D2: create repository returns a ULID");

    // ========== C1: import graph --bind resolves aliases ==========

    // Write graph package files (initiative with 3-alias bindings)
    const srcDir = join(tmp, "graph");
    mkdirSync(srcDir);
    mkdirSync(join(srcDir, "api"));
    writeFileSync(
      join(srcDir, "todo.md"),
      [
        "---",
        "kind: initiative",
        "ref: todo",
        "name: todo",
        "bindings:",
        "  source: repository",
        "  model: ai_provider",
        "  model-auth: credential",
        "---",
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(srcDir, "api", "api.md"),
      [
        "---",
        "kind: objective",
        "ref: api",
        "initiative: todo",
        "name: api",
        "context:",
        "  source: source",
        "  model: model",
        "  model-auth: model-auth",
        "---",
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(srcDir, "api", "impl.md"),
      [
        "---",
        "kind: task",
        "ref: impl",
        "objective: api",
        "title: implement TODO API",
        "agent: generic@1",
        "---",
        "# Instructions",
        "Build 5 REST endpoints.",
        "# Acceptance Criteria",
        "- [ ] all endpoints return correct status codes",
      ].join("\n") + "\n",
    );

    // C1(a): missing --bind for model-auth alias → exit 1 mentioning model-auth
    // RED TODAY: --bind is not in router parse config → exitCode 1 with
    // "unknown option '--bind'" instead of "model-auth" in stderr
    const rMissingBind = await dispatch(
      [
        "import",
        "graph",
        srcDir,
        "--create",
        "--project",
        PROJECT,
        "--bind",
        `source=${REPO}`,
        "--bind",
        `model=${AIP}`,
      ],
      deps,
    );
    assert.equal(
      rMissingBind.exitCode,
      1,
      `C1: missing model-auth alias must exit 1; stderr: ${JSON.stringify(rMissingBind.stderr)}`,
    );
    assert.ok(
      rMissingBind.stderr.some((l) => /model-auth/i.test(l)),
      `C1: stderr must mention 'model-auth' for unbound alias; got: ${JSON.stringify(rMissingBind.stderr)}`,
    );

    // C1(b): all --bind provided → exit 0
    const rFullBind = await dispatch(
      [
        "import",
        "graph",
        srcDir,
        "--create",
        "--project",
        PROJECT,
        "--bind",
        `source=${REPO}`,
        "--bind",
        `model=${AIP}`,
        "--bind",
        `model-auth=${CRED}`,
      ],
      deps,
    );
    assert.equal(
      rFullBind.exitCode,
      0,
      `C1: all aliases bound exits 0; stderr: ${JSON.stringify(rFullBind.stderr)}`,
    );

    // C1(c): find the imported task and verify it has resolved context bindings
    const rFindInit = await dispatch(
      ["find", "initiative", "--project", PROJECT, "--name", "todo"],
      deps,
    );
    assert.equal(rFindInit.exitCode, 0, "C1: find initiative exits 0");
    const INITIATIVE = rFindInit.stdout[0]!.trim();
    assert.match(INITIATIVE, ULID_RE, "C1: find initiative returns a ULID");

    const rListTask = await dispatch(
      ["list", "task", "--initiative", INITIATIVE, "--json"],
      deps,
    );
    assert.equal(rListTask.exitCode, 0, "C1: list task exits 0");
    const tasks = JSON.parse(rListTask.stdout[0]!) as Array<{ id: string }>;
    assert.ok(
      tasks.length > 0,
      "C1: at least one task must exist after import",
    );
    const TASK = tasks[0]!.id;

    const rGetTask = await dispatch(
      ["get", "task", "--id", TASK, "--json"],
      deps,
    );
    assert.equal(rGetTask.exitCode, 0, "C1: get task exits 0");
    const taskObj = JSON.parse(rGetTask.stdout.join("")) as Record<
      string,
      unknown
    >;
    const ctx = taskObj["context"] as Record<string, string> | undefined;
    assert.ok(
      ctx &&
        typeof ctx["repository"] === "string" &&
        typeof ctx["ai_provider"] === "string" &&
        typeof ctx["credential"] === "string",
      `C1: task context must have repository, ai_provider, credential bindings; got: ${JSON.stringify(ctx)}`,
    );

    // ========== C2/D5: local landing to the canonical branch ==========

    // Set up workspace clone with a new commit
    const wsDir = join(tmp, "ws");
    execFileSync("git", ["clone", "-q", homeDir, wsDir], { stdio: "ignore" });
    gitSync(
      wsDir,
      "-c",
      "user.email=a@b.c",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "task output",
    );
    const CAND = gitSHA(wsDir, "HEAD");

    // C2: repo land lands candidate to home/main
    const rLand = await dispatch(
      [
        "repo",
        "land",
        "--repository",
        REPO,
        "--workspace",
        wsDir,
        "--base",
        "main",
        "--candidate",
        CAND,
      ],
      deps,
    );
    assert.equal(
      rLand.exitCode,
      0,
      `C2: repo land exits 0; stderr: ${JSON.stringify(rLand.stderr)}`,
    );
    const landResult = JSON.parse(rLand.stdout.join("")) as {
      outcome: string;
    };
    assert.ok(
      ["fast-forward", "merge"].includes(landResult.outcome),
      `C2: repo land outcome must be fast-forward or merge; got: ${landResult.outcome}`,
    );

    // C2: home/main must now contain the candidate commit
    const homeHead = gitSHA(homeDir, "HEAD");
    assert.equal(
      homeHead,
      CAND,
      "C2: home/main HEAD must equal candidate SHA after landing",
    );

    // D5: re-landing the same candidate is idempotent
    const rReLand = await dispatch(
      [
        "repo",
        "land",
        "--repository",
        REPO,
        "--workspace",
        wsDir,
        "--base",
        "main",
        "--candidate",
        CAND,
      ],
      deps,
    );
    assert.equal(rReLand.exitCode, 0, "D5: re-land exits 0");
    const reLandOut = JSON.parse(rReLand.stdout.join("")) as {
      outcome: string;
    };
    assert.equal(
      reLandOut.outcome,
      "already-landed",
      `D5: re-land must report already-landed; got: ${reLandOut.outcome}`,
    );

    // ========== A: diagnostics export — single sanitized artifact ==========

    const diagOut = join(tmp, "diag.json");
    const rDiag = await dispatch(
      ["diagnostics", "export", "--initiative", INITIATIVE, "--out", diagOut],
      deps,
    );
    assert.equal(
      rDiag.exitCode,
      0,
      `A: diagnostics export exits 0; stderr: ${JSON.stringify(rDiag.stderr)}`,
    );

    const diagJson = JSON.parse(readFileSync(diagOut, "utf8")) as Record<
      string,
      unknown
    >;
    assert.ok(diagJson["schemaVersion"], "A: export has schemaVersion field");
    assert.ok(
      Array.isArray(diagJson["records"]),
      "A: export has records array",
    );

    // A canary: sensitive strings must NOT appear in the shareable artifact
    const diagStr = readFileSync(diagOut, "utf8");
    for (const needle of [
      "sk-from-file",
      "gpt-5.6-sol",
      "sk-plaintext",
      CAND.slice(0, 8), // partial SHA (commit text)
    ]) {
      assert.ok(
        !diagStr.includes(needle),
        `A canary: '${needle}' must not appear in diagnostics export`,
      );
    }

    console.log("Part A OK");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
