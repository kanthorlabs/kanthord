/**
 * Harness kit — Story 001 T1 (Epic 010).
 *
 * Assembles the deterministic lifecycle fixture: fake clock (Epic 001), fake
 * broker (Epic 005 AsyncVerbAdapter), temp SQLite store (Epic 003), a real
 * initialized temp git repo (kit parity, review B2), and the daemon
 * crash/restart entrypoint (Epic 009).
 */

import { FakeClock } from "../foundations/clock.ts";
import { openStore, type Store } from "../foundations/sqlite-store.ts";
import { bootDaemon, type DaemonLifecycle } from "../daemon/boot.ts";
import type { AsyncVerbAdapter } from "../broker/registry.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// HarnessFixture — public surface
// ---------------------------------------------------------------------------

export interface HarnessFixture {
  /** Deterministic fake clock; advance with clock.advance(ms). */
  clock: FakeClock;
  /** Fake async-verb adapter — records submits, returns configurable results. */
  broker: AsyncVerbAdapter;
  /** Temp SQLite store (in-memory); shared across all fixture components. */
  store: Store;
  /** Real initialized temp git repo (kit parity — one commit landed). */
  gitRepo: { dir: string };
  /** Daemon lifecycle wired on the feature dir / store / clock above. */
  boot: DaemonLifecycle;
  /** Cleanup: closes the store and removes all temp directories. */
  [Symbol.asyncDispose](): Promise<void>;
}

// ---------------------------------------------------------------------------
// harness() factory
// ---------------------------------------------------------------------------

/**
 * Create and wire all fixture components.  Call `await h[Symbol.asyncDispose]()`
 * (or use `await using h = await harness()`) to clean up after the test.
 */
export async function harness(): Promise<HarnessFixture> {
  // ------------------------------------------------------------------
  // Clock — deterministic fake; starts at a stable epoch
  // ------------------------------------------------------------------
  const clock = new FakeClock(1_000_000_000);

  // ------------------------------------------------------------------
  // Broker — minimal fake AsyncVerbAdapter (submit → poll → reconcile)
  // ------------------------------------------------------------------
  const broker: AsyncVerbAdapter = {
    async submit(input: unknown): Promise<unknown> {
      return { requestId: `fake-req-${String(input)}`, status: "pending" };
    },
    async poll_status(requestId: unknown): Promise<unknown> {
      return { requestId, status: "success" };
    },
    async reconcile(ledger: unknown): Promise<unknown> {
      return { reconciled: true, ledger };
    },
  };

  // ------------------------------------------------------------------
  // Store — in-memory SQLite, no filesystem artefact needed for T1
  // ------------------------------------------------------------------
  const store = openStore(":memory:", { busyTimeout: 1000 });

  // ------------------------------------------------------------------
  // Feature dir — minimal empty dir; walkFeature returns empty groups
  // ------------------------------------------------------------------
  const featureDir = await mkdtemp(join(tmpdir(), "kharness-feat-"));

  // ------------------------------------------------------------------
  // Git repo — real initialized temp repo, one commit (review B2 kit parity).
  // Controlled local config avoids host-environment flakes in CI.
  // ------------------------------------------------------------------
  const gitDir = await mkdtemp(join(tmpdir(), "kharness-git-"));

  execFileSync("git", ["init", "-b", "main"], {
    cwd: gitDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Harness"], {
    cwd: gitDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.email", "harness@kanthord.local"], {
    cwd: gitDir,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: gitDir,
    stdio: "pipe",
  });

  await writeFile(join(gitDir, ".gitkeep"), "", "utf8");

  execFileSync("git", ["add", "."], { cwd: gitDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "Initial harness commit"], {
    cwd: gitDir,
    stdio: "pipe",
  });

  // ------------------------------------------------------------------
  // Boot — daemon lifecycle wired on the temp feature dir
  // ------------------------------------------------------------------
  const logger = {
    info(_record: Record<string, unknown>): void {
      // no-op in the harness; scenario tests inject real loggers if needed
    },
  };

  const boot = bootDaemon({
    featureDir,
    clock,
    store,
    logger,
    compileOpts: { repoRegistry: ["backend"] },
  });

  // ------------------------------------------------------------------
  // Fixture
  // ------------------------------------------------------------------
  return {
    clock,
    broker,
    store,
    gitRepo: { dir: gitDir },
    boot,
    async [Symbol.asyncDispose](): Promise<void> {
      store.close();
      await rm(featureDir, { recursive: true, force: true });
      await rm(gitDir, { recursive: true, force: true });
    },
  };
}
