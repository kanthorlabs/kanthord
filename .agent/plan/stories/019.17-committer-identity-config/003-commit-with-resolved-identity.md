# Story 003 - commit with the resolved identity

Epic: `.agent/plan/epics/019.17-committer-identity-config.md`

## Goal

The `git.commit` broker verb commits with the resolved committer identity applied
explicitly, so a commit is authored/committed by that identity even when the
checkout's ambient git config is empty. When no identity is configured, the daemon
does not produce an anonymous/failed commit — it escalates.

## Acceptance Criteria

- Given a git repo whose **ambient `user.name`/`user.email` are unset**, submitting
  `git.commit` with a resolved identity `{ name, email }` and staged changes produces
  a commit whose author **and** committer are exactly that `name <email>` (verifiable
  via `git log`), and `poll_status` returns `done`.
- In the live run-loop delivery, the identity applied to the commit is the one
  **resolved for the task's slot** (slot override → global default, per Story 002).
- When the resolved identity is **unconfigured**, the run-loop does **not** submit a
  commit; it records an escalation inbox item (reason names the missing committer
  identity) and the task does not deliver an anonymous commit.

## Constraints

- **Explicit `-c` flags** — the adapter runs `git -c user.name=<name> -c
  user.email=<email> commit -m <message>` (Ulrich decision 2026-07-13); it must not
  rely on ambient/global git config and must not write persistent config. Extend the
  `git.commit` verb payload (`GitCommitInput`) with the identity fields.
- **Resolve at the run-loop** — the run-loop resolves the identity (Story 002) before
  the commit step (`src/daemon/run-loop.ts`, Epic 019.16 S001 stage+commit block) and
  passes it into the `git.commit` submit; the adapter stays a pure executor of its
  payload.
- **Escalate, don't silent-commit** — reuse `createEscalationItem`
  (`src/inbox/inbox.ts`) for the unconfigured case; do not fall back to an anonymous
  commit.
- Backward compatibility: keep the adapter working when identity fields are provided;
  the run-loop is the only caller that must supply them for the live path.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing
  `git-local` / `run-loop` tests pass; guard green.

### Task T1 - git.commit applies the identity via -c flags

**Input:** `src/broker/verbs/git-local.ts`, `src/broker/verbs/git-local.test.ts`

**Action - RED:** a hermetic test creates a temp repo with **empty ambient git
config** (no user.name/email), stages a change, submits `git.commit` with `{ cwd,
message, name: "Ada Lovelace", email: "ada@example.com" }`, then asserts `git log -1
--pretty='%an <%ae>|%cn <%ce>'` shows `Ada Lovelace <ada@example.com>` for both
author and committer, and `poll_status` is `done`. Fails today (adapter ignores
identity; commit would fail "Author identity unknown").

**Action - GREEN:** extend `GitCommitInput` with optional `name`/`email`; when both
are present, `makeCommitAdapter`'s submit runs `git -c user.name=<name> -c
user.email=<email> commit -m <message>` (prepend the `-c` args); otherwise the
existing behavior is unchanged.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/broker/verbs/git-local.test.ts` green.

### Task T2 - run-loop resolves + passes identity, escalates when unconfigured

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a run-loop test with fake `git.add`/`git.commit` adapters and a
resolved identity injected asserts (a) the `git.commit` submit payload carries the
resolved `name`/`email`; and a second case with an **unconfigured** identity asserts
no `git.commit` submit is made and an escalation inbox item is created naming the
missing committer identity. Fails today (run-loop passes no identity, always commits).

**Action - GREEN:** in the stage+commit block (Epic 019.16 S001), resolve the
committer identity for the task's slot (Story 002) from a new run-loop dep (e.g.
`deps.resolveCommitterIdentity` / injected identity); when configured, include
`name`/`email` in the `git.commit` submit payload; when unconfigured, skip the commit
and `createEscalationItem` (reason: committer identity not configured).

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.
