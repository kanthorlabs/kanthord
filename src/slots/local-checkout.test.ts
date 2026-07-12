/**
 * Tests for src/slots/local-checkout
 * Story 001 — self-clone into a PAT-authenticated local checkout
 * Task T1   — bootstrapLocalCheckout (clone + auth config)
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { runGit } from "../git/exec.ts";
import { bootstrapLocalCheckout } from "./local-checkout.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a local bare repo with one seed commit; return the bare path. */
async function makeBareRemote(base: string): Promise<string> {
  const bareDir = join(base, "remote.git");
  const seedClone = join(base, "seed");
  execSync(`git init --bare -q "${bareDir}"`);
  execSync(`git clone -q "${bareDir}" "${seedClone}"`);
  execSync(`git -C "${seedClone}" config user.email "t@t.com"`);
  execSync(`git -C "${seedClone}" config user.name "T"`);
  execSync(
    `git -C "${seedClone}" commit --allow-empty -m "seed commit" -q`,
  );
  execSync(`git -C "${seedClone}" push -q`);
  await rm(seedClone, { recursive: true, force: true });
  return bareDir;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("src/slots/local-checkout", () => {
  describe("bootstrapLocalCheckout — clone + auth config", () => {
    test("clones bare remote and returns checkoutDir path", async () => {
      const base = await mkdtemp(join(tmpdir(), "kanthord-blc-"));
      try {
        const repoUrl = await makeBareRemote(base);
        const checkoutDir = join(base, "checkout");

        const result = await bootstrapLocalCheckout({
          repoUrl,
          identityToken: "tkn_fake",
          checkoutDir,
          runGit,
        });

        assert.equal(result, checkoutDir);
        const gitDir = execSync("git rev-parse --git-dir", {
          cwd: checkoutDir,
          encoding: "utf8",
        }).trim();
        assert.ok(gitDir.length > 0, "checkoutDir is a git repo");
        const log = execSync("git log --oneline", {
          cwd: checkoutDir,
          encoding: "utf8",
        });
        assert.ok(log.includes("seed commit"), "seed commit present in log");
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    test("http.extraHeader in checkout local config carries the token", async () => {
      const base = await mkdtemp(join(tmpdir(), "kanthord-blc-"));
      try {
        const repoUrl = await makeBareRemote(base);
        const checkoutDir = join(base, "checkout");

        await bootstrapLocalCheckout({
          repoUrl,
          identityToken: "tkn_fake",
          checkoutDir,
          runGit,
        });

        const header = execSync("git config --local http.extraHeader", {
          cwd: checkoutDir,
          encoding: "utf8",
        }).trim();

        assert.ok(header.length > 0, "http.extraHeader is set");
        assert.ok(
          header.startsWith("Authorization:"),
          `http.extraHeader must start with "Authorization:" — got: ${header}`,
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    test("remote URL does not contain the identity token", async () => {
      const base = await mkdtemp(join(tmpdir(), "kanthord-blc-"));
      try {
        const repoUrl = await makeBareRemote(base);
        const checkoutDir = join(base, "checkout");

        await bootstrapLocalCheckout({
          repoUrl,
          identityToken: "tkn_fake",
          checkoutDir,
          runGit,
        });

        const remoteUrl = execSync("git remote get-url origin", {
          cwd: checkoutDir,
          encoding: "utf8",
        }).trim();

        assert.ok(
          !remoteUrl.includes("tkn_fake"),
          `remote URL must not contain the token — got: ${remoteUrl}`,
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    test("second call is a no-op: succeeds without re-cloning, tree untouched", async () => {
      const base = await mkdtemp(join(tmpdir(), "kanthord-blc-"));
      try {
        const repoUrl = await makeBareRemote(base);
        const checkoutDir = join(base, "checkout");

        await bootstrapLocalCheckout({
          repoUrl,
          identityToken: "tkn_fake",
          checkoutDir,
          runGit,
        });

        // Write a marker file to verify the tree is not clobbered
        execSync(`echo "marker" > "${join(checkoutDir, "marker.txt")}"`);

        const result2 = await bootstrapLocalCheckout({
          repoUrl,
          identityToken: "tkn_fake",
          checkoutDir,
          runGit,
        });
        assert.equal(result2, checkoutDir, "second call returns checkoutDir");

        const markerOut = execSync(
          `test -f "${join(checkoutDir, "marker.txt")}" && echo "yes"`,
          { encoding: "utf8" },
        ).trim();
        assert.equal(markerOut, "yes", "marker file survives second call");
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });

    test("thrown error carries no identity token", async () => {
      const base = await mkdtemp(join(tmpdir(), "kanthord-blc-"));
      try {
        const checkoutDir = join(base, "checkout");
        const badRepoUrl = join(base, "nonexistent-remote.git");

        await assert.rejects(
          () =>
            bootstrapLocalCheckout({
              repoUrl: badRepoUrl,
              identityToken: "tkn_fake",
              checkoutDir,
              runGit,
            }),
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            assert.ok(
              !msg.includes("tkn_fake"),
              `error must not contain the token — got: ${msg}`,
            );
            return true;
          },
        );
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    });
  });
});
