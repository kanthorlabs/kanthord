# Story 05 — `update` verb group (5 leaves)

Epic: `.agent/plan/epics/007.2-migrate-cli-to-commander-js.md`
Requires: Story 01 (shell). Independent of Stories 02–04.

## Goal

Migrate the five `update` routes to Commander leaves under an `update` parent,
wired into `buildProgram`: `update ai-provider|credential|repository|
notification|filesystem`. Same handlers, same values, Commander only —
including the `--clear-*` boolean flags and the credential secret reader.

## Locked contracts

```ts
// commands/update/{ai-provider,credential,repository,notification,filesystem}.ts
// commands/update.ts -> buildUpdateCommand(deps, io)
buildUpdateAiProviderCommand; // --id [--name] [--model] [--effort] [--clear-effort] [--clear-base-url]
buildUpdateCredentialCommand; // --id [--name] [--value-file <path|->] [--value-timeout <dur>]
buildUpdateRepositoryCommand; // --id [--name] [--branch] [--remote-url] [--reclone]
buildUpdateNotificationCommand; // --id [--name] [--destination]
buildUpdateFilesystemCommand; // --id [--name] [--path]
```

Follow the Story 02 mapping rule. Kebab keys the handlers read:
`"value-file"`, `"value-timeout"`, `"remote-url"`, `"clear-effort"`,
`"clear-base-url"`. `--id` is required on all five; every other flag optional.

## Verification Gate

`node --test src/apps/cli/commands/update.test.ts` green; existing
`update-resource.test.ts`, `resource.test.ts`, `credential-input.test.ts` still
green; `npm run typecheck` 0; `npm run lint` clean.

---

### Task T1 — `update` parent + `update ai-provider` (clear flags)

**Requires:** Story 01 T4.

**Input:** `commands/update.ts`, `commands/update/ai-provider.ts` (new),
`commands/update.test.ts` (new), `src/apps/cli/resource.ts`.

**Action — RED:** `update ai-provider --id x --model m --effort high
--clear-base-url` calls `runUpdateAiProvider` with `{ id:"x", model:"m",
effort:"high", "clear-base-url":true }` (kebab keys; `--clear-effort` absent →
falsy); missing `--id` rejects. `--help` documents `--effort` values and what
each `--clear-*` flag does. Assert spy + `cap`. Fails today: modules missing.

**Action — GREEN:** create `update/ai-provider.ts` (required `--id`; optional
`--name/--model/--effort`; boolean `--clear-effort/--clear-base-url`; map to
kebab keys) and `update.ts` (`new Command("update")…showHelpAfterError()` +
addCommand). Values documented in help, no `.choices()`.

**Action — REFACTOR:** none.

**Output:** `update ai-provider` migrated with clear flags.

**Verify:** `node --test src/apps/cli/commands/update.test.ts` green.

---

### Task T2 — `update credential` (TTY / stdin / `--value-file`)

**Requires:** T1.

**Input:** `commands/update/credential.ts` (new), `commands/update.ts`,
`commands/update.test.ts`, `src/apps/cli/resource.ts`,
`src/apps/cli/credential-input.ts`.

**Action — RED:** `update credential --id x --value-file -` calls
`runUpdateCredential(args, deps.updateCredential, { tty, stdin })` with `args`
carrying `{ id, "value-file", "value-timeout"?, name? }` and the third argument
the reader object; `--help` example uses `--value-file`, never a secret. Assert
spy + `cap`. Fails today: leaf missing.

**Action — GREEN:** create `update/credential.ts` reproducing the reader
construction verbatim (`{ tty: process.stdin.isTTY ? process.stdin : undefined,
stdin: process.stdin }`) and calling `runUpdateCredential(args,
deps.updateCredential, reader)`. Register in `update.ts`.

**Action — REFACTOR:** none.

**Output:** `update credential` migrated; secret path unchanged.

**Verify:** `node --test src/apps/cli/commands/update.test.ts` green; existing
`credential-input.test.ts` still green.

---

### Task T3 — `update repository` / `notification` / `filesystem`

**Requires:** T1.

**Input:** `commands/update/{repository,notification,filesystem}.ts` (new),
`commands/update.ts`, `commands/update.test.ts`, `src/apps/cli/resource.ts`.

**Action — RED:** `update repository --id x --branch b --remote-url u --reclone`
→ `runUpdateRepository` with `{ id, branch, "remote-url":u, reclone:true }`;
`update notification --id x --destination d` → `runUpdateNotification`; `update
filesystem --id x --path p` → `runUpdateFilesystem`. Assert spies + `cap`. Fails
today: leaves missing.

**Action — GREEN:** create the three leaves (required `--id`; optional flags per
contract; `--reclone` boolean; kebab keys) and register in `update.ts`.

**Action — REFACTOR:** none.

**Output:** all five `update` leaves migrated.

**Verify:** `node --test src/apps/cli/commands/update.test.ts` green; existing
`update-resource.test.ts` still green.

---

### Task T4 — wire `update` into `buildProgram`

**Requires:** T1–T3.

**Input:** `src/apps/cli/index.ts`, `src/apps/cli/index.test.ts`.

**Action — RED:** `buildProgram` `--help` lists `update`; parsing `["update",
"ai-provider","--id","x","--model","m"]` runs `runUpdateAiProvider`. Fails today:
not added.

**Action — GREEN:** `program.addCommand(buildUpdateCommand(deps, io))`.

**Action — REFACTOR:** none.

**Output:** the `update` group is reachable from the root.

**Verify:** `node --test src/apps/cli/index.test.ts` green; `npm run typecheck`
0; `npm run lint` clean.
