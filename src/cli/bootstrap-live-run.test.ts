/**
 * src/cli/bootstrap-live-run — assembler test (Story 004 T1)
 *
 * Hermetic: local bare git repo as "remote"; temp dataRoot with 0600 identity
 * file; fake providerModel/providerStreamFn + agentFactory (no real Agent);
 * injected runGit (local subprocess only — no network guard trigger).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { runGit } from "../git/exec.ts";
import type { RepoSlot } from "../slots/repo-slot.ts";
import { bootstrapLiveRun } from "./bootstrap-live-run.ts";
import { runDaemon } from "../daemon/run-loop.ts";
import { FakeClock } from "../foundations/clock.ts";
import { compile } from "../compiler/compile.ts";
import { loadTasks } from "../scheduler/dispatch.ts";

// Fake agent factory — prevents real pi-agent instantiation
const fakeAgentFactory = (_opts: unknown) => ({
  abort: (): void => {},
  waitForIdle: async (): Promise<void> => {},
  reset: (): void => {},
});

describe("src/cli/bootstrap-live-run", () => {
  let dataRoot = "";
  let bareDir = "";
  let deps: Awaited<ReturnType<typeof bootstrapLiveRun>>;

  const slot = (): RepoSlot => ({
    repo: bareDir,
    strategy: "worktree",
    maxConcurrentTasks: 1,
    workflowsAllowed: [],
    identity: "test-identity",
  });

  before(async () => {
    // 1. Create a local bare "remote" repo
    bareDir = await mkdtemp(join(tmpdir(), "blr-bare-"));
    execSync("git init --bare .", { cwd: bareDir, stdio: "pipe" });

    // 2. Create temp dataRoot + 0600 identity file
    dataRoot = await mkdtemp(join(tmpdir(), "blr-data-"));
    const identityFile = join(dataRoot, "test-identity");
    await writeFile(identityFile, "fake-pat-token-abc123\n", "utf8");
    await chmod(identityFile, 0o600);

    // 3. Run the assembler once; all sub-tests share the result
    deps = await bootstrapLiveRun({
      slot: slot(),
      dataRoot,
      providerModel: { provider: "acct_blr", id: "fake-model" } as unknown,
      providerStreamFn: (async (): Promise<undefined> => undefined) as unknown,
      runGit,
      agentFactory: fakeAgentFactory,
    });
  });

  after(async () => {
    deps?.store?.close();
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
    if (bareDir) await rm(bareDir, { recursive: true, force: true });
  });

  it("featureDir is under local checkout (not the bare-repo URL)", () => {
    assert.ok(
      deps.featureDir.startsWith(dataRoot),
      `featureDir "${deps.featureDir}" must be under dataRoot "${dataRoot}"`,
    );
    assert.ok(
      !deps.featureDir.startsWith(bareDir),
      `featureDir "${deps.featureDir}" must not start with bare-repo path "${bareDir}"`,
    );
  });

  it("verbAdapters includes git.push and github.create_pr", () => {
    assert.ok(deps.verbAdapters !== undefined, "verbAdapters must be defined");
    const va = deps.verbAdapters as Record<string, unknown>;
    assert.ok("git.push" in va, "verbAdapters must include git.push");
    assert.ok("github.create_pr" in va, "verbAdapters must include github.create_pr");
  });

  it("commitsAhead is a function", () => {
    assert.strictEqual(typeof deps.commitsAhead, "function");
  });

  it("worktreeSlot.worktreesBase is a non-empty string", () => {
    assert.ok(deps.worktreeSlot !== undefined, "worktreeSlot must be defined");
    assert.ok(
      typeof deps.worktreeSlot.worktreesBase === "string" &&
        deps.worktreeSlot.worktreesBase.length > 0,
      "worktreesBase must be a non-empty string",
    );
  });

  // Story 004 AC2 — integration: boots runDaemon with bootstrapLiveRun deps,
  // drives a completed session with ≥1 commit ahead (mock), and confirms that
  // BOTH the push adapter submit AND the create_pr adapter submit fire.
  // First-run pass is expected: the delivery path is already implemented; this
  // test pins the AC2 contract that was absent from the prior cycle.
  it("boots runDaemon with bootstrapLiveRun deps; tick triggers push + create_pr delivery", async () => {
    // 1. Ensure featureDir + story subdir exist (bootstrapLiveRun does not create them)
    await mkdir(join(deps.featureDir, "001-story"), { recursive: true });

    // 2. Minimal valid feature fixture (all mandatory sections + ticket per task)
    const epicMd = [
      "---",
      "id: feat-blr-integ",
      "repo: blr-test",
      "ticket_system: github",
      "ticket: BLR-0",
      "---",
      "",
      "## Acceptance",
      "",
      "Feature complete when task-integ passes.",
    ].join("\n");
    const taskMd = [
      "---",
      "id: task-integ",
      "workflow: tdd@1",
      "repo: blr-test",
      "ticket_system: github",
      "ticket: BLR-1",
      "write_scope:",
      "  - src/",
      "---",
      "",
      "## Prerequisites",
      "",
      "None.",
      "",
      "## Inputs",
      "",
      "Input.",
      "",
      "## Outputs",
      "",
      "Output.",
      "",
      "## Tests",
      "",
      "Tests.",
    ].join("\n");
    await writeFile(join(deps.featureDir, "epic.md"), epicMd, "utf8");
    await writeFile(join(deps.featureDir, "RUNBOOK.md"), "# Runbook\n", "utf8");
    await writeFile(join(deps.featureDir, "001-story", "INDEX.md"), "# Story Integ\n", "utf8");
    await writeFile(join(deps.featureDir, "001-story", "task-integ.md"), taskMd, "utf8");

    // 3. Recording adapters — count submit() calls; poll_status/reconcile are stubs
    let pushSubmitCalls = 0;
    let createPrSubmitCalls = 0;
    const recordingPushAdapter = {
      submit: async (_input: unknown): Promise<unknown> => {
        pushSubmitCalls++;
        return "req-push-blr-001";
      },
      poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    };
    const recordingCreatePrAdapter = {
      submit: async (_input: unknown): Promise<unknown> => {
        createPrSubmitCalls++;
        return "req-pr-blr-001";
      },
      poll_status: async (_: unknown): Promise<unknown> => ({ status: "done" }),
      reconcile: async (_: unknown): Promise<unknown> => ({ status: "done" }),
    };

    // 4. VerbRegistryEntry-shaped objects (no import needed; cast bypasses types)
    const pushEntry = {
      verb: "git.push", tier: "auto", timeout: 30000,
      idempotency: { window_ms: 3600000 }, retry: { max: 3, backoff: "exponential" },
      poll_interval: 50, terminal_states: ["done", "failed"],
      rate_limit: { requests_per_minute: 0 }, observed_state_can_regress: false,
    };
    const createPrEntry = {
      verb: "github.create_pr", tier: "auto_with_audit", timeout: 30000,
      idempotency: { window_ms: 3600000 }, retry: { max: 3, backoff: "exponential" },
      poll_interval: 50, terminal_states: ["done", "failed", "merged"],
      rate_limit: { requests_per_minute: 60 }, observed_state_can_regress: false,
    };

    // 5. Mock worktree dispatch (avoids real git worktree ops on the empty checkout)
    const mockBranchName = "blr-integ-branch";
    const mockWorktreePath = join(dataRoot, "wt-blr-integ");
    const mockDispatch = async (_opts: unknown): Promise<unknown> =>
      ({ worktreePath: mockWorktreePath, branchName: mockBranchName, queued: false });

    // 6. Boot runDaemon with bootstrapLiveRun deps + recording overrides.
    //    piSurface / logger / statusServerFactory come from deps (buildRealDeps
    //    wires fakeAgentFactory); clock is overridden to FakeClock for test control.
    //    patternRegistry: undefined disables the outbound scan guard (null = block-all).
    //    The as-unknown cast bypasses excess-property checking on the spread.
    const handle = await runDaemon({
      ...deps,
      clock: new FakeClock(1_000_000_000),
      patternRegistry: undefined,
      verbAdapters: {
        "git.push": { entry: pushEntry, adapter: recordingPushAdapter },
        "github.create_pr": { entry: createPrEntry, adapter: recordingCreatePrAdapter },
      },
      commitsAhead: async (_b: string, _base: string): Promise<number> => 1,
      worktreeSlot: {
        worktreesBase: join(dataRoot, "worktrees"),
        repoPath: dataRoot,
        dispatch: mockDispatch,
      },
    } as unknown as Parameters<typeof runDaemon>[0]);

    try {
      // 7. Compile feature plan into the store + mark task-integ dispatchable
      await compile(deps.featureDir, deps.store, { repoRegistry: ["blr-test"] });
      loadTasks(deps.store, "feat-blr-integ");

      // 8. One tick: dispatches task → fake session completes → commitsAhead=1 → delivery
      await handle.tick();

      // 9. Story 004 AC2: both adapters must have had submit() called at least once
      assert.ok(
        pushSubmitCalls >= 1,
        `push adapter submit must fire; got ${pushSubmitCalls} calls`,
      );
      assert.ok(
        createPrSubmitCalls >= 1,
        `create_pr adapter submit must fire; got ${createPrSubmitCalls} calls`,
      );
    } finally {
      await handle.stop().catch(() => {});
    }
  });
});
