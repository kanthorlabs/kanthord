# Story 5 — provider probe (opt-in, billable)

Epic: `.agent/plan/epics/014-project-readiness-check.md`
Depends on: Story 4 (`makeRedactor` in `src/domain/redact.ts` must already exist).

## Change

### 1. New file `src/app/project/probe-ai-provider.ts`

A thin adapter over the **existing** `test ai-provider` path. No new model code, no
new session code, no new port: `TestAiProvider`
(`src/app/ai-provider/test-ai-provider.ts:11`, `execute({id, prompt}):
Promise<string>`) already wraps `ProviderProbe.probe`
(`src/agent-runner/port.ts:7-9`), whose real adapter is `PiProviderProbe`
(`src/agent-runner/pi-provider-probe.ts:13`).

```ts
// src/app/project/probe-ai-provider.ts — EPIC 014 Story 5

/** Fixed prompt: deterministic and minimal. This call is billable. */
export const PROVIDER_PROBE_PROMPT = "kanthord readiness probe";

export interface ProviderProbeOutcome {
  resourceId: string;
  status: "ok" | "failed";
  detail: string;
}

export class ProbeAiProvider {
  constructor(
    tester: { execute(input: { id: string; prompt: string }): Promise<string> },
    /** Reads the provider's folded secret so the failure detail can be redacted. */
    secretOf: (providerId: string) => string | null,
  );

  /** Probes exactly one provider. Never throws. */
  execute(providerId: string): Promise<ProviderProbeOutcome>;
}
```

`execute` body, pinned:

1. `const text = await this.#tester.execute({ id: providerId, prompt: PROVIDER_PROBE_PROMPT });`
2. On resolve → `{ resourceId: providerId, status: "ok", detail: "provider answered the probe prompt" }`.
   **Do not put the model's response text in `detail`** — the reply is model output,
   not a diagnosis, and it is unbounded.
3. On throw → `{ resourceId: providerId, status: "failed", detail }` where
   `detail = makeRedactor(this.#secretOf(providerId))(err instanceof Error ? err.message : String(err))`
   reduced to its first line, trimmed, truncated to 300 characters.

`PiProviderProbe` applies no redaction of its own
(`src/agent-runner/pi-provider-probe.ts:22-58` — errors from `sessions.for`
propagate raw), so this is the seam where redaction must happen.

### 2. `src/composition.ts` — construct only (no CLI wiring in this story)

`testAiProvider` already exists at `src/composition.ts:259`. Beside it add:

```ts
const probeAiProvider = new ProbeAiProvider(
  testAiProvider,
  (id) => aiProviderRegistry.get(id)?.value ?? null,
);
```

`GlobalAiProvider.value` is the folded secret (`src/storage/port.ts:283`). Pass an
arrow wrapper, never `aiProviderRegistry.get` bare — a bare method reference loses
`this` and crashes on the adapter's `#private` fields (AGENTS.md).

Expose it in the returned bundle (`src/composition.ts:850-920`) as
`providerProbe: probeAiProvider,` and declare `providerProbe: ProbeAiProvider;` on
`CliDeps` (`src/apps/cli/deps.ts:131`) with an `import type` at the top of
`deps.ts` (mirror `:19`).

The field name is `providerProbe` in both places — on `CliDeps` and in Story 6's
`CheckProjectDeps` — because EPIC 015 consumes `deps.providerProbe`. One name, no
alias.

**No structural mirror is needed here**, unlike Story 4's `repositoryProbe`:
`ProbeAiProvider` lives in `src/app/project/`, and `apps/` may depend on `app/`
(`eslint.config.js:39`). `CliDeps` already imports dozens of `app/` classes
(e.g. `src/apps/cli/deps.ts:58`). Import the class type directly — do **not**
declare a `CliProviderProbe` mirror, and do **not** import
`src/agent-runner/port.ts` (`ProviderProbe`) into `apps/`; that would be the
boundary violation.

Nothing calls it until Story 6.

## Constraints

- **No new model, session, catalog, or credential code.** The only permitted path
  to a provider is `TestAiProvider.execute`. If something is missing there, raise
  it as a blocker rather than reimplementing it.
- Exactly one provider is probed per run, chosen by Story 6 (the first member of
  the daemon's resolved chain). This story's `execute` takes one id and probes
  that one provider; it makes no selection of its own and never calls
  `listAssigned` or `getDefault`.
- `execute` never throws: a provider failure is data (`status: "failed"`), because
  a diagnostic command must still print the rest of the report.
- The detail must never contain the provider's secret. `makeRedactor` from
  `src/domain/redact.ts` is the only redactor; do not write another.
- Absent `--probe-provider` (Story 6), nothing here runs, and the `ai_provider`
  check stays `unverified` — Story 1's rule already guarantees that.

## Verify

- `node --test src/app/project/probe-ai-provider.test.ts` — new file, hermetic
  (inline fake tester, no network, no model):
  - a tester resolving `"ok, it is Monday"` → `{ resourceId: "p1", status: "ok" }`
    and `detail` does **not** contain the model text.
  - the tester is called exactly once, with `{ id: "p1", prompt: PROVIDER_PROBE_PROMPT }`.
  - a tester rejecting with `new Error("401 unauthorized")` →
    `{ status: "failed", detail: "401 unauthorized" }`, and `execute` resolves
    rather than rejecting.
  - a tester rejecting with `new Error("sk-secret is an invalid key")` and
    `secretOf` returning `"sk-secret"` → `detail` contains `***` and does not
    contain `sk-secret` (mirrors the assertion at
    `src/agent-runner/pi.test.ts:1159-1167`).
  - `secretOf` returning `null` → the message passes through unredacted and
    unchanged.
  - a rejection with a multi-line message → `detail` is the first line only; a
    5000-character message → `detail.length <= 300`.
  - a non-`Error` rejection (`"boom"`) → `detail === "boom"`.
- `npm run verify` exits 0.
- Proof: none directly — the Proof script never passes `--probe-provider` (it must
  stay free of model calls). Coverage for this story is the hermetic test above,
  plus Story 6's flag plumbing test.
