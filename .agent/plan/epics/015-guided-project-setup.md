# EPIC 015 — Guided project setup (`setup project`)

> Routine 1 (onboarding) proper, chosen by Ulrich on 2026-07-27. A fifth debate
> then rejected the first draft's core premise — that EPIC 014's readiness report
> could serve as the wizard's state store — and this version replaces it with
> explicit reconciliation. 014 is used as the FINAL diagnostic, not as the
> equivalence oracle.
>
> Depends on `014-project-readiness-check.md` for the closing verdict and for the
> repository access probe.

## Goal

A user who knows nothing about kanthord runs one command and ends with a project
that is configured and verified. `kanthord setup project [--answers <file>]
[--non-interactive]` gathers the decisions kanthord cannot infer — project name,
repository remote / branch / local path / auth mode and its credential, provider
route (OAuth login, API key, or custom OpenAI-compatible), and an optional graph
package — then applies each step by **reconciling requested state against actual
state**: absent → create, present and equivalent → skip, present but different →
**fail with a drift report**, ambiguous → fail. It never silently mutates an
existing working project. Answers are validated completely **before any write**,
so a missing answer costs nothing. A step that fails or is interrupted leaves
earlier steps applied, and the next run continues from the first unsatisfied one.
It ends by printing the project id, the readiness verdict, and the exact command
to start the daemon — it never starts one.

Two terminal successes are distinguished, because they are not the same promise:
`configured-with-work` (a graph was imported, so a daemon will have something to
run) and `configured-no-work` (the graph step was skipped, so the user must
import one before anything runs). Both exit `0`; only the first claims work will
execute.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).
Hermetic coverage required beyond the Proof:

- **The plan is pure; reconciliation is explicit.**
  `src/app/project/setup-plan.ts` maps `(observedFacts, answers) → next step`
  with zero I/O. `observedFacts` carries **identities and the configuration
  fields that matter** — the repository's remote/branch/path/auth and credential
  reference, the assigned providers with route/model/baseUrl, the imported
  graph's initiative and its `source` binding — never the coarse 014 statuses.
  Each object's four outcomes (create / skip / drift / ambiguous) are unit-tested.
- **Drift fails loudly.** A rerun whose `repository.remoteUrl`, `branch`, `path`,
  `auth`, `provider.model`, `provider.baseUrl`, `provider.route`, or
  `graph.packagePath` differs from what exists exits non-zero with an
  expected-vs-actual report and a remediation command. Tested per field. No
  `--reconcile` / force path ships in this epic.
- **Project identity is resolved by name with defined multiplicity.** Zero
  matches → create; exactly one → reuse; more than one → fail naming the
  candidate ids (`resolveProjectByName` returns a list, so duplicates are
  reachable).
- **Answers are preflight-validated atomically.** The complete route-specific
  required set is checked before the first write. A missing key exits non-zero
  naming the key with **zero** database writes — asserted by comparing a full
  table-row-count snapshot before and after, not by counting projects.
- **The answer schema is enumerated and closed**, with grammar pinned: one
  `key=value` per line, split at the first `=`, `#` comments and blank lines
  ignored, values not shell-unescaped, relative paths resolved against the
  answers file's directory, unknown key → error naming it, duplicate key →
  error, a key irrelevant to the chosen route → error (not a silent ignore).
  Booleans are exactly `true`/`false`. Graph bindings are repeated keys
  `graph.bind.<alias>=<resourceName|resourceId>` — matching the existing
  `--bind <alias=id>` contract after name resolution — so a package with several
  aliases is expressible. The invented `repository:home` typed-reference syntax
  is dropped.
- **Secret rules are route-specific, not one blanket rule.** API-key and custom
  routes accept a secret only as `*.valueFile=<path>`; `-` (stdin) is rejected in
  `--answers` mode because it cannot be scripted unambiguously. An inline
  `*.value=` key is rejected by a **secret-specific** rule (not merely as an
  unknown key) and the rejection never echoes the value. The OAuth route
  delegates entirely to the existing `login provider` path; setup never reads,
  stores, serialises, or logs a token or device code. Interactive mode prompts
  for a **path**, never for a secret. The rule under test is that no secret
  _contents_ reach stdout, stderr, any event payload, or any persisted JSON —
  ordinary values such as the project name are printed and that is correct.
- **Embedded credentials in a remote URL are caught before they can be echoed.**
  Setup validates `repository.remoteUrl` and refuses with a **redacted** message,
  because `EmbeddedCredentialError` interpolates the raw URL into its message
  (`src/domain/resource.ts:84`) and would otherwise print an embedded token.
- **Provider verification runs only when the provider is created or changed.**
  A no-op rerun does not re-test and therefore cannot re-bill; this follows from
  reconciliation and needs no new storage. Consent is scoped to the configuration
  being tested: `provider.confirmCost=true` authorises the provider described by
  the current answers only, and a changed model/endpoint/route/credential
  requires consent again. The test uses a fixed prompt with a bounded timeout; a
  failure leaves the provider registered but the step unsatisfied, and says so.
  The call count is asserted, not assumed.
- **Orchestration lives in the driving adapter.** The step sequence is executed by
  `src/apps/cli/setup/run-setup.ts`, which calls the same use cases the
  individual leaves call. No use case calls another use case, and nothing under
  `src/app/` imports `src/apps/cli/credential-input.ts` — the coordinator is
  already inside `apps/cli/`, so it uses that path directly.
- **Interactive mode is specified and tested through an injected prompt seam**
  (scripted `CliIo`, no real TTY): prompt order, per-answer validation with
  re-prompt on invalid input, answers-file values take precedence and are not
  re-prompted, EOF/Ctrl-C aborts before the current step's write, and a non-TTY
  stdin without `--answers` fails rather than hanging. OAuth uses a fake login
  adapter in tests.
- **It starts no daemon and runs no task.** Asserted by no job ever reaching
  `running` and no `task.started` / `agent.started` event.

Proof: `scripts/e2e/guided-setup-proof.sh` — deterministic, no model, no network
beyond a local `file://` remote, `HOME` redirected into the run's temp directory
so nothing can touch the real `~/.kanthord`. Run from the repo root:

```bash
scripts/e2e/guided-setup-proof.sh
```

It must print `015 ok: …`.

## Stories

1. **`SetupPlan` + observed facts.** `src/app/project/setup-plan.ts` (zero I/O)
   plus the identity-rich `observedFacts` query it consumes. Owns the four
   reconciliation outcomes, the route branches, project-name multiplicity, and
   the two terminal states.

2. **Answer file parsing + preflight validation.** The enumerated closed key set,
   the pinned grammar, repeated `graph.bind.<alias>` keys, route-relevance
   checks, and the secret-specific rejection of inline values. Nothing is written
   until validation passes.

3. **Drift reporting.** Expected-vs-actual per field with a remediation command,
   for every mutable answer.

4. **Step execution + per-step verification.** `src/apps/cli/setup/run-setup.ts`
   calls existing use cases in order; the repository step gates on 014's
   `ls-remote` probe (remote reachable AND branch present) and on the
   embedded-credential refusal; the provider step gates on one consented test,
   run only on create/change.

5. **`setup project` CLI leaf + interactive prompt seam.** `--answers`,
   `--non-interactive`, the injected prompt abstraction, `Usage` + `Example`
   help, and the closing output: project id, readiness verdict, and the exact
   next command.

## Decisions

- **Reconciliation over identity, not readiness-as-state** (debate 2026-07-27).
  014 answers "is a repository configured", never "is it the repository these
  answers describe". Deriving resume from readiness would silently accept a stale
  remote, a stale provider, an incomplete OAuth login, or the wrong graph.
- **Drift fails; it does not auto-fix.** Silently rewriting a working project
  because an answers file changed is the worst outcome available. A reconcile
  flag can come later with its own design.
- **Preflight atomicity for answers; resume is for failed or interrupted steps.**
  These are different things, and the first draft conflated them: it promised
  "writes nothing" while its own Proof expected partial writes from a missing
  answer.
- **Verification on create/change only.** Gives "test once" without a durable
  verification record, and makes a no-op rerun free.
- **Consent is configuration-scoped.** A standing `confirmCost=true` in a file
  must not authorise billing for a provider the user later changed.
- **Orchestration sits in `apps/cli/`, the plan sits in `app/`.** This is the
  only split that keeps AGENTS.md's no-use-case-calls-use-case rule and the
  import direction intact.
- **Two terminal successes.** Without a graph there is no work, so claiming "can
  execute work" would be false; `configured-no-work` says so and names the import
  command.
- **`setup project`** — a new verb group; no collision with `check` or with EPIC
  009.4's agent-driven `project onboard`.

## Non-goals

- **No `--reconcile` / `--force` drift resolution.**
- **No graph authoring** — the graph step imports an existing package or is
  skipped.
- **No notification step** — no notifier exists in `src`.
- **No daemon supervision, service install, or background process.**
- **No multi-repository fan-out in one run** — one repository per run; more are
  added with `create repository`.
- **No re-implementation of any existing command's logic, and no new resource,
  provider, or credential code.**
- **No fix to `EmbeddedCredentialError`'s message.** Setup refuses before that
  error can fire; redacting the domain message itself is a separate small change
  (see blockers).
- **No database migration** — this epic adds no table and no column.
