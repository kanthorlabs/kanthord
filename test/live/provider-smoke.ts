/**
 * MAINTAINER-RUN ONLY — not part of `npm test` (excluded by the `src/**\/*.test.ts` glob).
 *
 * Reads stored credentials from a kanthord data root (env KANTHORD_DATA; KANTHORD_DATA_ROOT accepted as fallback).
 * For each shipped provider kind (openai-codex, openai-compatible, github-copilot):
 *   - finds the first registered account of that kind (or the account whose label
 *     matches env KANTHORD_SMOKE_<KIND>_ACCOUNT, hyphens → underscores, uppercase)
 *   - builds a session via buildProviderSession
 *   - makes ONE real model call (single-turn, minimal marker prompt, maxTokens: 32)
 *   - asserts the response contains the expected marker string
 *   - captures cost + duration (no raw token value is ever printed)
 *   - appends a result row to the live-proof runbook
 *
 * Run inside Podman against an isolated credential copy:
 *   KANTHORD_DATA=/path/to/.data-live node test/live/provider-smoke.ts
 *   (KANTHORD_DATA_ROOT is also accepted as a fallback for the data root)
 *
 * Optional env overrides (replace hyphens with underscores, uppercase):
 *   KANTHORD_SMOKE_OPENAI_CODEX_ACCOUNT=<label>
 *   KANTHORD_SMOKE_OPENAI_COMPATIBLE_ACCOUNT=<label>
 *   KANTHORD_SMOKE_GITHUB_COPILOT_ACCOUNT=<label>
 *   KANTHORD_SMOKE_OPENAI_CODEX_MODEL=<model-id>
 *   KANTHORD_SMOKE_OPENAI_COMPATIBLE_MODEL=<model-id>
 *   KANTHORD_SMOKE_GITHUB_COPILOT_MODEL=<model-id>
 *
 * Exit 0 if all shipped kinds PASS. Exit 1 if any kind is skipped or fails.
 *
 * After a successful run, fill the table in:
 *   .agent/plan/feedback/019.4-ai-provider-integration/provider-live-proof.md
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Context } from "@earendil-works/pi-ai";

import { buildProviderSession } from "../../src/agent/provider-session.ts";
import {
  createProviderAccountRegistry,
} from "../../src/agent/provider-account-registry.ts";
import type {
  ProviderAccount,
  ProviderKind,
  ProviderAccountRegistry,
} from "../../src/agent/provider-account-registry.ts";
import { createProviderCredentialStore } from "../../src/agent/provider-credential-store.ts";
import type { ProviderCredentialStore } from "../../src/agent/provider-credential-store.ts";
import { createOpenAICompatibleConfigStore } from "../../src/agent/openai-compatible.ts";
import type { OpenAICompatibleConfigStore } from "../../src/agent/openai-compatible.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ARTIFACT_PATH = join(
  REPO_ROOT,
  ".agent",
  "plan",
  "feedback",
  "019.4-ai-provider-integration",
  "provider-live-proof.md",
);

const SHIPPED_KINDS: ProviderKind[] = [
  "openai-codex",
  "openai-compatible",
  "github-copilot",
];

/** Fallback model per kind when account has no defaultModel and no env override. */
const KIND_DEFAULT_MODEL: Partial<Record<ProviderKind, string>> = {
  "openai-codex": "gpt-5.4-mini",
  "github-copilot": "claude-haiku-4.5",
  // openai-compatible: derived from the stored config (no single fallback)
};

// ---------------------------------------------------------------------------
// Env-key helpers (no raw token values)
// ---------------------------------------------------------------------------

function accountEnvKey(kind: ProviderKind): string {
  return `KANTHORD_SMOKE_${kind.toUpperCase().replace(/-/g, "_")}_ACCOUNT`;
}

function modelEnvKey(kind: ProviderKind): string {
  return `KANTHORD_SMOKE_${kind.toUpperCase().replace(/-/g, "_")}_MODEL`;
}

function markerFor(kind: ProviderKind): string {
  return `KANTHORD_PROVIDER_SMOKE_${kind.toUpperCase().replace(/-/g, "_")}_OK`;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface SmokeKindResult {
  kind: ProviderKind;
  status: "PASS" | "FAIL" | "SKIP";
  accountLabel: string | undefined;
  modelId: string | undefined;
  durationMs: number | undefined;
  costTotal: number | undefined;
  skipReason: string | undefined;
  failReason: string | undefined;
}

// ---------------------------------------------------------------------------
// Per-kind smoke runner
// ---------------------------------------------------------------------------

async function smokeKind(
  kind: ProviderKind,
  registry: ProviderAccountRegistry,
  store: ProviderCredentialStore,
  openaiCompatibleConfigStore: OpenAICompatibleConfigStore,
): Promise<SmokeKindResult> {
  const skip = (reason: string, extras?: Partial<SmokeKindResult>): SmokeKindResult => ({
    kind,
    status: "SKIP",
    accountLabel: undefined,
    modelId: undefined,
    durationMs: undefined,
    costTotal: undefined,
    skipReason: reason,
    failReason: undefined,
    ...extras,
  });

  const fail = (reason: string, extras?: Partial<SmokeKindResult>): SmokeKindResult => ({
    kind,
    status: "FAIL",
    accountLabel: undefined,
    modelId: undefined,
    durationMs: undefined,
    costTotal: undefined,
    skipReason: undefined,
    failReason: reason,
    ...extras,
  });

  // 1. Resolve account
  const accounts = await registry.list({ kind });
  let account: ProviderAccount | undefined;

  const labelFilter = process.env[accountEnvKey(kind)];
  if (labelFilter !== undefined) {
    account = accounts.find((a) => a.label === labelFilter);
    if (account === undefined) {
      return skip(
        `no ${kind} account with label "${labelFilter}" registered`,
      );
    }
  } else {
    account = accounts[0];
    if (account === undefined) {
      return skip(`no ${kind} account registered`);
    }
  }

  // 2. Resolve model id
  let modelId: string;
  const modelEnvVal = process.env[modelEnvKey(kind)];
  if (modelEnvVal !== undefined) {
    modelId = modelEnvVal;
  } else if (account.defaultModel !== undefined) {
    modelId = account.defaultModel;
  } else if (kind === "openai-compatible") {
    // Load config to find first available model
    const config = await openaiCompatibleConfigStore.load(account.id);
    if (config === undefined) {
      return skip(
        `openai-compatible config not found for account "${account.id}" ("${account.label}")`,
        { accountLabel: account.label },
      );
    }
    const firstModel = config.models[0];
    if (firstModel === undefined) {
      return skip(
        `openai-compatible config has no models for account "${account.id}" ("${account.label}")`,
        { accountLabel: account.label },
      );
    }
    modelId = firstModel;
  } else {
    const fallback = KIND_DEFAULT_MODEL[kind];
    if (fallback === undefined) {
      return skip(
        `no default model defined for kind "${kind}"; set ${modelEnvKey(kind)}`,
        { accountLabel: account.label },
      );
    }
    modelId = fallback;
  }

  // 3. Build provider session
  let session: Awaited<ReturnType<typeof buildProviderSession>>;
  try {
    session = await buildProviderSession(
      { accountId: account.id, modelId },
      { registry, store, openaiCompatibleConfigStore },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return skip(`session build failed: ${msg}`, {
      accountLabel: account.label,
      modelId,
    });
  }

  // 4. Make one real model call — minimal single-turn marker prompt
  const marker = markerFor(kind);
  const userContent = `Reply with exactly this string and nothing else: ${marker}`;
  const context: Context = {
    messages: [{ role: "user", content: userContent, timestamp: Date.now() }],
  };

  const started = Date.now();
  try {
    const stream = session.streamFn(session.model, context, { maxTokens: 32 });
    const message = await stream.result();
    const durationMs = Date.now() - started;

    // Extract text without printing raw content
    let responseText = "";
    for (const c of message.content) {
      if (c.type === "text") {
        responseText += c.text;
      }
    }

    const markerFound = responseText.includes(marker);
    const costTotal = message.usage.cost.total;

    if (!markerFound) {
      return fail(
        `marker not found in response (response_bytes=${Buffer.byteLength(responseText, "utf8")})`,
        { accountLabel: account.label, modelId, durationMs, costTotal },
      );
    }

    return {
      kind,
      status: "PASS",
      accountLabel: account.label,
      modelId,
      durationMs,
      costTotal,
      skipReason: undefined,
      failReason: undefined,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`call error: ${msg}`, {
      accountLabel: account.label,
      modelId,
      durationMs,
    });
  }
}

// ---------------------------------------------------------------------------
// Artifact append
// ---------------------------------------------------------------------------

async function appendToArtifact(
  results: SmokeKindResult[],
  runAt: Date,
): Promise<void> {
  await mkdir(dirname(ARTIFACT_PATH), { recursive: true });

  const header =
    `\n## Run: ${runAt.toISOString()}\n\n` +
    `| Kind | Account | Model | Status | Marker OK | Cost | Duration | Notes |\n` +
    `| --- | --- | --- | --- | --- | --- | --- | --- |\n`;

  const rows = results.map((r) => {
    const markerOk =
      r.status === "PASS" ? "YES" : r.status === "FAIL" ? "NO" : "—";
    const cost =
      r.costTotal !== undefined ? `$${r.costTotal.toFixed(6)}` : "—";
    const duration =
      r.durationMs !== undefined ? `${r.durationMs}ms` : "—";
    const notes =
      r.status === "SKIP"
        ? (r.skipReason ?? "")
        : r.status === "FAIL"
          ? (r.failReason ?? "")
          : "";
    return (
      `| ${r.kind} | ${r.accountLabel ?? "—"} | ${r.modelId ?? "—"} ` +
      `| ${r.status} | ${markerOk} | ${cost} | ${duration} | ${notes} |`
    );
  });

  await appendFile(ARTIFACT_PATH, header + rows.join("\n") + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runProviderSmoke(): Promise<void> {
  const dataRoot =
    process.env["KANTHORD_DATA"] ?? process.env["KANTHORD_DATA_ROOT"];
  if (dataRoot === undefined) {
    throw new Error(
      "KANTHORD_DATA is required (KANTHORD_DATA_ROOT is accepted as a fallback). " +
        "Set it to an isolated credential copy (e.g. .data-live) before running.",
    );
  }

  const store = createProviderCredentialStore({ dataRoot });
  const registry = createProviderAccountRegistry({ dataRoot, store });
  const openaiCompatibleConfigStore = createOpenAICompatibleConfigStore({
    dataRoot,
  });

  const runAt = new Date();
  const results: SmokeKindResult[] = [];

  for (const kind of SHIPPED_KINDS) {
    console.log(`[provider-smoke] ${kind} — starting …`);
    const result = await smokeKind(
      kind,
      registry,
      store,
      openaiCompatibleConfigStore,
    );
    results.push(result);

    if (result.status === "PASS") {
      const cost =
        result.costTotal !== undefined
          ? `, cost $${result.costTotal.toFixed(6)}`
          : "";
      const duration =
        result.durationMs !== undefined ? `, ${result.durationMs}ms` : "";
      console.log(
        `[provider-smoke] ${kind} PASS — marker found${cost}${duration}`,
      );
    } else if (result.status === "SKIP") {
      console.log(
        `[provider-smoke] ${kind} SKIP — ${result.skipReason ?? "no account/credential"}`,
      );
    } else {
      console.error(
        `[provider-smoke] ${kind} FAIL — ${result.failReason ?? "unknown error"}`,
      );
    }
  }

  await appendToArtifact(results, runAt);
  console.log(`[provider-smoke] results appended to ${ARTIFACT_PATH}`);

  const anyNotPass = results.some((r) => r.status !== "PASS");
  if (anyNotPass) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Direct invocation entry point (node test/live/provider-smoke.ts)
// ---------------------------------------------------------------------------

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log("[provider-smoke] starting …");
  runProviderSmoke()
    .then(() => {
      if (process.exitCode !== 1) {
        console.log("[provider-smoke] PASS — all shipped kinds green");
      } else {
        console.log(
          "[provider-smoke] DONE — one or more kinds skipped or failed (exit 1)",
        );
      }
    })
    .catch((err: unknown) => {
      console.error("[provider-smoke] ERROR", err);
      process.exitCode = 1;
    });
}
