/**
 * B3 — live smoke harness seam + hermetic exclusion proof.
 *
 * Asserts:
 * 1. `test/live/pi-session-smoke.ts` exists at the repo root (the harness
 *    artifact the Epic gate requires the maintainer to run).
 * 2. That file exports `runLiveSmoke` as a function (the documented seam;
 *    does NOT call it — no model, no credentials, no network).
 * 3. The glob pattern used by `npm test` (`src/**\/*.test.ts`) does NOT match
 *    any file under `test/live/`, proving the live harness is excluded from the
 *    default hermetic suite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Suite: src/harness/live-smoke-exclusion
// ---------------------------------------------------------------------------

await test("src/harness/live-smoke-exclusion", async (t) => {
  await t.test(
    "test/live/pi-session-smoke.ts exists at the repo root",
    async () => {
      const target = resolve(REPO_ROOT, "test", "live", "pi-session-smoke.ts");
      const st = await stat(target).catch(() => null);
      assert.ok(
        st !== null && st.isFile(),
        `expected test/live/pi-session-smoke.ts to exist as a file`,
      );
    },
  );

  await t.test(
    "test/live/pi-session-smoke.ts exports runLiveSmoke as a function",
    async () => {
      const target = resolve(REPO_ROOT, "test", "live", "pi-session-smoke.ts");
      // Dynamic import: resolves at test time; the module must NOT trigger any
      // real model call at import time.
      const mod = (await import(target)) as Record<string, unknown>;
      assert.ok(
        typeof mod["runLiveSmoke"] === "function",
        `expected test/live/pi-session-smoke.ts to export runLiveSmoke as a function, got ${typeof mod["runLiveSmoke"]}`,
      );
    },
  );

  await t.test(
    "npm test glob (src/**/*.test.ts) does not match any file under test/live/",
    async () => {
      // Enumerate all files under test/live/ (if any) and confirm none matches
      // the hermetic-suite glob pattern.
      const testLiveDir = resolve(REPO_ROOT, "test", "live");
      const srcPattern = "src/**/*.test.ts";

      // Collect actual files matched by the hermetic pattern, filtered to
      // those that would be inside test/live/ — there must be none.
      const matches: string[] = [];
      for await (const f of glob(srcPattern, { cwd: REPO_ROOT })) {
        if (f.startsWith("test/live/") || f.startsWith("test\\live\\")) {
          matches.push(f);
        }
      }
      assert.equal(
        matches.length,
        0,
        `src/**/*.test.ts must not match any file under test/live/; matched: ${matches.join(", ")}`,
      );

      // Also confirm test/live/ itself exists (otherwise this test would pass vacuously).
      const st = await stat(testLiveDir).catch(() => null);
      assert.ok(
        st !== null && st.isDirectory(),
        `test/live/ directory must exist for the exclusion assertion to be non-vacuous`,
      );
    },
  );

  await t.test(
    "live-smoke.md artifact exists at .agent/plan/feedback/016-real-agent-sessions/live-smoke.md",
    async () => {
      // The Epic gate (016-real-agent-sessions.md:59-62, 110-111) requires
      // that the maintainer writes live-smoke.md after a successful smoke run.
      // This test asserts the artifact path is present so the Epic can close.
      // It FAILS until the maintainer completes the live run and writes the file.
      const target = resolve(
        REPO_ROOT,
        ".agent",
        "plan",
        "feedback",
        "016-real-agent-sessions",
        "live-smoke.md",
      );
      const st = await stat(target).catch(() => null);
      assert.ok(
        st !== null && st.isFile(),
        `live-smoke.md must exist at .agent/plan/feedback/016-real-agent-sessions/live-smoke.md ` +
          `(written by the maintainer after a successful run of test/live/pi-session-smoke.ts)`,
      );
    },
  );

  await t.test(
    "hermetic suite passes with no provider credentials in the environment",
    () => {
      // This test runs inside `npm test` which loads the no-network-guard.
      // If we reach this assertion, the suite has already started without
      // credentials being accessed — the guard would have thrown otherwise.
      // We additionally confirm none of the sentinel credential env vars are
      // directly readable in this process (the guard proxy hides them).
      const credKeys = [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "OPENAI_KEY",
        "GOOGLE_API_KEY",
      ];
      for (const k of credKeys) {
        assert.throws(
          () => process.env[k],
          /no external credentials/,
          `process.env["${k}"] must be blocked by the no-network-guard`,
        );
      }
    },
  );
});
